import type { DemoCard } from '../types'
import { createDggsCase } from '../../lib/dggs/case'

const DggsH3Demo = createDggsCase('dggs-h3')

const dggsH3Case: DemoCard = {
  id: 'dggs-h3',
  title: 'H3 六边形网格',
  category: 'scene',
  description:
    '完整复刻 GeoLibre 的 H3 Grid 插件：以二十面体投影构建 0~15 层六边形（含 12 个五边形）单元，孔径 7。支持自动分辨率（随缩放联动）与手动滑块、填充色 / 不透明度、轮廓色 / 线宽、单元 ID 标注、二十面体叠加层；点击地图拾取单元并回显 ID、分辨率、中心经纬、基础单元编号、是否五边形、父级、子级数与邻域；可将选中单元邻域 / 父级叠加高亮，支持缩放到单元、复制 ID、导出 GeoJSON / CSV 与添加为图层。',
  tag: 'H3, DGGS, 六边形, 二十面体, 孔径7, 拾取, 导出',
  component: DggsH3Demo,
  updatedAt: '2026-09-26'
}

export default dggsH3Case
