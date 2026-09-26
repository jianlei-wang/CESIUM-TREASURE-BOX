import type { DemoCard } from '../types'
import { createDggsCase } from '../../lib/dggs/case'

const DggsGeohashDemo = createDggsCase('dggs-geohash')

const dggsGeohashCase: DemoCard = {
  id: 'dggs-geohash',
  title: 'Geohash 网格',
  category: 'scene',
  description:
    '完整复刻 GeoLibre 的 Geohash Grid 插件：Geohash 用 Base32 编码把经纬度交错二分（Z 阶曲线），编码每加 1 位单元细分为 32 个子格。支持自动精度（随缩放联动）与手动滑块、填充色 / 不透明度、轮廓色 / 线宽、单元 ID 标注；点击拾取单元并回显 geohash、精度、中心经纬、父级、子级数与邻域，可叠加邻域 / 父级高亮并导出 GeoJSON / CSV。',
  tag: 'Geohash, Base32, Z阶曲线, 经纬网格, 拾取, 导出',
  component: DggsGeohashDemo,
  updatedAt: '2026-09-26'
}

export default dggsGeohashCase
