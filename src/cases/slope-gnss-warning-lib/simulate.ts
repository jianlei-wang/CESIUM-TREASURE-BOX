/**
 * GNSS 监测网时序仿真 + 指标计算 + 预警状态机。
 * 纯 TS 实现，不依赖 Cesium / DOM，可独立单测。
 *
 * 变形曲线采用斋藤（Saito）三阶段 + Fukuzono 反速率加速模型：
 *   初始衰减蠕变 → 等速蠕变 → 加速变形（1/v = a - b·t，t_f = a/b 为构造破坏时刻）。
 * 观测值在真实累计位移上叠加白噪声、随机游走多路径、粗差跳变与质量退化。
 */

import {
  WarningLevel,
  type FixType,
  type GnssObservation,
  type RainObservation,
  type StationDef,
  type ThresholdConfig,
  type WarningLevelValue
} from './types'
import { clamp, gaussian, mulberry32, olsSlope, type Rng } from './rng'

export interface SimPlan {
  start: number
  end: number
  intervalH: number
  /** 等速起点（小时） */
  t1: number
  /** 加速起点（小时） */
  t2: number
  /** 构造破坏时刻（小时） */
  tf: number
  vSteadyMmd: number
  seed: number
}

export interface SimulationResult {
  times: number[]
  stations: StationDef[]
  observations: Record<string, GnssObservation[]>
  rain: RainObservation[]
  /** 变形场骨架，供界面提示 */
  timeline: { t1: number; t2: number; tf: number; totalHours: number }
}

export interface Scenario {
  boundary: [number, number][]
  stations: StationDef[]
  /** 监测网标称主滑方向（°） */
  nominalAzimuth: number
}

const TWO_PI = Math.PI * 2
const DEG = 180 / Math.PI

export function buildScenario(centerLon: number, centerLat: number, seed = 20260916): Scenario {
  const rng = mulberry32(seed)
  const mPerDegLon = 111320 * Math.cos((centerLat * Math.PI) / 180)
  const mPerDegLat = 110540
  const toLng = (x: number, y: number): [number, number] => [
    centerLon + x / mPerDegLon,
    centerLat + y / mPerDegLat
  ]

  const rx = 520
  const ry = 760
  const boundary: [number, number][] = []
  const vertices = 20
  for (let i = 0; i < vertices; i += 1) {
    const angle = (i / vertices) * TWO_PI
    const jitter = 0.86 + rng() * 0.28
    const x = Math.cos(angle) * rx * jitter
    const y = Math.sin(angle) * ry * jitter
    boundary.push(toLng(x, y))
  }
  boundary.push([...boundary[0]] as [number, number])

  const nominalAzimuth = 195
  const stations: StationDef[] = []
  const cols = [-250, 0, 250]
  const rows = [-430, -170, 90, 340]
  const sourceX = 20
  const sourceY = 150
  let index = 1
  for (const row of rows) {
    for (const col of cols) {
      const x = col + (rng() - 0.5) * 60
      const y = row + (rng() - 0.5) * 60
      if ((x / rx) ** 2 + (y / ry) ** 2 > 0.82) continue
      const distToSource = Math.hypot(x - sourceX, y - sourceY)
      const gain = clamp(1.8 - distToSource / 520, 0.62, 1.85)
      const [lon, lat] = toLng(x, y)
      stations.push({
        id: `GN${String(index).padStart(2, '0')}`,
        name: `GN${String(index).padStart(2, '0')}`,
        lon,
        lat,
        gain,
        lagH: Math.round(distToSource / 55),
        azimuth: nominalAzimuth + (rng() - 0.5) * 26,
        core: gain > 1.42
      })
      index += 1
    }
  }
  // 补充基准站
  const [blon, blat] = toLng(-430, 520)
  stations.push({ id: 'BASE', name: '基准站', lon: blon, lat: blat, gain: 0, lagH: 0, azimuth: 0 })
  return { boundary, stations, nominalAzimuth }
}

