# 浏览量服务地址

GitHub Pages 只能托管静态文件，浏览量与运营后台需要独立的 Node 服务。

## 1. 部署服务

在 Render 控制台执行 `New -> Blueprint`，选择本仓库，Render 会读取根目录的 `render.yaml`。

部署时需要在 Dashboard 里填一个 `ADMIN_TOKEN`（后台口令，自己定一个足够长的随机串）。
其余参数已在 `render.yaml` 中配置好。

服务地址形如 `https://cesium-views-xxxx.onrender.com`。

## 2. 回填地址

把服务地址写入本目录下的 `api-base-url.txt`（单行，末尾不要带 `/api`），提交后 Pages 构建会自动
把前端指向该地址。

也可以在仓库 Variables 中设置 `VIEWS_API_BASE_URL`，它优先于本文件。
