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
