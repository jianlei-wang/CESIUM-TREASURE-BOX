import * as THREE from 'three'
import {
  ApplyForce,
  Bezier,
  ColorOverLife,
  ColorRange,
  ConstantValue,
  ConeEmitter,
  Gradient,
  IntervalValue,
  ParticleSystem,
  PiecewiseBezier,
  RenderMode,
  RotationOverLife,
  SizeOverLife,
  SphereEmitter,
  TurbulenceField,
  Vector3 as QVector3,
  Vector4 as QVector4
} from 'three.quarks'
import type { EffectTextures } from './textures'

export type EffectId = 'fountain' | 'flame' | 'smoke' | 'fireworks'
export type ParamKind = 'number' | 'color' | 'boolean' | 'select'

export interface ParamDef {
  key: string
  label: string
  kind: ParamKind
  min?: number
  max?: number
  step?: number
  unit?: string
  default: number | string | boolean
  options?: Array<{ label: string; value: string }>
}

export interface EffectMeta {
  id: EffectId
  title: string
  subtitle: string
  description: string
  params: ParamDef[]
  /** 这些参数变化会导致粒子系统结构变化，需要整体重建；其余参数支持实时更新 */
  rebuildKeys?: string[]
}

export type ParamValue = number | string | boolean
export type ParamValues = Record<string, ParamValue>

export interface EffectBuildContext {
  textures: EffectTextures
}

export interface BuiltEffect {
  systems: ParticleSystem[]
  tick?: (delta: number) => void
  update?: (values: ParamValues) => void
}

const DEG = Math.PI / 180

function q3(x: number, y: number, z: number): QVector3 {
  return new QVector3(x, y, z)
}

function hexToQ3(hex: string): QVector3 {
  const color = new THREE.Color(hex)
  return new QVector3(color.r, color.g, color.b)
}

function hexToQ4(hex: string, alpha = 1): QVector4 {
  const color = new THREE.Color(hex)
  return new QVector4(color.r, color.g, color.b, alpha)
}

function num(values: ParamValues, key: string, fallback: number): number {
  const value = values[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function str(values: ParamValues, key: string, fallback: string): string {
  const value = values[key]
  return typeof value === 'string' ? value : fallback
}

function additive(map: THREE.Texture, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  })
}

function normalBlend(map: THREE.Texture, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  })
}

function whiteAlpha(alphaStops: Array<[number, number]>, opacity: number): Gradient {
  const rgb = hexToQ3('#ffffff')
  return new Gradient(
    [
      [rgb, 0],
      [rgb, 1]
    ],
    alphaStops.map(([a, t]) => [a * opacity, t] as [number, number])
  )
}

function gradientFromHex(stops: Array<[string, number]>, alpha: Array<[number, number]>, opacity: number): Gradient {
  return new Gradient(
    stops.map(([hex, t]) => [hexToQ3(hex), t] as [QVector3, number]),
    alpha.map(([a, t]) => [a * opacity, t] as [number, number])
  )
}

function sizeCurve(p1: number, p2: number, p3: number, p4: number): SizeOverLife {
  return new SizeOverLife(new PiecewiseBezier([[new Bezier(p1, p2, p3, p4), 0]]))
}

/* ------------------------------------------------------------------ */
/* Fountain                                                            */
/* ------------------------------------------------------------------ */

