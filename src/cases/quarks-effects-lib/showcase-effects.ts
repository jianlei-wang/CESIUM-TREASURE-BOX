import * as THREE from 'three'
import {
  ApplyForce,
  ColorOverLife,
  ColorRange,
  ConeEmitter,
  ConstantValue,
  IntervalValue,
  ParticleSystem,
  RenderMode,
  SphereEmitter,
  TurbulenceField
} from 'three.quarks'
import {
  additive,
  gradientFromHex,
  hexToQ4,
  normalBlend,
  num,
  q3,
  seededRandom,
  setColorRangeStops,
  setGradientColors,
  setParticleOpacity,
  sizeCurve,
  str,
  whiteAlpha,
  type BuiltEffect,
  type EffectBuildContext,
  type EffectMeta,
  type ParamValues
} from './effect-kit'

export type ShowcaseEffectId = 'rocket' | 'godray' | 'shield'

/** 同 disaster-effects：预热的连续发射系统必须把 duration 压到很小。 */
const PREWARM_DURATION = 4

/** 把 +z（quarks 默认发射方向）对准给定世界方向 */
function aim(emitter: { quaternion: THREE.Quaternion }, dir: THREE.Vector3): void {
  emitter.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize())
}

function surface(
  geometry: THREE.BufferGeometry,
  color: string,
  opacity: number,
  blending: THREE.Blending = THREE.NormalBlending
): THREE.Mesh {
  const solid = opacity >= 1
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: !solid,
      opacity,
      depthWrite: solid,
      side: solid ? THREE.FrontSide : THREE.DoubleSide,
      blending,
      toneMapped: false
    })
  )
}

function setOpacity(mesh: THREE.Mesh, opacity: number): void {
  ;(mesh.material as THREE.MeshBasicMaterial).opacity = opacity
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / Math.max(1e-6, b - a))
  return t * t * (3 - 2 * t)
}

function mixHex(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a)
  const cb = new THREE.Color(b)
  ca.lerp(cb, t)
  return `#${ca.getHexString()}`
}

/* ------------------------------------------------------------------ */
/* B03 火箭发射全链路                                                    */
/* ------------------------------------------------------------------ */

interface MachRing {
  mesh: THREE.Mesh
  phase: number
}

