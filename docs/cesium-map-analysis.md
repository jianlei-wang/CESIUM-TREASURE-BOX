# cesium-map 仓库代码分析

> 分析对象：https://github.com/cesiumChina/cesium-map （v1.0.0，克隆自 2026-09-02，源码位于 `/tmp/opencode/cesium-map`）

## 一、仓库定位

`@cesium-china/cesium-map` 是面向国内地图厂商的 Cesium 地图插件，核心能力是：把国内常用地图瓦片（高德、百度、星图、谷歌、天地图、腾讯）封装为 Cesium `ImageryProvider`，并解决国内坐标系（GCJ02/BD09）与 WGS84 之间的偏移问题。

- peerDependencies：`cesium ^1.118.2`（本项目 Cesium 1.144 兼容，见下方 API 核对）。
- 许可：Apache 2.0。
- 作者 Caven Chen（dc-sdk 同一作者，风格与 dc-sdk 一脉相承：ESM 源码 + esbuild/gulp 构建，`src/modules/provider|tiling-scheme|projection|transform` 分层）。

## 二、源码结构

```
src/
  index.js                              # 汇总导出
  modules/
    index.js                            # 6 provider + 2 自定义 TilingScheme 导出
    provider/
      AMapImageryProvider.js            # 高德
      BaiduImageryProvider.js           # 百度（重写 requestImage）
      GeoVisImageryProvider.js          # 星图（需 key）
      GoogleImageryProvider.js          # 谷歌
      TdtImageryProvider.js             # 天地图（需 key）
      TencentImageryProvider.js         # 腾讯（customTags）
    tiling-scheme/
      GCJ02TilingScheme.js              # 高德/谷歌/腾讯 GCJ02 偏移平铺方案
      BD09TilingScheme.js               # 百度 BD09 平铺方案
      CustomGeographicTilingScheme.js   # 自定义地理平铺方案（EPSG:4326 瓦片）
      CustomMercatorTilingScheme.js     # 自定义墨卡托平铺方案（EPSG:3857 瓦片）
    projection/
      BD09Projection.js                 # 百度墨卡托投影（MC2LL/LL2MC 多项式）
    transform/
      CoordTransform.js                 # WGS84 / GCJ02 / BD09 互转
examples/
  amap|baidu|geovis|google|tdt|tencent.html            # CDN 引入方式
  amap|baidu|geovis|google|tdt|tencent_esm.html        # ESM + importmap 方式
```

## 三、Provider 实现要点

所有 provider 均 `extends UrlTemplateImageryProvider`，通过 URL 模板 + 子域（subdomains）拼接瓦片地址，并视厂商坐标系注入对应 `tilingScheme`。

| Provider | 瓦片 URL 模板 | style 选项 | 坐标系 | 需 key |
| --- | --- | --- | --- | --- |
| AMapImageryProvider | `//webst{s}.is.autonavi.com/appmaptile?style=6/8&x={x}&y={y}&z={z}` | img / elec / cva | GCJ02（crs='WGS84' 时） | 否 |
| BaiduImageryProvider | `//shangetu{s}.map.bdimg.com`、`//online{s}.map.bdimg.com/tile/` 等 | img / vec / custom / traffic | BD09（crs='WGS84' 时） | 否 |
| GeoVisImageryProvider | 矢量 `https://api.open.geovisearth.com/map/v1/vec/{z}/{x}/{y}?token={key}`；影像 `https://api.open.geovisearth.com/pj/base/v1/2025/{z}/{x}/{y}?token={key}`（V6.6.1 起；原 `//tiles{s}.geovisearth.com/base/v1/...` 废弃） | vec / img | 标准（无偏移） | **是（token）** |
| GoogleImageryProvider | `//gac-geo.googlecnapps.cn/maps/vt?lyrs=s/m/h/t@131,r/y&x={x}&y={y}&z={z}` | img / elec / cva / ter / img_cva | GCJ02（crs='WGS84' 时） | 否 |
| TdtImageryProvider | `//t{s}.tianditu.gov.cn/DataServer?T={style}_w&x={x}&y={y}&l={z}&tk={key}` | vec / cva / img / cia / ter | 标准 | **是（tk）** |
| TencentImageryProvider | `//p{s}.map.gtimg.com/sateTiles/`、`//rt{s}.map.gtimg.com/tile?styleid={style}` | img / elec | GCJ02（crs='WGS84' 时） | 否 |

