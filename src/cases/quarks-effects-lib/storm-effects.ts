import * as THREE from 'three'
import {
  ApplyForce,
  ColorOverLife,
  ColorRange,
  ConeEmitter,
  ConstantValue,
  DonutEmitter,
  IntervalValue,
  OrbitOverLife,
  ParticleSystem,
  PointEmitter,
  RectangleEmitter,
  RenderMode,
  SphereEmitter,
  TurbulenceField,
  Vector3 as QVector3,
  type StretchedBillBoardSettings
} from 'three.quarks'
import {
  DEG,
  additive,
  gradientFromHex,
  hexToQ4,
  normalBlend,
  num,
  q3,
  sizeCurve,
  str,
  whiteAlpha,
  type BuiltEffect,
  type EffectBuildContext,
  type EffectMeta,
  type ParamValues
} from './effect-kit'

export type StormEffectId = 'thunderstorm' | 'sandstorm' | 'wake' | 'volcano' | 'meteor'

/** 把 +z（quarks 默认发射方向）对准给定世界方向 */
function aim(emitter: { quaternion: THREE.Quaternion }, dir: THREE.Vector3): void {
  emitter.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize())
}

/* ------------------------------------------------------------------ */
/* 01 雷暴积雨云 + 闪电链                                                */
/* ------------------------------------------------------------------ */

interface LightningState {
  interval: number
  baseInterval: number
  timer: number
  flash: number
  branches: number
  segments: number
  height: number
  spread: number
  intensity: number
  color: string
}

function createCloudTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.3, 'rgba(210,230,255,0.5)')
  grad.addColorStop(1, 'rgba(180,210,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function regenerateBolt(line: THREE.LineSegments, state: LightningState): void {
  const positions: number[] = []
  const rng = Math.random
  const half = state.spread

  const channel = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    segs: number,
    depth: number
  ): void => {
    let px = x0
    let py = y0
    let pz = z0
    for (let i = 1; i <= segs; i += 1) {
      const t = i / segs
      const jitter = i < segs ? 1 : 0.25
      const nx = x0 + (x1 - x0) * t + (rng() - 0.5) * half * jitter
      const ny = y0 + (y1 - y0) * t
      const nz = z0 + (z1 - z0) * t + (rng() - 0.5) * half * jitter
      positions.push(px, py, pz, nx, ny, nz)
      if (depth > 0 && i > 1 && i < segs && rng() < 0.4) {
        const bx = x1 + (rng() - 0.5) * half * 2.4
        const bz = z1 + (rng() - 0.5) * half * 2.4
        channel(nx, ny, nz, bx, Math.max(0, ny - (y0 - y1) * 0.45), bz, Math.max(3, segs - 3), depth - 1)
      }
      px = nx
      py = ny
      pz = nz
    }
  }

  const startX = (rng() - 0.5) * half * 2
  const startZ = (rng() - 0.5) * half * 2
  const endX = (rng() - 0.5) * half * 3
  const endZ = (rng() - 0.5) * half * 3
  channel(startX, state.height, startZ, endX, 0, endZ, state.segments, state.branches)

  line.geometry.dispose()
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  line.geometry = geometry
  ;(line.material as THREE.LineBasicMaterial).color = new THREE.Color(state.color)
}

