import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
export function createServer(root, productId) {
  const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.pdf': 'application/pdf' };
  return http.createServer(async (req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      let uri = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (productId && uri === '/doc') { res.writeHead(301, { Location: '/doc/' }); res.end(); return; }
      if (productId && uri.startsWith('/doc/')) uri = `/products/${productId}/${uri.slice(5)}`;
      if (uri.endsWith('/')) uri += 'index.html';
      const file = path.resolve(root, '.' + uri);
      if (!file.startsWith(root + path.sep)) throw new Error('invalid path');
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', ...(file.endsWith('.pdf') ? { 'X-Robots-Tag': 'noindex' } : {}) });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('页面不存在'); }
  });
}
