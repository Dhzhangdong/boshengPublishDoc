import fs from 'node:fs/promises';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { fileHistory, escape, chapterURL, excerpt, timeHTML } from './core.mjs';

export async function discoverArticles(root, strict = false) {
  const config = JSON.parse(await fs.readFile(path.join(root, 'articles.json'), 'utf8'));
  const origin = new URL(config.origin);
  if (origin.protocol !== 'https:' || origin.origin !== config.origin || config.basePath !== '/articles/') throw new Error('技术分享须配置 HTTPS origin 和 /articles/ 路径');
  const directory = path.join(root, '技术分享');
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const chapters = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.md$/i.test(entry.name) || /^readme\.md$/i.test(entry.name)) continue;
    const key = entry.name.slice(0, -3);
    if (['index', '_print'].includes(key.toLowerCase())) throw new Error(`文章文件名保留：${entry.name}`);
    const file = path.join(directory, entry.name), source = await fs.readFile(file, 'utf8');
    const tokens = new MarkdownIt({ html: false }).parse(source, {});
    const headings = tokens.filter(t => t.type === 'heading_open' && t.tag === 'h1');
    if (headings.length !== 1) throw new Error(`文章须有且仅有一个一级标题：${entry.name}`);
    const heading = tokens[tokens.indexOf(headings[0]) + 1];
    const title = heading.children.filter(t => ['text', 'code_inline'].includes(t.type)).map(t => t.content).join('');
    chapters.push({ key, title, filename: entry.name, file, source, ...fileHistory(root, file, strict) });
  }
  chapters.sort((a, b) => (Date.parse(b.updated || '1970-01-01') - Date.parse(a.updated || '1970-01-01')) || (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
  return { ...config, kind: 'articles', id: 'articles', directory, outputPath: '/articles/', chapters, assets: new Set() };
}

const metadata = (a, title, url, description, schema) => `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} - ${escape(a.publisher)}技术分享</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${escape(url)}"><meta property="og:title" content="${escape(title)}"><meta property="og:url" content="${escape(url)}"><link rel="stylesheet" href="${a.basePath}assets/site.css"><script type="application/ld+json">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script>`;
function layout(a, selected, body) {
  return `<a class="skip" href="#content">跳到正文</a><header class="top"><a href="${a.origin}/">${escape(a.publisher)} · ${escape(a.name)}</a><span>工程实践与研究文章</span><a href="${a.basePath}">文章列表</a></header><div class="layout"><aside><details class="menu" open><summary>技术分享文章</summary><nav aria-label="技术分享文章">${a.chapters.map(c => `<a href="${a.basePath}${encodeURIComponent(c.key)}.html"${selected === c.key ? ' aria-current="page"' : ''}>${escape(c.title)}</a>`).join('')}</nav></details></aside><main id="content">${body}<footer>发布主体：${escape(a.publisher)} · ${escape(a.name)}</footer></main></div>`;
}
export function articleHTML(a, c, content) {
  const url = chapterURL(a, c), description = excerpt(c.source);
  const schema = { '@context': 'https://schema.org', '@type': 'Article', headline: c.title, description, url, mainEntityOfPage: url, inLanguage: 'zh-CN', publisher: { '@type': 'Organization', name: a.publisher }, ...(c.updated ? { dateModified: c.updated, datePublished: c.created } : {}) };
  return `<!doctype html><html lang="zh-CN"><head>${metadata(a, c.title, url, description, schema)}</head><body>${layout(a, c.key, `<div class="breadcrumb"><a href="${a.basePath}">技术分享</a> / ${escape(c.title)}</div>${timeHTML(c)}<a class="chapter-pdf" href="${a.basePath}pdfs/${encodeURIComponent(c.key)}.pdf">下载本文 PDF</a><article>${content}</article>`)}</body></html>`;
}
export function articleIndexHTML(a) {
  const url = a.origin + a.basePath;
  const schema = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: a.name, url, inLanguage: 'zh-CN', mainEntity: { '@type': 'ItemList', itemListElement: a.chapters.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.title, url: chapterURL(a, c) })) } };
  const list = a.chapters.map(c => `<section class="article-card"><h2><a href="${a.basePath}${encodeURIComponent(c.key)}.html">${escape(c.title)}</a></h2>${timeHTML(c)}<p>${escape(excerpt(c.source))}</p><a href="${a.basePath}pdfs/${encodeURIComponent(c.key)}.pdf">下载 PDF</a></section>`).join('');
  return `<!doctype html><html lang="zh-CN"><head>${metadata(a, a.name, url, '技术分享、工程实践与研究复盘文章，按文档 Git 最后提交时间从新到旧排列。', schema)}</head><body>${layout(a, null, `<article><h1>${escape(a.name)}</h1><p>按文档 Git 最后提交时间，从新到旧排列。</p>${list || '<p>暂无文章。</p>'}</article>`)}</body></html>`;
}
export function articlePrintHTML(a, c, content, css) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escape(c.title)}</title><style>${css}</style></head><body><header><p>${escape(a.publisher)} · ${escape(a.name)}</p><p>在线文章：<a href="${chapterURL(a, c)}">${chapterURL(a, c)}</a></p>${timeHTML(c)}</header><article id="chapter-${escape(c.key)}">${content}</article></body></html>`;
}
export async function copyArticleAssets(a, destination) {
  const root = await fs.realpath(a.directory);
  for (const file of a.assets) {
    if (!/\.(png|jpe?g|gif|webp|svg|pdf|json|txt|csv)$/i.test(file)) throw new Error(`文章附件类型不支持：${file}`);
    const actual = await fs.realpath(file);
    if (!actual.startsWith(root + path.sep) || !(await fs.stat(actual)).isFile()) throw new Error(`文章附件必须是技术分享目录中的实际文件：${file}`);
    const dest = path.join(destination, path.relative(a.directory, file));
    await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.copyFile(actual, dest);
  }
}
