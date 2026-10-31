import { Cartesian3, Cartographic, Math as CesiumMath } from 'cesium'
import type { Viewer } from 'cesium'

// 地名标注：在画布上绘制轨迹名称、海拔/速度/距离读数，以及经过 swissNAMES3D 地名时
// 放大的地名卡片。名称来自 map.geo.admin.ch 的三维瓦片（glb 内嵌 EXT_structural_metadata）。
const BASE = 'https://3d.geo.admin.ch/ch.swisstopo.swissnames3d.3d/v2/'
const CAPTION_TIER = 6
const TILES_IN_FLIGHT = 16
const FADE_IN = 0.5
const HOLD = 3.5
const SHRINK = 0.7
const CROSSFADE = 0.3
const JUMP = 1
const MARKER_HEIGHT = 2
const STALE = 3000
const GONE = 3500
const SPEED_WINDOW = 100

const LAKE_COLOR = '#bfe0ff'
const READOUT_COLOR = '#ffd27a'
const TITLE_COLOR = 'rgba(255, 255, 255, 0.85)'
const FONT_STACK = '"Barlow Condensed", "PingFang SC", "Helvetica Neue", sans-serif'
const font = (weight: number, size: number) => `${weight} ${size}px ${FONT_STACK}`

// 上游的说明文字用 Barlow Condensed：字体到了再重绘，没到就用系统字体
function ensureFont(onReady: () => void): void {
  const existing = document.querySelector<HTMLLinkElement>('link[data-flyover-font]')
  if (existing) {
    void document.fonts.load(font(700, 64)).then(onReady)
    return
  }
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&display=swap'
  link.dataset.flyoverFont = 'true'
  link.addEventListener('load', () => {
    void document.fonts.load(font(700, 64)).then(onReady)
  })
  document.head.append(link)
}

const enterRadius = (place: Place) => (place.type === 'GIPFEL' ? 800 : place.tier <= 4 ? 2500 : 1200)
const MAX_ENTER_RADIUS = 2500
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

type Place = {
  text: string
  type: string
  tier: number
  position: Cartesian3
}

type FlyoverLike = {
  points: Cartesian3[]
  position: Cartesian3 | undefined
  progress: number
  duration: number
  distance: number
  name: string | undefined
  times: number[] | undefined
}

type NameRow = Record<string, string | number>

function drawFields(ctx: CanvasRenderingContext2D, fields: string[], x: number, baseline: number): void {
  const widest = [...'0123456789'].reduce((a, b) => (ctx.measureText(b).width > ctx.measureText(a).width ? b : a))
  const gap = ctx.measureText('  ').width
  fields.forEach((field, i) => {
    if (i > 0) {
      ctx.fillText('·', x, baseline)
      x += ctx.measureText('·').width + gap
    }
    ctx.fillText(field, x, baseline)
    x += ctx.measureText(field.replace(/\d/g, widest)).width + gap
  })
}

function readNames(buffer: ArrayBuffer): NameRow[] {
  const view = new DataView(buffer)
  const chunks: Uint8Array[] = []
  for (let offset = 12; offset < view.byteLength; ) {
    const length = view.getUint32(offset, true)
    chunks.push(new Uint8Array(buffer, offset + 8, length))
    offset += 8 + length
  }
  const json = JSON.parse(new TextDecoder().decode(chunks[0]))
  const bin = chunks[1]
  const bufferView = (i: number) => {
    const v = json.bufferViews[i]
    return new DataView(bin.buffer, bin.byteOffset + (v.byteOffset ?? 0), v.byteLength)
  }
  const table = json.extensions.EXT_structural_metadata.propertyTables[0]
  const decoder = new TextDecoder()
  const columns: Record<string, (string | number)[]> = {}
  for (const [name, property] of Object.entries<any>(table.properties)) {
    const values = bufferView(property.values)
    if (property.stringOffsets !== undefined) {
      const offsets = bufferView(property.stringOffsets)
      const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
      columns[name] = Array.from({ length: table.count }, (_, i) =>
        decoder.decode(bytes.subarray(offsets.getUint32(4 * i, true), offsets.getUint32(4 * i + 4, true)))
      )
    } else {
      columns[name] = Array.from({ length: table.count }, (_, i) => values.getFloat64(8 * i, true))
    }
  }
  return Array.from({ length: table.count }, (_, i) => Object.fromEntries(Object.keys(columns).map((k) => [k, columns[k][i]])))
}

export default class FlyoverCaptions {
  viewer: Viewer
  flyover: FlyoverLike
  active = true
  places: Place[] = []
  destroyed = false
  shown: { place: Place; since: number; card: boolean } | undefined
  replaced: { place: Place; until: number } | undefined
  lastTime: number | undefined
  distances: number[] = []
  canvas: HTMLCanvasElement
  removeListener: () => void
  units: {
    elevation: (value: number) => string
    speed: (value: number) => string
    distance: (value: number) => string
  }