function buildFountain(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const rate = num(values, 'rate', 220)
  const life = num(values, 'life', 2.4)
  const speed = num(values, 'speed', 9)
  const size = num(values, 'size', 0.6)
  const gravity = num(values, 'gravity', 9.8)
  const spread = num(values, 'spread', 14)
  const radius = num(values, 'radius', 0.35)
  const turbulence = num(values, 'turbulence', 0.7)
  const mist = num(values, 'mist', 1)

  const jetRate = new ConstantValue(rate * 0.75)
  const sprayRate = new ConstantValue(rate * 0.5 * mist)
  const jetLife = new IntervalValue(life * 0.6, life)
  const jetSpeed = new IntervalValue(speed * 0.85, speed * 1.15)
  const jetSize = new IntervalValue(size * 0.7, size)
  const sprayLife = new IntervalValue(life * 0.45, life * 0.8)
  const spraySpeed = new IntervalValue(speed * 0.25, speed * 0.6)
  const spraySize = new IntervalValue(size * 1.4, size * 2.6)
  const jetGravity = new ConstantValue(gravity)
  const sprayGravity = new ConstantValue(gravity * 0.35)
  const jetTurb = new TurbulenceField(q3(2.5, 2.5, 2.5), 2, q3(turbulence, turbulence, turbulence), q3(0.6, 0.6, 0.6))
  const sprayTurb = new TurbulenceField(
    q3(3, 3, 3),
    2,
    q3(turbulence * 0.6, turbulence * 0.6, turbulence * 0.6),
    q3(0.4, 0.4, 0.4)
  )
  const jetEmitter = new ConeEmitter({ radius, angle: spread * DEG, thickness: 0.6 })
  const sprayEmitter = new ConeEmitter({ radius: radius * 1.4, angle: spread * 1.9 * DEG, thickness: 0.9 })

  const jet = new ParticleSystem({
    duration: 200,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: jetEmitter,
    startLife: jetLife,
    startSpeed: jetSpeed,
    startSize: jetSize,
    startColor: new ColorRange(hexToQ4('#eaf7ff'), hexToQ4('#8fd0ff')),
    emissionOverTime: jetRate,
    behaviors: [
      new ApplyForce(q3(0, -1, 0), jetGravity),
      new SizeOverLife(new PiecewiseBezier([[new Bezier(0, 0.9, 0.85, 0.05), 0]])),
      new ColorOverLife(whiteAlpha([[1, 0], [1, 0.15], [0.75, 0.6], [0, 1]], 1)),
      jetTurb
    ],
    renderMode: RenderMode.StretchedBillBoard,
    material: additive(ctx.textures.glow),
    rendererEmitterSettings: { speedFactor: 1, lengthFactor: 0.055 }
  })
  jet.emitter.rotation.x = -Math.PI / 2

  const spray = new ParticleSystem({
    duration: 200,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: sprayEmitter,
    startLife: sprayLife,
    startSpeed: spraySpeed,
    startSize: spraySize,
    startColor: new ColorRange(hexToQ4('#ffffff'), hexToQ4('#bfe3ff')),
    emissionOverTime: sprayRate,
    behaviors: [
      new ApplyForce(q3(0, -1, 0), sprayGravity),
      sizeCurve(0.15, 0.7, 0.4, 0),
      new ColorOverLife(whiteAlpha([[0.35, 0], [0.5, 0.2], [0.28, 0.6], [0, 1]], 1)),
      sprayTurb
    ],
    renderMode: RenderMode.BillBoard,
    material: additive(ctx.textures.soft),
    rendererEmitterSettings: {}
  })
  spray.emitter.rotation.x = -Math.PI / 2

  const update = (v: ParamValues): void => {
    const r = num(v, 'rate', 220)
    const lf = num(v, 'life', 2.4)
    const sp = num(v, 'speed', 9)
    const sz = num(v, 'size', 0.6)
    const gv = num(v, 'gravity', 9.8)
    const sd = num(v, 'spread', 14)
    const rd = num(v, 'radius', 0.35)
    const tb = num(v, 'turbulence', 0.7)
    const ms = num(v, 'mist', 1)

    jetRate.value = r * 0.75
    sprayRate.value = r * 0.5 * ms
    jetLife.a = lf * 0.6
    jetLife.b = lf
    sprayLife.a = lf * 0.45
    sprayLife.b = lf * 0.8
    jetSpeed.a = sp * 0.85
    jetSpeed.b = sp * 1.15
    spraySpeed.a = sp * 0.25
    spraySpeed.b = sp * 0.6
    jetSize.a = sz * 0.7
    jetSize.b = sz
    spraySize.a = sz * 1.4
    spraySize.b = sz * 2.6
    jetGravity.value = gv
    sprayGravity.value = gv * 0.35
    jetEmitter.angle = sd * DEG
    sprayEmitter.angle = sd * 1.9 * DEG
    jetEmitter.radius = rd
    sprayEmitter.radius = rd * 1.4
    jetTurb.velocityMultiplier.set(tb, tb, tb)
    sprayTurb.velocityMultiplier.set(tb * 0.6, tb * 0.6, tb * 0.6)
  }

  return { systems: [jet, spray], update }
}

