import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import iconUrl from './icon.webp'

const GridRenderDemo = defineAsyncComponent(() => import('./GridRenderDemo.vue'))

const gridRenderCase: DemoCard = {
  id: 'grid-render',
  title: '地理网格渲染系统',
  category: 'system',
  description:
    '完整复刻 Cesium 地理网格渲染技术路线：以椭球面为基座构建统一网格渲染内核，集成经纬网格、北斗网格（GB/T 39409-2020 非极地 1~11 级）、水文网格与符合 OGC DGGS 规范的离散全球网格（H3 六边形、孔径 7）四类网格引擎；支持二维贴地与三维网格体两种模式，三维网格体按 GB/T 40087 高度域逐层剖分以保持单元近正方体；四类网格共享同一套 GridStyle 样式 Schema 与拾取协议，线模式并入单 PolylineCollection、面模式合并实例提交单 Primitive、标注并入单 LabelCollection，单元数超上限时自动提升层级降级；相机高度联动自动 LOD，也可关闭后逐类手动指定间隔 / 层级 / 步长 / 分辨率；鼠标悬浮实时预览高亮，单击锁定单元并在左上弹窗回显编码、层级、经纬范围、行列号、中心坐标与单元面积等元数据；「只显示研究区」可将网格生成与拾取限定在固定研究区内；地图内图层浮层可独立开关四类网格，右上角提供技术路线说明（渲染管线、四层架构、DGGS 选型对比 H3/S2/rHEALPix、能力矩阵、公共内核、交互与样式、性能优化专项、风险与对策、工程选型）；底部状态栏实时输出视点高度、缩放层级、视点经纬、视域四至、单元总数与渲染帧率。',
  tag: 'Cesium, 地理网格, 北斗网格, GB/T 39409, GB/T 40087, DGGS, H3, LOD, 拾取, 统一渲染内核',
  icon: iconUrl,
  component: GridRenderDemo,
  updatedAt: '2026-09-24'
}

export default gridRenderCase
