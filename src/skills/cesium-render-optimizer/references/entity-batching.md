# Entity / 大数据量点线面渲染优化（CesiumJS 1.144）

主线程卡顿（L1）与"Entity 太多"是同一类问题：**单个 Entity 是重量级对象**（含状态管理、属性回调、逐帧 pick 计算）。海量点/线/面/标注必须改用底层集合类（Primitive Collection），本节给出取舍与代码。

## 1. 先判断：你的数据量属于哪一档

| 数据规模 | 推荐方案 | 说明 |
|---|---|---|
| < 100 个动态 Entity | `viewer.entities` 直接用 | 数量少，Entity 便利性值得 |
| 100 ~ 1 万（静态为主） | 集合类（Collection / Primitive） | 一次性创建，批量更新 |
| > 1 万点/线/面 | 集合类 + 压缩几何 + 分层显示 | 或 3D Tiles / 点云（`PointCloud`） |
| 百万级点 | `PointPrimitiveCollection` + 抽样 / 3D Tiles 点云 | 单帧 draw call 极少，靠 GPU 点大小 |

**经验值**：数千个独立 `Entity`（尤其 Billboard/Label/Point）会显著拖慢主线程；换成对应 Collection 后 draw call 与 CPU 开销通常降一个数量级。

## 2. 集合类对照表（Entity → 底层）

| 你想画什么 | Entity 写法 | 高性能替代 | 注意 |
|---|---|---|---|
| 点 | `entity.position + point` | `PointPrimitiveCollection`（`viewer.scene.primitives.add`） | 静态点一次性 `add`；动态点更新 `positions` |
| 广告牌/图标 | `entity.billboard` | `BillboardCollection` | 可设 `scaleByDistance`、`translucencyByDistance` |
| 文字标注 | `entity.label` | `LabelCollection` | 大文本用 Canvas 合图 + 单 Billboard 更省 |
| 折线 | `entity.polyline` | `PolylineCollection` | 大量短线段合并进一个 collection |
| 面/多边形 | `entity.polygon` | `GroundPrimitive`（贴地）或 `Primitive` + `GeometryInstance` | 贴地面用 `GroundPolylinePrimitive` 同理 |
| 模型 | `entity.model` | `Cesium3DTileset` / glTF instancing | 大量同模型用 `EXT_mesh_gpu_instancing` |

```js
// 示例：1 万个静态点 → PointPrimitiveCollection
const points = new Cesium.PointPrimitiveCollection();
const scratch = new Cesium.Cartesian3();
for (let i = 0; i < 10000; i++) {
  points.add({
    position: Cesium.Cartesian3.fromDegrees(lon[i], lat[i], 0, scratch), // 复用 scratch，减少 GC
    pixelSize: 4,
    color: Cesium.Color.fromRandom({ alpha: 0.8 }),
    scaleByDistance: new Cesium.NearFarScalar(1.5e5, 4.0, 8.0e6, 0.5), // 远处缩小，省 overdraw
  });
}
viewer.scene.primitives.add(points);
```

## 3. 主线程纪律（Entity 场景下最容易踩的坑）

- **不要在每帧循环里改 Entity 属性**：`entity.position` 每帧写入会触发属性系统逐帧处理；静态对象创建后不再动。
- **不要每帧 `new` 对象**：坐标转换复用 `Cesium.Cartesian3`/`Color` 等 scratch 变量；`fromDegrees` 结果可缓存。
- **优先用集合类批量更新**：Collection 支持 `collection.removeAll()` 后整批重建，比逐个 `entities.remove(entity)` 快。
- **数据解析不要在主线程**：大 JSON/GeoJSON 用 `Cesium.GeoJsonDataSource.load(url, { clampToGround: true })`（异步加载在内部处理），避免 `JSON.parse` 大字符串于主线程。
- **时间动态数据**：采样降频（如 1Hz 更新，而非每帧），配合 `viewer.clock` 节流；动态内容保持 `requestRenderMode = false`。
- **隐藏而非删除**：频繁显隐的对象用 `entity.show = false` 或 collection 级 `show`，避免反复重建。

## 4. 贴地与大场景的特殊处理

- 贴地几何（`clampToGround`）很贵：每个点/线都要做地形贴附计算。静态数据用 `GroundPrimitive`（预计算），动态数据避免 `clampToGround: true`。
- 大量标注：合并成一张 `Canvas` 纹理 + 少量 Billboard（"贴图合批"），比几千个 Label 快得多。
- 视野外的对象剔除：集合类自带视锥剔除；再按业务做**区域分块加载**（如四叉树/网格按相机位置增删块），比全量常驻更稳。
- 属性回调（`CallbackProperty`）慎用：每帧求值，数量大时开销翻倍；静态值直接赋常量。

## 5. 验证指标

- 对比优化前后：`scene.debugShowStatistics` 的 draw calls 数（应大幅下降）、主线程长任务消失、FPS 回升。
- `tileset.statistics` 不适用 Entity 场景；Entity 场景看 DevTools Performance 的 scripting 占比即可。
- 内存：Memory 面板快照对比，确认无 `Entity` 实例持续累积（未销毁）。

## 6. 何时该升级到 3D Tiles / 点云

- 点/模型数量到十万级且几何复杂 → 用 `Cesium.PointCloud` / 3D Tiles（`Cesium3DTileset.fromUrl`），获得 LOD 与流式加载，见 tileset-tuning.md。
- 城市级建筑/设施 → 3D Tiles 是唯一现实方案；Entity 方案只适合业务对象（选中、交互、动效）数量有限时。
