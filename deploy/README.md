# 浏览量服务地址

GitHub Pages 只能托管静态文件，浏览量与运营后台需要独立的 Node 服务。

把后端地址（例如 `https://cesium-views.onrender.com`）写入同目录下的 `api-base-url.txt`
（单行，末尾不要带 `/api`），提交后 Pages 构建会自动把前端指向该地址。

也可以在仓库 Variables 中设置 `VIEWS_API_BASE_URL`，其优先级高于本文件。
