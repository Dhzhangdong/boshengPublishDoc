import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import MarkdownIt from 'markdown-it';

export const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const numbered = filename => filename.match(/^(\d+)[\s_-]+(.+)\.md$/i);
export const slug = text => text.trim().toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'section';
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export function fileHistory(root, file, strict = false) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const dates = git(root, ['log', '--follow', '--format=%cI', '--', relative]).split('\n').filter(Boolean);
  const dirty = Boolean(git(root, ['status', '--porcelain', '--', relative]));
  if (strict && (!dates.length || dirty)) throw new Error(`正式构建要求文档已提交且无本地修改：${relative}`);
  return { updated: dates[0] || null, created: dates.at(-1) || null, dirty, tracked: dates.length > 0 };
}
export function displayTime(value) {
  return value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '尚未提交';
}
export async function discover(root, strict = false, validateAllDirectories = true) {
  if (git(root, ['rev-parse', '--is-shallow-repository']) === 'true') throw new Error('需要完整 Git 历史；请使用 fetch-depth: 0 或 git fetch --unshallow');
  const config = JSON.parse(await fs.readFile(path.join(root, 'products.json'), 'utf8'));
  const products = [], ids = new Set(), origins = new Set(), directories = new Set();
  for (const p of config.products) {
    if (!/^[a-z][a-z0-9-]*$/.test(p.id) || ids.has(p.id)) throw new Error('产品标识非法或重复');
    if (p.directory !== path.basename(p.directory) || directories.has(p.directory)) throw new Error('产品目录非法或重复');
    const origin = new URL(p.origin);
    if (origin.protocol !== 'https:' || origin.origin !== p.origin || origins.has(p.origin + p.basePath)) throw new Error('产品公开 origin 必须为唯一 HTTPS 来源');
    if (p.basePath !== '/doc/') throw new Error('当前公开路径约定为 /doc/');
    ids.add(p.id); origins.add(p.origin + p.basePath); directories.add(p.directory);
    const directory = path.join(root, '产品手册', p.directory);
    const files = (await fs.readdir(directory, { withFileTypes: true })).filter(f => f.isFile() && numbered(f.name));
    const used = new Set();
    const chapters = [];
    for (const entry of files) {
      const [, prefix, title] = numbered(entry.name), order = Number(prefix);
      if (!Number.isSafeInteger(order) || used.has(order)) throw new Error(`章节序号非法或重复：${p.directory}/${entry.name}`);
      used.add(order);
      const file = path.join(directory, entry.name), source = await fs.readFile(file, 'utf8');
      const history = fileHistory(root, file, strict);
      chapters.push({ order, key: String(order).padStart(2, '0'), title, file, filename: entry.name, source, ...history });
    }
    chapters.sort((a, b) => a.order - b.order);
    if (!chapters.length) throw new Error(`产品无编号章节：${p.directory}`);
    products.push({ ...p, directory, chapters });
  }
  for (const entry of validateAllDirectories ? await fs.readdir(path.join(root, '产品手册'), { withFileTypes: true }) : []) {
    if (entry.isDirectory() && !directories.has(entry.name) && (await fs.readdir(path.join(root, '产品手册', entry.name))).some(numbered)) throw new Error(`新产品需要在 products.json 登记公开地址：${entry.name}`);
  }
  if (!products.length) throw new Error('至少配置一个产品');
  return products;
}
export const chapterURL = (p, c) => `${p.origin}${p.basePath}${encodeURIComponent(c.key)}.html`;
export const excerpt = source => source.split('\n').filter(l => l.trim() && !/^(#|\[|!|\||>|```)/.test(l)).join(' ').replace(/[*`]/g, '').slice(0, 160);

export function renderMarkdown(root, products, product, chapter, print = false) {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
  const tokens = md.parse(chapter.source, {}), seen = new Map();
  const headingPrefix = print ? `chapter-${chapter.key}-` : '';
  const resolve = (href, image = false) => {
    if (!href || /^(https?:|mailto:|tel:)/i.test(href)) return href;
    if (href.startsWith('#')) return `#${headingPrefix}${href.slice(1)}`;
    if (href.startsWith('/') || /^[a-z]+:/i.test(href)) throw new Error(`文档使用相对资源路径：${chapter.filename} → ${href}`);
    const [raw, fragment] = href.split('#'), target = path.resolve(path.dirname(chapter.file), decodeURIComponent(raw));
    if (!target.startsWith(root + path.sep)) throw new Error(`链接越出文档仓库：${href}`);
    const owner = products.find(p => target.startsWith(p.directory + path.sep));
    const dest = owner?.chapters.find(c => c.file === target);
    if (dest) {
      if (print && owner.id === product.id && (print === true || dest.key === chapter.key)) return `#chapter-${dest.key}${fragment ? '-' + fragment : ''}`;
      if (print) return `${chapterURL(owner, dest)}${fragment ? '#' + fragment : ''}`;
      return `${owner.id === product.id ? product.basePath : owner.origin + owner.basePath}${encodeURIComponent(dest.key)}.html${fragment ? '#' + fragment : ''}`;
    }
    if (/\.md$/i.test(target)) {
      if (path.basename(target).toLowerCase() === 'readme.md') return print ? '#manual' : (owner ? owner.origin + owner.basePath : product.origin + '/');
      throw new Error(`Markdown 链接没有对应编号章节：${href}`);
    }
    if (!owner) throw new Error(`资源必须位于产品目录内：${href}`);
    owner.assets?.add(target);
    const relative = path.relative(owner.directory, target).split(path.sep).map(encodeURIComponent).join('/');
    if (print) return `${image ? (owner.outputPath || `/products/${owner.id}/`) : owner.origin + owner.basePath}${relative}${fragment ? '#' + fragment : ''}`;
    return `${owner.id === product.id ? product.basePath : owner.origin + owner.basePath}${relative}${fragment ? '#' + fragment : ''}`;
  };
  const walk = list => {
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.type === 'paragraph_open' && /^\[说明书目录\]\(README\.md\)(?:\s*·\s*\[(?:上一章|下一章)：[^\]]+\]\([^)]+\))*\s*$/.test(list[i + 1]?.content || '')) {
        t.attrSet('class', 'doc-navigation');
      }
      if (t.type === 'heading_open') {
        const base = slug(list[i + 1].content), count = (seen.get(base) || 0) + 1; seen.set(base, count);
        t.attrSet('id', headingPrefix + base + (count > 1 ? '-' + count : ''));
      }
      if (t.type === 'link_open') t.attrSet('href', resolve(t.attrGet('href')));
      if (t.type === 'image') { t.attrSet('src', resolve(t.attrGet('src'), true)); t.attrSet('loading', print ? 'eager' : 'lazy'); }
      if (t.children) walk(t.children);
    }
  };
  walk(tokens);
  if (tokens.filter(t => t.type === 'heading_open' && t.tag === 'h1').length !== 1) throw new Error(`每章须有且仅有一个一级标题：${chapter.filename}`);
  return md.renderer.render(tokens, md.options, {});
}
export function timeHTML(c) {
  return `<p class="updated">文档最后提交：${c.updated ? `<time datetime="${escape(c.updated)}">${displayTime(c.updated)}</time>（北京时间）` : '尚未提交'}${c.dirty ? ' · 本地有未提交修改' : ''}</p>`;
}
export function pageHTML(p, c, content) {
  const url = chapterURL(p, c), description = excerpt(c.source);
  const schema = { '@context': 'https://schema.org', '@type': 'TechArticle', headline: `${p.name}：${c.title}`, description, url, inLanguage: 'zh-CN', publisher: { '@type': 'Organization', name: p.publisher }, ...(c.updated ? { dateModified: c.updated, datePublished: c.created } : {}) };
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(c.title)} - ${escape(p.name)}产品说明书</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${escape(url)}"><meta property="og:title" content="${escape(p.name + '：' + c.title)}"><meta property="og:url" content="${escape(url)}"><link rel="stylesheet" href="${p.basePath}assets/site.css"><script type="application/ld+json">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script></head><body><a class="skip" href="#content">跳到正文</a><header class="top"><a href="${p.origin}/">${escape(p.publisher)} · ${escape(p.name)}</a><span>官方产品说明书</span><a href="${p.basePath}pdfs/manual.pdf">下载完整 PDF</a></header><div class="layout"><aside><details class="menu" open><summary>说明书目录</summary><nav aria-label="章节目录">${p.chapters.map(v => `<a href="${p.basePath}${v.key}.html"${v.key === c.key ? ' aria-current="page"' : ''}><span>${v.key}</span>${escape(v.title)}</a>`).join('')}</nav></details></aside><main id="content"><div class="breadcrumb"><a href="${p.origin}/">产品首页</a> / <a href="${p.basePath}">产品说明书</a> / ${escape(c.title)}</div>${timeHTML(c)}<a class="chapter-pdf" href="${p.basePath}pdfs/${c.key}.pdf">下载本章 PDF</a><article>${content}</article><footer>发布主体：${escape(p.publisher)} · ${escape(p.name)}官方文档</footer></main></div></body></html>`;
}
export function printHTML(p, chapters, contents, css) {
  const updated = chapters.map(c => c.updated).filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const full = chapters.length > 1;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escape(p.name)}产品说明书</title><style>${css}</style></head><body class="print"><header id="manual" class="cover"><p>${escape(p.publisher)} · 官方产品文档</p><h1>${escape(p.name)}${full ? '产品说明书' : '：' + escape(chapters[0].title)}</h1><p>文档最后提交：${displayTime(updated)}（北京时间）</p>${chapters.some(c => c.dirty) ? '<p>本地预览：含未提交修改</p>' : ''}<p>在线说明书：<a href="${p.origin}${p.basePath}">${p.origin}${p.basePath}</a></p>${full ? `<h2>目录</h2><ol>${chapters.map(c => `<li><a href="#chapter-${c.key}">${c.key} ${escape(c.title)}</a></li>`).join('')}</ol>` : ''}</header>${chapters.map((c, i) => `<section class="chapter" id="chapter-${c.key}">${timeHTML(c)}${contents[i]}</section>`).join('')}</body></html>`;
}
