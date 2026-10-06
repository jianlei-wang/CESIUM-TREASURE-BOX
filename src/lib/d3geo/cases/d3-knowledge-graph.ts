import type { D3CaseSpec } from '../types'
import { addArc, addLabel, addPoint } from '../render'

type KGType = 'person' | 'institution' | 'event' | 'location'
type KGRelation = 'works' | 'born' | 'happens' | 'participates'

type KGNode = { id: string; name: string; type: KGType; lon: number; lat: number }
type KGLink = { source: string; target: string; relation: KGRelation }

const TYPE_COLOR: Record<KGType, string> = {
  person: '#38bdf8',
  institution: '#f472b6',
  event: '#facc15',
  location: '#4ade80'
}

const RELATION_COLOR: Record<KGRelation, string> = {
  works: '#38bdf8',
  born: '#4ade80',
  happens: '#facc15',
  participates: '#f472b6'
}

const NODES: KGNode[] = [
  { id: 'p-zhangheng', name: '张衡', type: 'person', lon: 112.454, lat: 34.619 },
  { id: 'p-zuchongzhi', name: '祖冲之', type: 'person', lon: 118.797, lat: 32.06 },
  { id: 'p-shenkuo', name: '沈括', type: 'person', lon: 120.155, lat: 30.274 },
  { id: 'p-guoshoujing', name: '郭守敬', type: 'person', lon: 116.407, lat: 39.904 },
  { id: 'p-xuxiake', name: '徐霞客', type: 'person', lon: 120.312, lat: 31.491 },
  { id: 'p-lishizhen', name: '李时珍', type: 'person', lon: 114.305, lat: 30.593 },
  { id: 'i-cas', name: '中国科学院', type: 'institution', lon: 116.407, lat: 39.904 },
  { id: 'i-zju', name: '浙江大学', type: 'institution', lon: 120.155, lat: 30.274 },
  { id: 'i-nju', name: '南京大学', type: 'institution', lon: 118.797, lat: 32.06 },
  { id: 'i-nwpu', name: '西北工业大学', type: 'institution', lon: 108.94, lat: 34.341 },
  { id: 'e-zhenghe', name: '郑和下西洋', type: 'event', lon: 118.797, lat: 32.06 },
  { id: 'e-dujiangyan', name: '都江堰修建', type: 'event', lon: 104.066, lat: 30.572 },
  { id: 'e-silkroad', name: '丝绸之路', type: 'event', lon: 108.94, lat: 34.341 },
  { id: 'l-beijing', name: '北京', type: 'location', lon: 116.407, lat: 39.904 },
  { id: 'l-nanjing', name: '南京', type: 'location', lon: 118.797, lat: 32.06 },
  { id: 'l-hangzhou', name: '杭州', type: 'location', lon: 120.155, lat: 30.274 },
  { id: 'l-xian', name: '西安', type: 'location', lon: 108.94, lat: 34.341 },
  { id: 'l-chengdu', name: '成都', type: 'location', lon: 104.066, lat: 30.572 },
  { id: 'l-luoyang', name: '洛阳', type: 'location', lon: 112.454, lat: 34.619 }
]

const LINKS: KGLink[] = [
  { source: 'p-zhangheng', target: 'i-cas', relation: 'works' },
  { source: 'p-shenkuo', target: 'i-zju', relation: 'works' },
  { source: 'p-zuchongzhi', target: 'i-nju', relation: 'works' },
  { source: 'p-guoshoujing', target: 'i-cas', relation: 'works' },
  { source: 'p-zhangheng', target: 'l-luoyang', relation: 'born' },
  { source: 'p-zuchongzhi', target: 'l-nanjing', relation: 'born' },
  { source: 'p-shenkuo', target: 'l-hangzhou', relation: 'born' },
  { source: 'p-guoshoujing', target: 'l-beijing', relation: 'born' },
  { source: 'p-lishizhen', target: 'l-chengdu', relation: 'born' },
  { source: 'e-zhenghe', target: 'l-nanjing', relation: 'happens' },
  { source: 'e-dujiangyan', target: 'l-chengdu', relation: 'happens' },
  { source: 'e-silkroad', target: 'l-xian', relation: 'happens' },
  { source: 'p-zhangheng', target: 'e-silkroad', relation: 'participates' },
  { source: 'p-xuxiake', target: 'e-zhenghe', relation: 'participates' },
  { source: 'i-nwpu', target: 'l-xian', relation: 'works' },
  { source: 'i-nju', target: 'l-nanjing', relation: 'works' }
]

