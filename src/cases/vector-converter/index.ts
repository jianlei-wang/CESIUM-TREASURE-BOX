import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const VectorConverterDemo = defineAsyncComponent(() => import('./VectorConverterDemo.vue'))

const vectorConverterCase: DemoCard = {
  id: 'vector-converter',
  title: '数据转换-矢量数据转换',
  category: 'data',
  description:
    '纯前端矢量数据格式互转工具：自动识别并解析 GeoJSON/TopoJSON、KML/KMZ、奥维 OVKML/OVKMZ/OVJSN/OVOBJ、GPX、WKT、CSV、Shapefile 等格式，统一为 WGS84 中间模型并在三维场景中预览，支持 WGS84/CGCS2000/GCJ02/BD09/Web墨卡托/高斯投影等坐标系互转，可导出为 GeoJSON/KML/KMZ/奥维/GPX/WKT/CSV/SHP，点位矢量可额外导出为 Excel 表格，内置功能实现说明',
  tag: '数据转换',
  icon,
  component: VectorConverterDemo
}

export default vectorConverterCase
