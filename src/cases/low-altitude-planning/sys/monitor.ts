import type { AirspaceZone, Alarm, AlarmLevel, AlarmType, Device, LonLat, Track } from './types'
import { circleRing, formatDateTime, haversine, pointInRing } from './util'

type Loop = LonLat[]

function loopFor(device: Device, index: number): Loop {
  const radius = 260 + (index % 5) * 90
  const squash = 0.62 + (index % 3) * 0.12
  const ring = circleRing({ lon: device.lon, lat: device.lat }, radius, 72)
  return ring.map((p) => ({ lon: p.lon, lat: device.lat + (p.lat - device.lat) * squash }))
}

export type MonitorListener = (payload: {
  devices: Device[]
  tracks: Track[]
  alarms: Alarm[]
  progress: Map<string, number>
}) => void

let alarmSeq = 0

/** 实时监控仿真：无人机沿闭合航线巡飞，按规则产生越界/冲突/偏航等告警。 */
export class MonitorSimulation {
  private readonly devices: Device[]
  private readonly loops = new Map<string, Loop>()
  private readonly progress = new Map<string, number>()
  private readonly tracks = new Map<string, Track>()
  private alarms: Alarm[]
  private readonly zones: AirspaceZone[]
  private timer: number | undefined
  private readonly cooldown = new Map<string, number>()
  private seedAlarms: Alarm[]
  private listener: MonitorListener | null = null
  private speed = 1

  constructor(devices: Device[], zones: AirspaceZone[], seedAlarms: Alarm[]) {
    this.devices = devices
    this.zones = zones
    this.seedAlarms = seedAlarms.map((a) => ({ ...a }))
    this.alarms = [...this.seedAlarms]
    this.devices.forEach((device, index) => {
      const loop = loopFor(device, index)
      this.loops.set(device.no, loop)
      this.progress.set(device.no, (index * 0.13) % 1)
      const first = loop[0]
      this.tracks.set(device.no, {
        deviceNo: device.no,
        color: `hsl(${(index * 47) % 360}, 78%, 62%)`,
        points: [
          { ...first, alt: device.alt, t: Date.now(), speed: device.speed, heading: device.heading }
        ]
      })
    })
  }

  onUpdate(listener: MonitorListener): void {
    this.listener = listener
  }

  setSpeed(multiplier: number): void {
    this.speed = multiplier
  }

  getAlarms(): Alarm[] {
    return this.alarms
  }

  start(): void {
    if (this.timer !== undefined) return
    this.timer = window.setInterval(() => this.tick(), 600)
  }

  stop(): void {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer)
      this.timer = undefined
    }
  }

  private raise(
    type: AlarmType,
    level: AlarmLevel,
    content: string,
    device: Device,
    cooldownMs = 45000
  ): void {
    const key = `${device.no}:${type}`
    const now = Date.now()
    if ((this.cooldown.get(key) ?? 0) > now) return
    this.cooldown.set(key, now + cooldownMs)
    alarmSeq += 1
    const alarm: Alarm = {
      id: `alarm-live-${alarmSeq}`,
      type,
      level,
      content,
      deviceNo: device.no,
      lon: device.lon,
      lat: device.lat,
      alt: device.alt,
      time: formatDateTime(new Date()),
      status: 'pending'
    }
    this.alarms = [alarm, ...this.alarms].slice(0, 60)
  }

  private tick(): void {
    const online = this.devices.filter((d) => d.status === 'online')
    const step = 0.0032 * this.speed
    for (const device of online) {
      const loop = this.loops.get(device.no)
      if (!loop) continue
      const next = ((this.progress.get(device.no) ?? 0) + step) % 1
      this.progress.set(device.no, next)
      const idx = Math.floor(next * loop.length) % loop.length
      const current = loop[idx]
      const prev = loop[(idx - 1 + loop.length) % loop.length]
      device.lon = current.lon
      device.lat = current.lat
      device.heading = Math.round((Math.atan2(current.lon - prev.lon, current.lat - prev.lat) * 180) / Math.PI + 360) % 360
      device.speed = Math.max(28, Math.round(52 + Math.sin(next * Math.PI * 4) * 14))
      device.battery = Math.max(8, device.battery - 0.015 * this.speed)
      device.signal = Math.round(70 + Math.sin(next * Math.PI * 6) * 26)
      device.temperature = Math.round(32 + Math.sin(next * Math.PI * 2) * 8)
      device.updatedAt = formatDateTime(new Date())
      const track = this.tracks.get(device.no)
      if (track) {
        track.points.push({
          lon: device.lon,
          lat: device.lat,
          alt: device.alt,
          t: Date.now(),
          speed: device.speed,
          heading: device.heading
        })
        if (track.points.length > 220) track.points.splice(0, track.points.length - 220)
      }
      // 越界 / 禁飞判定
      for (const zone of this.zones) {
        if (!zone.active) continue
        const inside =
          zone.shape === 'polygon'
            ? zone.ring.length >= 3 && pointInRing({ lon: device.lon, lat: device.lat }, zone.ring)
            : haversine({ lon: device.lon, lat: device.lat }, zone.center) <= zone.radius
        if (!inside) continue
        if (zone.type === 'forbid') {
          this.raise('禁飞', 'urgent', `无人机进入${zone.name}，立即处置`, device)
        } else if (zone.type === 'restrict' && device.alt > zone.altMax) {
          this.raise('越界', 'urgent', `在${zone.name}内超出限高 ${zone.altMax} m`, device)
        }
      }
      if (device.battery < 25) {
        this.raise('低电量', 'info', `剩余电量 ${device.battery.toFixed(0)}%，请安排返航`, device, 90000)
      }
    }
    // 冲突检测
    for (let i = 0; i < online.length; i += 1) {
      for (let j = i + 1; j < online.length; j += 1) {
        const a = online[i]
        const b = online[j]
        const horizontal = haversine(a, b)
        const vertical = Math.abs(a.alt - b.alt)
        if (horizontal < 55 && vertical < 30) {
          this.raise('冲突', 'urgent', `与 ${b.no} 水平间距 ${horizontal.toFixed(0)} m，存在冲突风险`, a)
        }
      }
    }
    // 偶发偏航（基于航向波动判定）
    for (const device of online) {
      const drift = Math.abs(Math.sin(this.progress.get(device.no)! * Math.PI * 3))
      if (drift > 0.985 && device.speed > 60) {
        this.raise('偏离', 'warn', '实际航迹偏离规划航线超过阈值', device, 120000)
      }
    }
    this.listener?.({
      devices: this.devices,
      tracks: Array.from(this.tracks.values()),
      alarms: this.alarms,
      progress: this.progress
    })
  }

  handleAlarm(id: string): void {
    this.alarms = this.alarms.map((a) => (a.id === id ? { ...a, status: 'handled' } : a))
  }

  reset(): void {
    this.alarms = [...this.seedAlarms]
  }
}
