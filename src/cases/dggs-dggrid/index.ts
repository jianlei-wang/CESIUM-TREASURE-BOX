import type { DemoCard } from '../types'
import { createDggsCase } from '../../lib/dggs/case'

const DggsDggridDemo = createDggsCase('dggs-dggrid')

const dggsDggridCase: DemoCard = {
  id: 'dggs-dggrid',
  title: 'DGGRID 网格',
  category: 'scene',
  description:
    '完整复刻 GeoLibre 的 DGGRID Grid 插件（webdggrid WASM）：支持六边形 / 钻石形 / 三角形三种单元类型与 ISEA / FULLER 投影，孔径 3 / 4 / 7（非六边形锁定孔径 4）。视域填充采用从中心种子单元出发的邻域 BFS，三角形拓扑回退为点采样；支持自动分辨率与手动滑块、填充色 / 不透明度、轮廓色 / 线宽、单元 ID 标注；点击拾取单元并回显序号 ID、分辨率、中心经纬、父级、子级数与邻域，可叠加邻域 / 父级高亮并导出 GeoJSON / CSV。',
  tag: 'DGGRID, webdggrid, WASM, ISEA, FULLER, 孔径, BFS, 拾取, 导出',
  component: DggsDggridDemo,
  updatedAt: '2026-09-26'
}

export default dggsDggridCase
