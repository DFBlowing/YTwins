/**
 * The local web server.
 *
 * Binds the loopback address only — this product is a private, single-user thing
 * on one machine, and it must never be reachable from the network. It serves
 * the built web page and the small API the page talks to.
 *
 * **The API key boundary lives here.** Any credential for a cloud provider is
 * read from the server's environment and used only on this side; nothing that
 * reaches the browser ever carries one. The provider wired up at this stage is
 * the local demo stand-in, which holds no credential at all — so the boundary
 * is intact for the strongest possible reason, not merely by convention.
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

import { createDomain } from '../domain/core.ts';
import type { Domain } from '../domain/interface.ts';
import { openSqliteStore } from '../domain/sqlite-store.ts';
import { createDemoProvider } from './demo-provider.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
/** Where `vite build` puts the page. */
const WEB_DIST = join(REPO_ROOT, 'dist', 'web');
/** Where the SQLite file lives. Ignored by git — it is this machine's data. */
const DEFAULT_DB = join(REPO_ROOT, 'data', 'ytwins.sqlite');

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
 * Build the request handler around one domain instance.
 *
 * Exported so the routing can be exercised without opening a socket.
 *
 * @param domain - the domain core every request goes through.
 * @returns the handler.
 */
export function createHandler(domain: Domain) {
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
    // one before it. Read-only by construction — there is no write endpoint
    // here, because settling needs no participation from the user. The two
    // things the user may do to a conclusion arrive with ticket 10.
    if (request.method === 'GET' && url === '/api/conclusions') {
      try {
        const conclusions = await domain.listConclusions();
        sendJson(response, 200, { conclusions });
      } catch {
        sendJson(response, 500, { error: '读取失败' });
      }
      return;
    }

    if (request.method === 'GET') {
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
  // The provider is the demo's stand-in: tickets 01–11 all run on a fake, and
  // the real one arrives in ticket 12 together with the key a human must supply.
  // It has to be wired up even so — without it, asking a question could only
  // ever come back "found nothing", and act two would have nothing to show.
  const store = openSqliteStore(process.env['YTwins_DB'] ?? DEFAULT_DB);
  const domain = createDomain({ store, provider: createDemoProvider() });

  const server = createServer((request, response) => {
    // One handler rejection must never be an unhandled rejection: that would
    // kill the process and lose the user's session over a single bad request.
    createHandler(domain)(request, response).catch(() => {
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
