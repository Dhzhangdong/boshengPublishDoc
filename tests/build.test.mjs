import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { discover, fileHistory, renderMarkdown, pageHTML, displayTime } from '../scripts/core.mjs';
import { discoverArticles, articleHTML, articleIndexHTML, copyArticleAssets } from '../scripts/articles.mjs';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'publish-doc-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (args, date) => execFileSync('git', ['-C', root, ...args], { env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) }, stdio: 'pipe', encoding: 'utf8' });
  git(['init']); git(['config', 'user.name', 'Document test']); git(['config', 'user.email', 'document-test@example.invalid']); git(['config', 'commit.gpgsign', 'false']);
  const directory = path.join(root, '产品手册', '产品'); await fs.mkdir(directory, { recursive: true });
  const config = { products: [{ id: 'sample', directory: '产品', name: '测试产品', publisher: '博生', origin: 'https://sample.example.com', basePath: '/doc/' }] };
  await fs.writeFile(path.join(root, 'products.json'), JSON.stringify(config));
  for (const name of ['10_售后政策.md', '02-快速开始.md', '01 产品介绍.md']) await fs.writeFile(path.join(directory, name), `# ${name.slice(0, -3)}\n\n实际说明文字。\n`);
  await fs.writeFile(path.join(directory, 'README.md'), '# 人工目录');
  git(['add', '.']); git(['commit', '-m', 'Create documents'], '2024-01-02T03:04:05+08:00');
  return { root, directory, git };
}
test('数字排序、三种分隔符、默认首章和无序号 README 排除', async t => {
  const { root } = await fixture(t); const [p] = await discover(root, true);
  assert.deepEqual(p.chapters.map(c => c.order), [1, 2, 10]);
  assert.deepEqual(p.chapters.map(c => c.title), ['产品介绍', '快速开始', '售后政策']);
  const c = p.chapters[0], html = pageHTML(p, c, renderMarkdown(root, [p], p, c));
  assert.match(html, /canonical" href="https:\/\/sample.example.com\/doc\/01.html/);
  assert.match(html, /<article><h1/); assert.match(html, /aria-current="page"/);
  assert.match(html, /datetime="2024-01-02T03:04:05\+08:00"/);
});
test('使用文件提交日期，独立于其他文件提交，支持重命名追溯', async t => {
  const { root, directory, git } = await fixture(t);
  await fs.appendFile(path.join(directory, '02-快速开始.md'), '\n新的内容');
  git(['add', '.']); git(['commit', '-m', 'Only update chapter two'], '2024-02-03T04:05:06+08:00');
  assert.equal(fileHistory(root, path.join(directory, '01 产品介绍.md')).updated, '2024-01-02T03:04:05+08:00');
  git(['mv', '产品手册/产品/02-快速开始.md', '产品手册/产品/02 新标题.md']);
  git(['commit', '-m', 'Rename chapter'], '2024-03-04T05:06:07+08:00');
  const h = fileHistory(root, path.join(directory, '02 新标题.md'));
  assert.equal(h.created, '2024-01-02T03:04:05+08:00'); assert.equal(h.updated, '2024-03-04T05:06:07+08:00');
  assert.equal(displayTime('2024-01-01T00:00:00Z'), '2024/01/01 08:00:00');
});
test('生产模式拒绝未提交内容；开发模式明确标记', async t => {
  const { root, directory } = await fixture(t); const file = path.join(directory, '01 产品介绍.md');
  await fs.appendFile(file, '\n本地修改'); assert.equal(fileHistory(root, file).dirty, true);
  assert.throws(() => fileHistory(root, file, true), /已提交/);
  const fresh = path.join(directory, '03 新章.md'); await fs.writeFile(fresh, '# 新章');
  assert.equal(fileHistory(root, fresh).updated, null);
});
test('重复数字序号构建失败，包括 1 与 01', async t => {
  const { root, directory } = await fixture(t); await fs.writeFile(path.join(directory, '1 重复.md'), '# 重复');
  await assert.rejects(discover(root), /序号非法或重复/);
});
test('HTML 与整本/单章 PDF 的章节链接采用各自正确地址', async t => {
  const { root } = await fixture(t); const [p] = await discover(root); const c = p.chapters[0];
  c.source = '# 产品介绍\n\n[快速开始](02-快速开始.md)\n\n<script>alert(1)</script>';
  assert.match(renderMarkdown(root, [p], p, c), /href="\/doc\/02.html"/);
  assert.match(renderMarkdown(root, [p], p, c, true), /href="#chapter-02"/);
  assert.match(renderMarkdown(root, [p], p, c, 'chapter'), /href="https:\/\/sample.example.com\/doc\/02.html"/);
  assert.doesNotMatch(renderMarkdown(root, [p], p, c), /<script>/);
});
test('未知 Markdown 章节和越出仓库链接拒绝发布', async t => {
  const { root } = await fixture(t); const [p] = await discover(root); const c = p.chapters[0];
  c.source = '# 产品介绍\n\n[缺失](03%20不存在.md)'; assert.throws(() => renderMarkdown(root, [p], p, c), /对应编号章节/);
  c.source = '# 产品介绍\n\n[越界](../../../../secrets.txt)'; assert.throws(() => renderMarkdown(root, [p], p, c), /越出/);
});
test('识别网页章节导航，但不把含普通目录链接的正文隐藏', async t => {
  const { root } = await fixture(t); const [p] = await discover(root); const c = p.chapters[0];
  c.source = '# 产品介绍\n\n[说明书目录](README.md) · [下一章：快速开始](02-快速开始.md)\n\n请看[说明书目录](README.md)，确认适用范围。';
  const html = renderMarkdown(root, [p], p, c, true);
  assert.equal([...html.matchAll(/class="doc-navigation"/g)].length, 1);
  assert.match(html, /<p>请看/);
});
async function articleFixture(t) {
  const f = await fixture(t), directory = path.join(f.root, '技术分享');
  await fs.mkdir(path.join(directory, 'qa'), { recursive: true });
  await fs.writeFile(path.join(f.root, 'articles.json'), JSON.stringify({ name: '技术分享', publisher: '博生', origin: 'https://articles.example.com', basePath: '/articles/' }));
  await fs.writeFile(path.join(directory, '99-old.md'), '# 原先的文章\n\n正文中的日期 2099-01-01 不参与排序。');
  await fs.writeFile(path.join(directory, 'README.md'), '# 目录');
  await fs.writeFile(path.join(directory, 'qa', 'internal.md'), '# 内部文件');
  f.git(['add', '.']); f.git(['commit', '-m', 'First article'], '2024-02-01T00:00:00Z');
  await fs.writeFile(path.join(directory, '01-new.md'), '# 最新文章\n\n正文。');
  await fs.writeFile(path.join(directory, '02-tie.md'), '# 相同时间\n\n正文。');
  f.git(['add', '.']); f.git(['commit', '-m', 'Two new articles'], '2024-03-01T00:00:00Z');
  return { ...f, articleDirectory: directory };
}
test('技术分享平铺扫描，取 H1 标题，按 Git 更新时间倒序且同时间按文件名排序', async t => {
  const { root, articleDirectory } = await articleFixture(t);
  const a = await discoverArticles(root, true);
  assert.deepEqual(a.chapters.map(c => c.key), ['01-new', '02-tie', '99-old']);
  assert.equal(a.chapters[0].title, '最新文章');
  const index = articleIndexHTML(a);
  assert.ok(index.indexOf('<h2><a href="/articles/01-new') < index.indexOf('<h2><a href="/articles/99-old'));
  const html = articleHTML(a, a.chapters[0], renderMarkdown(root, [a], a, a.chapters[0]));
  assert.match(html, /canonical" href="https:\/\/articles.example.com\/articles\/01-new.html/);
  assert.match(html, /"@type":"Article"/);
  assert.match(html, /"dateModified":"2024-03-01T00:00:00(?:Z|\+00:00)"/);
  await fs.writeFile(path.join(articleDirectory, '00-untracked.md'), '# 新草稿');
  assert.equal((await discoverArticles(root)).chapters.at(-1).key, '00-untracked');
  await assert.rejects(discoverArticles(root, true), /已提交/);
  await fs.writeFile(path.join(articleDirectory, 'index.md'), '# 保留文件名');
  await assert.rejects(discoverArticles(root), /文件名保留/);
});
test('文章互链、产品章节与 PDF 附件使用公开地址，只复制被正文引用的附件', async t => {
  const { root, articleDirectory } = await articleFixture(t);
  await fs.writeFile(path.join(articleDirectory, 'qa', 'report.json'), '{"status":"ok"}');
  await fs.writeFile(path.join(articleDirectory, 'qa', 'unused.json'), '{"raw":"internal"}');
  await fs.writeFile(path.join(articleDirectory, 'diagram.png'), 'image-fixture');
  const a = await discoverArticles(root), products = await discover(root);
  const c = a.chapters[0];
  c.source = '# 最新文章\n\n[旧文](99-old.md)\n\n[报告](qa/report.json)\n\n![图](diagram.png)\n\n[产品](../产品手册/产品/02-快速开始.md)';
  const html = renderMarkdown(root, [...products, a], a, c);
  assert.match(html, /href="\/articles\/99-old.html"/);
  assert.match(html, /href="https:\/\/sample.example.com\/doc\/02.html"/);
  const pdf = renderMarkdown(root, [...products, a], a, c, 'chapter');
  assert.match(pdf, /href="https:\/\/articles.example.com\/articles\/qa\/report.json"/);
  assert.match(pdf, /src="\/articles\/diagram.png"/);
  const dest = path.join(root, 'out'); await fs.mkdir(dest);
  await copyArticleAssets(a, dest);
  assert.equal(await fs.readFile(path.join(dest, 'qa', 'report.json'), 'utf8'), '{"status":"ok"}');
  await assert.rejects(fs.stat(path.join(dest, 'qa', 'unused.json')), { code: 'ENOENT' });
});
test('技术分享增量构建保留产品输出，生成文章首页、sitemap 并清理旧文章', async t => {
  const { root } = await articleFixture(t);
  await fs.mkdir(path.join(root, 'assets')); await fs.mkdir(path.join(root, 'dist', 'products', 'sample'), { recursive: true });
  await fs.writeFile(path.join(root, 'assets', 'site.css'), 'body{}'); await fs.writeFile(path.join(root, 'assets', 'print.css'), 'body{}');
  await fs.writeFile(path.join(root, 'dist', 'products', 'sample', '01.html'), 'preserved-product');
  await fs.writeFile(path.join(root, 'dist', 'manifest.json'), JSON.stringify({ products: [{ id: 'sample', name: '测试产品', origin: 'https://sample.example.com', basePath: '/doc/', chapters: [{ key: '01' }] }] }));
  await fs.mkdir(path.join(root, 'dist', 'articles')); await fs.writeFile(path.join(root, 'dist', 'articles', 'obsolete.html'), 'old');
  execFileSync(process.execPath, [path.resolve('scripts/build.mjs'), '--articles-only', '--html-only'], { cwd: root, stdio: 'pipe' });
  assert.equal(await fs.readFile(path.join(root, 'dist', 'products', 'sample', '01.html'), 'utf8'), 'preserved-product');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist', 'manifest.json')));
  assert.equal(manifest.products.length, 1); assert.equal(manifest.articles.chapters.length, 3);
  assert.match(await fs.readFile(path.join(root, 'dist', 'articles', 'sitemap.xml'), 'utf8'), /<lastmod>2024-03-01/);
  await assert.rejects(fs.stat(path.join(root, 'dist', 'articles', 'obsolete.html')), { code: 'ENOENT' });
});
