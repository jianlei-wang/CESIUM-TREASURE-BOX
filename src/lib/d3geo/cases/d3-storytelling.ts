import { range } from 'd3'
import { Cartesian3, EasingFunction, Math as CesiumMath } from 'cesium'
import type { D3CaseSpec } from '../types'
import { CHINA_CITIES, type CityDatum } from '../data'
import { addLabel, addPoint, addPolygon, addPulseRing } from '../render'

type Chapter = {
  title: string
  text: string
  accent: string
  camera: { lon: number; lat: number; height: number; pitch: number }
  filter: (city: CityDatum) => boolean
}

const CHAPTERS: Chapter[] = [
  {
    title: '全国总览',
    text: '40 座主要城市以点阵铺满国土，先建立整体印象。',
    accent: '#38bdf8',
    camera: { lon: 104, lat: 34, height: 5400000, pitch: -90 },
    filter: () => true
  },
  {
    title: '东部沿海',
    text: '京津冀、长三角、珠三角构成高密度沿海走廊。',
    accent: '#f472b6',
    camera: { lon: 119.5, lat: 30, height: 2800000, pitch: -70 },
    filter: (c) => c.lon > 113
  },
  {
    title: '中部枢纽',
    text: '武汉、郑州、长沙等中部节点承担全国交通中转。',
    accent: '#4ade80',
    camera: { lon: 112.5, lat: 32, height: 2800000, pitch: -72 },
    filter: (c) => c.lon >= 104 && c.lon <= 118
  },
  {
    title: '西部节点',
    text: '成渝、西安、兰州、乌鲁木齐串起向西开放通道。',
    accent: '#facc15',
    camera: { lon: 96, lat: 35, height: 3400000, pitch: -70 },
    filter: (c) => c.lon < 104
  }
]