### 各 Provider 独特点

1. **AMapImageryProvider**：`subdomains=['01','02','03','04']`；`crs='WGS84'` 时注入 `GCJ02TilingScheme`。
2. **BaiduImageryProvider**：唯一重写 `requestImage(x,y,level)` 的 provider。百度瓦片坐标原点在中心（`xTiles/2`），WGS84 模式下 y 需取反（`-y`）；`maximumLevel=18`；BD09 用 `BD09TilingScheme`，WGS84 用扩展范围的 `WebMercatorTilingScheme`（±33554054）。子域固定 `s=1`。
3. **GeoVisImageryProvider**：URL 直接替换 `{style}`/`{format}`/`{key}`；`subdomains=['1','2','3']`；星图瓦片为 `tmsIds=w`（无偏移标准瓦片）。
4. **GoogleImageryProvider**：使用 `gac-geo.googlecnapps.cn`（谷歌中国代理域名）；elec 为默认；`crs='WGS84'` 时注入 `GCJ02TilingScheme`。
5. **TdtImageryProvider**：`subdomains=['0'...'7']`；`maximumLevel=18`；style 后接 `_w`；`tk={key}` 参数在 URL 中，无 key 时代理请求将失败。
6. **TencentImageryProvider**：影像（img）用 `customTags` 计算 `{sx}/{sy}`（`x>>4`、`((1<<level)-1-y)>>4`）与 `{reverseY}`（内置关键字）；矢量 `styleid={style}` 由 options.style 替换；`subdomains=['0','1','2']`；`crs='WGS84'` 时注入 `GCJ02TilingScheme`。

## 四、TilingScheme 与坐标转换

### CoordTransform（WGS84 ↔ GCJ02 ↔ BD09）

标准火星坐标算法：
- `WGS84ToGCJ02/GCJ02ToWGS84`：中国大陆范围（`73.66<lng<135.05 && 3.86<lat<53.55`）内做非线性偏移（delta 变换），国外直接返回原值。
- `GCJ02ToBD09/BD09ToGCJ02`：经典百度偏移公式（`z=sqrt(x²+y²)±0.00002*sin(y*BD_FACTOR)` 等）。
- 常量：`BD_FACTOR=3.14159265358979324*3000/180`、`RADIUS=6378245.0`、`EE=0.00669342162296594323`。

### GCJ02TilingScheme（高德/谷歌/腾讯 WGS84 模式）

`extends WebMercatorTilingScheme`，重写 `_projection.project`：先 `WGS84→GCJ02` 再走标准 WebMercator 投影；`unproject` 反向 `GCJ02→WGS84`。使 Cesium（WGS84 输入）能正确请求 GCJ02 偏移瓦片并贴地。

### BD09TilingScheme + BD09Projection（百度）

- `BD09Projection`：百度自有墨卡托（MC）↔ 经纬度（LL）多项式变换（6 段 MC_BAND/LL_BAND + MC2LL/LL2MC 系数表），`EARTH_RADIUS=6370996.81`。
- `BD09TilingScheme extends WebMercatorTilingScheme`：`project` = WGS84→GCJ02→BD09→MC；`unproject` 反向；重写 `tileXYToNativeRectangle`/`positionToTileXY`，用 `resolutions`（每级米/瓦片）计算瓦片范围（y 取负）。

### CustomGeographicTilingScheme / CustomMercatorTilingScheme

