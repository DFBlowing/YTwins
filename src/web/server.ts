/**
 * The local web server.
 *
 * Binds the loopback address only — this product is a private, single-user thing
 * on one machine, and it must never be reachable from the network. It serves
 * the built web page and the small API the page talks to.
 *
 * **The API key boundary lives here.** Any credential for a cloud provider is
 * read from the server's environment — and from a `.env` file beside the
 * repository, which git ignores — and is used only on this side: it goes into
 * the provider wired up below, and nothing that reaches the browser ever
 * carries one. The page has no route that could return it, because the domain
 * never sees it and the provider is not part of anything the API serialises.
 *
 * Run it with: `node src/web/server.ts`
 *
 * @module web/server
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ProviderConfigError, resolveProviderConfig, type ProviderConfig } from '../ai/config.ts';
import { loadEnvFile } from '../ai/env-file.ts';
import { createDomain } from '../domain/core.ts';
import { isDeletionMode, type Domain } from '../domain/interface.ts';
import { PRESET_ACTS, seedPreset, type PresetActs } from '../domain/preset.ts';
import { openSqliteStore } from '../domain/sqlite-store.ts';
import { createConfiguredProvider } from './provider.ts';
import { describeDataBoundary, type DataBoundary } from './privacy.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
/** Where `vite build` puts the page. */
const WEB_DIST = join(REPO_ROOT, 'dist', 'web');
/** Where the SQLite file lives. Ignored by git — it is this machine's data. */
const DEFAULT_DB = join(REPO_ROOT, 'data', 'ytwins.sqlite');
/** The file a demo gets by default, so its reset cannot empty the one above. */
const DEFAULT_DEMO_DB = join(REPO_ROOT, 'data', 'demo.sqlite');
/** Where the API key lives, when one is needed. Ignored by git. */
const ENV_FILE = join(REPO_ROOT, '.env');

/** Loopback only. `0.0.0.0` would expose the user's drops to the network. */
const HOST = '127.0.0.1';
const PORT = Number(process.env['YTwins_PORT'] ?? 5273);

/** Content types for the handful of files a built page consists of. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

/** Read a request body, capped so a runaway client cannot exhaust memory. */
async function readBody(request: IncomingMessage, limitBytes = 64 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limitBytes) throw new Error('request body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Resolve a URL path to a regular file inside the built page, or null.
 *
 * Containment is checked after normalising, so a crafted path cannot escape the
 * build directory and serve something else on disk. Directories are rejected:
 * `/` normalises to the build directory itself, and handing that to `readFile`
 * raises `EISDIR` — which would take the whole server down over a page request.
 */
function resolveStaticFile(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  const candidate = join(WEB_DIST, relative);
  if (candidate !== WEB_DIST && !candidate.startsWith(WEB_DIST + sep)) return null;
  if (candidate === WEB_DIST) return null;
  return statSync(candidate, { throwIfNoEntry: false })?.isFile() === true ? candidate : null;
}

async function serveStatic(response: ServerResponse, file: string): Promise<void> {
  const body = await readFile(file);
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': body.length,
  });
  response.end(body);
}

/**
 * The demo's own two routes, handed in only where a demo was asked for.
 *
 * There is deliberately no way to reach a reset on a server started without
 * `YTwins_PROVIDER=demo`: emptying the library is not an operation the product
 * has (deletion is the previewed, one-fragment-at-a-time operation above), and a
 * request shape that wiped everything must not exist on a server somebody is
 * using for real.
 */
export interface DemoRoutes {
  /** The three acts, exactly as the preset material holds them. */
  readonly acts: PresetActs;
  /** Empty this machine's library and lay the preset material down again. */
  reset(): Promise<void>;
}

/** What the handler needs besides the domain, if the server knows it. */
export interface HandlerOptions {
  /**
   * What leaves this machine, in the user's terms.
   *
   * Absent means this server was not told, and the page is told that it was not
   * told — a disclosure nobody made must not be able to render as a reassurance.
   */
  readonly boundary?: DataBoundary;
  /** The demo's routes, present only where a demo was asked for. */
  readonly demo?: DemoRoutes;
}

/**
 * Build the request handler around one domain instance.
 *
 * Exported so the routing can be exercised without opening a socket.
 *
 * @param domain - the domain core every request goes through.
 * @param options - the boundary and the demo routes, when this server has them.
 * @returns the handler.
 */
