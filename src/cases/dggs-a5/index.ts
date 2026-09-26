import type { DemoCard } from '../types'
import { createDggsCase } from '../../lib/dggs/case'

const DggsA5Demo = createDggsCase('dggs-a5')

const dggsA5Case: DemoCard = {
  id: 'dggs-a5',
  title: 'A5 网格',
  category: 'scene',
  description:
    '完整复刻 GeoLibre 的 A5 Grid 插件：A5 将地球划分为等面积五边形 / 六边形单元并逐级细分。支持自动层级（随缩放联动）与手动滑块、填充色 / 不透明度、轮廓色 / 线宽、单元 ID 标注；点击地图拾取单元并回显 ID、层级、中心经纬、父级、子级数与邻域；可将选中单元邻域 / 父级叠加高亮，支持缩放到单元、复制 ID、导出 GeoJSON / CSV 与添加为图层。',
  tag: 'A5, DGGS, 五边形, 六边形, 等面积, 拾取, 导出',
  component: DggsA5Demo,
  updatedAt: '2026-09-26'
}

export default dggsA5Case
