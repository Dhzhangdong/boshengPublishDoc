import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { discover, renderMarkdown, pageHTML, printHTML, chapterURL, escape } from './core.mjs';
import { createServer } from './server.mjs';
const root = process.cwd(), out = path.join(root, 'dist'), strict = process.env.DOC_STRICT_GIT === '1';
const htmlOnly = process.argv.includes('--html-only');
const products = await discover(root, strict);
// Only this fixed generated directory may be replaced; never remove source directories.
if (path.dirname(out) !== root || path.basename(out) !== 'dist') throw new Error('Invalid output path');
await fs.rm(out, { recursive: true, force: true }); await fs.mkdir(out, { recursive: true });
const printCSS = await fs.readFile(path.join(root, 'assets/print.css'), 'utf8');
const manifest = { version: 1, products: [] }, printJobs = [];
async function copyAssets(from, to) {
  for (const item of await fs.readdir(from, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error(`不支持符号链接：${item.name}`);
    const src = path.join(from, item.name), dest = path.join(to, item.name);
    if (item.isDirectory()) { await fs.mkdir(dest, { recursive: true }); await copyAssets(src, dest); }
    else if (/\.(png|jpe?g|gif|webp|svg|pdf)$/i.test(item.name)) await fs.copyFile(src, dest);
  }
}
for (const p of products) {
  const dest = path.join(out, 'products', p.id); await fs.mkdir(path.join(dest, 'assets'), { recursive: true });
  await fs.mkdir(path.join(dest, 'pdfs'), { recursive: true });
  await copyAssets(p.directory, dest);
  await fs.copyFile(path.join(root, 'assets/site.css'), path.join(dest, 'assets/site.css'));
  const contents = [];
  for (const c of p.chapters) {
    const content = renderMarkdown(root, products, p, c);
    await fs.writeFile(path.join(dest, c.key + '.html'), pageHTML(p, c, content));
    contents.push(renderMarkdown(root, products, p, c, true));
  }
  await fs.copyFile(path.join(dest, p.chapters[0].key + '.html'), path.join(dest, 'index.html'));
  const urls = p.chapters.map(c => `<url><loc>${escape(chapterURL(p, c))}</loc>${c.updated ? `<lastmod>${escape(c.updated)}</lastmod>` : ''}</url>`).join('');
  await fs.writeFile(path.join(dest, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  for (const c of p.chapters) printJobs.push({ p, name: c.key, html: printHTML(p, [c], [renderMarkdown(root, products, p, c, 'chapter')], printCSS) });
  printJobs.push({ p, name: 'manual', html: printHTML(p, p.chapters, contents, printCSS) });
  manifest.products.push({ id: p.id, name: p.name, origin: p.origin, basePath: p.basePath, chapters: p.chapters.map(({ key, title, filename, updated, created, dirty }) => ({ key, title, filename, updated, created, dirty })) });
}
await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
await fs.writeFile(path.join(out, 'health.json'), JSON.stringify({ status: 'ok', products: products.length }));
await fs.writeFile(path.join(out, 'health-probes.txt'), `/products/${products[0].id}/${products[0].chapters[0].key}.html\n/products/${products[0].id}/pdfs/manual.pdf\n`);
await fs.writeFile(path.join(out, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>博生产品文档服务</title></head><body><h1>产品说明书</h1><ul>${products.map(p => `<li><a href="${p.origin}${p.basePath}">${escape(p.name)}</a></li>`).join('')}</ul></body></html>`);
if (!htmlOnly) {
  const server = createServer(out); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.DOC_BROWSER_EXECUTABLE ? { executablePath: process.env.DOC_BROWSER_EXECUTABLE } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url().startsWith(address + '/') ? route.continue() : route.abort());
    for (const job of printJobs) {
      const file = path.join(out, 'products', job.p.id, '_print.html'); await fs.writeFile(file, job.html);
      await page.goto(`${address}/products/${job.p.id}/_print.html`, { waitUntil: 'networkidle' });
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(async img => { await img.decode(); if (!img.naturalWidth) throw new Error('图片无法加载：' + img.src); })); });
      await page.pdf({ path: path.join(out, 'products', job.p.id, 'pdfs', job.name + '.pdf'), format: 'A4', preferCSSPageSize: true, printBackground: true, tagged: true, outline: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: `<div style="width:100%;font-size:9px;color:#657469;margin:0 16mm;display:flex;justify-content:space-between"><span>${escape(job.p.name)} · 产品说明书</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>` });
      console.log(`PDF ${job.p.id}/${job.name}.pdf`);
    }
  } finally {
    if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    for (const p of products) await fs.rm(path.join(out, 'products', p.id, '_print.html'), { force: true });
  }
}
console.log(`已生成 ${products.length} 个产品，${products.reduce((n, p) => n + p.chapters.length, 0)} 个章节${htmlOnly ? '（仅 HTML）' : '及逐章、整本 PDF'}`);