const spec: D3CaseSpec = {
  id: 'd3-knowledge-graph',
  meta: {
    title: '知识图谱地理叠加',
    subtitle: '人物 / 机构 / 事件 / 地点 · addArc 关系连线',
    description: '把四类知识实体锚定到真实经纬位置，用不同颜色与弧线表达实体类型与语义关系。',
    tag: 'D3 图数据 · 关系网络',
    accent: '#f472b6',
    tips: [
      '实体分为人物、机构、事件、地点四类，地点类直接使用真实经纬度锚定',
      '关系边用 addArc 抬升成弧线，按关系类型着色，避免与地理要素混淆',
      '可通过下拉过滤不同关系类型，观察单一语义子图的分布'
    ]
  },
  defaults: {
    arcHeight: 320000,
    width: 1.8,
    relation: 'all',
    showLabels: true,
    nodeScale: 7
  },
  camera: { lon: 112, lat: 34, height: 3400000, pitch: -80 },
  controls: [
    { kind: 'range', key: 'arcHeight', label: '弧线抬升', min: 50000, max: 1200000, step: 50000 },
    { kind: 'range', key: 'width', label: '弧线线宽', min: 0.5, max: 6, step: 0.5 },
    {
      kind: 'select',
      key: 'relation',
      label: '关系类型',
      options: [
        { value: 'all', label: '全部关系' },
        { value: 'works', label: '供职 / 隶属' },
        { value: 'born', label: '出生于' },
        { value: 'happens', label: '发生于' },
        { value: 'participates', label: '参与事件' }
      ]
    },
    { kind: 'checkbox', key: 'showLabels', label: '显示标签' },
    { kind: 'range', key: 'nodeScale', label: '节点大小', min: 4, max: 16, step: 1 }
  ],
  setup(ctx) {
    const arcHeight = Number(ctx.settings.arcHeight)
    const width = Number(ctx.settings.width)
    const relation = String(ctx.settings.relation)
    const showLabels = Boolean(ctx.settings.showLabels)
    const nodeScale = Number(ctx.settings.nodeScale)

    const byId = new Map<string, KGNode>(NODES.map((node): [string, KGNode] => [node.id, node]))
    const activeLinks = LINKS.filter((link) => relation === 'all' || link.relation === relation)

    activeLinks.forEach((link) => {
      const from = byId.get(link.source)
      const to = byId.get(link.target)
      if (!from || !to) return
      addArc(ctx.dataSource, [from.lon, from.lat], [to.lon, to.lat], {
        segments: 48,
        arcHeight,
        width,
        color: RELATION_COLOR[link.relation],
        alpha: 0.7,
        glow: true,
        glowPower: 0.15
      })
    })

    NODES.forEach((node) => {
      addPoint(ctx.dataSource, node.lon, node.lat, {
        pixelSize: node.type === 'location' ? nodeScale - 1 : nodeScale,
        color: TYPE_COLOR[node.type],
        outlineColor: '#0f172a',
        outlineWidth: 2,
        disableDepthTest: true
      })
      if (showLabels) {
        addLabel(ctx.dataSource, node.lon, node.lat, node.name, {
          font: '12px sans-serif',
          color: '#e2e8f0',
          scaleByDistance: [800000, 0.4, 6000000, 1.3],
          disableDepthTest: true
        })
      }
    })

    ctx.legend([
      { label: '人物', color: TYPE_COLOR.person },
      { label: '机构', color: TYPE_COLOR.institution },
      { label: '事件', color: TYPE_COLOR.event },
      { label: '地点', color: TYPE_COLOR.location }
    ])
    ctx.status(`实体 ${NODES.length} 个，显示关系 ${activeLinks.length} / ${LINKS.length} 条`)
  }
}

export default spec
