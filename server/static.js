import fs from 'node:fs/promises';
import path from 'node:path';

const MIME_BY_EXT = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function safeJoin(rootDir, reqPath) {
  const normalized = path.posix.normalize(reqPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const resolved = path.resolve(rootDir, normalized);
  if (!resolved.startsWith(path.resolve(rootDir))) return null;
  return resolved;
}

export async function serveStatic({ req, res, roots }) {
  if (!req.url) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  const url = new URL(req.url, 'http://local');
  const pathname = decodeURIComponent(url.pathname);

  for (const root of roots) {
    if (!pathname.startsWith(root.urlPrefix)) continue;
    const rest = pathname.slice(root.urlPrefix.length);
    const rel = rest === '' ? root.defaultFile ?? '' : rest;
    const abs = safeJoin(root.dir, rel);
    if (!abs) continue;

    try {
      const stat = await fs.stat(abs);
      if (stat.isDirectory()) continue;
      const ext = path.extname(abs).toLowerCase();
      const mime = MIME_BY_EXT.get(ext) ?? 'application/octet-stream';
      res.writeHead(200, {
        'content-type': mime,
        'cache-control': 'no-store',
      });
      if (req.method === 'HEAD') {
        res.end();
        return true;
      }
      const buf = await fs.readFile(abs);
      res.end(buf);
      return true;
    } catch {
      // fallthrough
    }
  }

  return false;
}