function buildThunderstorm(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const cloudCount = num(values, 'cloudCount', 800)
  const cloudSize = num(values, 'cloudSize', 16)
  const cloudHeight = num(values, 'cloudHeight', 70)
  const cloudLife = num(values, 'cloudLife', 16)
  const updraft = num(values, 'updraft', 2)
  const wind = num(values, 'wind', 6)
  const area = num(values, 'area', 70)
  const rainRate = num(values, 'rainRate', 300)
  const rainSpeed = num(values, 'rainSpeed', 45)
  const strikeInterval = num(values, 'strikeInterval', 6)
  const branches = num(values, 'branches', 2)
  const intensity = num(values, 'flash', 1.2)
  const boltColor = str(values, 'boltColor', '#bfe0ff')

  const cloudRate = new ConstantValue(cloudCount / Math.max(1, cloudLife) * 1.6)
  const cloudLifeGen = new IntervalValue(cloudLife * 0.6, cloudLife)
  const cloudSizeGen = new IntervalValue(cloudSize * 0.5, cloudSize)
  const cloudUpdraft = new ConstantValue(updraft)
  const cloudWind = new ConstantValue(wind)
  const cloudTurb = new TurbulenceField(q3(3, 3, 3), 2, q3(0.7, 0.5, 0.7), q3(0.25, 0.25, 0.25))
  const cloudEmitter = new RectangleEmitter({ width: area, height: area, thickness: 0.4 })
  const cloudMaterial = normalBlend(ctx.textures.smoke, 0.42)
  const cloud = new ParticleSystem({
    duration: 400,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: cloudEmitter,
    startLife: cloudLifeGen,
    startSpeed: new IntervalValue(0.4, 1.6),
    startSize: cloudSizeGen,
    startColor: new ColorRange(hexToQ4('#e7edf5'), hexToQ4('#98a3b2')),
    emissionOverTime: cloudRate,
    behaviors: [
      new ApplyForce(q3(0, 1, 0), cloudUpdraft),
      new ApplyForce(q3(1, 0, 0), cloudWind),
      sizeCurve(0.45, 0.9, 1.15, 0.85),
      new ColorOverLife(
        gradientFromHex(
          [
            ['#eef3f9', 0],
            ['#b9c3d0', 0.45],
            ['#707b89', 1]
          ],
          [
            [0, 0],
            [0.6, 0.12],
            [0.5, 0.5],
            [0, 1]
          ],
          1
        )
      ),
      cloudTurb
    ],
    renderMode: RenderMode.BillBoard,
    material: cloudMaterial,
    rendererEmitterSettings: {}
  })
  cloud.emitter.position.set(0, cloudHeight, 0)
  cloud.emitter.rotation.x = -Math.PI / 2

  const rainRateGen = new ConstantValue(rainRate)
  const rainLifeGen = new IntervalValue(cloudHeight / Math.max(5, rainSpeed), cloudHeight / Math.max(5, rainSpeed) * 2)
  const rainSpeedGen = new IntervalValue(rainSpeed * 0.85, rainSpeed * 1.15)
  const rainWind = new ConstantValue(wind * 0.6)
  const rainEmitter = new RectangleEmitter({ width: area * 0.9, height: area * 0.9, thickness: 0.5 })
  const rain = new ParticleSystem({
    duration: 300,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: rainEmitter,
    startLife: rainLifeGen,
    startSpeed: rainSpeedGen,
    startSize: new IntervalValue(0.25, 0.6),
    startColor: new ColorRange(hexToQ4('#a9c6e6'), hexToQ4('#e6f2ff')),
    emissionOverTime: rainRateGen,
    behaviors: [
      new ApplyForce(q3(0, -1, 0), new ConstantValue(6)),
      new ApplyForce(q3(1, 0, 0), rainWind),
      sizeCurve(0.6, 1, 1, 0.6),
      new ColorOverLife(whiteAlpha([[0.15, 0], [0.5, 0.2], [0.35, 0.8], [0, 1]], 1))
    ],
    renderMode: RenderMode.StretchedBillBoard,
    material: additive(ctx.textures.soft, 0.5),
    rendererEmitterSettings: { speedFactor: 1, lengthFactor: 0.1 }
  })
  rain.emitter.position.set(0, cloudHeight, 0)
  rain.emitter.rotation.x = Math.PI / 2

  const lineMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(boltColor),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  })
  const line = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial)
  line.frustumCulled = false
  const glowMaterial = new THREE.SpriteMaterial({
    map: createCloudTexture(),
    color: new THREE.Color('#dbeaff'),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  })
  const glow = new THREE.Sprite(glowMaterial)
  glow.scale.setScalar(cloudHeight * 1.4)
  glow.position.set(0, cloudHeight * 0.5, 0)
  const group = new THREE.Group()
  group.add(line)
  group.add(glow)

  const state: LightningState = {
    interval: strikeInterval,
    baseInterval: strikeInterval,
    timer: 0,
    flash: 0,
    branches: Math.round(branches),
    segments: 9,
    height: cloudHeight,
    spread: cloudHeight * 0.14,
    intensity,
    color: boltColor
  }

  const strike = (): void => {
    regenerateBolt(line, state)
    state.flash = 1
    state.timer = 0
    state.interval = Math.max(0.4, state.baseInterval * (0.55 + Math.random() * 0.9))
  }

  const tick = (delta: number): void => {
    state.timer += delta
    if (state.timer >= state.interval) strike()
    state.flash = Math.max(0, state.flash - delta * 3.2)
    const flicker = state.flash > 0.99 ? 1 : state.flash
    lineMaterial.opacity = Math.min(1, flicker) * state.intensity
    glowMaterial.opacity = flicker * 0.8 * state.intensity
  }

  const update = (v: ParamValues): void => {
    const cc = num(v, 'cloudCount', 800)
    const cs = num(v, 'cloudSize', 16)
    const ch = num(v, 'cloudHeight', 70)
    const cl = num(v, 'cloudLife', 16)
    const up = num(v, 'updraft', 2)
    const wd = num(v, 'wind', 6)
    const ar = num(v, 'area', 70)
    const rr = num(v, 'rainRate', 300)
    const rs = num(v, 'rainSpeed', 45)

    cloudRate.value = cc / Math.max(1, cl) * 1.6
    cloudLifeGen.a = cl * 0.6
    cloudLifeGen.b = cl
    cloudSizeGen.a = cs * 0.5
    cloudSizeGen.b = cs
    cloudUpdraft.value = up
    cloudWind.value = wd
    cloudEmitter.width = ar
    cloudEmitter.height = ar
    cloud.emitter.position.set(0, ch, 0)
    rainRateGen.value = rr
    rainEmitter.width = ar * 0.9
    rainEmitter.height = ar * 0.9
    rain.emitter.position.set(0, ch, 0)
    const fall = Math.max(5, rs)
    rainLifeGen.a = ch / fall
    rainLifeGen.b = ch / fall * 2
    rainSpeedGen.a = rs * 0.85
    rainSpeedGen.b = rs * 1.15
    rainWind.value = wd * 0.6
    state.baseInterval = num(v, 'strikeInterval', 6)
    state.branches = Math.round(num(v, 'branches', 2))
    state.height = ch
    state.spread = ch * 0.14
    state.intensity = num(v, 'flash', 1.2)
    glow.scale.setScalar(ch * 1.4)
    glow.position.set(0, ch * 0.5, 0)
  }

  return { systems: [cloud, rain], objects: [group], tick, update }
}

/* ------------------------------------------------------------------ */
/* 02 沙尘暴 / 尘卷风                                                    */
/* ------------------------------------------------------------------ */

