// Local stand-in for Spacefast: serves ./site, sends everything else to
// site/handler.js, and backs env.DB with a SQLite file instead of the Space's
// database. Not used in production.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import handler from './site/handler.js';
import { build } from './scripts/build-components.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.join(ROOT, 'site');
const PRIVATE = new Set(['handler.js', 'sf.jsonc']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// The slice of the D1 API that handler.js uses.
export function createLocalDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new DatabaseSync(file);
  return {
    prepare(sql) {
      const bound = (args) => ({
        all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
        run: async () => {
          sqlite.prepare(sql).run(...args);
          return { success: true };
        },
      });
      return { ...bound([]), bind: (...args) => bound(args) };
    },
  };
}

function staticFile(pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(SITE_DIR, rel);
  if (!file.startsWith(SITE_DIR + path.sep) || PRIVATE.has(rel)) return null;
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

export function createServer(db) {
  const env = { DB: db };
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === '/components.json') build(); // pick up component edits without a restart

      const file = req.method === 'GET' ? staticFile(pathname) : null;
      if (file) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(fs.readFileSync(file));
        return;
      }

      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const response = await handler.fetch(
        new Request(url, { method: req.method, headers: req.headers, body: hasBody ? Buffer.concat(chunks) : undefined }),
        env
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      console.error(err);
      res.writeHead(500).end('Dev server error');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const dbFile = process.env.DB_FILE || path.join(ROOT, 'data', 'votes.sqlite');
  createServer(createLocalDb(dbFile)).listen(port, () => {
    console.log(`Component Vote (local dev) running at http://localhost:${port}`);
  });
}