function buildRocket(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const bodyRadius = 6
  const bodyHeight = 90
  const padHeight = 4
  const machCount = Math.max(0, Math.round(num(values, 'machRings', 5)))

  const pad = surface(new THREE.CylinderGeometry(26, 30, padHeight, 32), '#4a4f56', 1)
  pad.position.y = padHeight / 2

  const rocket = new THREE.Group()
  rocket.position.y = padHeight

  const body = surface(new THREE.CylinderGeometry(bodyRadius, bodyRadius, bodyHeight, 24), '#e8ecf1', 1)
  body.position.y = bodyHeight / 2
  const stripe = surface(new THREE.CylinderGeometry(bodyRadius * 1.02, bodyRadius * 1.02, 6, 24), '#c0392b', 1)
  stripe.position.y = bodyHeight * 0.28
  const nose = surface(new THREE.ConeGeometry(bodyRadius, 22, 24), '#f4f7fa', 1)
  nose.position.y = bodyHeight + 11
  rocket.add(body, stripe, nose)

  const boosterGeo = new THREE.CylinderGeometry(bodyRadius * 0.5, bodyRadius * 0.5, bodyHeight * 0.55, 18)
  const boosterL = surface(boosterGeo, '#d8dde3', 1)
  boosterL.position.set(-bodyRadius * 1.7, bodyHeight * 0.275, 0)
  const boosterR = surface(boosterGeo, '#d8dde3', 1)
  boosterR.position.set(bodyRadius * 1.7, bodyHeight * 0.275, 0)
  const noseCapGeo = new THREE.ConeGeometry(bodyRadius * 0.5, 12, 18)
  const capL = surface(noseCapGeo, '#eef2f6', 1)
  capL.position.set(-bodyRadius * 1.7, bodyHeight * 0.55 + 6, 0)
  const capR = surface(noseCapGeo, '#eef2f6', 1)
  capR.position.set(bodyRadius * 1.7, bodyHeight * 0.55 + 6, 0)
  rocket.add(boosterL, boosterR, capL, capR)

  const machRings: MachRing[] = []
  const machGroup = new THREE.Group()
  for (let i = 0; i < machCount; i += 1) {
    const ring = surface(new THREE.TorusGeometry(bodyRadius * (1.1 + i * 0.28), 0.5, 8, 40), '#ffffff', 0, THREE.AdditiveBlending)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 2 - i * 3.2
    ring.visible = false
    machGroup.add(ring)
    machRings.push({ mesh: ring, phase: i * 0.9 })
  }
  rocket.add(machGroup)

  const windForce = new ConstantValue(3)
  const flameRate = new ConstantValue(0)
  const flameLifeGen = new IntervalValue(0.25, 0.7)
  const flameSizeGen = new IntervalValue(bodyRadius * 0.8, bodyRadius * 1.6)
  const flameSpeedGen = new IntervalValue(30, 70)
  const flameColorRange = new ColorRange(hexToQ4('#ffffff'), hexToQ4('#ff8a2a'))
  const flameEmitter = new ConeEmitter({ radius: bodyRadius * 0.8, angle: 16 * (Math.PI / 180), thickness: 1 })
  const flame = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: false,
    worldSpace: true,
    shape: flameEmitter,
    startLife: flameLifeGen,
    startSpeed: flameSpeedGen,
    startSize: flameSizeGen,
    startColor: flameColorRange,
    emissionOverTime: flameRate,
    behaviors: [
      new ColorOverLife(
        gradientFromHex(
          [
            ['#ffffff', 0],
            ['#ffd66a', 0.25],
            ['#ff7a18', 0.6],
            ['#7a1c04', 1]
          ],
          [
            [1, 0],
            [1, 0.2],
            [0.6, 0.6],
            [0, 1]
          ],
          1
        )
      ),
      sizeCurve(0.3, 1, 0.8, 0.1)
    ],
    renderMode: RenderMode.StretchedBillBoard,
    material: additive(ctx.textures.glow),
    rendererEmitterSettings: { speedFactor: 0.1, lengthFactor: 0.05 }
  })

  const sprayRate = new ConstantValue(0)
  const sprayLifeGen = new IntervalValue(1.2, 3)
  const spraySizeGen = new IntervalValue(10, 26)
  const sprayColorRange = new ColorRange(hexToQ4('#eef6ff'), hexToQ4('#b9c8d6'))
  const sprayEmitter = new ConeEmitter({ radius: 20, angle: 46 * (Math.PI / 180), thickness: 1 })
  const spray = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: false,
    worldSpace: true,
    shape: sprayEmitter,
    startLife: sprayLifeGen,
    startSpeed: new IntervalValue(10, 34),
    startSize: spraySizeGen,
    startColor: sprayColorRange,
    emissionOverTime: sprayRate,
    behaviors: [
      new ApplyForce(q3(0, 0.12, 0), new ConstantValue(0.6)),
      new ApplyForce(q3(1, 0, 0.4), windForce),
      sizeCurve(0.2, 0.8, 1.4, 2.2),
      new ColorOverLife(whiteAlpha([[0, 0], [0.75, 0.15], [0.5, 0.6], [0, 1]], 1)),
      new TurbulenceField(q3(4, 4, 4), 2, q3(0.8, 0.5, 0.8), q3(0.3, 0.3, 0.3))
    ],
    renderMode: RenderMode.BillBoard,
    material: normalBlend(ctx.textures.smoke, 0.85),
    rendererEmitterSettings: {}
  })
  spray.emitter.position.y = padHeight - 0.5
  aim(spray.emitter, new THREE.Vector3(1, 0.6, 0.4))

  const sparkRate = new ConstantValue(0)
  const spark = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: false,
    worldSpace: true,
    shape: new ConeEmitter({ radius: bodyRadius * 0.9, angle: 26 * (Math.PI / 180), thickness: 1 }),
    startLife: new IntervalValue(0.4, 1.1),
    startSpeed: new IntervalValue(20, 55),
    startSize: new IntervalValue(0.5, 1.4),
    startColor: new ColorRange(hexToQ4('#fff4c0'), hexToQ4('#ff6a12')),
    emissionOverTime: sparkRate,
    behaviors: [
      new ColorOverLife(whiteAlpha([[1, 0], [0.9, 0.5], [0, 1]], 1)),
      new TurbulenceField(q3(5, 5, 5), 2, q3(1, 1, 1), q3(0.4, 0.4, 0.4))
    ],
    renderMode: RenderMode.StretchedBillBoard,
    material: additive(ctx.textures.spark),
    rendererEmitterSettings: { speedFactor: 0.07, lengthFactor: 0.09 }
  })

  const stageReact = new ConstantValue(0)
  const stageFlash = new ParticleSystem({
    duration: 1.6,
    looping: false,
    autoDestroy: false,
    prewarm: false,
    worldSpace: true,
    shape: new SphereEmitter({ radius: 3, thickness: 1 }),
    startLife: new IntervalValue(0.5, 1.3),
    startSpeed: new IntervalValue(16, 48),
    startSize: new IntervalValue(1, 3.2),
    startColor: new ColorRange(hexToQ4('#ffffff'), hexToQ4('#ffd24a')),
    emissionOverTime: new ConstantValue(0),
    emissionBursts: [{ time: 0, count: stageReact, cycle: 1, interval: 0, probability: 1 }],
    behaviors: [
      new ColorOverLife(whiteAlpha([[1, 0], [0.9, 0.5], [0, 1]], 1)),
      new TurbulenceField(q3(4, 4, 4), 2, q3(1.4, 1.4, 1.4), q3(0.5, 0.5, 0.5))
    ],
    renderMode: RenderMode.BillBoard,
    material: additive(ctx.textures.glow),
    rendererEmitterSettings: {}
  })

  const cfg = {
    thrust: num(values, 'thrust', 1),
    flameSize: num(values, 'flameSize', 1),
    flameColor: str(values, 'flameColor', '#ff8a2a'),
    sprayRate: num(values, 'sprayRate', 2400),
    spraySpread: num(values, 'spraySpread', 46),
    sparkRate: num(values, 'sparkRate', 900),
    riseAccel: num(values, 'riseAccel', 26),
    maxAltitude: num(values, 'maxAltitude', 900),
    loopTime: num(values, 'loopTime', 30),
    wind: num(values, 'wind', 3)
  }

  const state = { t: 0, alt: 0, speed: 0, stagesDone: false }

  const resetRun = (): void => {
    state.t = 0
    state.alt = 0
    state.speed = 0
    state.stagesDone = false
    boosterL.visible = true
    boosterR.visible = true
    capL.visible = true
    capR.visible = true
    rocket.position.y = padHeight
    for (const ring of machRings) ring.mesh.visible = false
  }

  const igniteBurst = (): void => {
    stageReact.value = Math.round(220 * cfg.thrust)
    stageFlash.emitter.position.set(0, padHeight + state.alt - 1.5, 0)
    stageFlash.restart()
  }

  const tick = (delta: number): void => {
    state.t += delta
    if (state.t > cfg.loopTime) resetRun()

    const t = state.t
    const ignition = 2

    if (t < ignition) {
      const p = clamp01(t / ignition)
      flameRate.value = cfg.thrust * 1400 * p
      sparkRate.value = cfg.sparkRate * p
      sprayRate.value = cfg.sprayRate * p * 0.9
    } else {
      const dt = t - ignition
      state.alt = 0.5 * cfg.riseAccel * dt * dt
      state.speed = cfg.riseAccel * dt
      flameRate.value = cfg.thrust * 1400
      sparkRate.value = cfg.sparkRate
      const sp = clamp01(1 - state.alt / Math.max(1, cfg.maxAltitude))
      sprayRate.value = cfg.sprayRate * sp * sp
      if (state.alt > cfg.maxAltitude) {
        state.alt = cfg.maxAltitude
        resetRun()
        return
      }
      if (!state.stagesDone && state.alt > cfg.maxAltitude * 0.45) {
        state.stagesDone = true
        boosterL.visible = false
        boosterR.visible = false
        capL.visible = false
        capR.visible = false
        igniteBurst()
      }
    }

    const baseY = padHeight + state.alt
    rocket.position.y = baseY
    flame.emitter.position.set(0, baseY - 1, 0)
    aim(flame.emitter, new THREE.Vector3(0, -1, 0))
    spark.emitter.position.set(0, baseY - 1, 0)
    aim(spark.emitter, new THREE.Vector3(0, -1, 0))

    const maxSpeed = Math.sqrt(2 * cfg.riseAccel * Math.max(1, cfg.maxAltitude))
    const mach = smoothstep(0.12 * maxSpeed, 0.28 * maxSpeed, state.speed) * (1 - smoothstep(0.5 * maxSpeed, 0.72 * maxSpeed, state.speed))
    for (const ring of machRings) {
      ring.mesh.visible = mach > 0.02 && t > ignition
      const wobble = 0.5 + 0.5 * Math.sin(state.t * 24 + ring.phase)
      ring.mesh.scale.setScalar(0.7 + 0.5 * mach * wobble)
      setOpacity(ring.mesh, mach * (0.35 + 0.35 * wobble))
    }
  }

  resetRun()

  const update = (v: ParamValues): void => {
    cfg.thrust = num(v, 'thrust', 1)
    cfg.flameSize = num(v, 'flameSize', 1)
    cfg.flameColor = str(v, 'flameColor', '#ff8a2a')
    cfg.sprayRate = num(v, 'sprayRate', 2400)
    cfg.spraySpread = num(v, 'spraySpread', 46)
    cfg.sparkRate = num(v, 'sparkRate', 900)
    cfg.riseAccel = num(v, 'riseAccel', 26)
    cfg.maxAltitude = num(v, 'maxAltitude', 900)
    cfg.loopTime = num(v, 'loopTime', 30)
    cfg.wind = num(v, 'wind', 3)

    flameSizeGen.a = bodyRadius * 0.8 * cfg.flameSize
    flameSizeGen.b = bodyRadius * 1.6 * cfg.flameSize
    flameSpeedGen.a = 30
    flameSpeedGen.b = 70
    flameLifeGen.a = 0.25
    flameLifeGen.b = 0.7
    sprayLifeGen.a = 1.2
    sprayLifeGen.b = 3
    spraySizeGen.a = 10
    spraySizeGen.b = 26
    sprayEmitter.angle = cfg.spraySpread * (Math.PI / 180)
    flameEmitter.angle = 16 * (Math.PI / 180)
    flameEmitter.radius = bodyRadius * 0.8 * cfg.flameSize
    setColorRangeStops(flameColorRange, '#ffffff', cfg.flameColor)
    setGradientColors((flame.behaviors[0] as ColorOverLife).color, ['#ffffff', mixHex('#ffd66a', cfg.flameColor, 0.4), cfg.flameColor, '#7a1c04'])
    windForce.value = cfg.wind
  }

  return {
    systems: [flame, spray, spark, stageFlash],
    objects: [pad, rocket],
    tick,
    update
  }
}

