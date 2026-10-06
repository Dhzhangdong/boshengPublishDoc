# 产品与技术文档

本仓库集中维护产品说明书的 Markdown 与图片，构建时按文件序号生成静态 HTML、逐章 PDF 和完整产品 PDF；各产品通过自己的 `/doc/` 路径访问。

技术分享直接维护在 `技术分享/`，构建为 `/articles/` 文章列表、独立 HTML 与单篇 PDF，按 Git 最后提交时间倒序排列。公开地址配置在 `articles.json`；`npm run build:articles` 可单独更新文章并保留已有产品输出。

- [构建与发布规则](docs/构建与发布规则.md)
- [Gitea CD 与反向代理配置](deploy/test/README.md)
- 产品配置：`products.json`；本地运行：`npm ci`、`npm run browser:install`、`npm run build`、`npm run verify`、`npm run preview`。

## 产品手册

- [AI接待员产品说明书](产品手册/AI接待员/README.md)：产品介绍、注册入门、企业知识、网站接入、工单、会话、套餐与团队权限，附实际产品页面截图。

## 技术分享

- [统一上下文协议](技术分享/unified-context-protocol.md)
- [上下文协议实践总结](技术分享/context-protocol-lessons.md)