/* ------------------------------------------------------------------ */
/* Flame                                                               */
/* ------------------------------------------------------------------ */

function buildFlame(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const rate = num(values, 'rate', 320)
  const life = num(values, 'life', 1.6)
  const speed = num(values, 'speed', 3.2)
  const size = num(values, 'size', 0.9)
  const buoyancy = num(values, 'buoyancy', 4.2)
  const spread = num(values, 'spread', 16)
  const radius = num(values, 'radius', 0.3)
  const turbulence = num(values, 'turbulence', 1.6)

  const flameRate = new ConstantValue(rate)
  const sparkRate = new ConstantValue(rate * 0.35)
  const flameLife = new IntervalValue(life * 0.55, life)
  const flameSpeed = new IntervalValue(speed * 0.6, speed * 1.2)
  const flameSize = new IntervalValue(size * 0.7, size * 1.2)
  const sparkLife = new IntervalValue(life * 0.35, life * 0.7)
  const sparkSpeed = new IntervalValue(speed * 1.6, speed * 3)
  const sparkSize = new IntervalValue(size * 0.12, size * 0.28)
  const flameBuoyancy = new ConstantValue(buoyancy)
  const sparkBuoyancy = new ConstantValue(buoyancy * 1.6)
  const flameTurb = new TurbulenceField(
    q3(2, 2, 2),
    2,
    q3(turbulence, turbulence * 1.4, turbulence),
    q3(1.2, 1.2, 1.2)
  )
  const sparkTurb = new TurbulenceField(
    q3(3, 3, 3),
    2,
    q3(turbulence * 1.4, turbulence * 1.6, turbulence * 1.4),
    q3(1.6, 1.6, 1.6)
  )
  const flameEmitter = new ConeEmitter({ radius, angle: spread * DEG, thickness: 0.85 })
  const sparkEmitter = new ConeEmitter({ radius: radius * 0.7, angle: spread * 1.4 * DEG, thickness: 0.5 })

  const flame = new ParticleSystem({
    duration: 200,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: flameEmitter,
    startLife: flameLife,
    startSpeed: flameSpeed,
    startSize: flameSize,
    startColor: new ColorRange(hexToQ4('#ffffff'), hexToQ4('#ffffff')),
    emissionOverTime: flameRate,
    behaviors: [
      new ApplyForce(q3(0, 1, 0), flameBuoyancy),
      new SizeOverLife(new PiecewiseBezier([[new Bezier(0.15, 0.9, 1.25, 0), 0]])),
      new ColorOverLife(
        gradientFromHex(
          [
            ['#fff6c8', 0],
            ['#ffd24a', 0.28],
            ['#ff7a18', 0.58],
            ['#c2350a', 0.82],
            ['#3a1004', 1]
          ],
          [
            [0.8, 0],
            [1, 0.12],
            [0.85, 0.4],
            [0.4, 0.7],
            [0, 1]
          ],
          1
        )
      ),
      flameTurb
    ],
    renderMode: RenderMode.BillBoard,
    material: additive(ctx.textures.glow),
    rendererEmitterSettings: {}
  })
  flame.emitter.rotation.x = -Math.PI / 2

  const sparks = new ParticleSystem({
    duration: 200,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: sparkEmitter,
    startLife: sparkLife,
    startSpeed: sparkSpeed,
    startSize: sparkSize,
    startColor: new ColorRange(hexToQ4('#ffffff'), hexToQ4('#ffffff')),
    emissionOverTime: sparkRate,
    behaviors: [
      new ApplyForce(q3(0, 1, 0), sparkBuoyancy),
      new ApplyForce(q3(0, -1, 0), new ConstantValue(3.2)),
      new SizeOverLife(new PiecewiseBezier([[new Bezier(0.2, 1, 0.6, 0), 0]])),
      new ColorOverLife(
        gradientFromHex(
          [
            ['#fff8d0', 0],
            ['#ffc23a', 0.5],
            ['#ff5a12', 1]
          ],
          [
            [1, 0],
            [0.9, 0.5],
            [0, 1]
          ],
          1
        )
      ),
      sparkTurb
    ],
    renderMode: RenderMode.StretchedBillBoard,
    material: additive(ctx.textures.spark),
    rendererEmitterSettings: { speedFactor: 1, lengthFactor: 0.09 }
  })
  sparks.emitter.rotation.x = -Math.PI / 2

  const update = (v: ParamValues): void => {
    const r = num(v, 'rate', 320)
    const lf = num(v, 'life', 1.6)
    const sp = num(v, 'speed', 3.2)
    const sz = num(v, 'size', 0.9)
    const by = num(v, 'buoyancy', 4.2)
    const sd = num(v, 'spread', 16)
    const rd = num(v, 'radius', 0.3)
    const tb = num(v, 'turbulence', 1.6)

    flameRate.value = r
    sparkRate.value = r * 0.35
    flameLife.a = lf * 0.55
    flameLife.b = lf
    sparkLife.a = lf * 0.35
    sparkLife.b = lf * 0.7
    flameSpeed.a = sp * 0.6
    flameSpeed.b = sp * 1.2
    sparkSpeed.a = sp * 1.6
    sparkSpeed.b = sp * 3
    flameSize.a = sz * 0.7
    flameSize.b = sz * 1.2
    sparkSize.a = sz * 0.12
    sparkSize.b = sz * 0.28
    flameBuoyancy.value = by
    sparkBuoyancy.value = by * 1.6
    flameEmitter.angle = sd * DEG
    sparkEmitter.angle = sd * 1.4 * DEG
    flameEmitter.radius = rd
    sparkEmitter.radius = rd * 0.7
    flameTurb.velocityMultiplier.set(tb, tb * 1.4, tb)
    sparkTurb.velocityMultiplier.set(tb * 1.4, tb * 1.6, tb * 1.4)
  }

  return { systems: [flame, sparks], update }
}

