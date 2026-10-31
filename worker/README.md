# Cloudflare Workers + D1 免费后端

GitHub Pages 只能托管静态文件，浏览量与 `/admin` 后台需要独立后端。Cloudflare Workers + D1 免费额度足够本项目使用，且无需信用卡。

免费额度（截至 2026 年）：

- Workers：10 万请求/天
- D1：500 万行读取/天、10 万行写入/天、5 GB 存储

## 1. 准备

```bash
npx wrangler login
```

浏览器完成 Cloudflare 授权即可，无需 API Token。

## 2. 创建 D1 数据库

```bash
npx wrangler d1 create cesium-views
```

命令会输出 `database_id`，把它填到仓库根目录 `wrangler.toml` 的 `database_id` 字段。

## 3. 建表

```bash
npx wrangler d1 execute cesium-views --remote --file=worker/schema.sql
```

## 4. 设置后台口令

```bash
npx wrangler secret put ADMIN_TOKEN
```

输入一个足够长的随机串，这就是 `/admin/` 的登录口令。

## 5. 部署

```bash
npx wrangler deploy
```

部署成功后会得到形如 `https://cesium-views.<account>.workers.dev` 的地址。

## 6. 回填前端地址

把 Worker 地址写入 `deploy/api-base-url.txt`（单行，末尾不要带 `/api`），提交推送到 `master`，
GitHub Pages 构建时会通过 `scripts/gen-runtime-config.mjs` 把前端指向该地址。

```bash
echo "https://cesium-views.<account>.workers.dev" > deploy/api-base-url.txt
```

## 接口

| 方法 | 路径                      | 说明                                         |
| ---- | ------------------------- | -------------------------------------------- |
| GET  | `/api/health`             | 健康检查                                     |
| GET  | `/api/views?ids=a,b`      | 批量查询浏览量                               |
| POST | `/api/views`              | 记录一次打开，body 为 `{"id":"case-a"}`      |
| POST | `/api/admin/login`        | 校验口令，body 为 `{"token":"..."}`          |
| GET  | `/api/admin/stats?days=7` | 运营统计，需 `Authorization: Bearer <token>` |
| GET  | `/api/admin/catalog`      | 案例目录，需同样鉴权                         |

## 本地开发

```bash
npx wrangler d1 execute cesium-views --local --file=worker/schema.sql
npx wrangler dev --local
```

本地 D1 数据存放在 `.wrangler/state`（已 gitignore）。

## 单元测试

Worker 的核心逻辑用 `node:sqlite` 的内存库模拟 D1，无需网络：

```bash
npm run test:worker
```

## 与 Node 服务的关系

`server/` 下的 Node 版本仍保留，用于单机 Docker 部署；两者接口完全一致，前端无需区分。