const spec: D3CaseSpec = {
  id: 'd3-storytelling',
  meta: {
    title: '数据故事滚动叙事',
    subtitle: 'd3.range 章节编排 → camera.flyTo + 图层显隐',
    description: '左侧章节导航点击即切换预设视角与图层，用镜头语言讲述数据的空间故事。',
    tag: 'D3 叙事 · 镜头编排',
    accent: '#a78bfa',
    tips: [
      'd3.range 生成章节索引，每章绑定一套相机参数与数据过滤规则',
      '图层通过预先创建实体的 show 属性切换，避免逐章重复建销',
      '自动播放由 ctx.onFrame 累加计时推进，不使用 setInterval'
    ]
  },
  defaults: {
    duration: 1.8,
    showLabels: true,
    autoPlay: false,
    interval: 3,
    easing: 'smooth'
  },
  camera: { lon: 104, lat: 34, height: 5400000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'duration', label: '切换时长(s)', min: 0.5, max: 4, step: 0.1 },
    { kind: 'range', key: 'interval', label: '自动播放间隔(s)', min: 1.5, max: 8, step: 0.5 },
    {
      kind: 'select',
      key: 'easing',
      label: '镜头缓动',
      options: [
        { value: 'smooth', label: '平滑' },
        { value: 'cubic', label: '三次缓动' },
        { value: 'linear', label: '匀速' }
      ]
    },
    { kind: 'checkbox', key: 'showLabels', label: '显示城市标签' },
    { kind: 'checkbox', key: 'autoPlay', label: '自动播放' }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const duration = Number(settings.duration)
    const showLabels = Boolean(settings.showLabels)
    const autoPlay = Boolean(settings.autoPlay)
    const interval = Number(settings.interval)
    const easing = String(settings.easing)

    const wrap = document.createElement('div')
    ctx.overlay(wrap)
    const nav = document.createElement('div')
    nav.style.cssText =
      'position:absolute;left:18px;top:18px;width:210px;pointer-events:auto;' +
      'display:flex;flex-direction:column;gap:8px;font-family:inherit;'
    wrap.appendChild(nav)

    const title = document.createElement('div')
    title.textContent = '数据章节'
    title.style.cssText = 'color:#e2e8f0;font-size:14px;font-weight:600;letter-spacing:0.06em;'
    nav.appendChild(title)

    const buttons: HTMLButtonElement[] = []
    const caption = document.createElement('div')
    caption.style.cssText =
      'margin-top:6px;padding:10px 12px;border-radius:10px;background:rgba(15,23,42,0.86);' +
      'border:1px solid rgba(148,163,184,0.3);color:#cbd5e1;font-size:12px;line-height:1.6;'

    const chapterIds = range(0, CHAPTERS.length)
    const groups: Array<import('cesium').Entity[]> = []

    chapterIds.forEach((index: number) => {
      const chapter = CHAPTERS[index]
      const list: import('cesium').Entity[] = []

      const filtered = CHINA_CITIES.filter(chapter.filter)
      const west = Math.min(...filtered.map((c) => c.lon)) - 2
      const east = Math.max(...filtered.map((c) => c.lon)) + 2
      const south = Math.min(...filtered.map((c) => c.lat)) - 2
      const north = Math.max(...filtered.map((c) => c.lat)) + 2
      const region = addPolygon(
        ctx.dataSource,
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north]
        ],
        { height: 40, color: chapter.accent, alpha: 0.12, outline: true, outlineColor: chapter.accent, outlineWidth: 2 }
      )
      list.push(region)

      filtered.forEach((city) => {
        const point = addPoint(ctx.dataSource, city.lon, city.lat, {
          pixelSize: 6 + city.value / 20,
          color: chapter.accent,
          disableDepthTest: true
        })
        list.push(point)
        if (showLabels) {
          const label = addLabel(ctx.dataSource, city.lon, city.lat, city.name, {
            font: '12px sans-serif',
            scaleByDistance: [1500000, 0.35, 9000000, 1.3],
            disableDepthTest: true
          })
          list.push(label)
        }
      })

      const pulse = addPulseRing(ctx.dataSource, chapter.camera.lon, chapter.camera.lat, {
        color: chapter.accent,
        maxRadius: 180000,
        period: 2600,
        width: 2
      })
      list.push(pulse)

      groups.push(list)

      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = `${index + 1}. ${chapter.title}`
      button.style.cssText =
        'text-align:left;padding:9px 12px;border-radius:9px;cursor:pointer;font-size:13px;' +
        'border:1px solid rgba(148,163,184,0.35);background:rgba(15,23,42,0.78);color:#cbd5e1;'
      const onClick = () => activate(index)
      button.addEventListener('click', onClick)
      ctx.onCleanup(() => button.removeEventListener('click', onClick))
      nav.appendChild(button)
      buttons.push(button)
    })
    nav.appendChild(caption)

    let active = -1
    const activate = (index: number) => {
      const chapter = CHAPTERS[index]
      groups.forEach((list, i) => list.forEach((entity) => (entity.show = i === index)))
      buttons.forEach((button, i) => {
        button.style.borderColor = i === index ? chapter.accent : 'rgba(148,163,184,0.35)'
        button.style.background = i === index ? 'rgba(56,189,248,0.2)' : 'rgba(15,23,42,0.78)'
        button.style.color = i === index ? '#f8fafc' : '#cbd5e1'
      })
      caption.textContent = chapter.text
      caption.style.borderColor = chapter.accent
      active = index
      ctx.viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(
          chapter.camera.lon,
          chapter.camera.lat,
          chapter.camera.height
        ),
        orientation: {
          heading: 0,
          pitch: CesiumMath.toRadians(chapter.camera.pitch),
          roll: 0
        },
        duration,
        easingFunction:
          easing === 'cubic'
            ? EasingFunction.CUBIC_IN_OUT
            : easing === 'linear'
              ? EasingFunction.LINEAR_NONE
              : EasingFunction.QUADRATIC_IN_OUT
      })
      ctx.status(`第 ${index + 1} 章 · ${chapter.title}：${chapter.text}`)
    }

    activate(0)

    if (autoPlay) {
      let acc = 0
      ctx.onFrame((_time, delta) => {
        acc += delta
        if (acc < interval * 1000) return
        acc = 0
        activate((active + 1) % CHAPTERS.length)
      })
    }

    ctx.legend(CHAPTERS.map((chapter) => ({ label: chapter.title, color: chapter.accent })))
  }
}

export default spec