export function createHandler(domain: Domain, options: HandlerOptions = {}) {
  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = request.url ?? '/';

    // Drop one piece of text. The page's only write.
    if (request.method === 'POST' && url === '/api/drop') {
      try {
        const parsed = JSON.parse(await readBody(request)) as { body?: unknown };
        const body = typeof parsed.body === 'string' ? parsed.body : '';
        if (body.trim().length === 0) {
          sendJson(response, 400, { error: '投递内容是空的' });
          return;
        }
        const result = await domain.drop(body);
        // The id travels back because the items are not known yet: extraction
        // is asynchronous to recording, so the page asks about this drop again
        // rather than being made to wait for an answer that may never come.
        sendJson(response, 200, { id: result.id, body: result.body, reply: result.reply });
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : '投递失败',
        });
      }
      return;
    }

    // Ask a question of what has been kept. The answer and the drop it came from
    // travel back together: the page shows the source so the user can check the
    // answer against their own words.
    if (request.method === 'POST' && url === '/api/recall') {
      try {
        const parsed = JSON.parse(await readBody(request)) as { question?: unknown; now?: unknown };
        const question = typeof parsed.question === 'string' ? parsed.question : '';
        if (question.trim().length === 0) {
          sendJson(response, 400, { error: '问题内容是空的' });
          return;
        }
        // The pinned moment is the demo's "a few days later" viewpoint. It is
        // only passed through when the page actually sent one, so a request
        // without it gets the real present rather than an invented date.
        const options =
          typeof parsed.now === 'string' && parsed.now.trim().length > 0
            ? { now: parsed.now }
            : undefined;
        const result = await domain.recall(question, options);
        // "Found nothing" is a 200, not a 404. It is a real answer about the
        // user's data, and the page renders it as one — turning it into an error
        // status would push the page towards showing a failure rather than the
        // honest outcome the product promises.
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : '追溯失败',
        });
      }
      return;
    }

    // Ask the product to **surface** one thing it has worked out. Two triggers
    // reach here — a drop that just happened, and the user's own question — and
    // the domain decides whether this is a moment at all, so a request for a
    // turn that is not one comes back 200 with an ordinary reason rather than an
    // error status. Zero answers are normal (cooling down, or nothing sayable
    // yet), and turning them into failures would push the page towards showing a
    // problem where the honest outcome is silence.
    if (request.method === 'POST' && url === '/api/surface') {
      try {
        const parsed = JSON.parse(await readBody(request)) as { dropId?: unknown };
        const dropId = typeof parsed.dropId === 'string' ? parsed.dropId : '';
        const result = await domain.requestSurfacing(
          dropId.length > 0 ? { dropId } : undefined,
        );
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : '浮现失败',
        });
      }
      return;
    }

    // Everything the page already dropped — this is what survives a refresh.
    if (request.method === 'GET' && url === '/api/drops') {
      try {
        const drops = await domain.listDrops();
        sendJson(response, 200, { drops });
      } catch {
        sendJson(response, 500, { error: '读取失败' });
      }
      return;
    }

    // One drop, with whatever has been read out of it so far. The page polls
    // this after dropping, which is how it finds out what was caught without
    // the drop itself having waited for extraction.
    if (request.method === 'GET' && url.startsWith('/api/drops/')) {
      try {
        const dropId = decodeURIComponent(url.slice('/api/drops/'.length));
        const drop = await domain.getDrop(dropId);
        if (drop === null) {
          sendJson(response, 404, { error: '没有这次投递' });
          return;
        }
        sendJson(response, 200, { drop });
      } catch {
        sendJson(response, 500, { error: '读取失败' });
      }
      return;
    }

    // What deleting one fragment **would** take, counted before anything is
    // removed (09). The first of deletion's two steps, and the reason it has two:
    // a fragment typed in passing can turn out to be the ground a judgement
    // stands on, and the user is owed that fact before they act on it.
    //
    // A GET, because it changes nothing — asking twice gives the same answer
    // twice, and a page that shows a preview and then does nothing has left the
    // material exactly as it was. The count the spec asks for is the length of
    // `conclusions`; the sentences travel too, so the user can recognize what
    // they would be giving up rather than trusting a number.
    if (request.method === 'GET' && url.startsWith('/api/deletions/')) {
      try {
        const dropId = decodeURIComponent(url.slice('/api/deletions/'.length));
        const preview = await domain.previewDeletion(dropId);
        // Not found is a 404 rather than a 200 with null: unlike "nothing covers
        // this question", there is no honest page state for "the fragment you are
        // about to delete does not exist" — the client asked about a specific row.
        if (preview === null) {
          sendJson(response, 404, { error: '没有这次投递' });
          return;
        }
        sendJson(response, 200, { preview });
      } catch {
        sendJson(response, 500, { error: '读取失败' });
      }
      return;
    }

    // Carry out a deletion (09). The choice is **required** and named: there is
    // deliberately no request shape that deletes by default, because this is the
    // one operation in the product that cannot be undone. `keep` is one of the
    // three accepted answers and removes nothing — the decision the user arrived
    // at by reading the preview counts as a decision.
    if (request.method === 'POST' && url === '/api/delete') {
      try {
        const parsed = JSON.parse(await readBody(request)) as { dropId?: unknown; mode?: unknown };
        const dropId = typeof parsed.dropId === 'string' ? parsed.dropId : '';
        const mode = parsed.mode;
        if (dropId.length === 0) {
          sendJson(response, 400, { error: '没说是哪一次投递' });
          return;
        }
        // An unrecognised mode is refused rather than passed through or defaulted:
        // a page that sent nonsense must hear about it instead of watching the
        // user's material disappear under a choice nobody made.
        if (!isDeletionMode(mode)) {
          sendJson(response, 400, { error: '不认识的删除方式' });
          return;
        }
        const result = await domain.deleteDrop(dropId, mode);
        if (result === null) {
          // Nothing happened: either there is no such fragment, or the user chose
          // to keep it. Both are reported as "nothing was deleted" rather than as
          // an error, because neither is a failure.
          sendJson(response, 200, { deleted: null });
          return;
        }
        sendJson(response, 200, { deleted: result });
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : '删除失败',
        });
      }
      return;
    }

    // Every item caught so far, including the ones with no parsed time. The
    // unscheduled ones are listed deliberately rather than filtered out here:
    // deciding how to show them is the page's business, and silently dropping
    // them at the API would be the one failure the product does not allow.
    if (request.method === 'GET' && url === '/api/items') {
      try {
        const items = await domain.listItems();
        sendJson(response, 200, { items });
      } catch {
        sendJson(response, 500, { error: '读取失败' });
      }
      return;
    }

    // What is still to do, arranged on the timeline (**scheduling**, 08). Two
    // lists rather than one, and the split is the domain's: an item with a time
    // is placed on it, an item without one is kept apart, and neither is dropped.
    // The rule is not restated here — a page that decided the split itself could
    // disagree with the domain about which list an item belongs in.
    if (request.method === 'GET' && url === '/api/upcoming') {
      try {
        sendJson(response, 200, await domain.upcoming());
      } catch {
        sendJson(response, 500, { error: '读取失败' });
      }
      return;
    }

    // Advance one item's state — todo to done, or back again. The product's only
    // write besides dropping, and the only thing the user ever changes
    // (`CONTEXT.md`, 无感: nothing else is asked of them).
    if (request.method === 'POST' && url.startsWith('/api/items/')) {
      try {
        const parsed = JSON.parse(await readBody(request)) as { state?: unknown };
        const state = parsed.state;
        // An unknown state is refused rather than passed through: the domain
        // would default it, and a page that sent nonsense by mistake should hear
        // about it instead of watching the item come back unchanged.
        if (state !== 'todo' && state !== 'done') {
          sendJson(response, 400, { error: '不认识的状态' });
          return;
        }
        const itemId = decodeURIComponent(url.slice('/api/items/'.length));
        if (itemId.length === 0) {
          sendJson(response, 400, { error: '没说是哪一件事' });
          return;
        }
        const item = await domain.setItemState(itemId, state);
        // Not found is a 404 here rather than a 200 with null: unlike "nothing
        // covers this question", there is no honest page state for "the item you
        // just ticked does not exist" — the client asked about a specific row.
        if (item === null) {
          sendJson(response, 404, { error: '没有这件事' });
          return;
        }
        sendJson(response, 200, { item });
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : '改不动这件事',
        });
      }
      return;
    }

    // Every link grown between the user's terms. Its own endpoint rather than
    // part of a drop, because a link belongs to no single drop: it is what the
    // drops added up to. Each one carries its reason and strength, so the page
    // can show why two things are joined rather than only that they are.
    if (request.method === 'GET' && url === '/api/links') {
      try {
        const links = await domain.listLinks();
        sendJson(response, 200, { links });
      } catch {
        sendJson(response, 500, { error: '读取失败' });
      }
      return;
    }

    // The **portrait**, which is also the **conclusion chain**: the conclusions
    // themselves, each with the terms that support it and how it stands to the
    // one before it. Read-only: settling needs no participation from the user,
    // and the only two things that may be written are the revision routes below.
    if (request.method === 'GET' && url === '/api/conclusions') {
      try {
        const conclusions = await domain.listConclusions();
        sendJson(response, 200, { conclusions });
      } catch {
        sendJson(response, 500, { error: '读取失败' });
      }
      return;
    }

    // The two light things the user may do to a conclusion (10), and the only
    // writes the portrait has ever had. Both are named after what the user **did**
    // rather than after what the product stores: `wrong` is the tap on 「不对」,
    // `append` is a sentence written beside the record.
    //
    // Anything else under this path is not an operation and falls through to the
    // 405 at the bottom — which is what makes "there is no rating, no like and no
    // bulk answer" a fact about the server rather than a promise about the page.
    // The two operations take **one** conclusion, named in the path: there is no
    // request shape here that carries a score, or a list.
    if (request.method === 'POST' && url.startsWith('/api/conclusions/')) {
      try {
        const [rawId = '', action = ''] = url.slice('/api/conclusions/'.length).split('/');
        const conclusionId = decodeURIComponent(rawId);
        if (conclusionId.length === 0) {
          sendJson(response, 400, { error: '没说是哪一条小结论' });
          return;
        }

        if (action === 'wrong') {
          // No body: there is nothing to carry. The act is the whole message, and
          // a request that could name a reason would be the beginning of a
          // feedback form.
          const conclusion = await domain.markConclusionWrong(conclusionId);
          // Not found is a 404 rather than a 200 with null: the client asked about
          // a specific record, so there is no honest page state for "it is gone".
          if (conclusion === null) {
            sendJson(response, 404, { error: '没有这条小结论' });
            return;
          }
          sendJson(response, 200, { conclusion });
          return;
        }

        if (action === 'append') {
          const parsed = JSON.parse(await readBody(request)) as { body?: unknown };
          const body = typeof parsed.body === 'string' ? parsed.body : '';
          if (body.trim().length === 0) {
            sendJson(response, 400, { error: '补充内容是空的' });
            return;
          }
          const addition = await domain.appendToConclusion(conclusionId, body);
          if (addition === null) {
            sendJson(response, 404, { error: '没有这条小结论' });
            return;
          }
          sendJson(response, 200, { addition });
          return;
        }
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : '改不动这条小结论',
        });
        return;
      }
    }

    // Which part of what you say leaves this machine (ticket 13). Its own read
    // rather than a line baked into the page, because the honest answer depends
    // on how **this** server is wired: a page stating one combination while the
    // server ran another would be a disclosure that lies. A server that was not
    // told answers 404 rather than an empty pair of lists — "nobody said" and
    // "nothing leaves" are opposite facts.
    if (request.method === 'GET' && url === '/api/privacy') {
      if (options.boundary === undefined) {
        sendJson(response, 404, { error: '这个服务没有说明数据边界' });
        return;
      }
      sendJson(response, 200, { boundary: options.boundary });
      return;
    }

    // The demo's script, and whether there is one at all. A 200 with `demo:
    // null` rather than a 404: the page asks this on every load to decide
    // whether to draw its demo block, and "this server has no demo" is an
    // ordinary answer to that question rather than a missing resource.
    if (request.method === 'GET' && url === '/api/demo') {
      sendJson(response, 200, { demo: options.demo === undefined ? null : { acts: options.demo.acts } });
      return;
    }

    // Start the demo over: empty the library, lay the preset material down
    // again. The one destructive route in the product, and it exists only on a
    // server started in demo mode — see `DemoRoutes`. It takes no body and has
    // no options, because the state it returns to is the whole of what it does.
    if (request.method === 'POST' && url === '/api/demo/reset') {
      if (options.demo === undefined) {
        sendJson(response, 404, { error: '这个服务没有演示模式' });
        return;
      }
      try {
        await options.demo.reset();
        sendJson(response, 200, { demo: { acts: options.demo.acts } });
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : '重新开始演示失败',
        });
      }
      return;
    }

    if (request.method === 'GET') {
      // Nothing under `/api/` is a page. Without this, an unknown API path falls
      // through to the built page and comes back **200 with HTML** — which would
      // make "this server has no such route" invisible (a check asking for
      // `/api/signup` would see a success), and would hand a client that parsed
      // the response as JSON a document instead of an error.
      if (url === '/api' || url.startsWith('/api/')) {
        sendJson(response, 404, { error: '没有这个接口' });
        return;
      }

      const requested = resolveStaticFile(url);
      const file = requested ?? join(WEB_DIST, 'index.html');
      if (statSync(file, { throwIfNoEntry: false })?.isFile() === true) {
        try {
          await serveStatic(response, file);
        } catch {
          // A file that vanished between the check and the read is a 404, not a
          // reason to take the server down with it.
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('找不到这个页面。');
        }
        return;
      }
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('页面尚未构建。先运行 npm run build:web。');
      return;
    }

    response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('不支持的请求方法');
  };
}

