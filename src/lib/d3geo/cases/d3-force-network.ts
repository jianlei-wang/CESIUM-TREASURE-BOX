import { forceSimulation, forceManyBody, forceLink, forceCenter } from 'd3'
import { Cartesian3, ConstantPositionProperty, ConstantProperty } from 'cesium'
import type { D3CaseSpec } from '../types'
import { WORLD_HUBS, mulberry32 } from '../data'
import { ramp } from '../palettes'
import { addLabel, addPolyline, addToPointCollection } from '../render'

type ForceNode = {
  index: number
  name: string
  lon: number
  lat: number
  value: number
  x: number
  y: number
}

type ForceLink = { source: ForceNode; target: ForceNode; weight: number }

const CENTER: [number, number] = [30, 22]

function buildNodes(count: number): ForceNode[] {
  return WORLD_HUBS.slice(0, Math.max(2, Math.min(count, WORLD_HUBS.length))).map(
    (hub, index: number): ForceNode => ({
      index,
      name: hub.name,
      lon: hub.lon,
      lat: hub.lat,
      value: hub.value,
      x: hub.lon,
      y: hub.lat
    })
  )
}

function buildLinks(nodes: ForceNode[], count: number, seed: number): ForceLink[] {
  const rng = mulberry32(seed)
  const links: ForceLink[] = []
  const seen = new Set<string>()
  let guard = 0
  while (links.length < count && guard < count * 40) {
    guard += 1
    const a = Math.floor(rng() * nodes.length)
    const b = Math.floor(rng() * nodes.length)
    if (a === b) continue
    const key = a < b ? `${a}-${b}` : `${b}-${a}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ source: nodes[a], target: nodes[b], weight: 0.25 + rng() * 0.75 })
  }
  return links
}

const spec: D3CaseSpec = {
  id: 'd3-force-network',
  meta: {
    title: '全球网络拓扑图',
    subtitle: 'd3.forceSimulation 在经纬平面自组织布局',
    description: '利用力导向模拟的斥力与连线张力，在经纬坐标平面内组织全球枢纽拓扑，并逐帧推进演化。',
    tag: 'D3 力学布局 · 网络拓扑',
    accent: '#38bdf8',
    tips: [
      'forceManyBody 提供节点斥力，forceLink 维持连边张力，forceCenter 稳定整体质心',
      '初始化位置取自真实经纬度，力场演化后仍保留地理分布的可辨识性',
      'simulation.stop() 关闭内置计时器，改由 onFrame 手动 tick，位置用 ConstantPositionProperty 逐帧更新'
    ]
  },
  defaults: {
    nodeCount: 16,
    linkCount: 34,
    charge: -90,
    showLabels: true,
    seed: 20261006
  },
  camera: { lon: 30, lat: 22, height: 20000000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'nodeCount', label: '节点数量', min: 6, max: 20, step: 1 },
    { kind: 'range', key: 'linkCount', label: '连线数量', min: 6, max: 80, step: 2 },
    { kind: 'range', key: 'charge', label: '斥力强度', min: -400, max: -20, step: 10 },
    { kind: 'checkbox', key: 'showLabels', label: '显示标签' },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const nodeCount = Math.round(Number(ctx.settings.nodeCount))
    const linkCount = Math.round(Number(ctx.settings.linkCount))
    const charge = Number(ctx.settings.charge)
    const showLabels = Boolean(ctx.settings.showLabels)
    const seed = Number(ctx.settings.seed)

    const nodes = buildNodes(nodeCount)
    const links = buildLinks(nodes, linkCount, seed)

    const values = nodes.map((n) => n.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const ratio = (value: number) => (max === min ? 0.6 : (value - min) / (max - min))

    const collection = ctx.pointCollection()
    const nodePts = nodes.map((node) =>
      addToPointCollection(collection, node.x, node.y, 0, ramp('turbo', ratio(node.value)), 4 + ratio(node.value) * 6)
    )
    const nodeLabels = nodes.map((node) =>
      addLabel(ctx.dataSource, node.x, node.y, node.name, {
        font: '11px sans-serif',
        scaleByDistance: [2000000, 0.3, 14000000, 1.3],
        disableDepthTest: true
      })
    )
    nodeLabels.forEach((entity) => {
      entity.show = showLabels
    })

    const linkEntities = links.map((link) =>
      addPolyline(
        ctx.dataSource,
        [
          [link.source.x, link.source.y],
          [link.target.x, link.target.y]
        ],
        { width: 0.8 + link.weight * 2.2, color: ramp('plasma', link.weight), alpha: 0.6, glow: true, glowPower: 0.15 }
      )
    )

    const simulation = forceSimulation(nodes)
      .force('charge', forceManyBody().strength(charge))
      .force('link', forceLink(links).distance(14).strength(0.12))
      .force('center', forceCenter(CENTER[0], CENTER[1]))
      .stop()

    const sync = () => {
      nodes.forEach((node) => {
        node.x = Math.max(-179, Math.min(179, node.x))
        node.y = Math.max(-80, Math.min(80, node.y))
      })
      nodes.forEach((node, i) => {
        nodePts[i].position = Cartesian3.fromDegrees(node.x, node.y, 0)
        nodeLabels[i].position = new ConstantPositionProperty(Cartesian3.fromDegrees(node.x, node.y, 0))
      })
      links.forEach((link, i) => {
        const entity = linkEntities[i]
        if (!entity.polyline) return
        entity.polyline.positions = new ConstantProperty([
          Cartesian3.fromDegrees(link.source.x, link.source.y, 0),
          Cartesian3.fromDegrees(link.target.x, link.target.y, 0)
        ])
      })
    }

    for (let i = 0; i < 120; i += 1) simulation.tick()
    sync()

    ctx.onFrame(() => {
      simulation.tick()
      sync()
    })
    ctx.onCleanup(() => simulation.stop())

    ctx.legend([
      { label: '节点价值（低→高）', color: ramp('turbo', 1) },
      { label: `${nodes.length} 节点 / ${links.length} 连线`, color: '#38bdf8' }
    ])
    ctx.status(`力导向布局：${nodes.length} 个枢纽，${links.length} 条连接，斥力 ${charge}`)
  }
}

export default spec
