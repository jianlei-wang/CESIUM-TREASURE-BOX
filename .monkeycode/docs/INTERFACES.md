# 模块接口

## 案例注册

`src/cases/index.ts` 汇总每个案例的 `DemoCard`。卡片包含 `id`、标题、分类、描述、标签、组件和更新时间。

## 场景工具

`src/lib/cesium-scene.ts` 提供：

- `createMapScene(container, callbacks)`：创建 Cesium Viewer。
- `loadBingImagery(viewer, callbacks)`：加载基础影像。
- `loadWorldTerrain(viewer)`：加载世界地形。
- `destroyScene(viewer)`：销毁当前场景。

## 深度图数据

矩形深度图组件将采样结果组织为宽高一致的高度数组，使用最小值和最大值映射为 0 至 255 的灰度值。PNG 来自 Canvas，TIFF 使用单通道 8 位无压缩基线布局。

## 浏览量接口

`src/lib/case-views.ts` 提供前端调用封装：

- `fetchCaseViews(ids)`：`GET /api/views?ids=a,b`，返回 `{ [id]: number }`，失败返回空对象。
- `recordCaseView(id)`：`POST /api/views`，返回最新浏览量，失败返回 `null`。
- `formatViewCount(n)`：`>= 10000` 显示为 `x.x万`，其余按中文千分位。

服务端接口（`server/index.mjs`）：

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | 否 | 存活探测 |
| GET | `/api/views?ids=a,b` | 否 | 批量查询，最多 500 个标识 |
| POST | `/api/views` | 否 | 请求体 `{ id }`，累加浏览量 |
| POST | `/api/admin/login` | 否 | 请求体 `{ token }` 校验口令 |
| GET | `/api/admin/stats?days=7` | Bearer | 总量、趋势、Top、分类与明细 |
| GET | `/api/admin/catalog` | Bearer | 案例目录 |

`/admin/` 为独立静态页面，口令保存在 `sessionStorage`，请求携带 `Authorization: Bearer <token>`。
