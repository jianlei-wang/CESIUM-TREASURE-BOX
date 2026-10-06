# D3 地理大数据案例库开发指南

本目录（`src/lib/d3geo`）为「D3地理大数据」分类下 45 个案例提供统一渲染外壳与工具函数。
每个案例只需要实现一个 `D3CaseSpec`，外壳负责 Cesium 场景、参数面板、图例、状态栏与鼠标经纬度。

## 目录约定

- 案例描述文件：`src/lib/d3geo/cases/<id>.ts`，默认导出 `D3CaseSpec`。
- 案例注册文件：`src/cases/<id>/index.ts`，从上面的描述文件创建组件。
- 案例目录名、`spec.id`、`DemoCard.id` 必须完全一致。
- 不提供 `icon` 字段（保持为空）。

## 注册文件模板

```ts
import type { DemoCard } from '../types'
import { createD3Case } from '../../lib/d3geo/case'
import spec from '../../lib/d3geo/cases/d3-xxx'

const Demo = createD3Case(spec)

const caseMeta: DemoCard = {
  id: 'd3-xxx',
  title: 'D3大数据-案例名',
  category: 'd3',
  description: '一句话说明。',
  tag: '关键词1, 关键词2',
  component: Demo,
  updatedAt: '2026-10-06'
}

export default caseMeta
```

## D3CaseSpec

```ts
type D3CaseSpec = {
  id: string
  meta: {
    title: string          // 顶栏主标题（中文）
    subtitle: string       // 副标题（技术说明）
    description: string    // 一句话
    tag: string            // 技术标签
    accent: string         // 强调色，如 '#38bdf8'
    tips?: string[]        // 侧栏「实现要点」，2~3 条
  }
  defaults: Record<string, string | number | boolean>
  controls?: D3Control[]
  camera?: { lon: number; lat: number; height: number; heading?: number; pitch?: number; roll?: number }
  setup: (ctx: D3CaseContext) => void
  update?: (ctx: D3CaseContext) => void   // 不填则参数变化时清空重建
}
```

`D3Control` 取值：

```ts
{ kind: 'range', key, label, min, max, step?, format?: (v:number)=>string }
{ kind: 'select', key, label, options: [{ value, label }] }
{ kind: 'checkbox', key, label }
{ kind: 'color', key, label }
{ kind: 'button', label, onClick: (ctx) => void }
```

## D3CaseContext

```ts
ctx.viewer          // Cesium Viewer
ctx.dataSource      // 案例专属 CustomDataSource，实体加到这里，重建时自动清空
ctx.settings        // 当前参数（响应式对象，可直接读取）
ctx.status(text)    // 更新左下角状态文字
ctx.legend(items)   // 设置图例；label 为色带名时自动渲染渐变条
ctx.onFrame((timeMs, deltaMs) => {})  // 每帧回调，返回取消函数
ctx.onCleanup(fn)   // 注册清理逻辑
ctx.overlay(el)     // 追加覆盖画布的元素（SVG 浮层等），重建时自动移除
ctx.pointCollection() // 创建批量点集合（性能优于逐点 Entity），自动清理
ctx.clear()         // 清空案例内容
```

## 渲染工具（`../render`）

```ts
addBox(ds, lon, lat, { size, height, base?, color, alpha?, outline?, outlineColor? })
addCylinder(ds, lon, lat, { radius, height, base?, color, alpha?, outline?, outlineColor? })
addPolygon(ds, points, { height?, extrudedHeight?, perPositionHeight?, color?, alpha?, outline?, outlineColor?, outlineWidth? })
   // points: Array<[lon,lat] | [lon,lat,height]>
addPolyline(ds, points, { width?, color?, alpha?, clampToGround?, height?, glow?, glowPower? })
addArc(ds, from, to, { segments?, arcHeight?, width?, color?, glow? })
geodesicPoints(from, to, segments?, heightAt?: (t)=>number)
addPoint(ds, lon, lat, { pixelSize?, color?, alpha?, outlineColor?, outlineWidth?, disableDepthTest? })
addLabel(ds, lon, lat, text, { color?, font?, outlineColor?, disableDepthTest?, scaleByDistance? })
addBillboard(ds, lon, lat, image, { scale?, color?, disableDepthTest? })
createPointCollection(viewer) / addToPointCollection(collection, lon, lat, height, color, pixelSize)
addPulseRing(ds, lon, lat, { color?, maxRadius?, period?, height?, width? })
circlePositions(lon, lat, radiusMeters, height?, segments?)
circlePolygon(lon, lat, radiusMeters, segments?)
toColor(value, alpha?) / shade(hex, factor)
type LonLat = [number, number]
```

## 数据工具（`../data`）

```ts
mulberry32(seed)        // 可复现随机数
CHINA_CITIES            // 40 个国内城市 { name, lon, lat, value }
WORLD_HUBS              // 20 个全球枢纽 { name, lon, lat, value }
randomPoints(count, bounds, seed)
clusteredPoints([{ lon, lat, count, spread? }], seed)
histogram(values, bins, domain?)
valueNoise2D(width, height, seed?, octaves?)
lerp / clamp
```

## 色带工具（`../palettes`）

```ts
ramp(name, t)     // name: viridis | inferno | turbo | plasma | blues | greens | reds | spectral | coolwarm | sunset
categorical(i)
withAlpha(hex, alpha)
mixHex(a, b, t)
rampCss(name)
```

## d3 可用范围

`d3` 已作为依赖安装。可用的核心模块（从 `'d3'` 命名导入）包括：
`scaleLinear / scaleSqrt / scaleQuantize / scaleOrdinal / scaleSequential`、`pie / stack / arc / line / area / curveCardinal`、
`hierarchy / treemap / pack / partition / tree`、`forceSimulation / forceManyBody / forceLink / forceCenter / forceCollide`、
`contours / contourDensity`、`Delaunay`、`quadtree`、`polygonHull`、`geoPath / geoGraticule / geoContains`、
`group / rollup / sum / mean / extent / range / ascending`、`timeFormat / timeParse / utcHour`、`json / csv / fetch`、
`brush / brushX`、`schemeViridis` 等插值器。

注意：**未安装** `d3-hexbin`、`d3-sankey`、`d3-hull`。蜂窝聚合请自行实现（或使用已安装的 `h3-js`），
桑基流请自行实现简单的分层布局。

## 实现注意

- 所有实体添加到 `ctx.dataSource`；海量点用 `ctx.pointCollection()`。
- 动画用 `ctx.onFrame`，不要用 `setInterval`；清理用 `ctx.onCleanup`。
- 参数变化时若 `update` 未定义，外壳会清空后重新执行 `setup`，因此 `setup` 必须可重复执行。
- 控制项数量建议 4~6 个，保证面板简洁。
- 避免使用 `any` 之外难以通过 `vue-tsc` 的类型操作；`d3` 为环境声明，返回 `any`，可直接使用。