/* ------------------------------------------------------------------ */
/* Smoke                                                               */
/* ------------------------------------------------------------------ */

function buildSmoke(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const rate = num(values, 'rate', 60)
  const life = num(values, 'life', 6)
  const speed = num(values, 'speed', 1.1)
  const size = num(values, 'size', 1.9)
  const rise = num(values, 'rise', 1.5)
  const wind = num(values, 'wind', 0.6)
  const turbulence = num(values, 'turbulence', 0.6)
  const opacity = num(values, 'opacity', 0.55)
  const spin = num(values, 'spin', 0.35)

  const smokeRate = new ConstantValue(rate)
  const smokeLife = new IntervalValue(life * 0.65, life)
  const smokeSpeed = new IntervalValue(speed * 0.5, speed * 1.3)
  const smokeSize = new IntervalValue(size * 0.55, size)
  const riseForce = new ConstantValue(rise)
  const windForce = new ConstantValue(wind)
  const smokeTurb = new TurbulenceField(
    q3(3.5, 3.5, 3.5),
    2,
    q3(turbulence, turbulence * 0.7, turbulence),
    q3(0.25, 0.25, 0.25)
  )
  const smokeSpin = new IntervalValue(-spin, spin)
  const material = normalBlend(ctx.textures.smoke, opacity)

  const smoke = new ParticleSystem({
    duration: 400,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: new ConeEmitter({ radius: 0.5, angle: 24 * DEG, thickness: 1 }),
    startLife: smokeLife,
    startSpeed: smokeSpeed,
    startSize: smokeSize,
    startColor: new ColorRange(hexToQ4('#3c3f46'), hexToQ4('#8d9299')),
    emissionOverTime: smokeRate,
    behaviors: [
      new ApplyForce(q3(0, 1, 0), riseForce),
      new ApplyForce(q3(0.6, 0, 0.85), windForce),
      sizeCurve(0.08, 0.55, 1.25, 2.6),
      new RotationOverLife(smokeSpin),
      new ColorOverLife(whiteAlpha([[0, 0], [0.7, 0.18], [0.65, 0.55], [0, 1]], 1)),
      smokeTurb
    ],
    renderMode: RenderMode.BillBoard,
    material,
    rendererEmitterSettings: {}
  })
  smoke.emitter.rotation.x = -Math.PI / 2

  const update = (v: ParamValues): void => {
    const r = num(v, 'rate', 60)
    const lf = num(v, 'life', 6)
    const sp = num(v, 'speed', 1.1)
    const sz = num(v, 'size', 1.9)
    const rs = num(v, 'rise', 1.5)
    const wd = num(v, 'wind', 0.6)
    const tb = num(v, 'turbulence', 0.6)
    const op = num(v, 'opacity', 0.55)
    const sn = num(v, 'spin', 0.35)

    smokeRate.value = r
    smokeLife.a = lf * 0.65
    smokeLife.b = lf
    smokeSpeed.a = sp * 0.5
    smokeSpeed.b = sp * 1.3
    smokeSize.a = sz * 0.55
    smokeSize.b = sz
    riseForce.value = rs
    windForce.value = wd
    smokeTurb.velocityMultiplier.set(tb, tb * 0.7, tb)
    smokeSpin.a = -sn
    smokeSpin.b = sn
    material.opacity = op
  }

  return { systems: [smoke], update }
}

