import type { DemoCard } from '../types'
import { createDggsCase } from '../../lib/dggs/case'

const DggsS2Demo = createDggsCase('dggs-s2')

const dggsS2Case: DemoCard = {
  id: 'dggs-s2',
  title: 'S2 球面网格',
  category: 'scene',
  description:
    '完整复刻 GeoLibre 的 S2 Grid 插件：S2 Geometry 将球面递归四分为 30 层四边形单元并以 Hilbert 曲线编码。支持自动层级（随缩放联动）与手动滑块、填充色 / 不透明度、轮廓色 / 线宽、单元 ID 标注；点击地图拾取单元并回显 token、层级、中心经纬、父级、子级数与边邻域；可将选中单元邻域 / 父级叠加高亮，支持缩放到单元、复制 ID、导出 GeoJSON / CSV 与添加为图层。',
  tag: 'S2, DGGS, 球面四边形, Hilbert曲线, 拾取, 导出',
  component: DggsS2Demo,
  updatedAt: '2026-09-26'
}

export default dggsS2Case