interface RainEvent {
  hour: number
  amount: number
}

function buildRainEvents(totalHours: number, rng: Rng): RainEvent[] {
  const events: RainEvent[] = []
  const count = 5
  for (let i = 0; i < count; i += 1) {
    const hour = Math.round((0.12 + rng() * 0.78) * totalHours)
    const amount = 15 + rng() * 55
    events.push({ hour, amount })
  }
  events.sort((a, b) => a.hour - b.hour)
  return events
}

function fukuzonoVelocity(hours: number, plan: SimPlan): number {
  const vSteadyMph = plan.vSteadyMmd / 24
  if (hours < plan.t1) {
    const decay = Math.max(1, plan.t1 / 3)
    return vSteadyMph * (1 + 0.7 * Math.exp(-hours / decay))
  }
  if (hours < plan.t2) {
    return vSteadyMph * (1 + 0.05 * Math.sin((hours / 24) * 0.9))
  }
  const a = 1 / vSteadyMph
  const b = a / Math.max(1, plan.tf - plan.t2)
  const dt = hours - plan.t2
  const inv = a - b * dt
  const maxV = vSteadyMph * 90
  if (inv <= 0) return maxV
  return Math.min(1 / inv, maxV)
}

function rainFactor(hours: number, events: RainEvent[]): number {
  let factor = 0
  for (const event of events) {
    if (hours < event.hour) continue
    const dt = hours - event.hour
    if (dt > 240) continue
    factor += event.amount * 0.0038 * Math.exp(-dt / 20)
  }
  return factor
}

function rainAt(hours: number, events: RainEvent[]): { rain1h: number; rain24h: number } {
  let rain1h = 0
  let rain24h = 0
  for (const event of events) {
    const dt = hours - event.hour
    if (dt >= -0.5 && dt < 1) rain1h += event.amount
    if (dt >= -0.5 && dt < 24) rain24h += event.amount * Math.exp(-dt / 10)
  }
  return { rain1h, rain24h }
}

function qualityAt(hours: number, rng: Rng, badWindows: { start: number; end: number }[]): {
  fixType: FixType
  sats: number
  pdop: number
  rmsH: number
  rmsV: number
} {
  const bad = badWindows.some((w) => hours >= w.start && hours < w.end)
  if (bad) {
    return {
      fixType: 'float',
      sats: 4 + Math.floor(rng() * 3),
      pdop: 6 + rng() * 3.5,
      rmsH: 6 + rng() * 6,
      rmsV: 10 + rng() * 10
    }
  }
  const degrade = rng() < 0.02
  if (degrade) {
    return {
      fixType: 'float',
      sats: 5 + Math.floor(rng() * 3),
      pdop: 4 + rng() * 2,
      rmsH: 3.2 + rng() * 2,
      rmsV: 5.5 + rng() * 3
    }
  }
  return {
    fixType: 'fixed',
    sats: 9 + Math.floor(rng() * 5),
    pdop: 1.1 + rng() * 1.5,
    rmsH: 1.1 + rng() * 1.7,
    rmsV: 2.0 + rng() * 2.4
  }
}

function qualityPass(
  q: { fixType: FixType; sats: number; pdop: number; rmsH: number; rmsV: number },
  cfg: ThresholdConfig
): boolean {
  const gate = cfg.qualityGate
  return (
    q.fixType === 'fixed' &&
    q.sats >= gate.minSats &&
    q.pdop <= gate.maxPdop &&
    q.rmsH <= gate.maxRmsH &&
    q.rmsV <= gate.maxRmsV
  )
}

interface RawSample {
  time: number
  dE: number
  dN: number
  dU: number
  fixType: FixType
  sats: number
  pdop: number
  rmsH: number
  rmsV: number
  qualityOk: boolean
}