  constructor(viewer: Viewer, flyover: FlyoverLike) {
    this.viewer = viewer
    this.flyover = flyover
    this.canvas = document.createElement('canvas')
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none'
    })
    viewer.container.append(this.canvas)
    this.removeListener = viewer.scene.postRender.addEventListener(() => this.draw()) as unknown as () => void

    const locale = navigator.language
    const region = new Intl.Locale(locale).region
    const format = (unit: string, digits: number, factor: number) => {
      const f = new Intl.NumberFormat(locale, { style: 'unit', unit, maximumFractionDigits: digits })
      return (value: number) => f.format(value * factor)
    }
    const miles = ['US', 'LR', 'GB', 'MM'].includes(region ?? '')
    this.units = {
      elevation: ['US', 'LR'].includes(region ?? '') ? format('foot', 0, 1 / 0.3048) : format('meter', 0, 1),
      speed: miles ? format('mile-per-hour', 1, 3600 / 1609.344) : format('kilometer-per-hour', 1, 3.6),
      distance: miles ? format('mile', 1, 1 / 1609.344) : format('kilometer', 1, 1 / 1000)
    }
    ensureFont(() => viewer.scene.requestRender())
  }

  async load(): Promise<void> {
    const points = this.flyover.points
    this.distances = [0]
    for (let i = 1; i < points.length; i++) {
      this.distances.push(this.distances[i - 1] + Cartesian3.distance(points[i - 1], points[i]))
    }
    const samples: Cartesian3[] = []
    for (const point of points) {
      if (!samples.length || Cartesian3.distance(samples.at(-1) as Cartesian3, point) > 500) samples.push(point)
    }
    const cartographics = samples.map((p) => Cartographic.fromCartesian(p))
    const radius = this.viewer.scene.ellipsoid.maximumRadius
    const near = (region: number[], meters: number) => {
      const [west, south, east, north] = region
      return cartographics.some((c) => {
        const dLat = meters / radius
        const dLon = dLat / Math.cos(c.latitude)
        return (
          c.longitude > west - dLon && c.longitude < east + dLon && c.latitude > south - dLat && c.latitude < north + dLat
        )
      })
    }
    const tileset = await (await fetch(BASE + 'tileset.json')).json()
    const uris: string[] = []
    const walk = (node: any) => {
      const uri = node.content?.uri
      const tier = uri ? +uri.match(/zoomlevel(\d)/)[1] : 0
      if (tier > CAPTION_TIER || !near(node.boundingVolume.region, MAX_ENTER_RADIUS)) return
      if (uri) uris.push(uri)
      node.children?.forEach(walk)
    }
    walk(tileset.root)
    const rows: NameRow[] = []
    const queue = [...uris]
    await Promise.all(
      Array.from({ length: TILES_IN_FLIGHT }, async () => {
        while (queue.length && !this.destroyed) {
          const uri = queue.shift() as string
          try {
            rows.push(...readNames(await (await fetch(BASE + uri)).arrayBuffer()))
          } catch {
            // 单个瓦片失败只丢该瓦片的地名
          }
        }
      })
    )
    if (this.destroyed) return
    const seen = new Set<string>()
    this.places = rows
      .filter((row) => !seen.has(String(row.sourceId)) && seen.add(String(row.sourceId)))
      .map((row) => ({
        text: String(row.text),
        type: String(row.type),
        tier: +String(row.tier).replace('zoomlevel', ''),
        position: Cartesian3.fromDegrees(Number(row.longitude), Number(row.latitude), Number(row.groundHeight))
      }))
    this.viewer.scene.requestRender()
  }

  update(marker: Cartesian3, time: number): void {
    const jump = this.lastTime === undefined || Math.abs(time - this.lastTime) > JUMP
    this.lastTime = time
    if (jump) {
      this.shown = undefined
      this.replaced = undefined
    }
    const inside = (place: Place) => Cartesian3.distance(marker, place.position) < enterRadius(place)
    if (!this.shown || !inside(this.shown.place)) {
      let entered: Place | undefined
      let nearest = 1
      for (const place of this.places) {
        const ratio = Cartesian3.distance(marker, place.position) / enterRadius(place)
        if (ratio < nearest) {
          entered = place
          nearest = ratio
        }
      }
      if (entered) {
        const animated = !jump || time === 0
        if (this.shown) this.replaced = { place: this.shown.place, until: time }
        this.shown = { place: entered, since: animated ? time : -Infinity, card: animated }
      }
    }
  }

  label(place: Place): { text: string; color: string } {
    const text = place.text.toUpperCase()
    return { text: place.type === 'GIPFEL' ? `▲ ${text}` : text, color: place.type === 'SEE' ? LAKE_COLOR : 'white' }
  }

  speed(): number | undefined {
    const { times, distance } = this.flyover
    if (!times) return undefined
    const d = this.distances
    let i = 0
    while (i < d.length - 1 && d[i + 1] <= distance - SPEED_WINDOW) i++
    let j = d.length - 1
    while (j > 0 && d[j - 1] >= distance + SPEED_WINDOW) j--
    const seconds = times[j] - times[i]
    return seconds > 0 ? (d[j] - d[i]) / seconds : 0
  }

  layout(width: number, height: number) {
    const short = Math.min(width, height)
    const portrait = height > width
    const nameSize = Math.max(0.05 * short, 18)
    const readoutSize = Math.max(0.032 * short, 14)
    const spacing = 0.35 * readoutSize
    const nameBaseline = portrait ? 0.08 * height + nameSize : height - Math.max(0.06 * short, 40) - readoutSize - spacing
    return {
      short,
      portrait,
      left: Math.max(0.05 * short, 24),
      nameSize,
      readoutSize,
      titleBaseline: nameBaseline - 0.85 * nameSize,
      nameBaseline,
      readoutBaseline: nameBaseline + spacing + readoutSize,
      cardBaseline: portrait ? 0.28 * height : 0.8 * height
    }
  }

  draw(): void {
    const dpr = window.devicePixelRatio
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr)
      this.canvas.height = Math.round(height * dpr)
    }
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const marker = this.flyover.position
    if (!this.active || !marker) return
    const time = this.flyover.progress * this.flyover.duration
    this.update(marker, time)
    const layout = this.layout(width, height)
    const { portrait, left, readoutSize, titleBaseline, readoutBaseline } = layout

    const shade = ctx.createLinearGradient(0, portrait ? 0 : height, 0, portrait ? 0.4 * height : 0.6 * height)
    shade.addColorStop(0, 'rgba(0, 0, 0, 0.4)')
    shade.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = shade
    ctx.fillRect(0, portrait ? 0 : 0.6 * height, width, 0.4 * height)

    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)'
    ctx.shadowOffsetY = 1
    ctx.shadowBlur = 3
    ctx.letterSpacing = '0.12em'

    const elevation = (Cartographic.fromCartesian(marker).height ?? 0) - MARKER_HEIGHT
    const speed = this.speed()
    const readout = [`ALT ${this.units.elevation(elevation)}`]
    if (speed !== undefined) readout.push(this.units.speed(speed))
    readout.push(this.units.distance(this.flyover.distance))
    ctx.font = font(600, readoutSize)
    ctx.fillStyle = READOUT_COLOR
    drawFields(
      ctx,
      readout.map((field) => field.toUpperCase()),
      left,
      readoutBaseline
    )

    if (this.flyover.name) {
      ctx.font = font(500, readoutSize)
      ctx.fillStyle = TITLE_COLOR
      ctx.fillText(this.flyover.name.toUpperCase(), left, titleBaseline)
    }

    ctx.letterSpacing = '0.06em'
    this.drawPlaces(ctx, marker, time, layout, width)
    ctx.restore()
  }

  drawPlaces(
    ctx: CanvasRenderingContext2D,
    marker: Cartesian3,
    time: number,
    layout: ReturnType<FlyoverCaptions['layout']>,
    width: number
  ): void {
    const { short, left, nameSize, nameBaseline, cardBaseline } = layout
    const name = (place: Place, size: number, baseline: number, alpha: number) => {
      if (alpha <= 0) return
      const { text, color } = this.label(place)
      ctx.globalAlpha = alpha
      ctx.font = font(700, size)
      ctx.shadowBlur = 0.16 * size
      ctx.fillStyle = color
      ctx.fillText(text, left, baseline)
    }
    const fresh = (place: Place) =>
      1 - CesiumMath.clamp((Cartesian3.distance(marker, place.position) - STALE) / (GONE - STALE), 0, 1)
    if (this.replaced) {
      name(
        this.replaced.place,
        nameSize,
        nameBaseline,
        fresh(this.replaced.place) * (1 - ease((time - this.replaced.until) / CROSSFADE))
      )
    }
    if (this.shown) {
      const { place, since, card } = this.shown
      const t = time - since
      if (card) {
        ctx.font = font(700, 100)
        const big = Math.min(0.1 * short, (100 * (width - 2 * left)) / ctx.measureText(this.label(place).text).width)
        const appear = ease(t / FADE_IN)
        const shrink = ease((t - FADE_IN - HOLD) / SHRINK)
        const baseline = CesiumMath.lerp(cardBaseline, nameBaseline, shrink) + 0.02 * short * (1 - appear)
        name(place, CesiumMath.lerp(big, nameSize, shrink), baseline, appear * fresh(place))
      } else {
        name(place, nameSize, nameBaseline, ease(t / CROSSFADE) * fresh(place))
      }
    }
  }

  destroy(): void {
    this.destroyed = true
    this.removeListener()
    this.canvas.remove()
  }
}
