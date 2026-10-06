import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { discover, renderMarkdown, pageHTML, printHTML, chapterURL, escape } from './core.mjs';
import { createServer } from './server.mjs';
import { discoverArticles, articleHTML, articleIndexHTML, articlePrintHTML, copyArticleAssets } from './articles.mjs';
const root = process.cwd(), out = path.join(root, 'dist'), strict = process.env.DOC_STRICT_GIT === '1';
const htmlOnly = process.argv.includes('--html-only');
const articlesOnly = process.argv.includes('--articles-only');
const linkedProducts = await discover(root, articlesOnly ? false : strict, !articlesOnly);
const products = articlesOnly ? [] : linkedProducts;
const articles = await discoverArticles(root, strict);
const collections = [...linkedProducts, articles];
// Only this fixed generated directory may be replaced; never remove source directories.
if (path.dirname(out) !== root || path.basename(out) !== 'dist') throw new Error('Invalid output path');
let previous;
if (articlesOnly) {
  try { previous = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await fs.rm(path.join(out, 'articles'), { recursive: true, force: true });
} else await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
const printCSS = await fs.readFile(path.join(root, 'assets/print.css'), 'utf8');
const manifest = { version: 2, products: articlesOnly ? previous?.products || [] : [] }, printJobs = [];
const chapterManifest = chapters => chapters.map(({ key, title, filename, updated, created, dirty }) => ({ key, title, filename, updated, created, dirty }));
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
    const content = renderMarkdown(root, collections, p, c);
    await fs.writeFile(path.join(dest, c.key + '.html'), pageHTML(p, c, content));
    contents.push(renderMarkdown(root, collections, p, c, true));
  }
  await fs.copyFile(path.join(dest, p.chapters[0].key + '.html'), path.join(dest, 'index.html'));
  const urls = p.chapters.map(c => `<url><loc>${escape(chapterURL(p, c))}</loc>${c.updated ? `<lastmod>${escape(c.updated)}</lastmod>` : ''}</url>`).join('');
  await fs.writeFile(path.join(dest, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  for (const c of p.chapters) printJobs.push({ p, name: c.key, html: printHTML(p, [c], [renderMarkdown(root, collections, p, c, 'chapter')], printCSS) });
  printJobs.push({ p, name: 'manual', html: printHTML(p, p.chapters, contents, printCSS) });
  manifest.products.push({ id: p.id, name: p.name, origin: p.origin, basePath: p.basePath, chapters: chapterManifest(p.chapters) });
}
const articleDest = path.join(out, 'articles');
await fs.mkdir(path.join(articleDest, 'assets'), { recursive: true });
await fs.mkdir(path.join(articleDest, 'pdfs'), { recursive: true });
await fs.copyFile(path.join(root, 'assets/site.css'), path.join(articleDest, 'assets/site.css'));
for (const c of articles.chapters) {
  await fs.writeFile(path.join(articleDest, c.key + '.html'), articleHTML(articles, c, renderMarkdown(root, collections, articles, c)));
  printJobs.push({ p: articles, name: c.key, html: articlePrintHTML(articles, c, renderMarkdown(root, collections, articles, c, 'chapter'), printCSS) });
}
await copyArticleAssets(articles, articleDest);
await fs.writeFile(path.join(articleDest, 'index.html'), articleIndexHTML(articles));
const articleURLs = [{ url: articles.origin + articles.basePath, updated: articles.chapters[0]?.updated }, ...articles.chapters.map(c => ({ url: chapterURL(articles, c), updated: c.updated }))];
await fs.writeFile(path.join(articleDest, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${articleURLs.map(c => `<url><loc>${escape(c.url)}</loc>${c.updated ? `<lastmod>${escape(c.updated)}</lastmod>` : ''}</url>`).join('')}</urlset>`);
manifest.articles = { name: articles.name, origin: articles.origin, basePath: articles.basePath, chapters: chapterManifest(articles.chapters) };
await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
await fs.writeFile(path.join(out, 'health.json'), JSON.stringify({ status: 'ok', products: manifest.products.length, articles: articles.chapters.length }));
const probes = manifest.products.flatMap(p => [`/products/${p.id}/${p.chapters[0].key}.html`, `/products/${p.id}/pdfs/manual.pdf`]);
probes.push('/articles/'); if (articles.chapters.length) probes.push(`/articles/pdfs/${encodeURIComponent(articles.chapters[0].key)}.pdf`);
await fs.writeFile(path.join(out, 'health-probes.txt'), probes.join('\n') + '\n');
await fs.writeFile(path.join(out, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>博生文档服务</title></head><body><h1>文档服务</h1><h2>产品说明书</h2><ul>${manifest.products.map(p => `<li><a href="${p.origin}${p.basePath}">${escape(p.name)}</a></li>`).join('')}</ul><h2><a href="${articles.origin}${articles.basePath}">技术分享</a></h2></body></html>`);
if (!htmlOnly) {
  const server = createServer(out); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.DOC_BROWSER_EXECUTABLE ? { executablePath: process.env.DOC_BROWSER_EXECUTABLE } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url().startsWith(address + '/') ? route.continue() : route.abort());
    for (const job of printJobs) {
      const directory = job.p.outputPath || `/products/${job.p.id}/`;
      const file = path.join(out, '.' + directory, '_print.html'); await fs.writeFile(file, job.html);
      await page.goto(`${address}${directory}_print.html`, { waitUntil: 'networkidle' });
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(async img => { await img.decode(); if (!img.naturalWidth) throw new Error('图片无法加载：' + img.src); })); });
      await page.pdf({ path: path.join(out, '.' + directory, 'pdfs', job.name + '.pdf'), format: 'A4', preferCSSPageSize: true, printBackground: true, tagged: true, outline: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: `<div style="width:100%;font-size:9px;color:#657469;margin:0 16mm;display:flex;justify-content:space-between"><span>${escape(job.p.name)}${job.p.kind === 'articles' ? '' : ' · 产品说明书'}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>` });
      console.log(`PDF ${job.p.id}/${job.name}.pdf`);
    }
  } finally {
    if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    for (const p of collections) await fs.rm(path.join(out, '.' + (p.outputPath || `/products/${p.id}/`), '_print.html'), { force: true });
  }
}
console.log(`已生成 ${products.length} 个产品的 ${products.reduce((n, p) => n + p.chapters.length, 0)} 个章节、${articles.chapters.length} 篇技术文章${htmlOnly ? '（仅 HTML）' : '及 PDF'}${articlesOnly ? '；已有产品输出保留' : ''}`);
