import type { DemoCard } from '../types'
import { createDggsCase } from '../../lib/dggs/case'

const DggsOlcDemo = createDggsCase('dggs-olc')

const dggsOlcCase: DemoCard = {
  id: 'dggs-olc',
  title: 'OLC 网格',
  category: 'scene',
  description:
    '完整复刻 GeoLibre 的 OLC Grid 插件：Open Location Code（Plus Codes）以变长字母数字编码把地球划分为轴对齐经纬网格，合法编码长度 2~15（10 位以上细化为 4×5 网格）。支持自动编码长度（随缩放联动）与手动下拉选择、填充色 / 不透明度、轮廓色 / 线宽、单元 ID 标注；点击拾取单元并回显编码、编码长度、中心经纬、父级、子级数与边邻域，可叠加邻域 / 父级高亮并导出 GeoJSON / CSV。',
  tag: 'OLC, Plus Codes, 开放位置编码, 编码长度, 拾取, 导出',
  component: DggsOlcDemo,
  updatedAt: '2026-09-26'
}

export default dggsOlcCase
