import type { DemoCard } from '../types'
import { createDggsCase } from '../../lib/dggs/case'

const DggsTilecodeDemo = createDggsCase('dggs-tilecode')

const dggsTilecodeCase: DemoCard = {
  id: 'dggs-tilecode',
  title: 'Tilecode 网格',
  category: 'scene',
  description:
    '完整复刻 GeoLibre 的 Tilecode Grid 插件：基于 Web Mercator 四叉树瓦片编码（z/x/y 与 quadkey），层级每加 1 单元四分为 4 个子瓦片。支持自动瓦片层级（随缩放联动）与手动滑块、填充色 / 不透明度、轮廓色 / 线宽、单元 ID 标注；点击拾取单元并回显瓦片编码、四叉键、瓦片层级、中心经纬、父级、子级数与邻域，可叠加邻域 / 父级高亮并导出 GeoJSON / CSV。',
  tag: 'Tilecode, 四叉树, quadkey, Web Mercator, 瓦片, 拾取, 导出',
  component: DggsTilecodeDemo,
  updatedAt: '2026-09-26'
}

export default dggsTilecodeCase
