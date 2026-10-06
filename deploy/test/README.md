# Gitea CD 与产品网关接入

## 部署资源

参考 AIReception 的组织变量与服务器发布流程，使用独立资源：

| 项目 | 值 |
| --- | --- |
| 镜像 | `git.bosheng.online/lekutaoxian/publish-doc:<commit-sha>` |
| 服务器目录 | `~/publishDoc/test` |
| Compose 项目 | `publish-doc-test` |
| 默认监听 | `192.168.1.85:15120` → 容器 8080 |
| 内容 | 镜像内静态 HTML、图片及 PDF，无数据库 |

本次选择 15120；未访问远端检查占用。如冲突，在服务器 `.runtime.env` 设置 `DOC_PORT=15121`，需要换绑定地址时设置 `DOC_BIND_IP`，同步调整产品网关。不要给本服务占用现有产品端口或 80/443。

## 组织变量与密钥

沿用 `GITEAREGISTRYUSERNAME`、`GITEAREGISTRYTOKEN`、`UBUNTOSERVERTESTIP`、`UBUNTOSERVERTESTUSERNAME`、`UBUNTOSERVERTESTUSERPWD`，类型与 AIReception 一致。组织配置须允许本仓库读取，平台使用共享镜像命名空间的账号必须有权限推送 `lekutaoxian/publish-doc`。

运行器需要 Docker/Compose，服务器用户需要 `sudo -n docker` 权限。SSH 首次信任采用参考项目的 accept-new，应在受信任网络首次连接或预置 known_hosts。凭据只通过临时 Docker 配置及 SSH stdin 传递，不写入生成物或最终镜像。

## 流程与恢复

main 的 push 或 Gitea 手动运行均可触发：完整历史检出 → Docker 中构建并验证 → SHA 镜像推送 → 上传版本化部署定义 → 获取部署锁 → 拉取镜像 → 替换文档容器 → 健康及 HTML/PDF 校验 → 提升当前版本元数据。

失败时恢复已保存的旧 Compose 和镜像版本；首次发布失败则停止失败容器。源历史和旧镜像不被删除，无数据库迁移。CD 不会自动调整产品公网代理、DNS，也不触发 GitHub 发布。

## 产品域名 `/doc/` 反向代理

每个产品将自己的 `/doc/` 映射到文档服务中的专属目录。AI接待员的 Nginx 示例（合并进现有产品虚拟主机）：

```nginx
location = /doc { return 301 /doc/; }
location /doc/ {
    proxy_pass http://192.168.1.85:15120/products/ai-reception/;
    proxy_set_header Host $host;
}
```

其他产品替换 `ai-reception` 为 `products.json` 登记的产品标识，菜单和资产仍使用该产品的 `/doc/`。后端目录和产品路径都必须保留尾斜线。图片、CSS、PDF、sitemap 都经相同映射，不用 iframe 或跳转到文档服务域名。

产品根目录 robots.txt 可增加 `Sitemap: https://aireceptionist.bosheng.online/doc/sitemap.xml`，或将文档章节纳入官网 sitemap。允许抓取公开 HTML，不要给 `/doc/` 加 noindex。文档 PDF 的 noindex 响应头由文档服务提供。

## 核对

```bash
sudo docker ps --filter label=com.docker.compose.project=publish-doc-test
curl --fail http://192.168.1.85:15120/health.json
curl --fail http://192.168.1.85:15120/products/ai-reception/01.html
```

代理配置完成后，再核对产品域名 `/doc/` 首章、其他章节、图片、PDF、canonical 和 sitemap。当前改动仅添加本仓库的构建/CD和部署定义，是否已远端发布以 Gitea 运行记录和服务器核对为准。
