import type { DemoCard } from '../types'
import { createDggsCase } from '../../lib/dggs/case'

const DggsDggalDemo = createDggsCase('dggs-dggal')

const dggsDggalCase: DemoCard = {
  id: 'dggs-dggal',
  title: 'DGGAL 网格',
  category: 'scene',
  description:
    '完整复刻 GeoLibre 的 DGGAL Grid 插件（dggal WASM）：内置 18 种离散全球网格类型（ISEA / IVEA / RTEA 系列的 3H / 4R / 7H / 9R 与 Z7 变体、GNOSISGlobalGrid、HEALPix、rHEALPix 等），各类型分辨率上限不同。视域查询由引擎 listZones 原生完成；支持自动分辨率与手动滑块、填充色 / 不透明度、轮廓色 / 线宽、单元 ID 标注；点击拾取单元并回显文本 ID、分辨率、中心经纬、父级、子级数与邻域，可叠加邻域 / 父级高亮并导出 GeoJSON / CSV。',
  tag: 'DGGAL, WASM, ISEA, IVEA, RTEA, HEALPix, rHEALPix, 拾取, 导出',
  component: DggsDggalDemo,
  updatedAt: '2026-09-26'
}

export default dggsDggalCase