function buildSandstorm(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const count = num(values, 'count', 3500)
  const size = num(values, 'size', 0.3)
  const speed = num(values, 'speed', 20)
  const life = num(values, 'life', 4.5)
  const rise = num(values, 'rise', 1.2)
  const turbulence = num(values, 'turbulence', 1.6)
  const area = num(values, 'area', 140)
  const vortexRadius = num(values, 'vortexRadius', 14)
  const vortexSpin = num(values, 'vortexSpin', 2.6)
  const vortexUp = num(values, 'vortexUp', 5)
  const vortexRateValue = num(values, 'vortexRate', 600)
  const haze = num(values, 'haze', 0.35)

  const sandRate = new ConstantValue(count / Math.max(1, life) * 1.4)
  const sandLifeGen = new IntervalValue(life * 0.6, life)
  const sandSizeGen = new IntervalValue(size * 0.5, size * 1.5)
  const sandWind = new ConstantValue(speed)
  const sandRise = new ConstantValue(rise)
  const sandEmitter = new SphereEmitter({ radius: area * 0.5, thickness: 1 })
  const sandTurb = new TurbulenceField(q3(4, 2, 4), 2, q3(turbulence, turbulence * 0.5, turbulence), q3(0.35, 0.35, 0.35))
  const sandMaterial = normalBlend(ctx.textures.smoke, haze)
  const sand = new ParticleSystem({
    duration: 400,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: sandEmitter,
    startLife: sandLifeGen,
    startSpeed: new IntervalValue(2, 6),
    startSize: sandSizeGen,
    startColor: new ColorRange(hexToQ4('#d9b578'), hexToQ4('#8f6b39')),
    emissionOverTime: sandRate,
    behaviors: [
      new ApplyForce(q3(1, 0, 0), sandWind),
      new ApplyForce(q3(0, 1, 0), sandRise),
      new ColorOverLife(
        gradientFromHex(
          [
            ['#e3c187', 0],
            ['#b98f52', 0.5],
            ['#7c5a2e', 1]
          ],
          [
            [0, 0],
            [0.55, 0.12],
            [0.4, 0.6],
            [0, 1]
          ],
          1
        )
      ),
      sandTurb
    ],
    renderMode: RenderMode.BillBoard,
    material: sandMaterial,
    rendererEmitterSettings: {}
  })
  sand.emitter.position.set(0, 3, 0)

  const vortexRate = new ConstantValue(vortexRateValue)
  const vortexSpinGen = new ConstantValue(vortexSpin)
  const vortexUpForce = new ConstantValue(vortexUp)
  const vortexLifeGen = new IntervalValue(life * 0.5, life * 0.9)
  const vortexSizeGen = new IntervalValue(size * 0.7, size * 1.8)
  const vortexEmitter = new DonutEmitter({ radius: vortexRadius, donutRadius: vortexRadius * 0.4, thickness: 0.6 })
  const vortexTurb = new TurbulenceField(
    q3(2, 3, 2),
    2,
    q3(turbulence * 0.6, turbulence * 0.8, turbulence * 0.6),
    q3(0.5, 0.5, 0.5)
  )
  const vortex = new ParticleSystem({
    duration: 400,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: vortexEmitter,
    startLife: vortexLifeGen,
    startSpeed: new IntervalValue(1, 3),
    startSize: vortexSizeGen,
    startColor: new ColorRange(hexToQ4('#cba672'), hexToQ4('#8a6636')),
    emissionOverTime: vortexRate,
    behaviors: [
      new OrbitOverLife(vortexSpinGen, new QVector3(0, 1, 0)),
      new ApplyForce(q3(0, 1, 0), vortexUpForce),
      new ColorOverLife(
        gradientFromHex(
          [
            ['#e8cd9a', 0],
            ['#b08850', 0.6],
            ['#6f4f27', 1]
          ],
          [
            [0, 0],
            [0.6, 0.15],
            [0.35, 0.65],
            [0, 1]
          ],
          1
        )
      ),
      vortexTurb
    ],
    renderMode: RenderMode.BillBoard,
    material: sandMaterial,
    rendererEmitterSettings: {}
  })
  vortex.emitter.position.set(0, 2, 0)
  vortex.emitter.rotation.x = -Math.PI / 2

  const update = (v: ParamValues): void => {
    const c = num(v, 'count', 3500)
    const sz = num(v, 'size', 0.3)
    const sp = num(v, 'speed', 20)
    const lf = num(v, 'life', 4.5)
    const rs = num(v, 'rise', 1.2)
    const tb = num(v, 'turbulence', 1.6)
    const ar = num(v, 'area', 140)
    const vr = num(v, 'vortexRadius', 14)
    const vs = num(v, 'vortexSpin', 2.6)
    const vu = num(v, 'vortexUp', 5)
    const vrate = num(v, 'vortexRate', 600)
    const hz = num(v, 'haze', 0.35)

    sandRate.value = c / Math.max(1, lf) * 1.4
    sandLifeGen.a = lf * 0.6
    sandLifeGen.b = lf
    sandSizeGen.a = sz * 0.5
    sandSizeGen.b = sz * 1.5
    sandWind.value = sp
    sandRise.value = rs
    sandEmitter.radius = ar * 0.5
    sandMaterial.opacity = hz
    sandTurb.velocityMultiplier.set(tb, tb * 0.5, tb)

    vortexRate.value = vrate
    vortexSpinGen.value = vs
    vortexUpForce.value = vu
    vortexEmitter.radius = vr
    vortexEmitter.donutRadius = vr * 0.4
    vortexLifeGen.a = lf * 0.5
    vortexLifeGen.b = lf * 0.9
    vortexSizeGen.a = sz * 0.7
    vortexSizeGen.b = sz * 1.8
    vortexTurb.velocityMultiplier.set(tb * 0.6, tb * 0.8, tb * 0.6)
  }

  return { systems: [sand, vortex], update }
}

/* ------------------------------------------------------------------ */
/* 03 船尾开尔文尾迹 / 礁石碎浪                                          */
/* ------------------------------------------------------------------ */

