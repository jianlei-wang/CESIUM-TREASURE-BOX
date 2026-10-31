import { Rectangle } from 'cesium'
import { File as H5File } from 'jsfive'

// MeteoSwiss 雷达看到的雨，供降水特效做地图：开放数据里的 CombiPrecip 合成
// （data.geo.admin.ch，STAC，每天一个 item，保留 14 天），最近一小时的雨量以毫米计，
// 已经按雨量站校准，因此是个平均 mm/h，在浏览器里解码后按经纬度绘制。
const COLLECTION = 'https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-radar-precip'
// 合成产品的网格：LV95 下 1 km 一格，左上角格子的左上角坐标
const CELL = 1000
const EAST0 = 2255000
const NORTH0 = 1480000
const COLUMNS = 710
const ROWS = 640
// 地图：网格四角换成经纬度，一个像素大约一格宽
const WEST = 2.68
const SOUTH = 43.61
const EAST = 12.47
const NORTH = 49.38
const WIDTH = 1024
const HEIGHT = 768
// 雨强 mm/h：满强度时的色阶，毛毛雨也要看得见，所以开方
const HEAVY = 10
const HOUR = 3600 * 1000
// 缓存的图张数，最近请求的排最后；每张约 3 MB
const MAX_MAPS = 12

export type RadarMap = { image: HTMLCanvasElement; rectangle: Rectangle }
type DayAssets = Record<string, { href: string }>

const days = new Map<string, Promise<DayAssets>>()

/** 某个 UTC 日期的全部文件，只取一次 */
function dayAssets(date: Date): Promise<DayAssets> {
  const id = `${date.toISOString().slice(0, 10).replaceAll('-', '')}-ch`
  let entry = days.get(id)
  if (!entry) {
    entry = fetch(`${COLLECTION}/items/${id}`).then(async (response) => {
      if (!response.ok) throw new Error(`${response.status} for ${response.url}`)
      const data = await response.json()
      return (data.assets ?? {}) as DayAssets
    })
    // 失败的不留着，下次重试
    entry = entry.catch((error) => {
      days.delete(id)
      throw error
    })
    days.set(id, entry)
  }
  return entry
}

/**
 * 整点结束的那一小时的 CombiPrecip 文件名，去掉末尾几位：
 * cpc、两位年份、三位年内天数、小时与分钟。
 */
function hourlyPrefix(date: Date): string {
  const day = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / (24 * HOUR))
  const pad = (n: number, length: number) => String(n).padStart(length, '0')
  return `cpc${pad(date.getUTCFullYear() % 100, 2)}${pad(day, 3)}${pad(date.getUTCHours(), 2)}00`
}

/** 最近一个有文件的整点，刚过零点时是今天的，也可能是昨天的（UTC） */
export async function latestHour(): Promise<Date> {
  const hour = new Date(Math.floor(Date.now() / HOUR) * HOUR)
  const today = hour.getUTCDate()
  for (let tries = 0; tries < 26; tries++) {
    let assets: DayAssets
    try {
      assets = await dayAssets(hour)
    } catch (error) {
      // 今天这个 item 可能还没发布，退到昨天的最后一个小时
      if (hour.getUTCDate() !== today) throw error
      hour.setUTCHours(-1, 0, 0, 0)
      continue
    }
    const prefix = hourlyPrefix(hour)
    if (Object.keys(assets).some((name) => name.startsWith(prefix))) return hour
    hour.setTime(hour.getTime() - HOUR)
  }
  throw new Error('最近一天内没有 CombiPrecip 文件')
}

/** 经纬度转 LV95，swisstopo 的近似公式：误差约一米，远小于一格 */
function toLV95(longitude: number, latitude: number): { east: number; north: number } {
  const lambda = (longitude * 3600 - 26782.5) / 10000
  const phi = (latitude * 3600 - 169028.66) / 10000
  return {
    east:
      2600072.37 +
      211455.93 * lambda -
      10938.51 * lambda * phi -
      0.36 * lambda * phi * phi -
      44.54 * lambda ** 3,
    north:
      1200147.07 +
      308807.95 * phi +
      3745.25 * lambda * lambda +
      76.63 * phi * phi -
      194.56 * lambda * lambda * phi +
      119.79 * phi ** 3
  }
}

/** 把一份雷达文件画成经纬度上的地图：雨强进红色通道，雷达覆盖外与边缘一律为 0 */
function radarMap(buffer: ArrayBuffer): RadarMap {
  const file = new H5File(buffer, 'radar.h5')
  const what = file.get('dataset1/data1/what') as unknown as { attrs: { gain: number; offset: number } }
  const { gain, offset } = what.attrs
  const rates = (file.get('dataset1/data1/data') as { value: ArrayLike<number> }).value
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  const image = context.createImageData(WIDTH, HEIGHT)
  for (let y = 0; y < HEIGHT; y++) {
    const latitude = NORTH - ((y + 0.5) / HEIGHT) * (NORTH - SOUTH)
    for (let x = 0; x < WIDTH; x++) {
      const longitude = WEST + ((x + 0.5) / WIDTH) * (EAST - WEST)
      const { east, north } = toLV95(longitude, latitude)
      const column = Math.floor((east - EAST0) / CELL)
      const row = Math.floor((NORTH0 - north) / CELL)
      if (column < 0 || column >= COLUMNS || row < 0 || row >= ROWS) continue
      // 雷达覆盖外是 NaN
      const rate = rates[row * COLUMNS + column] * gain + offset
      if (rate > 0) {
        image.data[4 * (y * WIDTH + x)] = 255 * Math.sqrt(Math.min(rate / HEAVY, 1))
      }
    }
  }
  // 不透明，画布才会原样保留颜色
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255
  context.putImageData(image, 0, 0)
  return { image: canvas, rectangle: Rectangle.fromDegrees(WEST, SOUTH, EAST, NORTH) }
}

const maps = new Map<number, Promise<RadarMap>>()

/** 整点结束那一小时的雨图，只在最近请求的几张里缓存 */
export function hourlyRadarMap(hour: Date): Promise<RadarMap> {
  const time = hour.getTime()
  const kept = maps.get(time)
  if (kept) {
    maps.delete(time)
    maps.set(time, kept)
    return kept
  }
  const load = async (): Promise<RadarMap> => {
    const prefix = hourlyPrefix(hour)
    const assets = await dayAssets(hour)
    const name = Object.keys(assets).find((item) => item.startsWith(prefix))
    if (!name) throw new Error(`${hour.toISOString()} 没有 CombiPrecip 文件`)
    const response = await fetch(assets[name].href)
    if (!response.ok) throw new Error(`${response.status} for ${response.url}`)
    return radarMap(await response.arrayBuffer())
  }
  const promise = load().catch((error) => {
    maps.delete(time)
    throw error
  })
  maps.set(time, promise)
  if (maps.size > MAX_MAPS) {
    const oldest = maps.keys().next().value as number
    maps.delete(oldest)
  }
  return promise
}
