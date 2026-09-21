import * as THREE from 'three'
import {
  ApplyForce,
  ColorOverLife,
  ColorRange,
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
  Vector3 as QVector3
} from 'three.quarks'
import {
  additive,
  gradientFromHex,
  hexToQ4,
  mixHex,
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

export type DisasterEffectId = 'tsunami' | 'collapse' | 'nuke'

/**
 * prewarm 打开时 quarks 会以 60fps 逐帧模拟 duration 秒，全部在打开瞬间同步执行，
 * 因此需要预热的连续发射系统必须把 duration 压到很小。
 */
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
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending,
      toneMapped: false
    })
  )
}

function tint(mesh: THREE.Mesh, color: string): void {
  ;(mesh.material as THREE.MeshBasicMaterial).color.set(color)
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

/* ------------------------------------------------------------------ */
/* B01 海啸推进                                                        */
/* ------------------------------------------------------------------ */

interface TsunamiBlock {
  mesh: THREE.Mesh
  baseHeight: number
  dry: THREE.Color
  z: number
}

/**
 * 三维溃坝涌浪：以高度场位移 + 逐像素光照/泡沫生成有体积感的浪面。
 * 浪面在推进锋面处陡直抬升、向后缓慢回落，配合法线光照、菲涅尔与碎浪白沫，
 * 避免平面水面的“贴纸”观感。
 */
const WAVE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uFront;
uniform float uWidth;
uniform float uReach;
uniform float uHeight;
uniform float uFace;
uniform float uBack;
uniform float uChop;
varying vec3 vPosW;
varying vec3 vNormalW;
varying float vHeightNorm;
varying float vFoam;
varying float vBehind;

float waveHeight(float xw, float zw) {
  float d = zw - uFront;
  float rise = smoothstep(0.0, uFace, d);
  float fall = exp(-max(d - uFace, 0.0) / max(1.0, uBack));
  float lat = cos(clamp(xw / max(1.0, uWidth * 0.5), -1.0, 1.0) * 3.14159265);
  float shape = rise * fall * (0.76 + 0.24 * lat);
  float chop = uChop * sin(zw * 0.21 + uTime * 2.4) * sin(xw * 0.16 - uTime * 1.6);
  return uHeight * shape + chop * rise * fall;
}

void main() {
  float xw = position.x * uWidth;
  float zw = position.z * uReach;
  float h = waveHeight(xw, zw);

  float eps = max(1.0, uReach * 0.004);
  float hx = waveHeight(xw + eps, zw) - waveHeight(xw - eps, zw);
  float hz = waveHeight(xw, zw + eps) - waveHeight(xw, zw - eps);
  vec3 n = normalize(vec3(-hx, 2.0 * eps, -hz));

  vPosW = vec3(xw, h, zw);
  vNormalW = n;
  vHeightNorm = clamp(h / max(0.001, uHeight), 0.0, 1.4);
  vBehind = zw - uFront;
  float slope = length(vec2(hx, hz)) / (2.0 * eps);
  float crest = smoothstep(0.35, 0.9, vHeightNorm);
  vFoam = clamp(crest * 0.75 + smoothstep(0.5, 1.3, slope) * 0.65, 0.0, 1.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(vPosW, 1.0);
}
`

const WAVE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoamColor;
uniform vec3 uLightDir;
varying vec3 vPosW;
varying vec3 vNormalW;
varying float vHeightNorm;
varying float vFoam;
varying float vBehind;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  if (vBehind < -0.5) discard;
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 L = normalize(uLightDir);
  float depthMix = clamp(vHeightNorm * 1.15, 0.0, 1.0);
  vec3 col = mix(uDeep, uShallow, depthMix);
  float diffuse = 0.42 + 0.58 * clamp(dot(N, L), 0.0, 1.0);
  vec3 H = normalize(L + V);
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 48.0) * 0.9;
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  float ripple = noise(vec2(vPosW.x * 0.06 + uTime * 0.5, vPosW.z * 0.08 - uTime * 0.7));
  float foam = clamp(vFoam * (0.55 + 0.65 * ripple), 0.0, 1.0);
  vec3 water = col * diffuse + vec3(spec) + fres * vec3(0.32, 0.48, 0.6);
  vec3 outc = mix(water, uFoamColor, foam);
  float edge = smoothstep(-0.5, 5.0, vBehind);
  float alpha = clamp((0.4 + 0.5 * depthMix + foam * 0.35) * edge, 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(outc, alpha);
}
`

function buildTsunami(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const width = num(values, 'width', 320)
  const reach = num(values, 'reach', 240)
  const waveHeight = num(values, 'waveHeight', 12)
  const waveLength = num(values, 'waveLength', 70)
  const chop = num(values, 'chop', 1.4)
  const speed = num(values, 'speed', 26)
  const foamRate = num(values, 'foamRate', 3600)
  const foamSize = num(values, 'foamSize', 3)
  const foamLife = num(values, 'foamLife', 2.6)
  const sprayRate = num(values, 'sprayRate', 1400)
  const spraySpeed = num(values, 'spraySpeed', 13)
  const debrisRate = num(values, 'debrisRate', 160)
  const debrisSize = num(values, 'debrisSize', 2.4)
  const debrisLife = num(values, 'debrisLife', 3.4)
  const blocks = Math.round(num(values, 'blocks', 7))
  const blockHeight = num(values, 'blockHeight', 26)
  const waterColor = str(values, 'waterColor', '#2f6f93')
  const siltColor = str(values, 'siltColor', '#ac8a5c')
  const opacity = num(values, 'opacity', 0.72)

  const startZ = reach / 2

  const uniforms = {
    uTime: { value: 0 },
    uFront: { value: startZ },
    uWidth: { value: width },
    uReach: { value: reach },
    uHeight: { value: waveHeight },
    uFace: { value: Math.max(2, waveHeight * 0.3) },
    uBack: { value: waveLength },
    uChop: { value: chop },
    uOpacity: { value: opacity },
    uDeep: { value: new THREE.Color(shade(waterColor, 0.44)) },
    uShallow: { value: new THREE.Color(mixCrest(waterColor)) },
    uFoamColor: { value: new THREE.Color('#eef7fc') },
    uLightDir: { value: new THREE.Vector3(0.45, 0.82, 0.35) }
  }
  const waveGeometry = new THREE.PlaneGeometry(1, 1, 240, 80)
  waveGeometry.rotateX(-Math.PI / 2)
  const wave = new THREE.Mesh(
    waveGeometry,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: WAVE_VERTEX,
      fragmentShader: WAVE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false
    })
  )

  const floodGeometry = new THREE.PlaneGeometry(1, 1)
  floodGeometry.rotateX(-Math.PI / 2)
  const flood = surface(floodGeometry, waterColor, opacity * 0.7)
  flood.position.y = 0.25

  const city = new THREE.Group()
  const blockList: TsunamiBlock[] = []
  const rand = seededRandom(9137)
  for (let i = 0; i < 10; i += 1) {
    const h = blockHeight * (0.45 + rand() * 0.55)
    const w = 12 + rand() * 10
    const mesh = surface(new THREE.BoxGeometry(w, h, w), '#8f9aa6', 1)
    const x = (i - 4.5) * (width / 11)
    const z = (rand() - 0.35) * reach * 0.4
    mesh.position.set(x, h / 2, z)
    mesh.visible = i < blocks
    city.add(mesh)
    blockList.push({ mesh, baseHeight: h, dry: new THREE.Color('#8f9aa6'), z })
  }

  const foamRateGen = new ConstantValue(foamRate)
  const foamLifeGen = new IntervalValue(foamLife * 0.5, foamLife)
  const foamSizeGen = new IntervalValue(foamSize * 0.5, foamSize)
  const foamEmitter = new RectangleEmitter({ width, height: 6, thickness: 2 })
  const foam = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: false,
    worldSpace: true,
    shape: foamEmitter,
    startLife: foamLifeGen,
    startSpeed: new IntervalValue(2, 7),
    startSize: foamSizeGen,
    startColor: new ColorRange(hexToQ4('#ffffff'), hexToQ4('#dbeaf4')),
    emissionOverTime: foamRateGen,
    behaviors: [
      sizeCurve(0.7, 1, 1.05, 0.4),
      new ColorOverLife(whiteAlpha([[0.7, 0], [0.8, 0.15], [0.4, 0.65], [0, 1]], 1)),
      new TurbulenceField(q3(2.2, 1.2, 2.2), 2, q3(0.5, 0.35, 0.5), q3(0.6, 0.6, 0.6))
    ],
    renderMode: RenderMode.StretchedBillBoard,
    material: additive(ctx.textures.soft, 0.85),
    rendererEmitterSettings: { speedFactor: 1, lengthFactor: 0.06 }
  })

  aim(foam.emitter, new THREE.Vector3(0, 0.52, -0.85))

  const sprayRateGen = new ConstantValue(sprayRate)
  const spraySpeedGen = new IntervalValue(spraySpeed * 0.5, spraySpeed * 1.4)
  const spraySizeGen = new IntervalValue(1.2, 3.4)
  const spray = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: false,
    worldSpace: true,
    shape: new PointEmitter(),
    startLife: new IntervalValue(0.6, 1.8),
    startSpeed: spraySpeedGen,
    startSize: spraySizeGen,
    startColor: new ColorRange(hexToQ4('#ffffff'), hexToQ4('#cfe4ef')),
    emissionOverTime: sprayRateGen,
    behaviors: [
      new ApplyForce(q3(0, -1, 0), new ConstantValue(11)),
      sizeCurve(0.5, 0.9, 0.55, 0),
      new ColorOverLife(whiteAlpha([[0.75, 0], [0.6, 0.3], [0.25, 0.7], [0, 1]], 1))
    ],
    renderMode: RenderMode.BillBoard,
    material: additive(ctx.textures.soft, 0.7),
    rendererEmitterSettings: {}
  })
  aim(spray.emitter, new THREE.Vector3(0, 0.7, -0.7))

  const debrisRateGen = new ConstantValue(debrisRate)
  const debrisLifeGen = new IntervalValue(debrisLife * 0.55, debrisLife)
  const debrisSizeGen = new IntervalValue(debrisSize * 0.6, debrisSize * 1.6)
  const debris = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: false,
    worldSpace: true,
    shape: new PointEmitter(),
    startLife: debrisLifeGen,
    startSpeed: new IntervalValue(1.5, 6),
    startSize: debrisSizeGen,
    startColor: new ColorRange(hexToQ4(siltColor), hexToQ4(mixSilt(siltColor))),
    emissionOverTime: debrisRateGen,
    behaviors: [
      new ApplyForce(q3(0, -1, 0), new ConstantValue(3.2)),
      sizeCurve(0.8, 1, 1.2, 1.6),
      new ColorOverLife(
        gradientFromHex(
          [
            [siltColor, 0],
            [mixSilt(siltColor), 0.35],
            ['#5d4527', 1]
          ],
          [
            [1, 0],
            [0.85, 0.35],
            [0, 1]
          ],
          1
        )
      ),
      new TurbulenceField(q3(3.5, 1.4, 3.5), 2, q3(1.4, 0.5, 1.4), q3(0.5, 0.5, 0.5))
    ],
    renderMode: RenderMode.BillBoard,
    material: normalBlend(ctx.textures.smoke, 0.9),
    rendererEmitterSettings: {}
  })
  aim(debris.emitter, new THREE.Vector3(0, 0.4, -0.9))

  const cfg = { width, reach, waveHeight, waveLength, chop, speed, foamRate, sprayRate, debrisRate, blockHeight, startZ }
  const state = { frontZ: startZ, time: 0 }

  const placeFront = (): void => {
    uniforms.uFront.value = state.frontZ
    const length = Math.max(0.001, cfg.startZ - state.frontZ)
    flood.scale.set(cfg.width, 1, length)
    flood.position.z = (cfg.startZ + state.frontZ) / 2
    foam.emitter.position.set(0, 1.2, state.frontZ)
    spray.emitter.position.set(0, 1.5, state.frontZ)
    debris.emitter.position.set(0, 0.8, state.frontZ)
  }

  const resetRun = (): void => {
    state.frontZ = cfg.startZ
    foam.restart()
    spray.restart()
    debris.restart()
    for (const block of blockList) tint(block.mesh, '#8f9aa6')
    placeFront()
  }

  placeFront()

  const tick = (delta: number): void => {
    state.time += delta
    state.frontZ -= cfg.speed * delta
    if (state.frontZ < -cfg.startZ - 30) resetRun()
    placeFront()
    uniforms.uTime.value = state.time
    uniforms.uOpacity.value = clamp01(0.9 + 0.1 * Math.sin(state.time * 6)) * opacity
    setOpacity(flood, opacity * 0.7)
    for (const block of blockList) {
      const submerged = clamp01((block.z - state.frontZ) / 18)
      if (submerged > 0) {
        const wet = new THREE.Color('#2b3f4c')
        ;(block.mesh.material as THREE.MeshBasicMaterial).color.copy(block.dry).lerp(wet, submerged)
      }
    }
  }

  const update = (v: ParamValues): void => {
    cfg.width = num(v, 'width', 320)
    cfg.reach = num(v, 'reach', 240)
    cfg.waveHeight = num(v, 'waveHeight', 12)
    cfg.waveLength = num(v, 'waveLength', 70)
    cfg.chop = num(v, 'chop', 1.4)
    cfg.speed = num(v, 'speed', 26)
    cfg.startZ = cfg.reach / 2
    cfg.blockHeight = num(v, 'blockHeight', 26)
    foamEmitter.width = cfg.width
    foamRateGen.value = num(v, 'foamRate', 3600)
    sprayRateGen.value = num(v, 'sprayRate', 1400)
    debrisRateGen.value = num(v, 'debrisRate', 160)
    const fl = num(v, 'foamLife', 2.6)
    foamLifeGen.a = fl * 0.5
    foamLifeGen.b = fl
    const fs = num(v, 'foamSize', 3)
    foamSizeGen.a = fs * 0.5
    foamSizeGen.b = fs
    const spraySpeed = num(v, 'spraySpeed', 13)
    spraySpeedGen.a = spraySpeed * 0.5
    spraySpeedGen.b = spraySpeed * 1.4
    const ds = num(v, 'debrisSize', 2.4)
    debrisSizeGen.a = ds * 0.6
    debrisSizeGen.b = ds * 1.6
    const dl = num(v, 'debrisLife', 3.4)
    debrisLifeGen.a = dl * 0.55
    debrisLifeGen.b = dl
    const nextWater = str(v, 'waterColor', '#2f6f93')
    tint(flood, nextWater)
    uniforms.uWidth.value = cfg.width
    uniforms.uReach.value = cfg.reach
    uniforms.uHeight.value = cfg.waveHeight
    uniforms.uFace.value = Math.max(2, cfg.waveHeight * 0.3)
    uniforms.uBack.value = cfg.waveLength
    uniforms.uChop.value = cfg.chop
    uniforms.uDeep.value.set(shade(nextWater, 0.44))
    uniforms.uShallow.value.set(mixCrest(nextWater))
    const nextSilt = str(v, 'siltColor', '#ac8a5c')
    setColorRangeStops(debris.startColor as ColorRange, nextSilt, mixSilt(nextSilt))
    const op = num(v, 'opacity', 0.72)
    uniforms.uOpacity.value = op
    setOpacity(flood, op * 0.7)
    ;(foam.material as THREE.MeshBasicMaterial).opacity = clamp01(op + 0.1)
    ;(spray.material as THREE.MeshBasicMaterial).opacity = clamp01(op)
    ;(debris.material as THREE.MeshBasicMaterial).opacity = clamp01(op + 0.15)
    const count = Math.round(num(v, 'blocks', 7))
    for (let i = 0; i < blockList.length; i += 1) blockList[i].mesh.visible = i < count
    const scale = cfg.blockHeight / 26
    for (const block of blockList) {
      const h = block.baseHeight * scale
      block.mesh.scale.y = scale
      block.mesh.position.y = h / 2
    }
  }

  return { systems: [foam, spray, debris], objects: [wave, flood, city], tick, update }
}