function computeSeries(samples: RawSample[], intervalH: number, station: StationDef): GnssObservation[] {
  const n = samples.length
  const dH = samples.map((s) => Math.hypot(s.dE, s.dN))
  const velocity: number[] = new Array(n).fill(0)
  const Wv = 16
  for (let i = 0; i < n; i += 1) {
    const start = Math.max(0, i - Wv + 1)
    const xs: number[] = []
    const ys: number[] = []
    for (let k = start; k <= i; k += 1) {
      xs.push((k - start) * intervalH)
      ys.push(dH[k])
    }
    velocity[i] = xs.length >= 3 ? Math.max(0, olsSlope(xs, ys)) : 0
  }

  const accel: number[] = new Array(n).fill(0)
  const Wa = 16
  for (let i = 0; i < n; i += 1) {
    const start = Math.max(0, i - Wa + 1)
    const xs: number[] = []
    const ys: number[] = []
    for (let k = start; k <= i; k += 1) {
      xs.push((k - start) * intervalH)
      ys.push(velocity[k])
    }
    accel[i] = xs.length >= 3 ? olsSlope(xs, ys) * 24 : 0
  }

  const out: GnssObservation[] = []
  for (let i = 0; i < n; i += 1) {
    const s = samples[i]
    const start = Math.max(0, i - Wv + 1)
    const dEs = s.dE - samples[start].dE
    const dNs = s.dN - samples[start].dN
    const mag = Math.hypot(dEs, dNs)
    const azimuth = mag > 0.4 ? (Math.atan2(dEs, dNs) * DEG + 360) % 360 : station.azimuth

    // 改进切线角：最近窗口内坐标归一化后的斜率角
    const taStart = Math.max(0, i - 96 + 1)
    let tangentAngle: number | null = null
    const span = dH[i] - dH[taStart]
    if (i - taStart >= 8 && span > 3) {
      const xs: number[] = []
      const ys: number[] = []
      for (let k = taStart; k <= i; k += 1) {
        xs.push((k - taStart) / (i - taStart))
        ys.push((dH[k] - dH[taStart]) / span)
      }
      const slope = olsSlope(xs, ys)
      if (slope > 0) tangentAngle = clamp(Math.atan(slope) * DEG, 0, 89.9)
    }

    const v = velocity[i]
    const invVelocity = v > 0.02 ? 1 / v : null

    // Fukuzono 反速率预测：v 递增且已进入加速段时拟合 1/v = a + b·h
    let tfPredicted: number | null = null
    if (invVelocity !== null && (tangentAngle ?? 0) > 68 && accel[i] > 0) {
      const fitStart = Math.max(0, i - 24 + 1)
      const xs: number[] = []
      const ys: number[] = []
      for (let k = fitStart; k <= i; k += 1) {
        if (velocity[k] > 0.02) {
          xs.push(k * intervalH)
          ys.push(1 / velocity[k])
        }
      }
      if (xs.length >= 8) {
        const b = olsSlope(xs, ys)
        const mx = xs.reduce((a, c) => a + c, 0) / xs.length
        const my = ys.reduce((a, c) => a + c, 0) / ys.length
        const a = my - b * mx
        if (b < -1e-6) {
          const tf = -a / b
          const now = i * intervalH
          if (tf > now && tf - now < 24 * 90) tfPredicted = samples[i].time + (tf - now) * 3600000
        }
      }
    }

    out.push({
      time: s.time,
      dE: s.dE,
      dN: s.dN,
      dU: s.dU,
      dH: dH[i],
      v,
      accel: accel[i],
      azimuth,
      tangentAngle,
      invVelocity,
      tfPredicted,
      fixType: s.fixType,
      sats: s.sats,
      pdop: s.pdop,
      rmsH: s.rmsH,
      rmsV: s.rmsV,
      qualityOk: s.qualityOk,
      rawLevel: WarningLevel.Normal,
      level: WarningLevel.Normal
    })
  }
  return out
}

