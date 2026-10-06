import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from './server.mjs';
const root = path.resolve('dist'), manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json')));
let checked = 0;
const articlesOnly = process.argv.includes('--articles-only');
for (const p of articlesOnly ? [] : manifest.products) {
  const server = createServer(root, p.id); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const name of ['index', ...p.chapters.map(c => c.key)]) {
      const file = path.join(root, 'products', p.id, name + '.html'), html = await fs.readFile(file, 'utf8');
      if (!html.includes('<article>') || !html.includes('<h1') || !html.includes('application/ld+json') || !html.includes('rel="canonical"')) throw new Error(`SEO 正文或元数据缺失：${file}`);
      for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const href = m[1].replaceAll('&amp;', '&');
        if (!href.startsWith(p.basePath)) continue;
        const r = await fetch(local + href.split('#')[0]); if (!r.ok) throw new Error(`输出链接失效：${file} → ${href} (${r.status})`);
      }
      checked++;
    }
    for (const name of ['manual', ...p.chapters.map(c => c.key)]) {
      const data = await fs.readFile(path.join(root, 'products', p.id, 'pdfs', name + '.pdf'));
      if (data.subarray(0, 5).toString() !== '%PDF-' || data.length < 1000) throw new Error(`PDF 无效：${name}`);
    }
    if ((await fetch(local + '/doc/not-found.html')).status !== 404) throw new Error('缺失章节必须返回 404');
    if ((await fetch(local + '/doc/pdfs/manual.pdf')).headers.get('x-robots-tag') !== 'noindex') throw new Error('PDF 索引头缺失');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
if (manifest.articles) {
  const a = manifest.articles;
  const server = createServer(root); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const name of ['index', ...a.chapters.map(c => c.key)]) {
      const html = await fs.readFile(path.join(root, 'articles', name + '.html'), 'utf8');
      if (!html.includes('<article>') || !html.includes('<h1') || !html.includes('application/ld+json') || !html.includes('rel="canonical"')) throw new Error(`技术分享正文或元数据缺失：${name}`);
      for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const href = m[1].replaceAll('&amp;', '&');
        if (!href.startsWith(a.basePath)) continue;
        const response = await fetch(local + href.split('#')[0]);
        if (!response.ok) throw new Error(`文章输出链接失效：${name} → ${href} (${response.status})`);
      }
      checked++;
    }
    for (const c of a.chapters) {
      const data = await fs.readFile(path.join(root, 'articles', 'pdfs', c.key + '.pdf'));
      if (data.subarray(0, 5).toString() !== '%PDF-' || data.length < 1000) throw new Error(`文章 PDF 无效：${c.key}`);
      if ((await fetch(`${local}${a.basePath}pdfs/${encodeURIComponent(c.key)}.pdf`)).headers.get('x-robots-tag') !== 'noindex') throw new Error('文章 PDF 索引头缺失');
    }
    if ((await fetch(local + a.basePath + 'not-found.html')).status !== 404) throw new Error('缺失文章必须返回 404');
    if (!(await fetch(local + a.basePath + 'sitemap.xml')).ok) throw new Error('文章 sitemap 缺失');
    const rawFiles = await fs.readdir(path.join(root, 'articles'));
    if (rawFiles.some(f => /\.md$/i.test(f))) throw new Error('不得发布文章 Markdown 源文件');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
console.log(`验证通过：${checked} 个 HTML 页面、全部本地链接、${articlesOnly ? '文章' : '产品及文章'} PDF、404 与 PDF 索引控制`);