function shade(hex: string, factor: number): string {
  const color = new THREE.Color(hex).multiplyScalar(factor)
  return `#${color.getHexString()}`
}

function mixCrest(waterColor: string): string {
  const color = new THREE.Color(waterColor)
  color.lerp(new THREE.Color('#ffffff'), 0.72)
  return `#${color.getHexString()}`
}

function mixSilt(siltColor: string): string {
  const color = new THREE.Color(siltColor)
  color.lerp(new THREE.Color('#3f2c14'), 0.55)
  return `#${color.getHexString()}`
}

/* ------------------------------------------------------------------ */
/* B02 建筑碎裂坍塌                                                     */
/* ------------------------------------------------------------------ */

interface ChunkItem {
  mesh: THREE.Mesh
  size: number
  x0: number
  y0: number
  z0: number
  vx: number
  vy: number
  vz: number
  rx: number
  rz: number
  landed: boolean
}

function buildCollapse(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const floors = Math.max(4, Math.round(num(values, 'floors', 12)))
  const chunkCount = Math.max(8, Math.round(num(values, 'chunks', 40)))
  const collapseTime = num(values, 'collapseTime', 4)
  const hold = num(values, 'hold', 7)
  const dustRate = num(values, 'dustRate', 380)
  const dustSize = num(values, 'dustSize', 24)
  const dustLife = num(values, 'dustLife', 9)
  const dustOpacity = num(values, 'dustOpacity', 0.85)
  const wind = num(values, 'wind', 4)
  const blastForce = num(values, 'blastForce', 26)
  const shockRadius = num(values, 'shockRadius', 120)
  const shockSpeed = num(values, 'shockSpeed', 90)
  const flashPower = num(values, 'flash', 1)
  const dustColor = str(values, 'dustColor', '#a9967c')

  const floorH = 5
  const towerW = 15
  const tower = new THREE.Group()
  const floorMeshes: THREE.Mesh[] = []
  for (let i = 0; i < floors; i += 1) {
    const shade = 0.55 + 0.35 * (i / Math.max(1, floors - 1))
    const color = new THREE.Color('#7f8b96').multiplyScalar(shade)
    const mesh = surface(new THREE.BoxGeometry(towerW, floorH * 0.92, towerW), `#${color.getHexString()}`, 1)
    mesh.position.y = i * floorH + floorH / 2
    tower.add(mesh)
    floorMeshes.push(mesh)
  }
  const roof = surface(new THREE.BoxGeometry(towerW * 0.6, floorH * 0.5, towerW * 0.6), '#5f6a74', 1)
  roof.position.y = floors * floorH + floorH * 0.2
  tower.add(roof)

  const rand = seededRandom(44711)
  const debris = new THREE.Group()
  const chunkList: ChunkItem[] = []
  for (let i = 0; i < chunkCount; i += 1) {
    const size = 2 + rand() * 3.4
    const shade = 0.5 + rand() * 0.4
    const color = new THREE.Color('#8b8f8a').multiplyScalar(shade)
    const mesh = surface(new THREE.BoxGeometry(size, size * (0.6 + rand() * 0.5), size), `#${color.getHexString()}`, 1)
    mesh.visible = false
    debris.add(mesh)
    chunkList.push({ mesh, size, x0: 0, y0: 0, z0: 0, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, landed: false })
  }

  const flashSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: ctx.textures.glow,
      color: new THREE.Color('#ffd9a0'),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    })
  )
  flashSprite.position.set(0, 2, 0)
  flashSprite.scale.setScalar(10)

  const groundRing = surface(new THREE.RingGeometry(0.86, 1, 96), '#d8c6a6', 0, THREE.AdditiveBlending)
  groundRing.rotation.x = -Math.PI / 2
  groundRing.position.y = 0.4

  const plumeRate = new ConstantValue(0)
  const plumeLifeGen = new IntervalValue(dustLife * 0.6, dustLife)
  const plumeSizeGen = new IntervalValue(dustSize * 0.5, dustSize * 1.5)
  const windForce = new ConstantValue(wind)
  const plumeEmitter = new RectangleEmitter({ width: towerW * 1.6, height: towerW * 1.6, thickness: 2 })
  const plume = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: false,
    worldSpace: true,
    shape: plumeEmitter,
    startLife: plumeLifeGen,
    startSpeed: new IntervalValue(1.5, 5),
    startSize: plumeSizeGen,
    startColor: new ColorRange(hexToQ4(dustColor), hexToQ4(mixDust(dustColor))),
    emissionOverTime: plumeRate,
    behaviors: [
      new ApplyForce(q3(0, 1, 0), new ConstantValue(4.5)),
      new ApplyForce(q3(0.85, 0, 0.5), windForce),
      sizeCurve(0.1, 0.6, 1.3, 2.6),
      new ColorOverLife(
        gradientFromHex(
          [
            [dustColor, 0],
            [mixDust(dustColor), 0.15],
            ['#6b5c46', 1]
          ],
          [
            [0, 0],
            [0.7, 0.15],
            [0, 1]
          ],
          1
        )
      ),
      new TurbulenceField(q3(3.5, 3.5, 3.5), 1, q3(0.9, 0.6, 0.9), q3(0.3, 0.3, 0.3))
    ],
    renderMode: RenderMode.BillBoard,
    material: normalBlend(ctx.textures.smoke, dustOpacity),
    rendererEmitterSettings: {}
  })

  const shockRate = new ConstantValue(0)
  const shock = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: false,
    worldSpace: true,
    shape: new SphereEmitter({ radius: 6, thickness: 1 }),
    startLife: new IntervalValue(1.6, 3.6),
    startSpeed: new IntervalValue(12, 26),
    startSize: new IntervalValue(dustSize * 0.3, dustSize * 0.8),
    startColor: new ColorRange(hexToQ4(dustColor), hexToQ4(mixDust(dustColor))),
    emissionOverTime: shockRate,
    behaviors: [
      new ApplyForce(q3(0, -1, 0), new ConstantValue(1.4)),
      sizeCurve(0.6, 1, 1.3, 1.6),
      new ColorOverLife(whiteAlpha([[0.85, 0], [0.7, 0.25], [0, 1]], 1)),
      new TurbulenceField(q3(2.4, 1.2, 2.4), 1, q3(0.7, 0.4, 0.7), q3(0.4, 0.4, 0.4))
    ],
    renderMode: RenderMode.BillBoard,
    material: normalBlend(ctx.textures.smoke, dustOpacity * 0.9),
    rendererEmitterSettings: {}
  })

  const state = { t: 0, impact: false, dustLevel: 0 }
  const cfg = { collapseTime, hold, blastForce, shockRadius, shockSpeed, dustRate, wind, dustOpacity }
  const cycle = (): number => 1.4 + cfg.collapseTime + cfg.hold

  const resetRun = (): void => {
    state.t = 0
    state.impact = false
    state.dustLevel = 0
    tower.visible = true
    tower.rotation.z = 0
    tower.position.y = 0
    roof.visible = true
    for (let i = 0; i < floorMeshes.length; i += 1) floorMeshes[i].visible = true
    for (const chunk of chunkList) {
      chunk.mesh.visible = false
      chunk.landed = false
    }
    plumeRate.value = 0
    shockRate.value = 0
    setOpacity(groundRing, 0)
    ;(flashSprite.material as THREE.SpriteMaterial).opacity = 0
  }

  const impact = (): void => {
    state.impact = true
    tower.visible = false
    shockRate.value = dustRate * 1.2
    plumeRate.value = dustRate
    const r = seededRandom(991)
    for (const chunk of chunkList) {
      chunk.mesh.visible = true
      chunk.x0 = (r() - 0.5) * towerW * 0.7
      chunk.y0 = r() * floors * floorH * 0.8
      chunk.z0 = (r() - 0.5) * towerW * 0.7
      const angle = Math.atan2(chunk.z0, chunk.x0)
      const horizontal = cfg.blastForce * (0.5 + r() * 0.9)
      chunk.vx = Math.cos(angle) * horizontal
      chunk.vz = Math.sin(angle) * horizontal
      chunk.vy = cfg.blastForce * (0.6 + r() * 1.1)
      chunk.rx = (r() - 0.5) * 6
      chunk.rz = (r() - 0.5) * 6
      chunk.landed = false
      chunk.mesh.position.set(chunk.x0, chunk.y0, chunk.z0)
    }
  }

  resetRun()

  const tick = (delta: number): void => {
    state.t += delta
    const total = cycle()
    if (state.t > total) resetRun()
    const t = state.t

    if (t < 1.4) {
      const p = t / 1.4
      tower.rotation.z = 0.02 * p * Math.sin(t * 40)
      ;(flashSprite.material as THREE.SpriteMaterial).opacity = flashPower * 0.12 * p
      flashSprite.scale.setScalar(8 + 10 * p)
    } else {
      ;(flashSprite.material as THREE.SpriteMaterial).opacity *= 0.86
      const p = clamp01((t - 1.4) / cfg.collapseTime)
      tower.visible = !state.impact
      tower.rotation.z = 0.16 * p
      tower.position.y = -floors * floorH * 0.16 * p
      const shown = Math.max(0, Math.ceil(floors * (1 - p * 1.15)))
      for (let i = 0; i < floorMeshes.length; i += 1) floorMeshes[i].visible = i < shown
      if (!state.impact && p >= 0.75) impact()

      const shockT = t - 1.4 - cfg.collapseTime * 0.75
      if (shockT >= 0) {
        const radius = Math.min(cfg.shockRadius, cfg.shockSpeed * shockT)
        groundRing.scale.setScalar(Math.max(0.01, radius))
        setOpacity(groundRing, clamp01(0.7 * (1 - radius / Math.max(1, cfg.shockRadius))))
      }
      if (state.impact) {
        const fade = 1 - smoothstep(cfg.collapseTime * 0.6, cfg.collapseTime * 1.8, p * cfg.collapseTime)
        plumeRate.value = cfg.dustRate * clamp01(fade)
        shockRate.value = cfg.dustRate * 1.2 * clamp01(1 - shockT / 1.4)
      }
    }

    for (const chunk of chunkList) {
      if (!chunk.mesh.visible || chunk.landed) continue
      chunk.vy -= 22 * delta
      chunk.mesh.position.x += chunk.vx * delta
      chunk.mesh.position.y += chunk.vy * delta
      chunk.mesh.position.z += chunk.vz * delta
      chunk.mesh.rotation.x += chunk.rx * delta
      chunk.mesh.rotation.z += chunk.rz * delta
      const floorY = chunk.size / 2
      if (chunk.mesh.position.y <= floorY) {
        chunk.mesh.position.y = floorY
        chunk.landed = true
        chunk.vx = 0
        chunk.vz = 0
        chunk.vy = 0
      }
    }
  }

  const update = (v: ParamValues): void => {
    cfg.collapseTime = num(v, 'collapseTime', 4)
    cfg.hold = num(v, 'hold', 7)
    cfg.blastForce = num(v, 'blastForce', 26)
    cfg.shockRadius = num(v, 'shockRadius', 120)
    cfg.shockSpeed = num(v, 'shockSpeed', 90)
    cfg.dustRate = num(v, 'dustRate', 380)
    cfg.wind = num(v, 'wind', 4)
    cfg.dustOpacity = num(v, 'dustOpacity', 0.85)

    const ds = num(v, 'dustSize', 24)
    plumeSizeGen.a = ds * 0.5
    plumeSizeGen.b = ds * 1.5
    const dl = num(v, 'dustLife', 9)
    plumeLifeGen.a = dl * 0.6
    plumeLifeGen.b = dl
    const color = str(v, 'dustColor', '#a9967c')
    setColorRangeStops(plume.startColor as ColorRange, color, mixDust(color))
    setColorRangeStops(shock.startColor as ColorRange, color, mixDust(color))
    setParticleOpacity(plume, cfg.dustOpacity)
    setParticleOpacity(shock, cfg.dustOpacity * 0.9)
    windForce.value = cfg.wind
  }

  plume.emitter.rotation.x = -Math.PI / 2

  return {
    systems: [plume, shock],
    objects: [tower, debris, flashSprite, groundRing],
    tick,
    update
  }
}

