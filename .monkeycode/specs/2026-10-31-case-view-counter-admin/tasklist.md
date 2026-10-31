# 实施任务清单

- [x] T01 新增 `server/store.mjs`：浏览量累加、原子落盘、去抖写入、保留期清理、统计聚合
- [x] T02 新增 `server/catalog.mjs`：案例目录读取与 mtime 缓存
- [x] T03 新增 `server/index.mjs`：`/api/views`、`/api/admin/*`、限流、口令鉴权、静态托管
- [x] T04 新增 `scripts/gen-case-catalog.mjs` 并在 `npm run sync` 中生成 `public/data/cases.json`
- [x] T05 新增 `src/lib/case-views.ts` 与 `App.vue` 卡片徽标、批量刷新、乐观计数与失败回滚
- [x] T06 新增 `public/admin/` 运营后台（登录、KPI、趋势、Top 10、分类分布、明细检索/排序、CSV 导出）
- [x] T07 新增 `scripts/dev.mjs` 一体化启动，`vite.config.ts` 增加 `/api` 代理与 `/admin/` 开发入口
- [x] T08 Dockerfile 改为单容器 Node 运行时，`data/` 数据卷，entrypoint 写入运行时配置
- [x] T09 新增 `server/test/` 存储与 API 单元测试，`quality` 与 CI 接入 `test:views`
- [x] T10 同步 README、`.monkeycode/docs`、需求与设计文档