/* ------------------------------------------------------------------ */
/* Fireworks                                                           */
/* ------------------------------------------------------------------ */

const FIREWORK_PALETTES: Record<string, string[]> = {
  multicolor: ['#ff4d5a', '#ffd24a', '#58c6ff', '#8b5cff', '#5dff9b'],
  gold: ['#fff3c4', '#ffd24a', '#ff9d2e', '#ff6a00'],
  red: ['#ffd0d0', '#ff5a5a', '#e00000', '#8a0000'],
  blue: ['#d6f0ff', '#58c6ff', '#1f7dff', '#0a3cff'],
  violet: ['#f0d6ff', '#b06bff', '#7a1fff', '#3d0a8a']
}

function buildFireworks(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const count = num(values, 'count', 240)
  const interval = num(values, 'interval', 1.8)
  const speed = num(values, 'speed', 20)
  const life = num(values, 'life', 2.6)
  const size = num(values, 'size', 2)
  const gravity = num(values, 'gravity', 6)
  const sphereRadius = num(values, 'radius', 1.3)
  const palette = FIREWORK_PALETTES[str(values, 'palette', 'multicolor')] ?? FIREWORK_PALETTES.multicolor

  const colors = palette.map((hex) => hexToQ4(hex))
  const colorA = colors[0]
  const colorB = colors[colors.length - 1]

  const shellBurst = new ConstantValue(Math.round(count * 0.7))
  const sparkBurst = new ConstantValue(Math.round(count * 0.5))
  const shellLife = new IntervalValue(life * 0.7, life)
  const shellSpeed = new IntervalValue(speed * 0.55, speed)
  const shellSize = new IntervalValue(size * 0.5, size)
  const sparkLife = new IntervalValue(life * 0.85, life * 1.25)
  const sparkSpeed = new IntervalValue(speed * 0.8, speed * 1.25)
  const sparkSize = new IntervalValue(size * 0.16, size * 0.34)
  const shellGravity = new ConstantValue(gravity)
  const sparkGravity = new ConstantValue(gravity * 1.1)
  const shellEmitter = new SphereEmitter({ radius: sphereRadius, thickness: 1 })
  const sparkEmitter = new SphereEmitter({ radius: sphereRadius, thickness: 1 })

  const shell = new ParticleSystem({
    duration: life,
    looping: false,
    autoDestroy: false,
    prewarm: false,
    worldSpace: true,
    shape: shellEmitter,
    startLife: shellLife,
    startSpeed: shellSpeed,
    startSize: shellSize,
    startColor: new ColorRange(colorA, colorB),
    emissionOverTime: new ConstantValue(0),
    emissionBursts: [{ time: 0, count: shellBurst, cycle: 1, interval: 0, probability: 1 }],
    behaviors: [
      new ApplyForce(q3(0, -1, 0), shellGravity),
      new SizeOverLife(new PiecewiseBezier([[new Bezier(0.1, 1, 0.85, 0), 0]])),
      new ColorOverLife(whiteAlpha([[1, 0], [1, 0.55], [0, 1]], 1))
    ],
    renderMode: RenderMode.BillBoard,
    material: additive(ctx.textures.glow),
    rendererEmitterSettings: {}
  })

  const sparks = new ParticleSystem({
    duration: life,
    looping: false,
    autoDestroy: false,
    prewarm: false,
    worldSpace: true,
    shape: sparkEmitter,
    startLife: sparkLife,
    startSpeed: sparkSpeed,
    startSize: sparkSize,
    startColor: new ColorRange(colorA, hexToQ4('#ffffff')),
    emissionOverTime: new ConstantValue(0),
    emissionBursts: [{ time: 0, count: sparkBurst, cycle: 1, interval: 0, probability: 1 }],
    behaviors: [
      new ApplyForce(q3(0, -1, 0), sparkGravity),
      new SizeOverLife(new PiecewiseBezier([[new Bezier(0.2, 1, 0.5, 0), 0]])),
      new ColorOverLife(whiteAlpha([[1, 0], [1, 0.5], [0, 1]], 1)),
      new TurbulenceField(q3(4, 4, 4), 2, q3(0.8, 0.8, 0.8), q3(0.6, 0.6, 0.6))
    ],
    renderMode: RenderMode.StretchedBillBoard,
    material: additive(ctx.textures.spark),
    rendererEmitterSettings: { speedFactor: 1, lengthFactor: 0.12 }
  })

  const systems = [shell, sparks]
  const launchSpread = 45
  const heightBase = 38
  const state = { interval, timer: interval }

  const launch = (): void => {
    const angle = Math.random() * Math.PI * 2
    const dist = Math.sqrt(Math.random()) * launchSpread
    const x = Math.cos(angle) * dist
    const z = Math.sin(angle) * dist
    const y = heightBase + Math.random() * 24
    for (const system of systems) {
      system.emitter.position.set(x, y, z)
      system.restart()
    }
  }

  launch()

  const tick = (delta: number): void => {
    state.timer += delta
    if (state.timer >= state.interval) {
      state.timer = 0
      launch()
    }
  }

  const update = (v: ParamValues): void => {
    const c = num(v, 'count', 240)
    const it = num(v, 'interval', 1.8)
    const sp = num(v, 'speed', 20)
    const lf = num(v, 'life', 2.6)
    const sz = num(v, 'size', 2)
    const gv = num(v, 'gravity', 6)
    const rd = num(v, 'radius', 1.3)

    shellBurst.value = Math.round(c * 0.7)
    sparkBurst.value = Math.round(c * 0.5)
    state.interval = Math.max(0.2, it)
    shellSpeed.a = sp * 0.55
    shellSpeed.b = sp
    sparkSpeed.a = sp * 0.8
    sparkSpeed.b = sp * 1.25
    shellLife.a = lf * 0.7
    shellLife.b = lf
    sparkLife.a = lf * 0.85
    sparkLife.b = lf * 1.25
    shellSize.a = sz * 0.5
    shellSize.b = sz
    sparkSize.a = sz * 0.16
    sparkSize.b = sz * 0.34
    shellGravity.value = gv
    sparkGravity.value = gv * 1.1
    shellEmitter.radius = rd
    sparkEmitter.radius = rd
  }

  return { systems, tick, update }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const EFFECT_META: Record<EffectId, EffectMeta> = {
  fountain: {
    id: 'fountain',
    title: 'Three.Quarks 喷泉',
    subtitle: 'GPU 粒子水景',
    description:
      '基于 three.quarks 的 GPU 粒子喷泉，叠加在 Cesium 地球上，实时呈现水流、水雾与重力回落。所有参数支持实时生效，无需重建粒子系统。',
    params: [
      { key: 'rate', label: '发射速率', kind: 'number', min: 20, max: 600, step: 10, unit: '个/秒', default: 220 },
      { key: 'life', label: '粒子寿命', kind: 'number', min: 0.5, max: 8, step: 0.1, unit: '秒', default: 2.4 },
      { key: 'speed', label: '喷射速度', kind: 'number', min: 1, max: 30, step: 0.5, default: 9 },
      { key: 'size', label: '粒子尺寸', kind: 'number', min: 0.05, max: 4, step: 0.05, default: 0.6 },
      { key: 'gravity', label: '重力加速度', kind: 'number', min: 0, max: 40, step: 0.5, default: 9.8 },
      { key: 'spread', label: '喷射张角', kind: 'number', min: 0, max: 60, step: 1, unit: '°', default: 14 },
      { key: 'radius', label: '喷口半径', kind: 'number', min: 0, max: 3, step: 0.05, default: 0.35 },
      { key: 'turbulence', label: '湍流强度', kind: 'number', min: 0, max: 4, step: 0.1, default: 0.7 },
      { key: 'mist', label: '水雾浓度', kind: 'number', min: 0, max: 3, step: 0.1, default: 1 }
    ]
  },
  flame: {
    id: 'flame',
    title: 'Three.Quarks 火焰',
    subtitle: 'GPU 粒子火焰',
    description:
      '基于 three.quarks 的 GPU 粒子火焰：亮黄色的火焰核心自地面向上浮升，随生命周期逐渐转为橙红并收束消散，周围飞溅高速火星。所有参数支持实时生效。',
    params: [
      { key: 'rate', label: '发射速率', kind: 'number', min: 40, max: 900, step: 10, unit: '个/秒', default: 320 },
      { key: 'life', label: '粒子寿命', kind: 'number', min: 0.4, max: 5, step: 0.1, unit: '秒', default: 1.6 },
      { key: 'speed', label: '初始速度', kind: 'number', min: 0.5, max: 15, step: 0.1, default: 3.2 },
      { key: 'size', label: '粒子尺寸', kind: 'number', min: 0.1, max: 5, step: 0.05, default: 0.9 },
      { key: 'buoyancy', label: '浮力强度', kind: 'number', min: 0, max: 20, step: 0.2, default: 4.2 },
      { key: 'spread', label: '火焰张角', kind: 'number', min: 0, max: 60, step: 1, unit: '°', default: 16 },
      { key: 'radius', label: '火源半径', kind: 'number', min: 0, max: 3, step: 0.05, default: 0.3 },
      { key: 'turbulence', label: '湍流强度', kind: 'number', min: 0, max: 5, step: 0.1, default: 1.6 }
    ]
  },
  smoke: {
    id: 'smoke',
    title: 'Three.Quarks 烟雾',
    subtitle: 'GPU 粒子烟雾',
    description:
      '基于 three.quarks 的 GPU 粒子烟雾，通过湍流场与风向力驱动烟雾上升扩散，叠加在 Cesium 地球上。所有参数支持实时生效，无需重建粒子系统。',
    params: [
      { key: 'rate', label: '发射速率', kind: 'number', min: 5, max: 240, step: 5, unit: '个/秒', default: 60 },
      { key: 'life', label: '粒子寿命', kind: 'number', min: 1, max: 16, step: 0.5, unit: '秒', default: 6 },
      { key: 'speed', label: '初始速度', kind: 'number', min: 0.1, max: 8, step: 0.1, default: 1.1 },
      { key: 'size', label: '粒子尺寸', kind: 'number', min: 0.3, max: 8, step: 0.1, default: 1.9 },
      { key: 'rise', label: '上升力', kind: 'number', min: 0, max: 10, step: 0.1, default: 1.5 },
      { key: 'wind', label: '风力', kind: 'number', min: 0, max: 6, step: 0.1, default: 0.6 },
      { key: 'turbulence', label: '湍流强度', kind: 'number', min: 0, max: 4, step: 0.1, default: 0.6 },
      { key: 'opacity', label: '不透明度', kind: 'number', min: 0.05, max: 1, step: 0.05, default: 0.55 },
      { key: 'spin', label: '自旋速度', kind: 'number', min: 0, max: 2, step: 0.05, default: 0.35 }
    ]
  },
  fireworks: {
    id: 'fireworks',
    title: 'Three.Quarks 烟花',
    subtitle: 'GPU 粒子烟花',
    description:
      '基于 three.quarks 的 GPU 粒子烟花，多层爆裂球壳与拖尾火星在 Cesium 地球上空随机绽放。数量、速度、尺寸、寿命、重力、爆裂半径、发射间隔均支持实时生效，配色方案切换会重建粒子系统。',
    params: [
      { key: 'count', label: '爆裂粒子数', kind: 'number', min: 60, max: 800, step: 10, unit: '个', default: 240 },
      { key: 'interval', label: '发射间隔', kind: 'number', min: 0.4, max: 6, step: 0.1, unit: '秒', default: 1.8 },
      { key: 'speed', label: '爆裂速度', kind: 'number', min: 5, max: 60, step: 1, default: 20 },
      { key: 'life', label: '粒子寿命', kind: 'number', min: 0.6, max: 6, step: 0.1, unit: '秒', default: 2.6 },
      { key: 'size', label: '粒子尺寸', kind: 'number', min: 0.5, max: 10, step: 0.1, default: 2 },
      { key: 'gravity', label: '重力加速度', kind: 'number', min: 0, max: 25, step: 0.5, default: 6 },
      { key: 'radius', label: '爆裂半径', kind: 'number', min: 0, max: 8, step: 0.1, default: 1.3 },
      {
        key: 'palette',
        label: '配色方案',
        kind: 'select',
        default: 'multicolor',
        options: [
          { label: '缤纷', value: 'multicolor' },
          { label: '金色', value: 'gold' },
          { label: '赤红', value: 'red' },
          { label: '湛蓝', value: 'blue' },
          { label: '紫罗兰', value: 'violet' }
        ]
      }
    ],
    rebuildKeys: ['palette']
  }
}

export function defaultParamValues(id: EffectId): ParamValues {
  const values: ParamValues = {}
  for (const param of EFFECT_META[id].params) values[param.key] = param.default
  return values
}

export function buildEffect(id: EffectId, values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  switch (id) {
    case 'fountain':
      return buildFountain(values, ctx)
    case 'flame':
      return buildFlame(values, ctx)
    case 'smoke':
      return buildSmoke(values, ctx)
    case 'fireworks':
      return buildFireworks(values, ctx)
    default: {
      const exhaustive: never = id
      return exhaustive
    }
  }
}

export const QUARKS_EFFECT_IDS: EffectId[] = ['fountain', 'flame', 'smoke', 'fireworks']

export function isRebuildKey(id: EffectId, key: string): boolean {
  return (EFFECT_META[id].rebuildKeys ?? []).includes(key)
}