function mixDust(dustColor: string): string {
  const color = new THREE.Color(dustColor)
  color.lerp(new THREE.Color('#5b4a34'), 0.6)
  return `#${color.getHexString()}`
}

/* ------------------------------------------------------------------ */
/* B05 核爆蘑菇云                                                       */
/* ------------------------------------------------------------------ */

function buildNuke(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const fireballSize = num(values, 'fireballSize', 170)
  const fireUp = num(values, 'fireUp', 360)
  const fireballLife = num(values, 'fireballLife', 2.4)
  const stemRate = num(values, 'stemRate', 140)
  const stemSize = num(values, 'stemSize', 64)
  const stemRadius = num(values, 'stemRadius', 70)
  const capRate = num(values, 'capRate', 160)
  const capSize = num(values, 'capSize', 96)
  const capRadius = num(values, 'capRadius', 280)
  const capHeight = num(values, 'capHeight', 820)
  const capLife = num(values, 'capLife', 14)
  const rollSpeed = num(values, 'rollSpeed', 0.8)
  const shockRadius = num(values, 'shockRadius', 1600)
  const shockSpeed = num(values, 'shockSpeed', 650)
  const groundDustRate = num(values, 'groundDustRate', 90)
  const groundDustSize = num(values, 'groundDustSize', 84)
  const falloutRate = num(values, 'falloutRate', 40)
  const falloutLife = num(values, 'falloutLife', 34)
  const wind = num(values, 'wind', 7)
  const smokeColor = str(values, 'smokeColor', '#948a7c')
  const glowColor = str(values, 'glowColor', '#ff9a3c')
  const loopTime = num(values, 'loopTime', 70)

  const fireballCore = surface(new THREE.SphereGeometry(1, 32, 24), '#ffffff', 0.95, THREE.AdditiveBlending)
  const fireballOuter = surface(new THREE.SphereGeometry(1, 24, 18), '#ffb347', 0.55, THREE.AdditiveBlending)
  const fireballGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: ctx.textures.glow,
      color: new THREE.Color(glowColor),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    })
  )
  const scorch = surface(new THREE.CircleGeometry(1, 64), '#2c2118', 0.6)
  scorch.rotation.x = -Math.PI / 2
  scorch.position.y = 0.5
  const groundRing = surface(new THREE.RingGeometry(0.9, 1, 96), '#f4d9a6', 0, THREE.AdditiveBlending)
  groundRing.rotation.x = -Math.PI / 2
  groundRing.position.y = 0.6
  const cloudDisc = surface(new THREE.RingGeometry(0.55, 1, 72), '#e8eef4', 0, THREE.AdditiveBlending)
  cloudDisc.rotation.x = -Math.PI / 2
  cloudDisc.position.y = capHeight

  const stemRateGen = new ConstantValue(0)
  const stemLifeGen = new IntervalValue(8, 18)
  const stemSizeGen = new IntervalValue(stemSize * 0.5, stemSize)
  const stemWindForce = new ConstantValue(wind * 0.4)
  const stemEmitter = new DonutEmitter({ radius: stemRadius, donutRadius: stemRadius * 0.55, thickness: 0.5 })
  const stem = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: false,
    worldSpace: true,
    shape: stemEmitter,
    startLife: stemLifeGen,
    startSpeed: new IntervalValue(14, 30),
    startSize: stemSizeGen,
    startColor: new ColorRange(hexToQ4(mixSmoke(smokeColor)), hexToQ4(smokeColor)),
    emissionOverTime: stemRateGen,
    behaviors: [
      new ApplyForce(q3(0, 1, 0), new ConstantValue(9)),
      new ApplyForce(q3(0.8, 0, 0.4), stemWindForce),
      new OrbitOverLife(new IntervalValue(-0.5, 0.5), new QVector3(0, 1, 0)),
      sizeCurve(0.2, 0.7, 1.2, 2),
      new ColorOverLife(
        gradientFromHex(
          [
            [mixHex(smokeColor, '#ffd9a0', 0.5), 0],
            [mixSmoke(smokeColor), 0.14],
            ['#3f382e', 1]
          ],
          [
            [0, 0],
            [0.8, 0.14],
            [0, 1]
          ],
          1
        )
      ),
      new TurbulenceField(q3(3, 3, 3), 1, q3(0.8, 0.5, 0.8), q3(0.3, 0.3, 0.3))
    ],
    renderMode: RenderMode.BillBoard,
    material: normalBlend(ctx.textures.smoke, 0.9),
    rendererEmitterSettings: {}
  })

  const capRateGen = new ConstantValue(0)
  const capLifeGen = new IntervalValue(capLife * 0.6, capLife)
  const capSizeGen = new IntervalValue(capSize * 0.6, capSize)
  const capSpin = new IntervalValue(-rollSpeed, rollSpeed)
  const capEmitter = new DonutEmitter({ radius: capRadius, donutRadius: capRadius * 0.4, thickness: 0.7 })
  const cap = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: false,
    worldSpace: true,
    shape: capEmitter,
    startLife: capLifeGen,
    startSpeed: new IntervalValue(2, 6),
    startSize: capSizeGen,
    startColor: new ColorRange(hexToQ4(smokeColor), hexToQ4(mixSmoke(smokeColor))),
    emissionOverTime: capRateGen,
    behaviors: [
      new ApplyForce(q3(0, 1, 0), new ConstantValue(2.4)),
      new OrbitOverLife(capSpin, new QVector3(0, 1, 0)),
      sizeCurve(0.3, 0.8, 1.15, 1.8),
      new ColorOverLife(
        gradientFromHex(
          [
            [mixHex(smokeColor, '#ffcf9a', 0.32), 0],
            [mixSmoke(smokeColor), 0.16],
            ['#443c31', 1]
          ],
          [
            [0, 0],
            [0.85, 0.16],
            [0, 1]
          ],
          1
        )
      ),
      new TurbulenceField(q3(2.6, 2, 2.6), 1, q3(1.1, 0.6, 1.1), q3(0.3, 0.3, 0.3))
    ],
    renderMode: RenderMode.BillBoard,
    material: normalBlend(ctx.textures.smoke, 0.85),
    rendererEmitterSettings: {}
  })

  const curlRateGen = new ConstantValue(0)
  const curlLifeGen = new IntervalValue(capLife * 0.35, capLife * 0.7)
  const curlSizeGen = new IntervalValue(capSize * 0.4, capSize * 0.9)
  const curlSpin = new IntervalValue(-rollSpeed * 1.5, rollSpeed * 1.5)
  const curlEmitter = new DonutEmitter({ radius: capRadius * 1.05, donutRadius: capRadius * 0.35, thickness: 1 })
  const curl = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: false,
    worldSpace: true,
    shape: curlEmitter,
    startLife: curlLifeGen,
    startSpeed: new IntervalValue(1, 3),
    startSize: curlSizeGen,
    startColor: new ColorRange(hexToQ4(mixSmoke(smokeColor)), hexToQ4('#4a4032')),
    emissionOverTime: curlRateGen,
    behaviors: [
      new ApplyForce(q3(0, -1, 0), new ConstantValue(2.2)),
      new OrbitOverLife(curlSpin, new QVector3(0, 1, 0)),
      sizeCurve(0.5, 1, 1.1, 1.4),
      new ColorOverLife(
        gradientFromHex(
          [
            [mixSmoke(smokeColor), 0],
            ['#4a4032', 1]
          ],
          [
            [0.9, 0],
            [0, 1]
          ],
          1
        )
      ),
      new TurbulenceField(q3(3.4, 3.4, 3.4), 1, q3(1.4, 1, 1.4), q3(0.4, 0.4, 0.4))
    ],
    renderMode: RenderMode.BillBoard,
    material: normalBlend(ctx.textures.smoke, 0.8),
    rendererEmitterSettings: {}
  })

  const falloutRateGen = new ConstantValue(0)
  const falloutLifeGen = new IntervalValue(falloutLife * 0.5, falloutLife)
  const falloutSizeGen = new IntervalValue(8, 26)
  const falloutWindForce = new ConstantValue(wind)
  const falloutEmitter = new RectangleEmitter({ width: capRadius * 1.7, height: capRadius * 1.7, thickness: 4 })
  const fallout = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: false,
    worldSpace: true,
    shape: falloutEmitter,
    startLife: falloutLifeGen,
    startSpeed: new IntervalValue(0.5, 2),
    startSize: falloutSizeGen,
    startColor: new ColorRange(hexToQ4('#c9bfae'), hexToQ4('#8d8172')),
    emissionOverTime: falloutRateGen,
    behaviors: [
      new ApplyForce(q3(0, -1, 0), new ConstantValue(0.6)),
      new ApplyForce(q3(1, 0, 0.35), falloutWindForce),
      new ColorOverLife(whiteAlpha([[0, 0], [0.85, 0.1], [0.55, 0.5], [0, 1]], 1))
    ],
    renderMode: RenderMode.BillBoard,
    material: normalBlend(ctx.textures.smoke, 0.5),
    rendererEmitterSettings: {}
  })

  const groundDustRateGen = new ConstantValue(0)
  const groundDustLifeGen = new IntervalValue(6, 12)
  const groundDustSizeGen = new IntervalValue(groundDustSize * 0.5, groundDustSize * 1.4)
  const groundDustEmitter = new DonutEmitter({ radius: stemRadius * 1.7, donutRadius: stemRadius, thickness: 0.4 })
  const groundDust = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: false,
    worldSpace: true,
    shape: groundDustEmitter,
    startLife: groundDustLifeGen,
    startSpeed: new IntervalValue(8, 24),
    startSize: groundDustSizeGen,
    startColor: new ColorRange(hexToQ4(smokeColor), hexToQ4(mixSmoke(smokeColor))),
    emissionOverTime: groundDustRateGen,
    behaviors: [
      new ApplyForce(q3(0, 1, 0), new ConstantValue(1.6)),
      new ApplyForce(q3(0.85, 0, 0.45), stemWindForce),
      sizeCurve(0.35, 0.9, 1.3, 1.8),
      new ColorOverLife(
        gradientFromHex(
          [
            [mixHex(smokeColor, '#e7cfa6', 0.4), 0],
            [mixSmoke(smokeColor), 0.15],
            ['#4d4234', 1]
          ],
          [
            [0, 0],
            [0.75, 0.15],
            [0, 1]
          ],
          1
        )
      )
    ],
    renderMode: RenderMode.BillBoard,
    material: normalBlend(ctx.textures.smoke, 0.65),
    rendererEmitterSettings: {}
  })

  const cfg = {
    fireballSize,
    fireUp,
    fireballLife,
    stemRate,
    stemRadius,
    capRate,
    capRadius,
    capHeight,
    capLife,
    rollSpeed,
    shockRadius,
    shockSpeed,
    groundDustRate,
    groundDustSize,
    falloutRate,
    falloutLife,
    wind,
    loopTime,
    stemSize,
    capSize,
    glowColor,
    smokeColor
  }
  const state = { t: 0, capY: 60 }
  const coreColor = new THREE.Color('#ffffff')
  const outerColor = new THREE.Color('#ffb347')

  const resetRun = (): void => {
    state.t = 0
    state.capY = cfg.capHeight * 0.08
    stemRateGen.value = 0
    capRateGen.value = 0
    curlRateGen.value = 0
    groundDustRateGen.value = 0
    falloutRateGen.value = 0
    setOpacity(fireballCore, 0)
    setOpacity(fireballOuter, 0)
    ;(fireballGlow.material as THREE.SpriteMaterial).opacity = 0
    setOpacity(groundRing, 0)
    setOpacity(cloudDisc, 0)
    cap.emitter.position.set(0, state.capY, 0)
    curl.emitter.position.set(0, state.capY, 0)
    groundDust.emitter.position.set(0, 0.5, 0)
    fallout.emitter.position.set(0, cfg.capHeight, 0)
  }

  resetRun()

  const tick = (delta: number): void => {
    state.t += delta
    if (state.t > cfg.loopTime) resetRun()
    const t = state.t

    if (t < cfg.fireballLife) {
      const p = clamp01(t / cfg.fireballLife)
      const grow = smoothstep(0, 1, p)
      const coreScale = cfg.fireballSize * (0.2 + 0.8 * grow)
      const fireY = 40 + cfg.fireUp * Math.pow(p, 0.7)
      fireballCore.position.y = fireY
      fireballOuter.position.y = fireY
      fireballGlow.position.y = fireY
      fireballCore.scale.setScalar(Math.max(0.01, coreScale))
      fireballOuter.scale.setScalar(Math.max(0.01, coreScale * 1.45))
      fireballGlow.scale.setScalar(Math.max(0.01, coreScale * 3.4))
      coreColor
        .setHex(0xffffff)
        .lerp(new THREE.Color('#fff0a8'), clamp01(p * 1.4))
        .lerp(new THREE.Color('#ff8a2a'), clamp01((p - 0.4) / 0.6))
      ;(fireballCore.material as THREE.MeshBasicMaterial).color.copy(coreColor)
      outerColor
        .setHex(0xffb347)
        .lerp(new THREE.Color('#e2571a'), clamp01(p * 1.2))
        .lerp(new THREE.Color('#5c1503'), clamp01((p - 0.45) / 0.55))
      ;(fireballOuter.material as THREE.MeshBasicMaterial).color.copy(outerColor)
      const fade = 1 - smoothstep(0.62, 1, p)
      setOpacity(fireballCore, fade * 0.95)
      setOpacity(fireballOuter, fade * 0.6)
      const glowMat = fireballGlow.material as THREE.SpriteMaterial
      glowMat.opacity = fade * 0.85
      glowMat.color.copy(outerColor)
      stemRateGen.value = cfg.stemRate * smoothstep(0.03, 0.3, p)
      groundDustRateGen.value = cfg.groundDustRate * smoothstep(0, 0.25, p)
    } else {
      setOpacity(fireballCore, 0)
      setOpacity(fireballOuter, 0)
      ;(fireballGlow.material as THREE.SpriteMaterial).opacity = 0
      stemRateGen.value = cfg.stemRate * 0.85
      groundDustRateGen.value = cfg.groundDustRate * clamp01(1 - (t - cfg.fireballLife) / 10)
    }

    if (t > 1.8) {
      const rise = clamp01((t - 1.8) / 12)
      state.capY = cfg.capHeight * (0.12 + 0.88 * rise)
      cap.emitter.position.set(0, state.capY, 0)
      curl.emitter.position.set(0, state.capY + cfg.capRadius * 0.12, 0)
      capRateGen.value = cfg.capRate * smoothstep(0, 0.22, rise)
      curlRateGen.value = cfg.capRate * 0.35 * smoothstep(0.38, 0.72, rise)
    }

    if (t > cfg.fireballLife * 0.6) {
      const shockT = t - cfg.fireballLife * 0.6
      const radius = Math.min(cfg.shockRadius, cfg.shockSpeed * shockT * Math.pow(Math.max(0.05, shockT), -0.35))
      groundRing.scale.setScalar(Math.max(0.01, radius))
      setOpacity(groundRing, clamp01(0.75 * (1 - radius / Math.max(1, cfg.shockRadius))))
      const disc = Math.min(cfg.shockRadius * 0.5, cfg.shockSpeed * 2.6 * shockT)
      cloudDisc.position.y = state.capY
      cloudDisc.scale.setScalar(Math.max(0.01, disc))
      setOpacity(cloudDisc, clamp01(0.5 * (1 - disc / (cfg.shockRadius * 0.5))))
    }

    if (t > 14) {
      falloutRateGen.value = cfg.falloutRate * clamp01((t - 14) / 8)
      fallout.emitter.position.set(state.capY * 0.18, state.capY * 0.95, 0)
    }

    setOpacity(scorch, clamp01(0.25 + 0.35 * smoothstep(0, 3, t)))
  }

  const update = (v: ParamValues): void => {
    cfg.fireballSize = num(v, 'fireballSize', 170)
    cfg.fireUp = num(v, 'fireUp', 360)
    cfg.fireballLife = num(v, 'fireballLife', 2.4)
    cfg.stemRate = num(v, 'stemRate', 140)
    cfg.stemRadius = num(v, 'stemRadius', 70)
    cfg.capRate = num(v, 'capRate', 160)
    cfg.capRadius = num(v, 'capRadius', 280)
    cfg.capHeight = num(v, 'capHeight', 820)
    cfg.capLife = num(v, 'capLife', 14)
    cfg.rollSpeed = num(v, 'rollSpeed', 0.8)
    cfg.shockRadius = num(v, 'shockRadius', 1600)
    cfg.shockSpeed = num(v, 'shockSpeed', 650)
    cfg.groundDustRate = num(v, 'groundDustRate', 90)
    cfg.groundDustSize = num(v, 'groundDustSize', 84)
    cfg.falloutRate = num(v, 'falloutRate', 40)
    cfg.falloutLife = num(v, 'falloutLife', 34)
    cfg.wind = num(v, 'wind', 7)
    cfg.loopTime = num(v, 'loopTime', 70)

    const ss = num(v, 'stemSize', 64)
    stemSizeGen.a = ss * 0.5
    stemSizeGen.b = ss
    const cs = num(v, 'capSize', 96)
    capSizeGen.a = cs * 0.6
    capSizeGen.b = cs
    curlSizeGen.a = cs * 0.4
    curlSizeGen.b = cs * 0.9
    const gs = num(v, 'groundDustSize', 84)
    groundDustSizeGen.a = gs * 0.5
    groundDustSizeGen.b = gs * 1.4
    const cl = num(v, 'capLife', 14)
    capLifeGen.a = cl * 0.6
    capLifeGen.b = cl
    curlLifeGen.a = cl * 0.35
    curlLifeGen.b = cl * 0.7
    const fl = num(v, 'falloutLife', 34)
    falloutLifeGen.a = fl * 0.5
    falloutLifeGen.b = fl
    stemEmitter.radius = cfg.stemRadius
    stemEmitter.donutRadius = cfg.stemRadius * 0.55
    capEmitter.radius = cfg.capRadius
    capEmitter.donutRadius = cfg.capRadius * 0.42
    curlEmitter.radius = cfg.capRadius * 1.05
    curlEmitter.donutRadius = cfg.capRadius * 0.35
    falloutEmitter.width = cfg.capRadius * 1.7
    falloutEmitter.height = cfg.capRadius * 1.7

    const smoke = str(v, 'smokeColor', '#948a7c')
    const glow = str(v, 'glowColor', '#ff9a3c')
    const smokeLight = mixSmoke(smoke)
    cfg.smokeColor = smoke
    cfg.glowColor = glow
    setColorRangeStops(stem.startColor as ColorRange, smokeLight, smoke)
    setColorRangeStops(cap.startColor as ColorRange, smoke, smokeLight)
    setColorRangeStops(curl.startColor as ColorRange, smokeLight, '#4a4032')
    setColorRangeStops(groundDust.startColor as ColorRange, smoke, smokeLight)
    setGradientColors((stem.behaviors[3] as ColorOverLife).color, [
      mixHex(smoke, '#ffd9a0', 0.5),
      smokeLight,
      '#3f382e'
    ])
    setGradientColors((cap.behaviors[3] as ColorOverLife).color, [
      mixHex(smoke, '#ffcf9a', 0.32),
      smokeLight,
      '#443c31'
    ])
    setGradientColors((curl.behaviors[3] as ColorOverLife).color, [smokeLight, '#4a4032'])
    setGradientColors((groundDust.behaviors[3] as ColorOverLife).color, [
      mixHex(smoke, '#e7cfa6', 0.4),
      smokeLight,
      '#4d4234'
    ])
    stemWindForce.value = cfg.wind * 0.4
    falloutWindForce.value = cfg.wind
    tint(scorch, '#2c2118')
    ;(groundRing.material as THREE.MeshBasicMaterial).color.set(glow)
  }

  stem.emitter.rotation.x = -Math.PI / 2
  cap.emitter.rotation.x = -Math.PI / 2
  curl.emitter.rotation.x = -Math.PI / 2
  groundDust.emitter.rotation.x = -Math.PI / 2
  fallout.emitter.rotation.x = -Math.PI / 2

  return {
    systems: [stem, cap, curl, groundDust, fallout],
    objects: [fireballCore, fireballOuter, fireballGlow, scorch, groundRing, cloudDisc],
    tick,
    update
  }
}