面向自定义切片方案（地方坐标系/离线瓦片）：按 `origin`（切图原点）、`resolutions`（每级比例尺）、`tileSize`、`zoomOffset` 重算瓦片行列号。本次案例未使用，暂不移植（避免无用代码），后续自定义瓦片案例需要时再补充。

## 五、Cesium 1.144 兼容性核对（与本项目打包产物对照）

- `UrlTemplateImageryProvider`：1.144 为 class（Cesium.d.ts L46327），构造 options 支持 `url/subdomains/tilingScheme/maximumLevel/customTags`（L46271-46289），可 `extends`。
- `ImageryProvider.loadImage(imageryProvider, url)` 静态方法存在（L37676），百度 `requestImage` 重写可用。
- `WebMercatorTilingScheme`（L18579）/`ImageryLayer`/`TileCoordinatesImageryProvider` 均存在。
- 项目已有 `src/lib/tianditu.ts`（WMTS 方式硬编码 token）与本仓库 `TdtImageryProvider`（URL 模板 `DataServer` 方式）为两种不同实现，新案例采用 cesium-map 的 URL 模板方式并将 key 改为运行期手动输入参数。

## 六、新案例规划（V6.6）

- 每个样例新增一个案例，每个案例在原样例基础上新增一个方案（第 2 个方案）+ 坐标系切换。
- 需要 key 的天地图/星图：初始化时不加载底图，UI 提供 key 输入框与「加载底图」按钮，手动输入 key/token 后按参数创建 provider 并加入 ImageryLayer。
- 共享库 TS 化移植到 `src/lib/cesium-map/`，公共场景管理抽为 `src/lib/use-map-provider-scene.ts`。

## 七、坐标轴拾取/拖拽交互与坐标系统经验（V6.7 补充，V6.7.2 更正）

V6.7「自定义XYZ坐标轴-拖拽平移」案例属通用 Cesium 交互（非地图 provider 案例），记录与地图交互复用的坐标系统结论：

- 【V6.7.2 最终定案】`ScreenSpaceEventHandler` 回调 `position/endPosition`、`viewer.scene.pick()`、`SceneTransforms.worldToWindowCoordinates()` **三者统一为 canvas 相对坐标（CSS px）**。判定/拾取/比较一律不加减 `canvas.getBoundingClientRect()` 偏移；轴真实渲染像素与 worldToWindow 输出重合（headless 截图像素取证，X 轴端 canvas (982.7,372.5)）。V6.7 曾误判 pick/worldToWindow 需要 viewport 坐标并加 rect 偏移，导致真实用户“轴上无反应、空白偶发拾取”，已在 V6.7.2 删除（见 `system-iteration-log.md` V6.7.2 的源码依据与实验）。
- 仅「canvas 相对 → Playwright 原生鼠标/页面坐标」换算才加 `canvas.getBoundingClientRect()` 偏移；headless 验证鼠标落点须按此换算以复刻真实用户。
- 三轴方向用 `Transforms.eastNorthUpToFixedFrame(center)` 矩阵列向量取东/北/上单位向量；轴/端手柄 Entity 的 `positions`/`position` 用 `CallbackProperty(() => …, false)` 动态跟随中心点，无需逐帧手动刷新。
- 沿轴平移米数换算：`worldToWindowCoordinates(center)` 与 `worldToWindowCoordinates(center+d·1m)` 得每米屏幕像素向量 `vpx`，`meters = (dp·vpx)/|vpx|²`，中心沿固定 `d` 直线平移；轴近垂直屏幕时 `|vpx|≈0` 平移无效属 gizmo 正常退化行为。
- 悬停高亮/按下加粗通过动态替换 `polyline.width`（`ConstantProperty`）与 `material`（`ColorMaterialProperty`）实现；运行时赋值 graphics 属性须包 Property，创建 options 里的可裸赋 number/Color。