function buildWake(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const foamRate = num(values, 'foamRate', 900)
  const foamSize = num(values, 'foamSize', 2.6)
  const foamLife = num(values, 'foamLife', 7)
  const wakeAngle = num(values, 'wakeAngle', 19.5)
  const sprayRate = num(values, 'sprayRate', 350)
  const spraySpeed = num(values, 'spraySpeed', 7)
  const gravity = num(values, 'gravity', 9)
  const foamOpacity = num(values, 'foamOpacity', 0.5)
  const shipSpeed = num(values, 'shipSpeed', 12)

  const lane = 320
  const ship = new THREE.Group()
  ship.add(new THREE.Mesh(new THREE.BoxGeometry(14, 4, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color('#3a4a5c') })))
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(5, 3, 4),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#c9d6e2') })
  )
  cabin.position.set(-1, 4.5, 0)
  ship.add(cabin)

  const foamDensity = new ConstantValue(foamRate / 200)
  const foamLifeGen = new IntervalValue(foamLife * 0.5, foamLife)
  const foamSizeGen = new IntervalValue(foamSize * 0.5, foamSize)
  const foamEmitter = new PointEmitter()
  const foamLeft = new ParticleSystem({
    duration: 400,
    looping: true,
    prewarm: false,
    worldSpace: true,
    shape: foamEmitter,
    startLife: foamLifeGen,
    startSpeed: new IntervalValue(1.5, 3.5),
    startSize: foamSizeGen,
    startColor: new ColorRange(hexToQ4('#ffffff'), hexToQ4('#dfeaf2')),
    emissionOverTime: new ConstantValue(0),
    emissionOverDistance: foamDensity,
    behaviors: [
      sizeCurve(0.6, 1, 1.1, 1.4),
      new ColorOverLife(whiteAlpha([[0.5, 0], [0.6, 0.2], [0.35, 0.7], [0, 1]], 1)),
      new TurbulenceField(q3(1.5, 0.4, 1.5), 2, q3(0.25, 0.05, 0.25), q3(0.4, 0.4, 0.4))
    ],
    renderMode: RenderMode.BillBoard,
    material: normalBlend(ctx.textures.soft, foamOpacity),
    rendererEmitterSettings: {}
  })
  const foamRight = foamLeft.clone()
  foamRight.material = normalBlend(ctx.textures.soft, foamOpacity)

  const sprayRateGen = new ConstantValue(sprayRate / 10)
  const spraySpeedGen = new IntervalValue(spraySpeed * 0.6, spraySpeed * 1.3)
  const sprayGravity = new ConstantValue(gravity)
  const sprayEmitter = new PointEmitter()
  const spray = new ParticleSystem({
    duration: 300,
    looping: true,
    prewarm: false,
    worldSpace: true,
    shape: sprayEmitter,
    startLife: new IntervalValue(0.7, 1.6),
    startSpeed: spraySpeedGen,
    startSize: new IntervalValue(0.4, 1.1),
    startColor: new ColorRange(hexToQ4('#ffffff'), hexToQ4('#cfe3f0')),
    emissionOverTime: sprayRateGen,
    behaviors: [
      new ApplyForce(q3(0, -1, 0), sprayGravity),
      sizeCurve(0.5, 0.9, 0.6, 0.1),
      new ColorOverLife(whiteAlpha([[0.8, 0], [0.7, 0.3], [0.3, 0.7], [0, 1]], 1))
    ],
    renderMode: RenderMode.BillBoard,
    material: additive(ctx.textures.soft, 0.7),
    rendererEmitterSettings: {}
  })

  const setAngle = (angleDeg: number): void => {
    const a = angleDeg * DEG
    aim(foamLeft.emitter, new THREE.Vector3(-Math.cos(a), 0, Math.sin(a)))
    aim(foamRight.emitter, new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a)))
  }
  setAngle(wakeAngle)
  aim(spray.emitter, new THREE.Vector3(0.25, 0.9, 0))

  const cfg = { speed: shipSpeed, lane }
  const state = { x: -lane / 2 }
  const place = (): void => {
    ship.position.set(state.x, 1.5, 0)
    foamLeft.emitter.position.set(state.x - 7, 0.6, 0)
    foamRight.emitter.position.set(state.x - 7, 0.6, 0)
    spray.emitter.position.set(state.x + 7, 1.2, 0)
  }
  place()

  const tick = (delta: number): void => {
    state.x += cfg.speed * delta
    if (state.x > cfg.lane / 2) {
      state.x = -cfg.lane / 2
      foamLeft.restart()
      foamRight.restart()
      spray.restart()
    }
    place()
  }

  const update = (v: ParamValues): void => {
    cfg.speed = num(v, 'shipSpeed', 12)
    const ws = num(v, 'wakeAngle', 19.5)
    const fo = num(v, 'foamOpacity', 0.5)
    foamLeft.material.opacity = fo
    foamRight.material.opacity = fo
    setAngle(ws)
    foamDensity.value = num(v, 'foamRate', 900) / 200
    const fl = num(v, 'foamLife', 7)
    foamLifeGen.a = fl * 0.5
    foamLifeGen.b = fl
    const fz = num(v, 'foamSize', 2.6)
    foamSizeGen.a = fz * 0.5
    foamSizeGen.b = fz
    sprayRateGen.value = num(v, 'sprayRate', 350) / 10
    const ss = num(v, 'spraySpeed', 7)
    spraySpeedGen.a = ss * 0.6
    spraySpeedGen.b = ss * 1.3
    sprayGravity.value = num(v, 'gravity', 9)
  }

  return { systems: [foamLeft, foamRight, spray], objects: [ship], tick, update }
}

/* ------------------------------------------------------------------ */
/* 04 火山喷发全流程                                                     */
/* ------------------------------------------------------------------ */