/** 依据速率 / 切线角 / 累计位移 / 降雨耦合求单时次原始等级。 */
export function evaluateRawLevel(
  dH: number,
  v: number,
  tangentAngle: number | null,
  rain1h: number,
  cfg: ThresholdConfig
): WarningLevelValue {
  const rate = cfg.rateMmd
  let level: WarningLevelValue = WarningLevel.Normal
  if (v >= rate.red / 24) level = WarningLevel.Red
  else if (v >= rate.orange / 24) level = WarningLevel.Orange
  else if (v >= rate.yellow / 24) level = WarningLevel.Yellow
  else if (v >= rate.blue / 24) level = WarningLevel.Blue

  const ta = cfg.tangentAngle
  if (tangentAngle !== null) {
    if (tangentAngle >= ta.red) level = Math.max(level, WarningLevel.Red) as WarningLevelValue
    else if (tangentAngle >= ta.orange) level = Math.max(level, WarningLevel.Orange) as WarningLevelValue
    else if (tangentAngle >= ta.yellow) level = Math.max(level, WarningLevel.Yellow) as WarningLevelValue
  }

  const cum = cfg.cumulativeMm
  if (dH >= cum.red) level = Math.max(level, WarningLevel.Red) as WarningLevelValue
  else if (dH >= cum.orange) level = Math.max(level, WarningLevel.Orange) as WarningLevelValue
  else if (dH >= cum.yellow) level = Math.max(level, WarningLevel.Yellow) as WarningLevelValue

  if (cfg.rainCoupling.enabled && rain1h >= cfg.rainCoupling.rain1hTrigger && v >= (rate.yellow / 24) * cfg.rainCoupling.rateFactor) {
    level = Math.max(level, WarningLevel.Yellow, 1) as WarningLevelValue
  }
  return level
}

/** 升级确认 + 降级滞回 + 质量门控。 */
export function applyFsm(observations: GnssObservation[], cfg: ThresholdConfig): void {
  let level: WarningLevelValue = WarningLevel.Normal
  let pendingLevel: WarningLevelValue = WarningLevel.Normal
  let pendingCount = 0
  let downCount = 0
  for (const obs of observations) {
    if (!obs.qualityOk) {
      obs.level = level
      continue
    }
    const raw = obs.rawLevel
    if (raw > level) {
      if (raw === pendingLevel) pendingCount += 1
      else {
        pendingLevel = raw
        pendingCount = 1
      }
      const required = raw >= WarningLevel.Red ? cfg.confirm.redUpgradeEpochs : cfg.confirm.upgradeEpochs
      if (pendingCount >= required) {
        level = raw
        pendingCount = 0
        downCount = 0
      }
    } else if (raw < level) {
      pendingCount = 0
      downCount += 1
      if (downCount >= cfg.confirm.downgradeEpochs) {
        level = (level - 1) as WarningLevelValue
        downCount = 0
      }
    } else {
      pendingCount = 0
      downCount = 0
    }
    obs.level = level
  }
}

