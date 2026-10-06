import { axisBottom, axisLeft, line, max, mean, scaleLinear, select } from 'd3'
import {
  ConstantProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Cartesian2,
  type Entity
} from 'cesium'
import type { D3CaseSpec } from '../types'
import { CHINA_CITIES, mulberry32, type CityDatum } from '../data'
import { addLabel, addPoint, toColor } from '../render'

const SVG_NS = 'http://www.w3.org/2000/svg'

type Series = { labels: string[]; values: number[] }

/** 用可复现随机数 + 正弦基线生成城市的时间序列。 */
function buildSeries(city: CityDatum, hours: number, amplitude: number, seed: number): Series {
  const rng = mulberry32(seed)
  const labels: string[] = []
  const values: number[] = []
  for (let i = 0; i < hours; i += 1) {
    labels.push(`${String(i).padStart(2, '0')}:00`)
    const wave = Math.sin((i / hours) * Math.PI * 2 + (city.value % 7)) * 0.5 + 0.5
    values.push(Math.round((18 + wave * amplitude + rng() * amplitude * 0.35) * 10) / 10)
  }
  return { labels, values }
}

const spec: D3CaseSpec = {
  id: 'd3-floating-chart',
  meta: {
    title: '悬浮图表联动面板',
    subtitle: 'd3.line / d3.scaleLinear → 屏幕浮层 SVG 与三维拾取联动',
    description: '在三维地球上方叠加一块 d3 绘制的折线 / 柱状面板，点击地图城市即可切换时间序列。',
    tag: 'D3 图表 · 屏幕浮层',
    accent: '#38bdf8',
    tips: [
      '图表由 d3 比例尺与路径生成器绘制到 ctx.overlay 注入的 SVG 浮层，不占用 Cesium 图元',
      '通过 ScreenSpaceEventHandler 拾取实体 id，在 setup 内直接重绘图表，无需重建整个案例',
      '画布事件写入 ctx.onCleanup，浮层 SVG 由外壳随重建自动移除'
    ]
  },
  defaults: {
    hours: 24,
    amplitude: 40,
    mode: 'line',
    seed: 20261006,
    showLabels: true
  },
  camera: { lon: 104, lat: 34, height: 5200000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'hours', label: '时间点数量', min: 8, max: 72, step: 1 },
    { kind: 'range', key: 'amplitude', label: '序列振幅', min: 10, max: 120, step: 5 },
    {
      kind: 'select',
      key: 'mode',
      label: '图表类型',
      options: [
        { value: 'line', label: '折线图' },
        { value: 'bar', label: '柱状图' }
      ]
    },
    { kind: 'range', key: 'seed', label: '数据种子', min: 1, max: 9999999, step: 1 },
    { kind: 'checkbox', key: 'showLabels', label: '显示城市标签' }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const hours = Number(settings.hours)
    const amplitude = Number(settings.amplitude)
    const mode = String(settings.mode)
    const seed = Number(settings.seed)
    const showLabels = Boolean(settings.showLabels)

    const wrap = document.createElement('div')
    ctx.overlay(wrap)
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('width', '340')
    svg.setAttribute('height', '200')
    svg.setAttribute('viewBox', '0 0 340 200')
    svg.style.cssText =
      'position:absolute;left:16px;top:16px;border-radius:12px;background:rgba(15,23,42,0.86);' +
      'border:1px solid rgba(148,163,184,0.32);box-shadow:0 12px 30px rgba(2,6,23,0.45);'
    wrap.appendChild(svg)

    const cities = CHINA_CITIES.slice(0, 14)
    const cityByEntity = new Map<string, CityDatum>()
    const entityByCity = new Map<CityDatum, Entity>()

    cities.forEach((city) => {
      const entity = addPoint(ctx.dataSource, city.lon, city.lat, {
        pixelSize: 6 + city.value / 22,
        color: '#38bdf8',
        disableDepthTest: true
      })
      cityByEntity.set(entity.id, city)
      entityByCity.set(city, entity)
      if (showLabels) {
        addLabel(ctx.dataSource, city.lon, city.lat, city.name, {
          font: '11px sans-serif',
          scaleByDistance: [1500000, 0.4, 9000000, 1.2],
          disableDepthTest: true
        })
      }
    })

    const paint = (city: CityDatum, color: string) => {
      const entity = entityByCity.get(city)
      if (entity?.point) entity.point.color = new ConstantProperty(toColor(color))
    }

    const draw = (city: CityDatum) => {
      const { labels, values } = buildSeries(city, hours, amplitude, seed + Math.round(city.lon * 100))
      const root = select(svg)
      root.selectAll('*').remove()
      const m = { top: 32, right: 16, bottom: 28, left: 42 }
      const iw = 340 - m.left - m.right
      const ih = 200 - m.top - m.bottom
      const x = scaleLinear().domain([0, Math.max(1, values.length - 1)]).range([0, iw])
      const y = scaleLinear().domain([0, Math.max(1, max(values))]).range([ih, 0])

      root
        .append('text')
        .attr('x', m.left)
        .attr('y', 20)
        .attr('fill', '#e2e8f0')
        .attr('font-size', 13)
        .attr('font-weight', 600)
        .text(`${city.name} · 时间序列`)
      root
        .append('text')
        .attr('x', 340 - m.right)
        .attr('y', 20)
        .attr('text-anchor', 'end')
        .attr('fill', '#7dd3fc')
        .attr('font-size', 11)
        .text(`均值 ${(mean(values) ?? 0).toFixed(1)}`)

      const g = root.append('g').attr('transform', `translate(${m.left},${m.top})`)
      if (mode === 'bar') {
        g.selectAll('rect')
          .data(values)
          .enter()
          .append('rect')
          .attr('x', (_d: number, i: number) => x(i))
          .attr('y', (d: number) => y(d))
          .attr('width', Math.max(2, iw / values.length - 2))
          .attr('height', (d: number) => ih - y(d))
          .attr('fill', '#38bdf8')
          .attr('opacity', 0.85)
      } else {
        g.append('path')
          .datum(values.map((v, i) => [i, v] as [number, number]))
          .attr('fill', 'none')
          .attr('stroke', '#38bdf8')
          .attr('stroke-width', 2)
          .attr(
            'd',
            line()
              .x((d: [number, number]) => x(d[0]))
              .y((d: [number, number]) => y(d[1]))
          )
      }
      g.append('g')
        .attr('transform', `translate(0,${ih})`)
        .call(
          axisBottom(x)
            .ticks(6)
            .tickFormat((d: number) => labels[d] ?? '')
        )
      g.append('g').call(axisLeft(y).ticks(4))
      root.selectAll('.tick text').attr('fill', '#94a3b8').attr('font-size', 10)
      root.selectAll('.tick line').attr('stroke', 'rgba(148,163,184,0.4)')
      root.selectAll('.domain').attr('stroke', 'rgba(148,163,184,0.4)')
    }

    let selected = cities[0]
    paint(selected, '#facc15')
    draw(selected)

    const handler = new ScreenSpaceEventHandler(ctx.viewer.scene.canvas)
    handler.setInputAction(
      (movement: { position: Cartesian2 }) => {
        const picked = ctx.viewer.scene.pick(movement.position)
        const pickedId = picked?.id?.id ?? picked?.id
        if (typeof pickedId !== 'string') return
        const city = cityByEntity.get(pickedId)
        if (!city) return
        selected = city
        cities.forEach((c) => paint(c, c === city ? '#facc15' : '#38bdf8'))
        draw(city)
        ctx.status(`已选中 ${city.name}，基准指标 ${city.value}`)
      },
      ScreenSpaceEventType.LEFT_CLICK
    )
    ctx.onCleanup(() => handler.destroy())

    ctx.legend([
      { label: '时间序列', color: '#38bdf8' },
      { label: '已选城市', color: '#facc15' }
    ])
    ctx.status(`${cities.length} 个可拾取城市，图表已加载 ${selected.name}`)
  }
}

export default spec