/* ------------------------------------------------------------------ */
/* B04 丁达尔体积光 / 晨昏光柱                                          */
/* ------------------------------------------------------------------ */

const GODRAY_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const GODRAY_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uOpacity;
uniform float uNoise;
uniform vec3 uBottom;
uniform vec3 uTop;
varying vec2 vUv;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float edge = pow(1.0 - clamp(x, 0.0, 1.0), 1.6);
  float topFade = smoothstep(1.0, 0.3, vUv.y);
  float n = sin(vUv.y * 16.0 + uTime * 0.5) * 0.5 + 0.5;
  float n2 = sin(vUv.y * 41.0 - uTime * 0.9 + vUv.x * 6.0) * 0.5 + 0.5;
  n = mix(1.0, mix(n, n2, 0.4), uNoise);
  float a = edge * topFade * n * uOpacity;
  vec3 col = mix(uBottom, uTop, clamp(vUv.y, 0.0, 1.0));
  gl_FragColor = vec4(col * uIntensity, a);
}
`

interface GodUniforms {
  [key: string]: THREE.IUniform
  uTime: THREE.IUniform<number>
  uIntensity: THREE.IUniform<number>
  uOpacity: THREE.IUniform<number>
  uNoise: THREE.IUniform<number>
  uBottom: THREE.IUniform<THREE.Color>
  uTop: THREE.IUniform<THREE.Color>
}

function buildGodray(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const height = num(values, 'pillarHeight', 2600)
  const width = num(values, 'pillarWidth', 420)
  const intensity = num(values, 'intensity', 1.1)
  const opacity = num(values, 'opacity', 0.5)
  const noise = num(values, 'noise', 0.7)
  const elevation = num(values, 'sunElevation', 4)
  const dustCountGen = new ConstantValue(num(values, 'dustCount', 900))
  const dustSize = num(values, 'dustSize', 1.4)
  const dustOpacity = num(values, 'dustOpacity', 0.7)
  const bottomColor = str(values, 'bottomColor', '#ffd9a0')
  const topColor = str(values, 'topColor', '#ff7ec0')

  const group = new THREE.Group()
  const uniforms: GodUniforms = {
    uTime: { value: 0 },
    uIntensity: { value: intensity },
    uOpacity: { value: opacity },
    uNoise: { value: noise },
    uBottom: { value: new THREE.Color(bottomColor) },
    uTop: { value: new THREE.Color(topColor) }
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: GODRAY_VERTEX,
    fragmentShader: GODRAY_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  })

  const planeA = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 1, 24), material)
  planeA.position.y = height / 2
  const planeB = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 1, 24), material)
  planeB.position.y = height / 2
  planeB.rotation.y = Math.PI / 2
  const planeC = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.55, height, 1, 24), material)
  planeC.position.y = height / 2
  planeC.rotation.y = Math.PI / 4
  group.add(planeA, planeB, planeC)

  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: ctx.textures.glow,
      color: new THREE.Color(bottomColor),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    })
  )
  sun.position.set(0, height * 0.94, 0)
  sun.scale.setScalar(width * 0.7)
  group.add(sun)

  const dustLifeGen = new IntervalValue(8, 20)
  const dustSizeGen = new IntervalValue(dustSize * 0.5, dustSize)
  const dustColorRange = new ColorRange(hexToQ4('#fff2d0'), hexToQ4(bottomColor))
  const dustEmitter = new SphereEmitter({ radius: width * 0.6, thickness: 1 })
  const dust = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: false,
    worldSpace: true,
    shape: dustEmitter,
    startLife: dustLifeGen,
    startSpeed: new IntervalValue(0.2, 1.4),
    startSize: dustSizeGen,
    startColor: dustColorRange,
    emissionOverTime: dustCountGen,
    behaviors: [
      new ApplyForce(q3(0, 1, 0), new ConstantValue(0.25)),
      new ColorOverLife(whiteAlpha([[0, 0], [0.8, 0.2], [0.7, 0.7], [0, 1]], 1)),
      new TurbulenceField(q3(6, 6, 6), 2, q3(0.5, 0.4, 0.5), q3(0.15, 0.15, 0.15))
    ],
    renderMode: RenderMode.BillBoard,
    material: additive(ctx.textures.soft),
    rendererEmitterSettings: {}
  })
  dust.emitter.position.set(0, height * 0.45, 0)

  const cfg = { intensity, opacity, noise, elevation, bottomColor, topColor, dustSize }
  let time = 0

  const tick = (delta: number): void => {
    time += delta
    uniforms.uTime.value = time
    const sway = Math.sin(time * 0.25) * 0.06
    group.rotation.z = sway
    const shimmer = 0.85 + 0.15 * Math.sin(time * 0.7)
    const lowSun = 1 - smoothstep(6, 15, cfg.elevation)
    uniforms.uIntensity.value = cfg.intensity * shimmer * (0.25 + 0.75 * lowSun)
  }

  const update = (v: ParamValues): void => {
    cfg.elevation = num(v, 'sunElevation', 4)
    cfg.intensity = num(v, 'intensity', 1.1)
    cfg.opacity = num(v, 'opacity', 0.5)
    cfg.noise = num(v, 'noise', 0.7)
    cfg.bottomColor = str(v, 'bottomColor', '#ffd9a0')
    cfg.topColor = str(v, 'topColor', '#ff7ec0')
    cfg.dustSize = num(v, 'dustSize', 1.4)

    uniforms.uOpacity.value = cfg.opacity
    uniforms.uNoise.value = cfg.noise
    uniforms.uBottom.value.set(cfg.bottomColor)
    uniforms.uTop.value.set(cfg.topColor)
    const sunMat = sun.material as THREE.SpriteMaterial
    sunMat.color.set(cfg.bottomColor)
    dustCountGen.value = num(v, 'dustCount', 900)
    dustSizeGen.a = cfg.dustSize * 0.5
    dustSizeGen.b = cfg.dustSize
    dustLifeGen.a = 8
    dustLifeGen.b = 20
    setColorRangeStops(dustColorRange, '#fff2d0', cfg.bottomColor)
    setParticleOpacity(dust, num(v, 'dustOpacity', 0.7))
  }

  return { systems: [dust], objects: [group], tick, update }
}

/* ------------------------------------------------------------------ */
/* B06 可交互护盾 / 能量场                                              */
/* ------------------------------------------------------------------ */

const SHIELD_VERTEX = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec2 vUv;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const SHIELD_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uGrid;
uniform float uGridSpeed;
uniform float uIntensity;
uniform float uOpacity;
uniform vec3 uColor;
uniform vec3 uHit;
uniform float uHitTime;
uniform float uHitStrength;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec2 vUv;
float gridMask(vec2 uv, float scale) {
  vec2 g = abs(fract(uv * scale) - 0.5);
  float d = min(g.x, g.y);
  return 1.0 - smoothstep(0.0, 0.06, d);
}
void main() {
  vec3 V = normalize(cameraPosition - vPosW);
  float fres = pow(1.0 - clamp(dot(V, normalize(vNormalW)), 0.0, 1.0), 2.4);
  vec2 uv = vUv + vec2(uTime * uGridSpeed * 0.03, uTime * uGridSpeed * 0.02);
  float g = gridMask(uv, uGrid);
  float ripple = 0.0;
  float dt = uTime - uHitTime;
  if (dt > 0.0 && dt < 1.6) {
    float r = distance(vPosW, uHit);
    ripple = sin(r * 0.35 - dt * 8.0) * exp(-r * 0.02) * (1.0 - dt / 1.6) * uHitStrength;
  }
  float a = clamp(fres * 0.75 + g * 0.3 + ripple, 0.0, 1.0);
  vec3 col = uColor * (0.5 + fres * 0.9 + g * 0.4) + ripple * vec3(0.55, 1.0, 1.0);
  gl_FragColor = vec4(col * uIntensity, a * uOpacity);
}
`

