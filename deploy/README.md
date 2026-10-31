# 浏览量服务地址

GitHub Pages 只能托管静态文件，浏览量与运营后台需要独立后端。

推荐使用 **Cloudflare Workers + D1**，免费额度足够本项目使用，且无需信用卡，见
`worker/README.md`。

## 1. 部署后端

按 `worker/README.md` 的步骤执行：

```bash
npx wrangler login
npx wrangler d1 create cesium-views
npx wrangler d1 execute cesium-views --remote --file=worker/schema.sql
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

得到形如 `https://cesium-views.<account>.workers.dev` 的地址。

## 2. 回填地址

把服务地址写入本目录下的 `api-base-url.txt`（单行，末尾不要带 `/api`），提交后 Pages 构建会自动
把前端指向该地址。

也可以在仓库 Variables 中设置 `VIEWS_API_BASE_URL`，它优先于本文件。

## 备选方案：Node 单机部署

`server/` 与 `Dockerfile` 提供等价的 Node 实现，适合自有服务器或本地长期运行：

```bash
docker build -t cesium-views .
docker run -p 8787:8787 -e ADMIN_TOKEN=<口令> -v $(pwd)/data:/app/data cesium-views
```

根目录 `render.yaml` 是 Render Blueprint 的历史方案。Render 免费实例没有持久磁盘，
重启会丢数据，**不建议使用**。