export function simulateNetwork(plan: SimPlan, stations: StationDef[], cfg: ThresholdConfig): SimulationResult {
  const rng = mulberry32(plan.seed)
  const steps = Math.floor((plan.end - plan.start) / (plan.intervalH * 3600000)) + 1
  const times: number[] = []
  for (let i = 0; i < steps; i += 1) times.push(plan.start + i * plan.intervalH * 3600000)

  const totalHours = (plan.end - plan.start) / 3600000
  const rainEvents = buildRainEvents(totalHours, rng)

  const rain: RainObservation[] = []
  let effectiveRain = 0
  for (let i = 0; i < steps; i += 1) {
    const hours = (times[i] - plan.start) / 3600000
    const { rain1h, rain24h } = rainAt(hours, rainEvents)
    effectiveRain = effectiveRain * cfg.rainCoupling.effectiveK + rain1h
    rain.push({ time: times[i], rain1h, rain24h, effectiveRain })
  }

  const observations: Record<string, GnssObservation[]> = {}
  for (const station of stations) {
    // 质量退化窗口（遮挡/暴雨）
    const badWindows: { start: number; end: number }[] = []
    let cursor = 0
    while (cursor < totalHours) {
      cursor += 40 + rng() * 120
      if (cursor >= totalHours) break
      const len = 3 + Math.floor(rng() * 6) * plan.intervalH
      badWindows.push({ start: cursor, end: cursor + len })
      cursor += len
    }

    const samples: RawSample[] = []
    let dE = 0
    let dN = 0
    let dU = 0
    let walkE = 0
    let walkN = 0
    let walkU = 0
    const sigmaH = 2.0
    const sigmaV = 3.4
    for (let i = 0; i < steps; i += 1) {
      const hours = (times[i] - plan.start) / 3600000
      const lagHours = hours - station.lagH
      const baseV = lagHours > 0 ? fukuzonoVelocity(lagHours, plan) : fukuzonoVelocity(0, plan) * 0.4
      const rf = lagHours > 0 ? rainFactor(lagHours, rainEvents) : 0
      const v = station.gain * (baseV + rf)
      const dt = plan.intervalH
      const azimuth = (station.azimuth * Math.PI) / 180
      dE += v * Math.sin(azimuth) * dt
      dN += v * Math.cos(azimuth) * dt
      dU -= v * 0.14 * dt

      walkE = walkE * 0.994 + gaussian(rng) * 0.45
      walkN = walkN * 0.994 + gaussian(rng) * 0.45
      walkU = walkU * 0.994 + gaussian(rng) * 0.7

      let rE = dE + walkE + gaussian(rng) * sigmaH
      let rN = dN + walkN + gaussian(rng) * sigmaH
      const rU = dU + walkU + gaussian(rng) * sigmaV

      if (rng() < 0.004) {
        const jump = (rng() < 0.5 ? -1 : 1) * (10 + rng() * 22)
        rE += jump
        rN += jump * 0.4
      }

      const q = qualityAt(hours, rng, badWindows)
      samples.push({
        time: times[i],
        dE: rE,
        dN: rN,
        dU: rU,
        fixType: q.fixType,
        sats: q.sats,
        pdop: q.pdop,
        rmsH: q.rmsH,
        rmsV: q.rmsV,
        qualityOk: qualityPass(q, cfg)
      })
    }

    const series = computeSeries(samples, plan.intervalH, station)
    for (let i = 0; i < series.length; i += 1) {
      series[i].rawLevel = evaluateRawLevel(series[i].dH, series[i].v, series[i].tangentAngle, rain[i].rain1h, cfg)
    }
    applyFsm(series, cfg)
    observations[station.id] = series
  }

  return {
    times,
    stations,
    observations,
    rain,
    timeline: { t1: plan.t1, t2: plan.t2, tf: plan.tf, totalHours }
  }
}

/**
 * 依据新的阈值配置重算观测质量、原始等级与状态机等级，
 * 支持前端阈值率定后即时刷新，无需重新仿真。
 */
export function recomputeLevels(result: SimulationResult, cfg: ThresholdConfig): void {
  for (const station of result.stations) {
    const series = result.observations[station.id]
    if (!series) continue
    for (let i = 0; i < series.length; i += 1) {
      const obs = series[i]
      obs.qualityOk = qualityPass(obs, cfg)
      const rain1h = result.rain[i]?.rain1h ?? 0
      obs.rawLevel = evaluateRawLevel(obs.dH, obs.v, obs.tangentAngle, rain1h, cfg)
    }
    applyFsm(series, cfg)
  }
}

export const DEFAULT_SIM_PLAN: SimPlan = {
  start: Date.UTC(2026, 7, 1, 0, 0, 0),
  end: Date.UTC(2026, 8, 30, 0, 0, 0),
  intervalH: 6,
  t1: 60 * 24 * 0.22,
  t2: 60 * 24 * 0.52,
  tf: 60 * 24,
  vSteadyMmd: 8,
  seed: 20260916
}