interface ShieldUniforms {
  [key: string]: THREE.IUniform
  uTime: THREE.IUniform<number>
  uGrid: THREE.IUniform<number>
  uGridSpeed: THREE.IUniform<number>
  uIntensity: THREE.IUniform<number>
  uOpacity: THREE.IUniform<number>
  uColor: THREE.IUniform<THREE.Color>
  uHit: THREE.IUniform<THREE.Vector3>
  uHitTime: THREE.IUniform<number>
  uHitStrength: THREE.IUniform<number>
}

interface RippleRing {
  mesh: THREE.Mesh
  age: number
  active: boolean
}

function buildShield(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const radius = num(values, 'radius', 90)
  const gridScale = num(values, 'gridScale', 18)
  const gridSpeed = num(values, 'gridSpeed', 1)
  const intensity = num(values, 'intensity', 1.2)
  const opacity = num(values, 'opacity', 0.55)
  const color = str(values, 'color', '#3fd8ff')
  const hitInterval = Math.max(0.3, num(values, 'hitInterval', 2.4))
  const hitStrength = num(values, 'hitStrength', 1)
  const sparkCountGen = new ConstantValue(Math.round(num(values, 'sparkCount', 160)))
  const sparkSize = num(values, 'sparkSize', 1.2)
  const energyRateGen = new ConstantValue(num(values, 'energyRate', 320))
  const energyLifeGen = new IntervalValue(1.4, 3.4)

  const uniforms: ShieldUniforms = {
    uTime: { value: 0 },
    uGrid: { value: gridScale },
    uGridSpeed: { value: gridSpeed },
    uIntensity: { value: intensity },
    uOpacity: { value: opacity },
    uColor: { value: new THREE.Color(color) },
    uHit: { value: new THREE.Vector3(0, radius, 0) },
    uHitTime: { value: -10 },
    uHitStrength: { value: hitStrength }
  }
  const domeMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SHIELD_VERTEX,
    fragmentShader: SHIELD_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  })
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2),
    domeMaterial
  )

  const baseDisc = surface(new THREE.RingGeometry(radius * 0.96, radius * 1.04, 96), color, 0.5, THREE.AdditiveBlending)
  baseDisc.rotation.x = -Math.PI / 2
  baseDisc.position.y = 0.5

  const ripples: RippleRing[] = []
  for (let i = 0; i < 8; i += 1) {
    const ring = surface(new THREE.RingGeometry(0.86, 1, 48), '#ffffff', 0, THREE.AdditiveBlending)
    ring.visible = false
    ripples.push({ mesh: ring, age: 0, active: false })
  }

  const sparkColorRange = new ColorRange(hexToQ4('#ffffff'), hexToQ4(color))
  const impactBurst = new ParticleSystem({
    duration: 1.6,
    looping: false,
    autoDestroy: false,
    prewarm: false,
    worldSpace: true,
    shape: new SphereEmitter({ radius: radius * 0.03, thickness: 1 }),
    startLife: new IntervalValue(0.25, 0.9),
    startSpeed: new IntervalValue(20, 70),
    startSize: new IntervalValue(sparkSize * 0.4, sparkSize),
    startColor: sparkColorRange,
    emissionOverTime: new ConstantValue(0),
    emissionBursts: [{ time: 0, count: sparkCountGen, cycle: 1, interval: 0, probability: 1 }],
    behaviors: [
      new ApplyForce(q3(0, -1, 0), new ConstantValue(14)),
      new ColorOverLife(whiteAlpha([[1, 0], [0.9, 0.35], [0, 1]], 1)),
      new TurbulenceField(q3(5, 5, 5), 2, q3(1.4, 1.4, 1.4), q3(0.4, 0.4, 0.4))
    ],
    renderMode: RenderMode.StretchedBillBoard,
    material: additive(ctx.textures.spark),
    rendererEmitterSettings: { speedFactor: 1, lengthFactor: 0.1 }
  })

  const energyEmitter = new SphereEmitter({ radius, thickness: 1 })
  const energy = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: false,
    worldSpace: true,
    shape: energyEmitter,
    startLife: energyLifeGen,
    startSpeed: new IntervalValue(0.4, 3),
    startSize: new IntervalValue(sparkSize * 0.2, sparkSize * 0.7),
    startColor: sparkColorRange,
    emissionOverTime: energyRateGen,
    behaviors: [
      new ApplyForce(q3(0, 1, 0), new ConstantValue(2.2)),
      new ColorOverLife(whiteAlpha([[0, 0], [0.85, 0.2], [0.6, 0.7], [0, 1]], 1)),
      new TurbulenceField(q3(5, 5, 5), 2, q3(0.8, 1.1, 0.8), q3(0.3, 0.3, 0.3))
    ],
    renderMode: RenderMode.BillBoard,
    material: additive(ctx.textures.glow),
    rendererEmitterSettings: {}
  })

  const rand = seededRandom(90210)
  const cfg = { radius, color, intensity, opacity, gridScale, gridSpeed, hitInterval, hitStrength }
  let time = 0
  let hitTimer = hitInterval * 0.5

  const triggerHit = (): void => {
    const theta = rand() * Math.PI * 2
    const phi = 0.25 + rand() * 0.85
    const hit = new THREE.Vector3(
      Math.cos(theta) * Math.sin(phi) * cfg.radius,
      Math.cos(phi) * cfg.radius,
      Math.sin(theta) * Math.sin(phi) * cfg.radius
    )
    const normal = hit.clone().normalize()
    uniforms.uHit.value.copy(hit)
    uniforms.uHitTime.value = time
    uniforms.uHitStrength.value = cfg.hitStrength

    impactBurst.emitter.position.copy(hit)
    aim(impactBurst.emitter, normal)
    impactBurst.restart()

    for (const ripple of ripples) {
      if (!ripple.active) {
        ripple.active = true
        ripple.age = 0
        ripple.mesh.visible = true
        ripple.mesh.position.copy(hit)
        ripple.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
        break
      }
    }
  }

  const tick = (delta: number): void => {
    time += delta
    uniforms.uTime.value = time
    hitTimer += delta
    if (hitTimer >= cfg.hitInterval) {
      hitTimer = 0
      triggerHit()
    }
    for (const ripple of ripples) {
      if (!ripple.active) continue
      ripple.age += delta
      const p = ripple.age / 1.4
      if (p >= 1) {
        ripple.active = false
        ripple.mesh.visible = false
        setOpacity(ripple.mesh, 0)
        continue
      }
      const scale = cfg.radius * (0.06 + 0.55 * p)
      ripple.mesh.scale.setScalar(Math.max(0.01, scale))
      setOpacity(ripple.mesh, (1 - p) * 0.7)
    }
  }

  const update = (v: ParamValues): void => {
    cfg.color = str(v, 'color', '#3fd8ff')
    cfg.intensity = num(v, 'intensity', 1.2)
    cfg.opacity = num(v, 'opacity', 0.55)
    cfg.gridScale = num(v, 'gridScale', 18)
    cfg.gridSpeed = num(v, 'gridSpeed', 1)
    cfg.hitInterval = Math.max(0.3, num(v, 'hitInterval', 2.4))
    cfg.hitStrength = num(v, 'hitStrength', 1)

    uniforms.uColor.value.set(cfg.color)
    uniforms.uIntensity.value = cfg.intensity
    uniforms.uOpacity.value = cfg.opacity
    uniforms.uGrid.value = cfg.gridScale
    uniforms.uGridSpeed.value = cfg.gridSpeed
    uniforms.uHitStrength.value = cfg.hitStrength

    const rimCol = new THREE.Color(cfg.color).lerp(new THREE.Color('#ffffff'), 0.35)
    setColorRangeStops(sparkColorRange, '#ffffff', cfg.color)
    ;(baseDisc.material as THREE.MeshBasicMaterial).color.set(cfg.color)
    for (const ripple of ripples) (ripple.mesh.material as THREE.MeshBasicMaterial).color.copy(rimCol)
    setParticleOpacity(impactBurst, 1)
    setParticleOpacity(energy, 0.9)
    sparkCountGen.value = Math.round(num(v, 'sparkCount', 160))
    energyRateGen.value = num(v, 'energyRate', 320)
    energyLifeGen.a = 1.4
    energyLifeGen.b = 3.4
  }

  return { systems: [impactBurst, energy], objects: [dome, baseDisc, ...ripples.map((r) => r.mesh)], tick, update }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const SHOWCASE_META: Record<ShowcaseEffectId, EffectMeta> = {
  rocket: {
    id: 'rocket',
    title: 'VFX 火箭发射',
    subtitle: '时序点火 + 导流水雾 + 马赫盘 + 助推分离',
    description:
      '以可循环的时序编排还原火箭发射：点火阶段尾焰由弱到强、导流槽高压水雾向上翻涌，离架后箭体沿加速曲线爬升，跨音速窗口在箭体尾部闪烁马赫盘钻石激波，达到分离高度后助推器抛离并触发分离闪光，随后回落复位进入下一轮。推力、尾焰尺寸/颜色、导流水雾量/张角、火星量、爬升加速度、最大高度、循环周期与风速均可实时调整。',
    params: [
      { key: 'thrust', label: '推力强度', kind: 'number', min: 0.2, max: 2, step: 0.05, default: 1 },
      { key: 'flameSize', label: '尾焰尺寸', kind: 'number', min: 0.4, max: 2.5, step: 0.05, default: 1 },
      { key: 'flameColor', label: '尾焰颜色', kind: 'color', default: '#ff8a2a' },
      { key: 'sprayRate', label: '导流水雾量', kind: 'number', min: 0, max: 5000, step: 100, default: 2400 },
      { key: 'spraySpread', label: '水雾张角', kind: 'number', min: 10, max: 90, step: 1, unit: '°', default: 46 },
      { key: 'sparkRate', label: '火星量', kind: 'number', min: 0, max: 2500, step: 50, default: 900 },
      { key: 'riseAccel', label: '爬升加速度', kind: 'number', min: 5, max: 60, step: 1, unit: 'm/s²', default: 26 },
      { key: 'maxAltitude', label: '最大高度', kind: 'number', min: 200, max: 2000, step: 50, default: 900 },
      { key: 'machRings', label: '马赫盘环数', kind: 'number', min: 0, max: 8, step: 1, default: 5 },
      { key: 'wind', label: '风速', kind: 'number', min: 0, max: 15, step: 0.5, default: 3 },
      { key: 'loopTime', label: '循环周期', kind: 'number', min: 12, max: 60, step: 1, unit: '秒', default: 30 }
    ],
    rebuildKeys: ['machRings']
  },
  godray: {
    id: 'godray',
    title: 'VFX 丁达尔光柱',
    subtitle: '晨昏光柱 + 光锥 + 尘埃浮动',
    description:
      '以三片交叉的渐变光幕与太阳辉光构成晨昏光柱，光幕内部带流动的絮状噪声结构，配合缓慢摆动的整体姿态模拟大气折射；光柱体内散布大量缓慢浮沉、明暗闪烁的尘埃微粒，让空气具有可见的介质感。光柱高度/宽度、亮度/不透明度、噪声强度、尘埃数量/尺寸/不透明度、太阳高度角与光柱上下颜色均可实时调整。',
    params: [
      { key: 'pillarHeight', label: '光柱高度', kind: 'number', min: 600, max: 5000, step: 100, default: 2600, tip: '光幕从地面延伸的高度，决定光柱的纵向尺度。' },
      { key: 'pillarWidth', label: '光柱宽度', kind: 'number', min: 100, max: 1200, step: 20, default: 420, tip: '单片光幕的横向宽度，三片交叉叠加后决定光柱的粗壮程度。' },
      { key: 'intensity', label: '光柱亮度', kind: 'number', min: 0.1, max: 3, step: 0.05, default: 1.1, tip: '光幕的颜色增益，越高越明亮刺眼。' },
      { key: 'opacity', label: '光柱不透明度', kind: 'number', min: 0.05, max: 1, step: 0.05, default: 0.5, tip: '光幕的透明程度，越低越轻柔通透。' },
      { key: 'noise', label: '絮状结构强度', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.7, tip: '光幕内部流动絮状噪声的对比强度，越大层次越明显。' },
      { key: 'dustCount', label: '尘埃数量', kind: 'number', min: 0, max: 3000, step: 50, default: 900, tip: '光柱内悬浮尘埃的每秒生成量，越高空气介质感越强（对性能影响较大）。' },
      { key: 'dustSize', label: '尘埃尺寸', kind: 'number', min: 0.2, max: 6, step: 0.1, default: 1.4, tip: '尘埃微粒的大小。' },
      { key: 'dustOpacity', label: '尘埃不透明度', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.7, tip: '尘埃微粒的亮度与可见度。' },
      { key: 'sunElevation', label: '太阳高度角', kind: 'number', min: 0, max: 20, step: 0.5, unit: '°', default: 4, tip: '太阳相对地平线的高度角，角度越低光色越暖、丁达尔效应越强。' },
      { key: 'bottomColor', label: '底部颜色', kind: 'color', default: '#ffd9a0', tip: '光柱底部的暖色基调。' },
      { key: 'topColor', label: '顶部颜色', kind: 'color', default: '#ff7ec0', tip: '光柱顶部的冷色基调。' }
    ],
    rebuildKeys: ['pillarWidth', 'pillarHeight']
  },
  shield: {
    id: 'shield',
    title: 'VFX 能量护盾',
    subtitle: '半球网格 + 菲涅尔边缘 + 命中涟漪电弧',
    description:
      '半球护盾以自定义着色器绘制滚动六边形风格网格与菲涅尔边缘辉光，命中点在球面触发扩散涟漪并抛射电弧火花，涟漪以环状网格向外扩张；球面持续有能量微粒上升，营造电离气体流动感。半径、网格密度/滚动速度、辉光强度/不透明度、命中间隔与强度、电弧火花数/尺寸、能量微粒量、护盾颜色均可实时调整。',
    params: [
      { key: 'radius', label: '护盾半径', kind: 'number', min: 30, max: 220, step: 5, default: 90, tip: '半球护盾的半径，修改后会重建护盾。' },
      { key: 'gridScale', label: '网格密度', kind: 'number', min: 6, max: 48, step: 1, default: 18, tip: '球面能量网格的疏密程度，越大格子越密。' },
      { key: 'gridSpeed', label: '网格流速', kind: 'number', min: 0, max: 4, step: 0.1, default: 1, tip: '网格纹理滚动的速度，表现能量在护盾表面流动。' },
      { key: 'intensity', label: '辉光强度', kind: 'number', min: 0.2, max: 3, step: 0.05, default: 1.2, tip: '护盾边缘与网格的整体亮度增益。' },
      { key: 'opacity', label: '不透明度', kind: 'number', min: 0.05, max: 1, step: 0.05, default: 0.55, tip: '护盾的透明程度，越低越轻薄通透。' },
      { key: 'hitInterval', label: '命中间隔', kind: 'number', min: 0.3, max: 8, step: 0.1, unit: '秒', default: 2.4, tip: '模拟被击中的间隔秒数，越小命中越频繁。' },
      { key: 'hitStrength', label: '命中强度', kind: 'number', min: 0.2, max: 3, step: 0.1, default: 1, tip: '命中涟漪与电火花的强度。' },
      { key: 'sparkCount', label: '电弧火花数', kind: 'number', min: 20, max: 600, step: 10, default: 160, tip: '每次命中抛射的火花粒子数量（对性能影响较大）。' },
      { key: 'sparkSize', label: '火花尺寸', kind: 'number', min: 0.2, max: 4, step: 0.1, default: 1.2, tip: '火花粒子的大小。' },
      { key: 'energyRate', label: '能量微粒量', kind: 'number', min: 0, max: 1500, step: 20, default: 320, tip: '护盾表面持续上升的能量微粒每秒生成量。' },
      { key: 'color', label: '护盾颜色', kind: 'color', default: '#3fd8ff', tip: '护盾的基础色，决定网格、边缘与火花的色调。' }
    ],
    rebuildKeys: ['radius']
  }
}

export const SHOWCASE_EFFECT_IDS: ShowcaseEffectId[] = ['rocket', 'godray', 'shield']

export function buildShowcaseEffect(
  id: ShowcaseEffectId,
  values: ParamValues,
  ctx: EffectBuildContext
): BuiltEffect {
  switch (id) {
    case 'rocket':
      return buildRocket(values, ctx)
    case 'godray':
      return buildGodray(values, ctx)
    case 'shield':
      return buildShield(values, ctx)
    default: {
      const exhaustive: never = id
      return exhaustive
    }
  }
}