function buildVolcano(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const lavaRate = num(values, 'lavaRate', 1000)
  const lavaSpeed = num(values, 'lavaSpeed', 75)
  const lavaSize = num(values, 'lavaSize', 2.2)
  const lavaLife = num(values, 'lavaLife', 1.6)
  const ashRate = num(values, 'ashRate', 600)
  const ashLife = num(values, 'ashLife', 14)
  const ashSize = num(values, 'ashSize', 12)
  const wind = num(values, 'wind', 7)
  const rockRate = num(values, 'rockRate', 140)
  const rockSize = num(values, 'rockSize', 1.3)
  const gravity = num(values, 'gravity', 12)

  const lavaRateGen = new ConstantValue(lavaRate)
  const lavaLifeGen = new IntervalValue(lavaLife * 0.55, lavaLife)
  const lavaSpeedGen = new IntervalValue(lavaSpeed * 0.6, lavaSpeed * 1.15)
  const lavaSizeGen = new IntervalValue(lavaSize * 0.6, lavaSize)
  const lavaEmitter = new ConeEmitter({ radius: 2.2, angle: 16 * DEG, thickness: 0.5 })
  const lava = new ParticleSystem({
    duration: 300,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: lavaEmitter,
    startLife: lavaLifeGen,
    startSpeed: lavaSpeedGen,
    startSize: lavaSizeGen,
    startColor: new ColorRange(hexToQ4('#fff2b0'), hexToQ4('#ff8a1e')),
    emissionOverTime: lavaRateGen,
    behaviors: [
      new ApplyForce(q3(0, -1, 0), new ConstantValue(gravity)),
      sizeCurve(0.5, 1, 0.6, 0),
      new ColorOverLife(
        gradientFromHex(
          [
            ['#fff6c8', 0],
            ['#ffcf4a', 0.3],
            ['#ff6a12', 0.65],
            ['#a02405', 1]
          ],
          [
            [1, 0],
            [1, 0.25],
            [0.6, 0.7],
            [0, 1]
          ],
          1
        )
      ),
      new TurbulenceField(q3(2, 2, 2), 2, q3(1, 1, 1), q3(1, 1, 1))
    ],
    renderMode: RenderMode.BillBoard,
    material: additive(ctx.textures.glow),
    rendererEmitterSettings: {}
  })
  lava.emitter.position.set(0, 6, 0)
  lava.emitter.rotation.x = -Math.PI / 2

  const ashRateGen = new ConstantValue(ashRate)
  const ashLifeGen = new IntervalValue(ashLife * 0.6, ashLife)
  const ashSizeGen = new IntervalValue(ashSize * 0.4, ashSize)
  const ashWind = new ConstantValue(wind)
  const ashEmitter = new RectangleEmitter({ width: 8, height: 8, thickness: 0.5 })
  const ashMaterial = normalBlend(ctx.textures.smoke, 0.5)
  const ash = new ParticleSystem({
    duration: 400,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: ashEmitter,
    startLife: ashLifeGen,
    startSpeed: new IntervalValue(6, 16),
    startSize: ashSizeGen,
    startColor: new ColorRange(hexToQ4('#6d6a67'), hexToQ4('#33322f')),
    emissionOverTime: ashRateGen,
    behaviors: [
      new ApplyForce(q3(0, 1, 0), new ConstantValue(4)),
      new ApplyForce(q3(1, 0, 0), ashWind),
      sizeCurve(0.4, 0.9, 1.3, 2.2),
      new ColorOverLife(
        gradientFromHex(
          [
            ['#8b8783', 0],
            ['#55534f', 0.5],
            ['#26251f', 1]
          ],
          [
            [0, 0],
            [0.65, 0.15],
            [0.5, 0.5],
            [0, 1]
          ],
          1
        )
      ),
      new TurbulenceField(q3(3, 3, 3), 2, q3(0.8, 0.6, 0.8), q3(0.2, 0.2, 0.2))
    ],
    renderMode: RenderMode.BillBoard,
    material: ashMaterial,
    rendererEmitterSettings: {}
  })
  ash.emitter.position.set(0, 12, 0)
  ash.emitter.rotation.x = -Math.PI / 2

  const rockRateGen = new ConstantValue(rockRate / 10)
  const rockSpeedGen = new IntervalValue(lavaSpeed * 0.4, lavaSpeed * 0.8)
  const rockSizeGen = new IntervalValue(rockSize * 0.6, rockSize)
  const rocks = new ParticleSystem({
    duration: 300,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: new PointEmitter(),
    startLife: new IntervalValue(2.5, 5),
    startSpeed: rockSpeedGen,
    startSize: rockSizeGen,
    startColor: new ColorRange(hexToQ4('#5a2f16'), hexToQ4('#2c1608')),
    emissionOverTime: rockRateGen,
    behaviors: [
      new ApplyForce(q3(0, -1, 0), new ConstantValue(gravity)),
      new ColorOverLife(
        gradientFromHex(
          [
            ['#7a3d18', 0],
            ['#3a1c0a', 0.6],
            ['#1a0c04', 1]
          ],
          [
            [1, 0],
            [1, 0.6],
            [1, 1]
          ],
          1
        )
      )
    ],
    renderMode: RenderMode.BillBoard,
    material: normalBlend(ctx.textures.soft, 0.95),
    rendererEmitterSettings: {}
  })
  aim(rocks.emitter, new THREE.Vector3(0, 1, 0))
  rocks.emitter.position.set(0, 6, 0)

  const update = (v: ParamValues): void => {
    const lr = num(v, 'lavaRate', 1000)
    const ls = num(v, 'lavaSpeed', 75)
    const lz = num(v, 'lavaSize', 2.2)
    const ll = num(v, 'lavaLife', 1.6)
    const ar = num(v, 'ashRate', 600)
    const al = num(v, 'ashLife', 14)
    const az = num(v, 'ashSize', 12)
    const wd = num(v, 'wind', 7)
    const rr = num(v, 'rockRate', 140)
    const rz = num(v, 'rockSize', 1.3)

    lavaRateGen.value = lr
    lavaLifeGen.a = ll * 0.55
    lavaLifeGen.b = ll
    lavaSpeedGen.a = ls * 0.6
    lavaSpeedGen.b = ls * 1.15
    lavaSizeGen.a = lz * 0.6
    lavaSizeGen.b = lz
    ashRateGen.value = ar
    ashLifeGen.a = al * 0.6
    ashLifeGen.b = al
    ashSizeGen.a = az * 0.4
    ashSizeGen.b = az
    ashWind.value = wd
    rockRateGen.value = rr / 10
    rockSpeedGen.a = ls * 0.4
    rockSpeedGen.b = ls * 0.8
    rockSizeGen.a = rz * 0.6
    rockSizeGen.b = rz
  }

  return { systems: [lava, ash, rocks], update }
}

/* ------------------------------------------------------------------ */
/* 05 流星雨 / 再入火球                                                  */
/* ------------------------------------------------------------------ */