function mixSmoke(smokeColor: string): string {
  const color = new THREE.Color(smokeColor)
  color.lerp(new THREE.Color('#e7ded0'), 0.45)
  return `#${color.getHexString()}`
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const DISASTER_META: Record<DisasterEffectId, EffectMeta> = {
  tsunami: {
    id: 'tsunami',
    title: 'VFX 海啸推进',
    subtitle: '三维浪面 + 白沫飞溅 + 裹挟泥沙',
    description:
      '以三维高度场浪面还原海啸推进：水面在锋面处陡直抬升、向后方缓慢回落形成有体积感的浪墙，浪面上叠加逐像素法线光照、菲涅尔反射与高频碎浪扰动，前缘由泡沫、飞沫与浑浊泥沙共同构成白水线。浪头沿推进方向逐栋淹没沿岸建筑并使其颜色转暗。浪面宽度、推进距离、浪高、浪背长度、碎浪扰动、波速、泡沫/飞沫/泥沙量与建筑数量/高度、水体与泥沙颜色、不透明度均可实时调整。',
    params: [
      { key: 'width', label: '浪面宽度', kind: 'number', min: 120, max: 700, step: 20, default: 320, tip: '溃口与洪流的横向铺展范围，越大覆盖的街区越宽，水墙越显开阔。' },
      { key: 'reach', label: '推进距离', kind: 'number', min: 80, max: 600, step: 20, default: 240, tip: '浪头从起点推进到消失的总行程，决定淹没纵深与单次循环的推进时长。' },
      { key: 'waveHeight', label: '浪头高度', kind: 'number', min: 2, max: 30, step: 1, default: 12, tip: '浪面前缘抬升的峰值高度，越高越具压迫感，过高会显得失真。' },
      { key: 'waveLength', label: '浪背长度', kind: 'number', min: 20, max: 300, step: 5, default: 70, tip: '浪头后方水体回落所需的纵向距离，越短浪背越陡，越长越像缓慢涨水。' },
      { key: 'chop', label: '碎浪扰动', kind: 'number', min: 0, max: 6, step: 0.1, default: 1.4, tip: '叠加在浪面上的高频起伏强度，制造水面不规则涌动与碎浪细节。' },
      { key: 'speed', label: '推进速度', kind: 'number', min: 5, max: 70, step: 1, unit: 'm/s', default: 26, tip: '浪头每秒前进的距离，直接决定灾害节奏与冲击感。' },
      { key: 'foamRate', label: '泡沫密度', kind: 'number', min: 500, max: 9000, step: 100, default: 3600, tip: '浪头线上每秒生成的白色泡沫数量，越高白水越浓。' },
      { key: 'foamSize', label: '泡沫尺寸', kind: 'number', min: 0.5, max: 10, step: 0.1, default: 3, tip: '单个泡沫贴片的大小，影响白水的颗粒感与蓬松度。' },
      { key: 'foamLife', label: '泡沫寿命', kind: 'number', min: 0.6, max: 8, step: 0.1, unit: '秒', default: 2.6, tip: '泡沫从生成到消散的时长，越长白水拖尾越明显。' },
      { key: 'sprayRate', label: '飞沫量', kind: 'number', min: 0, max: 5000, step: 100, default: 1400, tip: '浪头向上抛射的水雾每秒数量，表现撞击与破碎的飞溅。' },
      { key: 'spraySpeed', label: '飞沫初速', kind: 'number', min: 2, max: 30, step: 0.5, default: 13, tip: '飞沫抛射的初速度，越大溅得越高越远。' },
      { key: 'debrisRate', label: '泥沙/漂流物量', kind: 'number', min: 0, max: 800, step: 10, default: 160, tip: '洪流中每秒卷起的泥沙与漂流物数量，体现洪水的浑浊与破坏力。' },
      { key: 'debrisSize', label: '泥沙尺寸', kind: 'number', min: 0.5, max: 12, step: 0.1, default: 2.4, tip: '单个泥沙团块的尺寸。' },
      { key: 'debrisLife', label: '泥沙寿命', kind: 'number', min: 1, max: 10, step: 0.2, unit: '秒', default: 3.4, tip: '泥沙悬浮翻滚的持续时间，越长越显浑浊厚重。' },
      { key: 'blocks', label: '街区建筑数', kind: 'number', min: 0, max: 10, step: 1, unit: '栋', default: 7, tip: '沿岸布置的建筑栋数，0 为不显示建筑。' },
      { key: 'blockHeight', label: '建筑高度', kind: 'number', min: 6, max: 60, step: 1, default: 26, tip: '建筑基准高度，用于对比浪高并直观呈现淹没过程。' },
      { key: 'waterColor', label: '水体颜色', kind: 'color', default: '#2f6f93', tip: '洪水的基础色，决定深水区与浪面的主色调。' },
      { key: 'siltColor', label: '泥沙颜色', kind: 'color', default: '#ac8a5c', tip: '被卷起泥沙与漂流物的颜色，体现水体浑浊程度。' },
      { key: 'opacity', label: '整体不透明度', kind: 'number', min: 0.2, max: 1, step: 0.05, default: 0.72, tip: '水体与浪面的整体透明度，越低越通透、越高越厚重。' }
    ]
  },
  collapse: {
    id: 'collapse',
    title: 'VFX 建筑碎裂坍塌',
    subtitle: '预破碎刚体回放 + 冲击尘环 + 尘云',
    description:
      '建筑自底部失稳后整体倾斜下沉，触地瞬间由完整楼体切换为碎块群：碎块按抛物线飞散、翻滚并落地堆存，地面冲击尘环向外扩张，尘云持续抬升扩散并随风漂移。楼层数、碎块数、坍塌时长与保持时长、起爆力、尘环半径/速度、尘云量/尺寸/寿命/风向风速与尘云颜色、不透明度均可实时调整。',
    params: [
      { key: 'floors', label: '楼层数', kind: 'number', min: 4, max: 24, step: 1, unit: '层', default: 12 },
      { key: 'chunks', label: '碎块数量', kind: 'number', min: 8, max: 90, step: 2, unit: '块', default: 40 },
      { key: 'collapseTime', label: '坍塌时长', kind: 'number', min: 1.5, max: 8, step: 0.5, unit: '秒', default: 4 },
      { key: 'hold', label: '保持时长', kind: 'number', min: 2, max: 20, step: 1, unit: '秒', default: 7 },
      { key: 'blastForce', label: '起爆力', kind: 'number', min: 5, max: 60, step: 1, default: 26 },
      { key: 'shockRadius', label: '尘环半径', kind: 'number', min: 20, max: 300, step: 5, default: 120 },
      { key: 'shockSpeed', label: '尘环速度', kind: 'number', min: 10, max: 250, step: 5, default: 90 },
      { key: 'dustRate', label: '尘云量', kind: 'number', min: 100, max: 1400, step: 50, default: 380 },
      { key: 'dustSize', label: '尘云尺寸', kind: 'number', min: 6, max: 60, step: 1, default: 24 },
      { key: 'dustLife', label: '尘云寿命', kind: 'number', min: 4, max: 24, step: 1, unit: '秒', default: 9 },
      { key: 'wind', label: '风速', kind: 'number', min: 0, max: 20, step: 0.5, default: 4 },
      { key: 'flash', label: '起爆闪光', kind: 'number', min: 0, max: 3, step: 0.1, default: 1 },
      { key: 'dustColor', label: '尘云颜色', kind: 'color', default: '#a9967c' },
      { key: 'dustOpacity', label: '尘云不透明度', kind: 'number', min: 0.1, max: 1, step: 0.05, default: 0.85 }
    ],
    rebuildKeys: ['floors', 'chunks']
  },
  nuke: {
    id: 'nuke',
    title: 'VFX 核爆蘑菇云',
    subtitle: '层叠火球 + 涡环蘑菇帽 + 冲击波 + 落尘',
    description:
      '以艺术标定的视觉仿真还原经典蘑菇云五阶段：白炽内核、橙色外焰与辉光光斑构成层叠火球，由地面尘柱托起；地面扬尘沿冲击波向外翻涌，帽部在目标高度由环状发射器配合绕竖直轴涡环力场完成 roll-up 翻卷，帽檐另有反向小涡制造向下翻卷层次；地面冲击波环与高空凝结云盘向外扩张，帽顶颗粒转入重力沉降形成随风长尾落尘。火球尺寸/抬升/寿命、尘柱量级/尺寸/半径、蘑菇帽量级/尺寸/半径/高度/寿命、涡环转速、冲击波半径/速度、地面扬尘量/尺寸、落尘量/寿命、风速与烟雾/辉光颜色均可实时调整。默认粒子量级按性能优先标定，调高帽部与尘柱量级会显著增加开销。',
    params: [
      { key: 'fireballSize', label: '火球直径', kind: 'number', min: 60, max: 600, step: 10, default: 170, tip: '爆心火球的最大直径，决定初始闪光的体量。' },
      { key: 'fireUp', label: '火球抬升', kind: 'number', min: 60, max: 1200, step: 20, default: 360, tip: '火球在燃烧期内向上抬升的最大距离。' },
      { key: 'fireballLife', label: '火球寿命', kind: 'number', min: 1, max: 6, step: 0.1, unit: '秒', default: 2.4, tip: '火球由白炽转为暗红并消散所需的时间。' },
      { key: 'stemRate', label: '尘柱量', kind: 'number', min: 100, max: 1200, step: 50, default: 140, tip: '每秒生成的尘柱烟雾粒子数，越大尘柱越浓密（对性能影响较大）。' },
      { key: 'stemSize', label: '尘柱尺寸', kind: 'number', min: 20, max: 200, step: 5, default: 64, tip: '尘柱烟雾粒子的基准大小。' },
      { key: 'stemRadius', label: '尘柱半径', kind: 'number', min: 20, max: 220, step: 5, default: 70, tip: '地面尘柱的横向半径，决定柱子粗细。' },
      { key: 'capRate', label: '蘑菇帽量', kind: 'number', min: 200, max: 1800, step: 100, default: 160, tip: '每秒生成的蘑菇帽粒子数，主要影响云帽的浓密程度与性能开销。' },
      { key: 'capSize', label: '蘑菇帽尺寸', kind: 'number', min: 40, max: 320, step: 10, default: 96, tip: '蘑菇帽粒子尺寸，越大云团越团聚厚实。' },
      { key: 'capRadius', label: '蘑菇帽半径', kind: 'number', min: 80, max: 800, step: 20, default: 280, tip: '蘑菇帽涡环的半径，决定云帽的横向规模。' },
      { key: 'capHeight', label: '蘑菇帽高度', kind: 'number', min: 300, max: 2600, step: 50, default: 820, tip: '蘑菇帽最终稳定的高度。' },
      { key: 'capLife', label: '烟云寿命', kind: 'number', min: 10, max: 45, step: 1, unit: '秒', default: 14, tip: '烟云粒子的存活时长，越长消散越慢、同时驻留的粒子越多。' },
      { key: 'rollSpeed', label: '涡环转速', kind: 'number', min: 0, max: 3, step: 0.05, default: 0.8, tip: '蘑菇帽绕竖直轴翻滚的角速度，营造 roll-up 卷曲层次。' },
      { key: 'shockRadius', label: '冲击波半径', kind: 'number', min: 300, max: 5000, step: 100, default: 1600, tip: '地面冲击波环最终扩张到的半径。' },
      { key: 'shockSpeed', label: '冲击波速度', kind: 'number', min: 100, max: 2000, step: 50, default: 650, tip: '冲击波环向外扩张的速度。' },
      { key: 'groundDustRate', label: '地面扬尘量', kind: 'number', min: 0, max: 700, step: 20, default: 90, tip: '贴地向外翻涌的尘土粒子数量，表现冲击波扬尘。' },
      { key: 'groundDustSize', label: '地面扬尘尺寸', kind: 'number', min: 20, max: 300, step: 10, default: 84, tip: '地面扬尘粒子的基准大小。' },
      { key: 'falloutRate', label: '落尘量', kind: 'number', min: 0, max: 700, step: 50, default: 40, tip: '蘑菇帽顶部转入沉降的尘埃粒子数量。' },
      { key: 'falloutLife', label: '落尘寿命', kind: 'number', min: 20, max: 90, step: 5, unit: '秒', default: 34, tip: '落尘粒子随风飘散的持续时间。' },
      { key: 'wind', label: '风速', kind: 'number', min: 0, max: 30, step: 1, default: 7, tip: '水平风切变强度，使尘柱与云帽向下风向倾斜。' },
      { key: 'loopTime', label: '循环周期', kind: 'number', min: 30, max: 150, step: 5, unit: '秒', default: 70, tip: '整段核爆演出循环一次的总时长。' },
      { key: 'smokeColor', label: '烟云颜色', kind: 'color', default: '#948a7c', tip: '烟云与尘柱的基础色。' },
      { key: 'glowColor', label: '辉光颜色', kind: 'color', default: '#ff9a3c', tip: '火球与冲击波的高光色。' }
    ]
  }
}

export const DISASTER_EFFECT_IDS: DisasterEffectId[] = ['tsunami', 'collapse', 'nuke']

export function buildDisasterEffect(
  id: DisasterEffectId,
  values: ParamValues,
  ctx: EffectBuildContext
): BuiltEffect {
  switch (id) {
    case 'tsunami':
      return buildTsunami(values, ctx)
    case 'collapse':
      return buildCollapse(values, ctx)
    case 'nuke':
      return buildNuke(values, ctx)
    default: {
      const exhaustive: never = id
      return exhaustive
    }
  }
}
