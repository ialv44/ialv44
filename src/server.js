import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { handle, routeList } from './api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function readBody(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  // Resolve then confirm containment: blocks ../ traversal out of public/.
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== path.join(PUBLIC_DIR, 'index.html')) {
    return send(res, 403, { error: 'forbidden' });
  }
  try {
    const data = await fsp.readFile(file);
    return send(res, 200, data, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  } catch {
    return send(res, 404, { error: 'not found' });
  }
}

export function createServer(store) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);

    let body = null;
    try {
      body = await readBody(req);
    } catch (err) {
      return send(res, 400, { error: err.message });
    }

    const query = Object.fromEntries(url.searchParams);
    const result = await handle(store, req.method, url.pathname, body, query);
    return send(res, result.status, result.body);
  });
}

export function startServer(store, port = config.port) {
  const server = createServer(store);
  server.listen(port, () => {
    const mode = config.apiKey ? `agent: ${config.model}` : 'agent: offline (no ANTHROPIC_API_KEY)';
    console.log(`Thirdplace on http://localhost:${port}  (${mode})`);
    console.log(`db: ${config.dbPath}`);
    if (!fs.existsSync(PUBLIC_DIR)) console.warn('warning: public/ missing, API only');
    console.log(`${routeList.length} endpoints`);
  });
  return server;
}