interface MeteorItem {
  head: ParticleSystem
  sparks: ParticleSystem
  headRate: ConstantValue
  sparkRate: ConstantValue
  headLife: IntervalValue
  headSize: IntervalValue
  sparkLife: IntervalValue
  sparkSize: IntervalValue
  headTurb: TurbulenceField
  sparkGravity: ConstantValue
  x0: number
  y0: number
  z0: number
  vx: number
  vy: number
  vz: number
  t: number
  duration: number
  flying: boolean
  delay: number
}

const MAX_METEORS = 4

function buildMeteor(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const concurrency = Math.min(MAX_METEORS, Math.max(1, Math.round(num(values, 'concurrency', 2))))
  const interval = num(values, 'interval', 1.6)
  const speed = num(values, 'speed', 500)
  const life = num(values, 'life', 1.6)
  const size = num(values, 'size', 4)
  const trailLength = num(values, 'trailLength', 0.22)
  const spread = num(values, 'spread', 0.8)
  const gravity = num(values, 'gravity', 2)
  const headColor = str(values, 'headColor', '#eaf6ff')
  const tailColor = str(values, 'tailColor', '#7fd0ff')

  const meteors: MeteorItem[] = []
  for (let i = 0; i < MAX_METEORS; i += 1) {
    const headRate = new ConstantValue(160)
    const headLife = new IntervalValue(life * 0.4, life)
    const headSize = new IntervalValue(size * 0.4, size)
    const headTurb = new TurbulenceField(q3(0.2, 0.05, 0.2), 2, q3(spread, spread, spread), q3(0.2, 0.2, 0.2))
    const head = new ParticleSystem({
      duration: 400,
      looping: true,
      prewarm: false,
      worldSpace: true,
      shape: new PointEmitter(),
      startLife: headLife,
      startSpeed: new IntervalValue(0.2, 0.8),
      startSize: headSize,
      startColor: new ColorRange(hexToQ4(headColor), hexToQ4(tailColor)),
      emissionOverTime: headRate,
      behaviors: [
        sizeCurve(0.5, 1, 0.9, 0.2),
        new ColorOverLife(whiteAlpha([[1, 0], [0.85, 0.2], [0.35, 0.7], [0, 1]], 1)),
        headTurb
      ],
      renderMode: RenderMode.BillBoard,
      material: additive(ctx.textures.glow, 0.9),
      rendererEmitterSettings: {}
    })

    const sparkRate = new ConstantValue(80)
    const sparkLife = new IntervalValue(life * 0.3, life * 0.7)
    const sparkSize = new IntervalValue(size * 0.1, size * 0.28)
    const sparkGravity = new ConstantValue(gravity)
    const sparks = new ParticleSystem({
      duration: 400,
      looping: true,
      prewarm: false,
      worldSpace: true,
      shape: new PointEmitter(),
      startLife: sparkLife,
      startSpeed: new IntervalValue(2, 7),
      startSize: sparkSize,
      startColor: new ColorRange(hexToQ4(headColor), hexToQ4('#ffb45a')),
      emissionOverTime: sparkRate,
      behaviors: [
        new ApplyForce(q3(0, -1, 0), sparkGravity),
        sizeCurve(0.6, 1, 0.5, 0),
        new ColorOverLife(whiteAlpha([[1, 0], [0.9, 0.4], [0, 1]], 1))
      ],
      renderMode: RenderMode.StretchedBillBoard,
      material: additive(ctx.textures.spark, 0.95),
      rendererEmitterSettings: { speedFactor: 1, lengthFactor: trailLength }
    })

    meteors.push({
      head,
      sparks,
      headRate,
      sparkRate,
      headLife,
      headSize,
      sparkLife,
      sparkSize,
      headTurb,
      sparkGravity,
      x0: 0,
      y0: 8000,
      z0: 0,
      vx: 0,
      vy: -1,
      vz: 0,
      t: 0,
      duration: 8,
      flying: false,
      delay: (i / MAX_METEORS) * interval * 2
    })
  }

  const cfg = { concurrency, interval, speed, trailLength }

  const startMeteor = (m: MeteorItem): void => {
    const heading = Math.random() * Math.PI * 2
    const dist = 6000 + Math.random() * 4000
    m.x0 = -Math.cos(heading) * dist * 0.5
    m.z0 = -Math.sin(heading) * dist * 0.5
    m.y0 = 7000 + Math.random() * 4000
    const dx = Math.cos(heading) * dist
    const dz = Math.sin(heading) * dist
    const dy = -(m.y0 - 400)
    const len = Math.hypot(dx, dy, dz)
    m.vx = (dx / len) * cfg.speed
    m.vy = (dy / len) * cfg.speed
    m.vz = (dz / len) * cfg.speed
    m.duration = len / Math.max(20, cfg.speed)
    m.t = 0
    m.flying = true
    m.headRate.value = 160
    m.sparkRate.value = 80
    m.head.restart()
    m.sparks.restart()
  }

  const placeFlying = (m: MeteorItem): void => {
    const x = m.x0 + m.vx * m.t
    const y = m.y0 + m.vy * m.t
    const z = m.z0 + m.vz * m.t
    m.head.emitter.position.set(x, y, z)
    m.sparks.emitter.position.set(x, y, z)
  }

  const tick = (delta: number): void => {
    let active = 0
    for (const m of meteors) {
      if (m.flying) {
        active += 1
        m.t += delta
        placeFlying(m)
        if (m.t >= m.duration) {
          m.flying = false
          m.headRate.value = 0
          m.sparkRate.value = 0
          m.delay = cfg.interval * (0.6 + Math.random())
        }
      } else {
        m.delay -= delta
      }
    }
    for (const m of meteors) {
      if (!m.flying && m.delay <= 0 && active < cfg.concurrency) {
        active += 1
        startMeteor(m)
      }
    }
  }

  const update = (v: ParamValues): void => {
    const lf = num(v, 'life', 1.6)
    const sz = num(v, 'size', 4)
    const sp = num(v, 'spread', 0.8)
    const gr = num(v, 'gravity', 2)
    cfg.interval = num(v, 'interval', 1.6)
    cfg.speed = num(v, 'speed', 500)
    cfg.concurrency = Math.min(MAX_METEORS, Math.max(1, Math.round(num(v, 'concurrency', 2))))
    cfg.trailLength = num(v, 'trailLength', 0.22)
    for (const m of meteors) {
      m.headLife.a = lf * 0.4
      m.headLife.b = lf
      m.headSize.a = sz * 0.4
      m.headSize.b = sz
      m.sparkLife.a = lf * 0.3
      m.sparkLife.b = lf * 0.7
      m.sparkSize.a = sz * 0.1
      m.sparkSize.b = sz * 0.28
      m.headTurb.velocityMultiplier.set(sp, sp, sp)
      m.sparkGravity.value = gr
      ;(m.sparks.rendererEmitterSettings as StretchedBillBoardSettings).lengthFactor = cfg.trailLength
    }
  }

  return {
    systems: meteors.flatMap((m) => [m.head, m.sparks]),
    tick,
    update
  }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const STORM_META: Record<StormEffectId, EffectMeta> = {
  thunderstorm: {
    id: 'thunderstorm',
    title: 'Three.Quarks 雷暴积雨云',
    subtitle: '云体 + 闪电链 + 雨幕',
    description:
      '参考“雷暴积雨云 + 闪电链”方案：多层烟雾 billboard 叠出云砧体积感，向上浮力与水平风平流驱动云体，递归分叉的折线闪电按随机节奏劈落并伴随辉光闪白，下方雨幕受重力与风拖曳。云量、云高、上升力、风力、雨量、闪电间隔与分叉级数均可实时调整。',
    params: [
      { key: 'cloudCount', label: '云粒子数', kind: 'number', min: 200, max: 1600, step: 50, unit: '个', default: 800 },
      { key: 'cloudSize', label: '云滴尺寸', kind: 'number', min: 5, max: 40, step: 1, default: 16 },
      { key: 'cloudHeight', label: '云底高度', kind: 'number', min: 30, max: 160, step: 5, default: 70 },
      { key: 'cloudLife', label: '云寿命', kind: 'number', min: 8, max: 24, step: 1, unit: '秒', default: 16 },
      { key: 'updraft', label: '上升力', kind: 'number', min: 0, max: 8, step: 0.2, default: 2 },
      { key: 'wind', label: '高空风', kind: 'number', min: 0, max: 20, step: 0.5, default: 6 },
      { key: 'area', label: '云团范围', kind: 'number', min: 20, max: 160, step: 5, default: 70 },
      { key: 'rainRate', label: '雨量', kind: 'number', min: 0, max: 1200, step: 50, unit: '个/秒', default: 300 },
      { key: 'rainSpeed', label: '雨滴速度', kind: 'number', min: 20, max: 80, step: 2, default: 45 },
      { key: 'strikeInterval', label: '闪电间隔', kind: 'number', min: 1, max: 20, step: 0.5, unit: '秒', default: 6 },
      { key: 'branches', label: '分叉级数', kind: 'number', min: 0, max: 3, step: 1, default: 2 },
      { key: 'flash', label: '闪光强度', kind: 'number', min: 0.2, max: 3, step: 0.1, default: 1.2 },
      { key: 'boltColor', label: '闪电颜色', kind: 'color', default: '#bfe0ff' }
    ],
    rebuildKeys: ['boltColor']
  },
  sandstorm: {
    id: 'sandstorm',
    title: 'Three.Quarks 沙尘暴 / 尘卷风',
    subtitle: '力场平流 + 涡旋漏斗',
    description:
      '参考“沙尘暴 / 尘卷风”方案：贴地沙粒沿风向高速平流并受多层湍流扰动，形成流动沙幕；尘卷风用环形发射器叠加绕竖直轴的涡旋场与向上抽吸，塑造螺旋上升的漏斗。沙粒数、风速、湍流、涡旋半径/转速/抽吸与整体沙尘浓度均可实时调整。',
    params: [
      { key: 'count', label: '沙粒数量', kind: 'number', min: 500, max: 9000, step: 250, unit: '个', default: 3500 },
      { key: 'size', label: '沙粒尺寸', kind: 'number', min: 0.05, max: 1.2, step: 0.05, default: 0.3 },
      { key: 'speed', label: '风速', kind: 'number', min: 5, max: 45, step: 1, default: 20 },
      { key: 'life', label: '沙粒寿命', kind: 'number', min: 2, max: 10, step: 0.5, unit: '秒', default: 4.5 },
      { key: 'rise', label: '抬升力', kind: 'number', min: 0, max: 8, step: 0.2, default: 1.2 },
      { key: 'turbulence', label: '湍流强度', kind: 'number', min: 0, max: 4, step: 0.1, default: 1.6 },
      { key: 'area', label: '沙暴范围', kind: 'number', min: 30, max: 300, step: 10, default: 140 },
      { key: 'vortexRadius', label: '涡旋半径', kind: 'number', min: 0, max: 40, step: 1, default: 14 },
      { key: 'vortexSpin', label: '涡旋角速度', kind: 'number', min: 0, max: 6, step: 0.1, default: 2.6 },
      { key: 'vortexUp', label: '涡旋抽吸', kind: 'number', min: 0, max: 15, step: 0.5, default: 5 },
      { key: 'vortexRate', label: '涡旋浓度', kind: 'number', min: 0, max: 2000, step: 100, default: 600 },
      { key: 'haze', label: '沙尘浓度', kind: 'number', min: 0.05, max: 0.9, step: 0.05, default: 0.35 }
    ]
  },
  wake: {
    id: 'wake',
    title: 'Three.Quarks 船尾开尔文尾迹',
    subtitle: '移动发射器 + 泡沫航迹',
    description:
      '参考“船尾开尔文尾迹 / 礁石碎浪”方案：船体作为移动发射器，两条按开尔文角向斜后方发散的泡沫航迹在静止世界坐标中遗留形成 V 形尾迹，船艏喷射水花受重力回落。航速、泡沫量/尺寸/寿命、开尔文角、水花量与透明度均可实时调整。',
    params: [
      { key: 'shipSpeed', label: '航速', kind: 'number', min: 0, max: 30, step: 0.5, unit: 'm/s', default: 12 },
      { key: 'foamRate', label: '泡沫密度', kind: 'number', min: 100, max: 3000, step: 50, default: 900 },
      { key: 'foamSize', label: '泡沫尺寸', kind: 'number', min: 0.5, max: 10, step: 0.1, default: 2.6 },
      { key: 'foamLife', label: '泡沫寿命', kind: 'number', min: 3, max: 15, step: 0.5, unit: '秒', default: 7 },
      { key: 'wakeAngle', label: '开尔文角', kind: 'number', min: 5, max: 45, step: 0.5, unit: '°', default: 19.5 },
      { key: 'sprayRate', label: '水花量', kind: 'number', min: 0, max: 1000, step: 25, default: 350 },
      { key: 'spraySpeed', label: '水花速度', kind: 'number', min: 2, max: 16, step: 0.5, default: 7 },
      { key: 'gravity', label: '重力加速度', kind: 'number', min: 0, max: 20, step: 0.5, default: 9 },
      { key: 'foamOpacity', label: '泡沫不透明度', kind: 'number', min: 0.05, max: 0.9, step: 0.05, default: 0.5 }
    ]
  },
  volcano: {
    id: 'volcano',
    title: 'Three.Quarks 火山喷发',
    subtitle: '熔岩喷泉 + 灰烬柱 + 飞溅岩块',
    description:
      '参考“火山喷发全流程”方案：同一喷口分层叠加三类发射器——高速亮色熔岩喷泉、受风切变弯曲的灰烬柱、按抛物线飞溅落地的暗色岩块。熔岩量/速度/尺寸、灰烬量/寿命/体积、风切变、岩块量与重力均可实时调整。',
    params: [
      { key: 'lavaRate', label: '熔岩量', kind: 'number', min: 100, max: 4000, step: 100, unit: '个/秒', default: 1000 },
      { key: 'lavaSpeed', label: '喷发速度', kind: 'number', min: 20, max: 160, step: 5, default: 75 },
      { key: 'lavaSize', label: '熔岩尺寸', kind: 'number', min: 0.5, max: 10, step: 0.1, default: 2.2 },
      { key: 'lavaLife', label: '熔岩寿命', kind: 'number', min: 0.4, max: 4, step: 0.1, unit: '秒', default: 1.6 },
      { key: 'ashRate', label: '灰烬量', kind: 'number', min: 50, max: 2000, step: 50, unit: '个/秒', default: 600 },
      { key: 'ashLife', label: '灰烬寿命', kind: 'number', min: 4, max: 30, step: 1, unit: '秒', default: 14 },
      { key: 'ashSize', label: '灰烬尺寸', kind: 'number', min: 3, max: 40, step: 1, default: 12 },
      { key: 'wind', label: '高空风切变', kind: 'number', min: 0, max: 25, step: 0.5, default: 7 },
      { key: 'rockRate', label: '岩块量', kind: 'number', min: 0, max: 500, step: 10, unit: '个/秒', default: 140 },
      { key: 'rockSize', label: '岩块尺寸', kind: 'number', min: 0.3, max: 5, step: 0.1, default: 1.3 },
      { key: 'gravity', label: '重力加速度', kind: 'number', min: 0, max: 30, step: 0.5, default: 12 }
    ]
  },
  meteor: {
    id: 'meteor',
    title: 'Three.Quarks 流星雨 / 再入火球',
    subtitle: '弹道轨迹 + 发光尾迹',
    description:
      '参考“流星雨 / 再入火球”方案：沿预计算的下行弹道驱动移动发射器，粒子在静止世界坐标中遗留下拉长的发光尾迹，头部明亮、尾部淡青，并伴随反向后抛的烧蚀火花。并发流星数、间隔、再入速度、寿命、尺寸、尾迹长度、散布与重力均可实时调整。',
    params: [
      { key: 'concurrency', label: '并发流星', kind: 'number', min: 1, max: 4, step: 1, unit: '条', default: 2 },
      { key: 'interval', label: '发射间隔', kind: 'number', min: 0.3, max: 6, step: 0.1, unit: '秒', default: 1.6 },
      { key: 'speed', label: '再入速度', kind: 'number', min: 20, max: 1200, step: 10, default: 500 },
      { key: 'life', label: '尾迹寿命', kind: 'number', min: 0.5, max: 3, step: 0.1, unit: '秒', default: 1.6 },
      { key: 'size', label: '粒子尺寸', kind: 'number', min: 1, max: 12, step: 0.5, default: 4 },
      { key: 'trailLength', label: '拖尾拉伸', kind: 'number', min: 0, max: 0.6, step: 0.02, default: 0.22 },
      { key: 'spread', label: '湍流散布', kind: 'number', min: 0.1, max: 3, step: 0.1, default: 0.8 },
      { key: 'gravity', label: '火花重力', kind: 'number', min: 0, max: 10, step: 0.5, default: 2 },
      { key: 'headColor', label: '头部颜色', kind: 'color', default: '#eaf6ff' },
      { key: 'tailColor', label: '尾部颜色', kind: 'color', default: '#7fd0ff' }
    ],
    rebuildKeys: ['headColor', 'tailColor']
  }
}

export const STORM_EFFECT_IDS: StormEffectId[] = ['thunderstorm', 'sandstorm', 'wake', 'volcano', 'meteor']

export function buildStormEffect(id: StormEffectId, values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  switch (id) {
    case 'thunderstorm':
      return buildThunderstorm(values, ctx)
    case 'sandstorm':
      return buildSandstorm(values, ctx)
    case 'wake':
      return buildWake(values, ctx)
    case 'volcano':
      return buildVolcano(values, ctx)
    case 'meteor':
      return buildMeteor(values, ctx)
    default: {
      const exhaustive: never = id
      return exhaustive
    }
  }
}
