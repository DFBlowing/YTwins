/**
 * The local web server.
 *
 * Binds the loopback address only — this product is a private, single-user thing
 * on one machine, and it must never be reachable from the network. It serves
 * the built web page and the small API the page talks to.
 *
 * **The API key boundary lives here.** Any credential for a cloud provider is
 * read from the server's environment and used only on this side; nothing that
 * reaches the browser ever carries one. At this stage no provider is wired up
 * at all, which is the strongest form of that guarantee.
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
  // No AI provider is wired up yet: tickets 01–11 all run on a fake, and the
  // real one arrives in ticket 12 together with the key a human must supply.
  const store = openSqliteStore(process.env['YTwins_DB'] ?? DEFAULT_DB);
  const domain = createDomain({ store });

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