async function main(): Promise<void> {
  // The one human step this product has: a key in a file nobody commits. The
  // environment wins over the file, so `YTwins_LLM=local node src/web/server.ts`
  // does what it looks like it does.
  await loadEnvFile(ENV_FILE, process.env);

  let config: ProviderConfig;
  try {
    config = resolveProviderConfig(process.env, { repoRoot: REPO_ROOT });
  } catch (error) {
    // A configuration nobody can act on is worse than no configuration: a typo
    // that quietly picked the cloud over the local model would send the user's
    // fragments off the machine while they believed otherwise. So it is stopped
    // here, with the message naming the variable, rather than started wrong.
    if (error instanceof ProviderConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const { provider, notes } = createConfiguredProvider(config);
  // Where this run keeps its material. A demo gets a file of its own by default,
  // and that is a safety property rather than tidiness: the demo has a button
  // that empties the library, and it must not be able to take the user's own
  // drops with it. `YTwins_DB` still wins when it is set — a person who named a
  // file meant that file.
  const dbFile =
    process.env['YTwins_DB'] ?? (config.choice === 'demo' ? DEFAULT_DEMO_DB : DEFAULT_DB);
  const store = openSqliteStore(dbFile);
  const domain = createDomain({
    store,
    provider,
    // The demo's dice are pinned, and only the demo's. Whether a turn that could
    // speak uses it, which conclusion it shows and which of its band's openings
    // the line carries are all rolls — and the one promise the three acts make is
    // that running them again says the same thing. Pin them and that is a fact;
    // leave them and "run it twice" is a hope. The product itself keeps the real
    // dice, which is where the visible moment's legibility was meant to live.
    ...(config.choice === 'demo' ? { random: (): number => 0 } : {}),
  });

  // The demo's reset, and it is the store's own clearing: the library is emptied
  // and the preset leads are dropped through the ordinary path, so what the acts
  // run on afterwards is a real chain rather than a special state.
  const demo: DemoRoutes | undefined =
    config.choice === 'demo'
      ? {
          acts: PRESET_ACTS,
          reset: async (): Promise<void> => {
            await store.clear();
            await seedPreset(domain);
          },
        }
      : undefined;

  const handler = createHandler(domain, {
    boundary: describeDataBoundary(config),
    ...(demo === undefined ? {} : { demo }),
  });

  // Which pair this machine is actually running, in one line each, and never a
  // key: the notes say whether one is configured, not what it is. This is the
  // only place a person finds out, because the combination is a property of the
  // environment and not of the page.
  for (const note of notes) console.log(note);
  if (config.choice === 'demo') {
    // Said out loud because it is the one thing a presenter has to know before
    // pressing the button that empties the library: which library it empties.
    console.log(`演示模式用的库：${dbFile}（「重新开始演示」清空的是它）`);
  }

  const server = createServer((request, response) => {
    // One handler rejection must never be an unhandled rejection: that would
    // kill the process and lose the user's session over a single bad request.
    handler(request, response).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('服务出错了。');
      } else {
        response.end();
      }
    });
  });

  const shutdown = async (): Promise<void> => {
    server.close();
    await store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  server.listen(PORT, HOST, () => {
    console.log(`YTwins 在 http://${HOST}:${PORT} 上运行（仅本机可访问）`);
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
