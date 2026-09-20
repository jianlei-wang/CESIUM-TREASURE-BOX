import * as THREE from 'three'
import {
  ApplyForce,
  AxisAngleGenerator,
  ColorOverLife,
  ColorRange,
  ConstantValue,
  ConeEmitter,
  IntervalValue,
  ParticleSystem,
  RandomQuatGenerator,
  RectangleEmitter,
  RenderMode,
  Rotation3DOverLife,
  TurbulenceField,
  Vector3 as QVector3
} from 'three.quarks'
import {
  DEG,
  additive,
  gradientFromHex,
  hexToQ4,
  normalBlend,
  num,
  q3,
  setParticleOpacity,
  sizeCurve,
  str,
  whiteAlpha,
  type BuiltEffect,
  type EffectBuildContext,
  type EffectMeta,
  type ParamValues
} from './effect-kit'

export type EarthEffectId = 'aurora' | 'urban-fire' | 'wind-field' | 'flock' | 'snow'

/**
 * prewarm 打开时 quarks 会以 60fps 逐帧模拟 duration 秒，全部在打开瞬间同步执行。
 * duration 每增加 1 秒就多 60 次全粒子 update，因此预热的系统必须把 duration 压到很小。
 */
const PREWARM_DURATION = 4

/* ------------------------------------------------------------------ */
/* 06 极光                                                              */
/* ------------------------------------------------------------------ */

const AURORA_VERTEX = `
uniform float uTime;
uniform float uWave;
uniform float uFold;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float fold = sin(uv.x * 6.2831853 * uFold + uTime * 0.9) * 0.55
             + sin(uv.x * 6.2831853 * (uFold * 2.3) - uTime * 1.4) * 0.28
             + sin(uv.y * 3.1415926 * 2.0 + uTime * 0.6) * 0.22;
  p.z += fold * uWave * (0.35 + uv.y);
  p.x += sin(uv.y * 3.1415926 * 1.6 + uTime * 0.5) * uWave * 0.22;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

const AURORA_FRAGMENT = `
uniform vec3 uBottom;
uniform vec3 uTop;
uniform float uBright;
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
void main() {
  float vertical = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.5);
  float bottomCut = smoothstep(0.0, 0.05, vUv.y);
  float ray = 0.62 + 0.38 * sin(vUv.x * 3.1415926 * 26.0 + uTime * 1.5 + uSeed + sin(vUv.x * 12.0) * 2.2);
  float curtain = vertical * bottomCut * ray;
  vec3 col = mix(uBottom, uTop, vUv.y);
  gl_FragColor = vec4(col * uBright, curtain * uBright);
}
`

interface AuroraUniforms {
  [key: string]: THREE.IUniform
  uTime: THREE.IUniform<number>
  uWave: THREE.IUniform<number>
  uFold: THREE.IUniform<number>
  uBright: THREE.IUniform<number>
  uBottom: THREE.IUniform<THREE.Color>
  uTop: THREE.IUniform<THREE.Color>
  uSeed: THREE.IUniform<number>
}

function buildAurora(values: ParamValues, _ctx: EffectBuildContext): BuiltEffect {
  const count = Math.max(1, Math.round(num(values, 'curtainCount', 14)))
  const width = num(values, 'width', 2600)
  const height = num(values, 'height', 1400)
  const distance = num(values, 'distance', 5200)
  const brightness = num(values, 'brightness', 0.85)
  const speed = num(values, 'speed', 0.5)
  const wave = num(values, 'wave', 320)
  const fold = num(values, 'fold', 3)
  const bottomColor = str(values, 'bottomColor', '#39f7a8')
  const topColor = str(values, 'topColor', '#ff4f8b')

  const band = width * count * 0.62
  const group = new THREE.Group()
  const uniforms: AuroraUniforms[] = []

  for (let i = 0; i < count; i += 1) {
    const geometry = new THREE.PlaneGeometry(width, height, 64, 12)
    const uniform: AuroraUniforms = {
      uTime: { value: Math.random() * 20 },
      uWave: { value: wave },
      uFold: { value: fold },
      uBright: { value: brightness },
      uBottom: { value: new THREE.Color(bottomColor) },
      uTop: { value: new THREE.Color(topColor) },
      uSeed: { value: Math.random() * 12 }
    }
    const material = new THREE.ShaderMaterial({
      uniforms: uniform,
      vertexShader: AURORA_VERTEX,
      fragmentShader: AURORA_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false
    })
    const mesh = new THREE.Mesh(geometry, material)
    const t = count === 1 ? 0.5 : i / (count - 1)
    const x = (t - 0.5) * band
    const arc = Math.abs(t - 0.5) * 2
    const z = -distance - arc * distance * 0.35
    const y = height * 0.6 + Math.sin(t * Math.PI * 2) * height * 0.18
    mesh.position.set(x, y, z)
    mesh.lookAt(new THREE.Vector3(0, y, 0))
    group.add(mesh)
    uniforms.push(uniform)
  }

  const cfg = { speed, wave, fold, brightness, bottom: bottomColor, top: topColor }
  let time = 0

  const tick = (delta: number): void => {
    time += delta * cfg.speed
    for (let i = 0; i < uniforms.length; i += 1) {
      const u = uniforms[i]
      u.uTime.value = time + i * 0.7
      const pulse = 0.8 + 0.2 * Math.sin(time * 0.35 + i * 1.1)
      u.uBright.value = cfg.brightness * pulse
    }
  }

  const update = (v: ParamValues): void => {
    cfg.speed = num(v, 'speed', 0.5)
    cfg.wave = num(v, 'wave', 320)
    cfg.fold = num(v, 'fold', 3)
    cfg.brightness = num(v, 'brightness', 0.85)
    cfg.bottom = str(v, 'bottomColor', '#39f7a8')
    cfg.top = str(v, 'topColor', '#ff4f8b')
    for (const u of uniforms) {
      u.uWave.value = cfg.wave
      u.uFold.value = cfg.fold
      u.uBottom.value.set(cfg.bottom)
      u.uTop.value.set(cfg.top)
    }
  }

  return { systems: [], objects: [group], tick, update }
}

/* ------------------------------------------------------------------ */
/* 07 城市火灾蔓延                                                       */
/* ------------------------------------------------------------------ */

interface FireCell {
  ix: number
  iz: number
  x: number
  z: number
  height: number
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  fire: ParticleSystem
  smoke: ParticleSystem
  fireRate: ConstantValue
  smokeRate: ConstantValue
  fireSizeGen: IntervalValue
  phase: number
  state: 0 | 1 | 2
  age: number
}

function buildUrbanFire(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const grid = Math.max(2, Math.round(num(values, 'gridSize', 4)))
  const fireRateBase = num(values, 'fireRate', 520)
  const smokeRateBase = num(values, 'smokeRate', 320)
  const fireSize = num(values, 'fireSize', 1.8)
  const spreadChance = num(values, 'spreadChance', 0.3)
  const spreadInterval = num(values, 'spreadInterval', 3)
  const burnDuration = num(values, 'burnDuration', 22)
  const wind = num(values, 'wind', 8)
  const windDir = num(values, 'windDir', 60)
  const smokeOpacity = num(values, 'smokeOpacity', 0.9)
  const glow = num(values, 'glow', 1)

  const spacing = 26
  const block = spacing * 0.62
  const half = ((grid - 1) * spacing) / 2

  const windDirVec = new QVector3(Math.cos(windDir * DEG), 0, Math.sin(windDir * DEG))
  const smokeWindMag = new ConstantValue(wind * 0.55)

  const cells: FireCell[] = []

  for (let ix = 0; ix < grid; ix += 1) {
    for (let iz = 0; iz < grid; iz += 1) {
      const x = ix * spacing - half
      const z = iz * spacing - half
      const h = 42 + Math.random() * 46

      const material = new THREE.MeshBasicMaterial({ color: new THREE.Color('#c9cdd4') })
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(block, h, block), material)
      mesh.position.set(x, h / 2, z)

      const fireRate = new ConstantValue(0)
      const fireSizeGen = new IntervalValue(fireSize * 0.5, fireSize)
      const fireSpeed = new IntervalValue(3, 7)
      const fireLife = new IntervalValue(0.6, 1.3)
      const fireFilicker = new ConstantValue(4)
      const fireEmitter = new ConeEmitter({ radius: block * 0.42, angle: 24 * DEG, thickness: 1 })
      const fire = new ParticleSystem({
        duration: 300,
        looping: true,
        prewarm: false,
        worldSpace: true,
        shape: fireEmitter,
        startLife: fireLife,
        startSpeed: fireSpeed,
        startSize: fireSizeGen,
        startColor: new ColorRange(hexToQ4('#fff1b0'), hexToQ4('#ff7a18')),
        emissionOverTime: fireRate,
        behaviors: [
          new ApplyForce(q3(0, 1, 0), fireFilicker),
          sizeCurve(0.4, 1, 0.7, 0),
          new ColorOverLife(
            gradientFromHex(
              [
                ['#fff6c8', 0],
                ['#ffd24a', 0.3],
                ['#ff6a12', 0.65],
                ['#8f2405', 1]
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
          new TurbulenceField(q3(2, 2, 2), 2, q3(0.8, 1.1, 0.8), q3(0.6, 0.6, 0.6))
        ],
        renderMode: RenderMode.BillBoard,
        material: additive(ctx.textures.glow),
        rendererEmitterSettings: {}
      })
      fire.emitter.position.set(x, h, z)
      fire.emitter.rotation.x = -Math.PI / 2
      setParticleOpacity(fire, Math.min(1, glow))

      const smokeRate = new ConstantValue(0)
      const smokeLife = new IntervalValue(5, 9)
      const smokeSpeed = new IntervalValue(1.5, 4)
      const smokeSize = new IntervalValue(3, 6.5)
      const smokeRise = new ConstantValue(2.4)
      const smokeEmitter = new ConeEmitter({ radius: block * 0.5, angle: 20 * DEG, thickness: 1 })
      const smoke = new ParticleSystem({
        duration: 400,
        looping: true,
        prewarm: false,
        worldSpace: true,
        shape: smokeEmitter,
        startLife: smokeLife,
        startSpeed: smokeSpeed,
        startSize: smokeSize,
        startColor: new ColorRange(hexToQ4('#4a4a4a'), hexToQ4('#9a9a9a')),
        emissionOverTime: smokeRate,
        behaviors: [
          new ApplyForce(q3(0, 1, 0), smokeRise),
          new ApplyForce(windDirVec, smokeWindMag),
          sizeCurve(0.25, 0.7, 1.3, 1.9),
          new ColorOverLife(
            gradientFromHex(
              [
                ['#8a8a8a', 0],
                ['#565656', 0.5],
                ['#2a2a2a', 1]
              ],
              [
                [0, 0],
                [0.6, 0.15],
                [0.45, 0.55],
                [0, 1]
              ],
              1
            )
          ),
          new TurbulenceField(q3(3, 3, 3), 1, q3(0.7, 0.5, 0.7), q3(0.25, 0.25, 0.25))
        ],
        renderMode: RenderMode.BillBoard,
        material: normalBlend(ctx.textures.smoke, smokeOpacity),
        rendererEmitterSettings: {}
      })
      smoke.emitter.position.set(x, h, z)
      smoke.emitter.rotation.x = -Math.PI / 2
      setParticleOpacity(smoke, smokeOpacity)

      cells.push({
        ix,
        iz,
        x,
        z,
        height: h,
        mesh,
        material,
        fire,
        smoke,
        fireRate,
        smokeRate,
        fireSizeGen,
        phase: Math.random() * Math.PI * 2,
        state: 0,
        age: 0
      })
    }
  }

  const group = new THREE.Group()
  for (const cell of cells) group.add(cell.mesh)

  const cfg = {
    fireRate: fireRateBase,
    smokeRate: smokeRateBase,
    spreadChance,
    spreadInterval,
    burnDuration,
    wind,
    windDir,
    glow
  }
  let spreadTimer = 0
  let resetTimer = 0
  let time = 0

  // 粒子预算：火焰/烟雾总量按当前燃烧单元数均摊，火势蔓延时单栋发射量自动下调，
  // 使场景总粒子数始终有界，避免蔓延到整片街区后 FPS 崩塌。
  const FIRE_BUDGET = 2200
  const SMOKE_BUDGET = 7000
  const FIRE_LIFE_AVG = 0.95
  const SMOKE_LIFE_AVG = 7

  const ignite = (cell: FireCell): void => {
    cell.state = 1
    cell.age = 0
    cell.material.color.set('#ff8a2a')
  }

  const extinguish = (cell: FireCell): void => {
    cell.state = 2
    cell.fireRate.value = 0
    cell.smokeRate.value = 0
    cell.material.color.set('#1d1a17')
  }

  const neighbors = (cell: FireCell): FireCell[] => {
    const result: FireCell[] = []
    for (const other of cells) {
      const dx = Math.abs(other.ix - cell.ix)
      const dz = Math.abs(other.iz - cell.iz)
      if (dx + dz === 1) result.push(other)
    }
    return result
  }

  ignite(cells[Math.floor(cells.length / 2)])

  const reset = (): void => {
    for (const cell of cells) {
      cell.state = 0
      cell.age = 0
      cell.fireRate.value = 0
      cell.smokeRate.value = 0
      cell.material.color.set('#c9cdd4')
    }
    ignite(cells[Math.floor(cells.length / 2)])
    spreadTimer = 0
    resetTimer = 0
  }

  const spread = (): void => {
    const dirRad = cfg.windDir * DEG
    const wx = Math.cos(dirRad)
    const wz = Math.sin(dirRad)
    for (const cell of cells) {
      if (cell.state !== 1) continue
      for (const other of neighbors(cell)) {
        if (other.state !== 0) continue
        const ndx = other.x - cell.x
        const ndz = other.z - cell.z
        const len = Math.hypot(ndx, ndz) || 1
        const align = (ndx * wx + ndz * wz) / len
        const probability = cfg.spreadChance * (1 + 1.6 * Math.max(0, align))
        if (Math.random() < probability) ignite(other)
      }
    }
  }

  const tick = (delta: number): void => {
    time += delta
    spreadTimer += delta
    if (spreadTimer >= cfg.spreadInterval) {
      spreadTimer = 0
      spread()
    }

    let burning = 0
    for (const cell of cells) {
      if (cell.state === 1) burning += 1
    }
    const fireCap = burning > 0 ? FIRE_BUDGET / burning / FIRE_LIFE_AVG : 0
    const smokeCap = burning > 0 ? SMOKE_BUDGET / burning / SMOKE_LIFE_AVG : 0
    const fireRatePerCell = Math.min(cfg.fireRate, fireCap)
    const smokeRatePerCell = Math.min(cfg.smokeRate, smokeCap)

    for (const cell of cells) {
      if (cell.state !== 1) continue
      cell.age += delta
      const flicker = 0.82 + 0.18 * Math.sin(time * 8 + cell.phase)
      cell.fireRate.value = fireRatePerCell * flicker
      cell.smokeRate.value = smokeRatePerCell
      if (cell.age >= cfg.burnDuration) extinguish(cell)
    }

    if (burning === 0) {
      resetTimer += delta
      if (resetTimer > 2.5) reset()
    } else {
      resetTimer = 0
    }
  }

  const update = (v: ParamValues): void => {
    cfg.fireRate = num(v, 'fireRate', 520)
    cfg.smokeRate = num(v, 'smokeRate', 320)
    cfg.spreadChance = num(v, 'spreadChance', 0.3)
    cfg.spreadInterval = Math.max(0.3, num(v, 'spreadInterval', 3))
    cfg.burnDuration = Math.max(1, num(v, 'burnDuration', 22))
    cfg.wind = num(v, 'wind', 8)
    cfg.windDir = num(v, 'windDir', 60)
    cfg.glow = num(v, 'glow', 1)

    const dirRad = cfg.windDir * DEG
    windDirVec.set(Math.cos(dirRad), 0, Math.sin(dirRad))
    smokeWindMag.value = cfg.wind * 0.55

    const fz = num(v, 'fireSize', 1.8)
    const so = num(v, 'smokeOpacity', 0.9)
    const fireOpacity = Math.min(1, cfg.glow)
    for (const cell of cells) {
      setParticleOpacity(cell.fire, fireOpacity)
      setParticleOpacity(cell.smoke, so)
      cell.fireSizeGen.a = fz * 0.5
      cell.fireSizeGen.b = fz
    }
  }

  return {
    systems: cells.flatMap((cell) => [cell.fire, cell.smoke]),
    objects: [group],
    tick,
    update
  }
}

/* ------------------------------------------------------------------ */
/* 08 全球风场可视化（局部“风之河”）                                     */
/* ------------------------------------------------------------------ */

interface WindParticle {
  x: number
  y: number
  z: number
  tx: number
  tz: number
  age: number
  life: number
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0 || 1)))
  return t * t * (3 - 2 * t)
}

function buildWindField(values: ParamValues, _ctx: EffectBuildContext): BuiltEffect {
  const count = Math.max(200, Math.round(num(values, 'count', 4500)))
  const area = num(values, 'area', 26000)
  const speed = num(values, 'speed', 140)
  const turbulence = num(values, 'turbulence', 0.8)
  const life = num(values, 'life', 6)
  const trail = num(values, 'trail', 900)
  const eye = num(values, 'eye', 1)
  const eyeRadius = num(values, 'eyeRadius', 5200)
  const altitude = num(values, 'altitude', 900)
  const thickness = num(values, 'thickness', 700)
  const brightness = num(values, 'brightness', 0.9)

  const positions = new Float32Array(count * 6)
  const colors = new Float32Array(count * 8)
  const half = area / 2
  const halfRef = { value: half }

  const particles: WindParticle[] = []
  const spawn = (p: WindParticle): void => {
    const h = halfRef.value
    p.x = (Math.random() * 2 - 1) * h
    p.z = (Math.random() * 2 - 1) * h
    p.y = altitude + (Math.random() * 2 - 1) * thickness
    p.tx = p.x
    p.tz = p.z
    p.age = Math.random() * life
    p.life = life * (0.65 + Math.random() * 0.7)
  }

  for (let i = 0; i < count; i += 1) {
    const particle: WindParticle = { x: 0, y: 0, z: 0, tx: 0, tz: 0, age: 0, life }
    spawn(particle)
    particles.push(particle)
  }

  const geometry = new THREE.BufferGeometry()
  const positionAttr = new THREE.BufferAttribute(positions, 3)
  const colorAttr = new THREE.BufferAttribute(colors, 4)
  geometry.setAttribute('position', positionAttr)
  geometry.setAttribute('color', colorAttr)
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), area)

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: brightness,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  })
  const lines = new THREE.LineSegments(geometry, material)
  lines.frustumCulled = false

  const cfg = {
    speed,
    turbulence,
    life,
    trail,
    eye,
    eyeRadius,
    area,
    altitude,
    thickness,
    brightness
  }
  let time = 0

  // 速度→颜色查找表：预计算 64 级 RGB，避免逐粒子反复 setHex/lerp。
  const PALETTE_STEPS = 64
  const paletteLut = new Float32Array(PALETTE_STEPS * 3)
  {
    const palette = [0x1f3bff, 0x1fb6ff, 0x2be08a, 0xf2d24a, 0xff7a26, 0xff2f2f]
    const ca = new THREE.Color()
    const cb = new THREE.Color()
    for (let i = 0; i < PALETTE_STEPS; i += 1) {
      const t = (i / (PALETTE_STEPS - 1)) * (palette.length - 1)
      const idx = Math.min(palette.length - 2, Math.floor(t))
      const frac = t - idx
      ca.setHex(palette[idx])
      cb.setHex(palette[idx + 1])
      ca.lerp(cb, frac)
      paletteLut[i * 3 + 0] = ca.r
      paletteLut[i * 3 + 1] = ca.g
      paletteLut[i * 3 + 2] = ca.b
    }
  }

  interface FlowSample {
    x: number
    z: number
  }

  /**
   * 无散度矢量风场：以流函数 ψ 叠加多个尺度涡旋（u=∂ψ/∂z, w=-∂ψ/∂x），
   * 再叠加纬向急流带与近似 Rankine 涡旋的切向风。涡旋项按 1/k 归一化，
   * 使各分量量级可比、输出稳定在单位量级。
   */
  const field = (x: number, z: number, out: FlowSample): void => {
    const length = Math.max(1200, cfg.area * 0.55)
    const k = (Math.PI * 2) / length
    let u = 0
    let w = 0

    const eddy = (scale: number, amp: number, spin: number, phase: number): void => {
      const kk = k / scale
      const a = amp / kk
      const argX = kk * x + time * spin + phase
      const argZ = kk * z - time * spin * 0.7 + phase * 1.7
      u += -a * kk * Math.sin(argX) * Math.sin(argZ)
      w += -a * kk * Math.cos(argX) * Math.cos(argZ)
    }

    eddy(1, 1.05, 0.05, 0)
    eddy(0.55, 0.72, -0.08, 2.1)
    eddy(0.3, 0.5, 0.13, 4.3)
    eddy(0.14, cfg.turbulence * 0.55, 0.5, 1.2)
    eddy(0.08, cfg.turbulence * 0.42, -0.8, 3.4)

    const bandPhase = (z / Math.max(1, cfg.area)) * Math.PI * 1.6 + time * 0.02
    u += 0.6 + 0.4 * Math.cos(bandPhase)

    const radius = Math.max(1, Math.hypot(x, z))
    const rn = radius / Math.max(1, cfg.eyeRadius)
    const tangential = cfg.eye * 2.2 * rn * Math.exp(1 - rn)
    const nx = -z / radius
    const nz = x / radius
    u += nx * tangential - (x / radius) * tangential * 0.16
    w += nz * tangential - (z / radius) * tangential * 0.16

    out.x = u
    out.z = w
  }

  // 风场在粗网格上采样，粒子用双线性插值读取，避免逐粒子做大量三角函数。
  const GRID_N = 48
  const grid = new Float32Array(GRID_N * GRID_N * 2)
  const gridHalf = { value: half }
  const gridStep = { value: (2 * half) / (GRID_N - 1) }
  const gridTmp: FlowSample = { x: 0, z: 0 }

  const rebuildGrid = (): void => {
    const h = gridHalf.value
    const step = gridStep.value
    let idx = 0
    for (let ix = 0; ix < GRID_N; ix += 1) {
      const x = -h + ix * step
      for (let iz = 0; iz < GRID_N; iz += 1) {
        field(x, -h + iz * step, gridTmp)
        grid[idx] = gridTmp.x
        grid[idx + 1] = gridTmp.z
        idx += 2
      }
    }
  }

  const sampleField = (x: number, z: number, out: FlowSample): void => {
    const h = gridHalf.value
    const step = gridStep.value
    let gx = (x + h) / step
    let gz = (z + h) / step
    if (gx < 0) gx = 0
    else if (gx > GRID_N - 1) gx = GRID_N - 1
    if (gz < 0) gz = 0
    else if (gz > GRID_N - 1) gz = GRID_N - 1
    const ix = Math.min(GRID_N - 2, gx | 0)
    const iz = Math.min(GRID_N - 2, gz | 0)
    const fx = gx - ix
    const fz = gz - iz
    const row0 = ix * GRID_N * 2
    const row1 = (ix + 1) * GRID_N * 2
    const c0 = iz * 2
    const c1 = (iz + 1) * 2
    const i00 = row0 + c0
    const i10 = row1 + c0
    const i01 = row0 + c1
    const i11 = row1 + c1
    const w00 = (1 - fx) * (1 - fz)
    const w10 = fx * (1 - fz)
    const w01 = (1 - fx) * fz
    const w11 = fx * fz
    out.x = grid[i00] * w00 + grid[i10] * w10 + grid[i01] * w01 + grid[i11] * w11
    out.z = grid[i00 + 1] * w00 + grid[i10 + 1] * w10 + grid[i01 + 1] * w01 + grid[i11 + 1] * w11
  }

  const first: FlowSample = { x: 0, z: 0 }
  const second: FlowSample = { x: 0, z: 0 }

  const tick = (delta: number): void => {
    time += delta
    const halfNow = halfRef.value
    const maxLag = 1.6
    const speedRef = Math.max(1, cfg.speed)
    const altLow = cfg.altitude - cfg.thickness
    const altSpan = Math.max(1, cfg.thickness * 2)
    rebuildGrid()

    for (let i = 0; i < count; i += 1) {
      const p = particles[i]
      p.age += delta

      const altFactor = 0.7 + 0.6 * Math.min(1, Math.max(0, (p.y - altLow) / altSpan))
      const step = cfg.speed * altFactor * delta
      sampleField(p.x, p.z, first)
      sampleField(p.x + first.x * step * 0.5, p.z + first.z * step * 0.5, second)
      p.x += second.x * step
      p.z += second.z * step

      const magnitude = Math.max(0.12, Math.hypot(second.x, second.z))
      const tau = Math.min(maxLag, cfg.trail / (speedRef * magnitude))
      const k = 1 - Math.exp(-delta / tau)
      p.tx += (p.x - p.tx) * k
      p.tz += (p.z - p.tz) * k

      if (p.age > p.life || Math.abs(p.x) > halfNow || Math.abs(p.z) > halfNow) {
        spawn(p)
        p.age = 0
        p.life = cfg.life * (0.65 + Math.random() * 0.7)
      }

      const age = p.age / Math.max(0.001, p.life)
      const fade = smoothstep(0, 0.15, age) * (1 - smoothstep(0.68, 1, age))
      const edge = 1 - smoothstep(0.82, 1, Math.max(Math.abs(p.x), Math.abs(p.z)) / halfNow)
      const speedLevel = Math.min(1, Math.max(0, (magnitude - 0.55) / 2.6))
      const alpha = fade * edge * (0.45 + 0.55 * speedLevel)

      const pb = i * 6
      positions[pb + 0] = p.tx
      positions[pb + 1] = p.y
      positions[pb + 2] = p.tz
      positions[pb + 3] = p.x
      positions[pb + 4] = p.y
      positions[pb + 5] = p.z

      const li = ((speedLevel * (PALETTE_STEPS - 1)) | 0) * 3
      const r = paletteLut[li]
      const g = paletteLut[li + 1]
      const b = paletteLut[li + 2]
      const cb = i * 8
      colors[cb + 0] = r
      colors[cb + 1] = g
      colors[cb + 2] = b
      colors[cb + 3] = alpha * 0.1
      colors[cb + 4] = r
      colors[cb + 5] = g
      colors[cb + 6] = b
      colors[cb + 7] = alpha
    }

    positionAttr.needsUpdate = true
    colorAttr.needsUpdate = true
  }

  const update = (v: ParamValues): void => {
    cfg.speed = num(v, 'speed', 140)
    cfg.turbulence = num(v, 'turbulence', 0.8)
    cfg.life = num(v, 'life', 6)
    cfg.trail = num(v, 'trail', 900)
    cfg.eye = num(v, 'eye', 1)
    cfg.eyeRadius = num(v, 'eyeRadius', 5200)
    cfg.altitude = num(v, 'altitude', 900)
    cfg.thickness = num(v, 'thickness', 700)
    cfg.brightness = num(v, 'brightness', 0.9)
    const nextArea = num(v, 'area', 26000)
    cfg.area = nextArea
    halfRef.value = nextArea / 2
    gridHalf.value = nextArea / 2
    gridStep.value = (2 * gridHalf.value) / (GRID_N - 1)
    material.opacity = cfg.brightness
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), nextArea)
  }

  return { systems: [], objects: [lines], tick, update }
}

/* ------------------------------------------------------------------ */
/* 09 鸟群 / 萤火虫 / 无人机编队                                         */
/* ------------------------------------------------------------------ */

interface FlockField {
  positions: Float32Array
  velocities: Float32Array
  colors: Float32Array
  homes: Float32Array
  targets: Float32Array
  phase: Float32Array
}

function formationTargets(shape: string, count: number, radius: number, time: number, out: Float32Array): void {
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1)
    let x = 0
    let y = 0
    let z = 0
    if (shape === 'sphere') {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / count)
      const theta = Math.PI * (1 + Math.sqrt(5)) * i
      x = Math.sin(phi) * Math.cos(theta) * radius
      y = Math.cos(phi) * radius
      z = Math.sin(phi) * Math.sin(theta) * radius
    } else if (shape === 'plane') {
      const cols = Math.ceil(Math.sqrt(count))
      const cx = i % cols
      const cz = Math.floor(i / cols)
      x = ((cx / (cols - 1 || 1)) - 0.5) * radius * 2
      z = ((cz / (cols - 1 || 1)) - 0.5) * radius * 2
      y = Math.sin(x * 0.01 + time) * radius * 0.12
    } else if (shape === 'helix') {
      const angle = t * Math.PI * 6
      x = Math.cos(angle) * radius
      z = Math.sin(angle) * radius
      y = (t - 0.5) * radius * 1.6
    } else {
      x = (t - 0.5) * radius * 3
      z = Math.sin(t * Math.PI * 5 + time * 1.2) * radius * 0.9
      y = Math.cos(t * Math.PI * 4 + time) * radius * 0.3
    }
    out[i * 3 + 0] = x
    out[i * 3 + 1] = y + radius * 0.7
    out[i * 3 + 2] = z
  }
}

function buildFlock(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const mode = str(values, 'mode', 'flock')
  const count = Math.max(50, Math.round(num(values, 'count', 700)))
  const size = num(values, 'size', 18)
  const speed = num(values, 'speed', 34)
  const spread = num(values, 'spread', 1200)
  const perception = num(values, 'perception', 90)
  const separation = num(values, 'separation', 1.4)
  const cohesion = num(values, 'cohesion', 0.5)
  const alignment = num(values, 'alignment', 0.9)
  const formation = str(values, 'formation', 'sphere')
  const hue = num(values, 'hue', 190)
  const brightness = num(values, 'brightness', 1)

  const field: FlockField = {
    positions: new Float32Array(count * 3),
    velocities: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    homes: new Float32Array(count * 3),
    targets: new Float32Array(count * 3),
    phase: new Float32Array(count)
  }
  const half = spread / 2
  const tint = new THREE.Color()

  for (let i = 0; i < count; i += 1) {
    const x = (Math.random() * 2 - 1) * half
    const y = 120 + Math.random() * 260
    const z = (Math.random() * 2 - 1) * half
    field.positions[i * 3 + 0] = x
    field.positions[i * 3 + 1] = y
    field.positions[i * 3 + 2] = z
    field.homes[i * 3 + 0] = x
    field.homes[i * 3 + 1] = y
    field.homes[i * 3 + 2] = z
    field.velocities[i * 3 + 0] = (Math.random() * 2 - 1) * speed
    field.velocities[i * 3 + 1] = (Math.random() * 2 - 1) * speed * 0.3
    field.velocities[i * 3 + 2] = (Math.random() * 2 - 1) * speed
    field.phase[i] = Math.random() * Math.PI * 2
  }

  const geometry = new THREE.BufferGeometry()
  const positionAttr = new THREE.BufferAttribute(field.positions, 3)
  const colorAttr = new THREE.BufferAttribute(field.colors, 3)
  geometry.setAttribute('position', positionAttr)
  geometry.setAttribute('color', colorAttr)
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 200, 0), spread * 2)

  const material = new THREE.PointsMaterial({
    size,
    map: ctx.textures.glow,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
    blending: mode === 'flock' ? THREE.NormalBlending : THREE.AdditiveBlending,
    toneMapped: false
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false

  const cfg = {
    mode,
    count,
    size,
    speed,
    spread,
    half,
    perception,
    separation,
    cohesion,
    alignment,
    formation,
    hue,
    brightness
  }
  let time = 0
  let formationTime = 0
  const grid = new Map<number, number[]>()

  const baseColors = (): void => {
    for (let i = 0; i < count; i += 1) {
      if (mode === 'flock') {
        field.colors[i * 3 + 0] = 0.18
        field.colors[i * 3 + 1] = 0.19
        field.colors[i * 3 + 2] = 0.22
      } else {
        tint.setHSL((cfg.hue + (i % 24)) / 360, 0.9, 0.6)
        field.colors[i * 3 + 0] = tint.r
        field.colors[i * 3 + 1] = tint.g
        field.colors[i * 3 + 2] = tint.b
      }
    }
    colorAttr.needsUpdate = true
  }
  baseColors()

  if (mode === 'formation') {
    formationTargets(cfg.formation, count, cfg.spread * 0.35, time, field.targets)
  }

  const cellKey = (x: number, z: number): number => {
    const rad = Math.max(1, cfg.perception)
    const ix = Math.floor(x / rad) + 2048
    const iz = Math.floor(z / rad) + 2048
    return ix * 4096 + iz
  }

  const tickFlock = (delta: number): void => {
    const positions = field.positions
    const velocities = field.velocities
    const rad = Math.max(1, cfg.perception)
    const radSq = rad * rad
    const sepSq = rad * rad * 0.35
    const maxSpeed = cfg.speed * 1.6
    const minSpeed = cfg.speed * 0.4

    grid.clear()
    for (let i = 0; i < count; i += 1) {
      const key = cellKey(positions[i * 3], positions[i * 3 + 2])
      const bucket = grid.get(key)
      if (bucket) bucket.push(i)
      else grid.set(key, [i])
    }

    const targetX = Math.cos(time * 0.2) * rad * 6
    const targetZ = Math.sin(time * 0.2) * rad * 6
    const targetY = 220 + Math.sin(time * 0.3) * 80

    for (let i = 0; i < count; i += 1) {
      const ix = i * 3
      const px = positions[ix]
      const py = positions[ix + 1]
      const pz = positions[ix + 2]
      let cohX = 0
      let cohY = 0
      let cohZ = 0
      let aliX = 0
      let aliY = 0
      let aliZ = 0
      let sepX = 0
      let sepY = 0
      let sepZ = 0
      let neighbors = 0

      const baseIx = Math.floor(px / rad)
      const baseIz = Math.floor(pz / rad)
      for (let dx = -1; dx <= 1 && neighbors < 14; dx += 1) {
        for (let dz = -1; dz <= 1 && neighbors < 14; dz += 1) {
          const bucket = grid.get((baseIx + dx + 2048) * 4096 + (baseIz + dz + 2048))
          if (!bucket) continue
          for (const j of bucket) {
            if (j === i) continue
            const jx = j * 3
            const ddx = positions[jx] - px
            const ddy = positions[jx + 1] - py
            const ddz = positions[jx + 2] - pz
            const distSq = ddx * ddx + ddy * ddy + ddz * ddz
            if (distSq > radSq) continue
            cohX += positions[jx]
            cohY += positions[jx + 1]
            cohZ += positions[jx + 2]
            aliX += velocities[jx]
            aliY += velocities[jx + 1]
            aliZ += velocities[jx + 2]
            if (distSq < sepSq && distSq > 0.0001) {
              sepX -= ddx / distSq
              sepY -= ddy / distSq
              sepZ -= ddz / distSq
            }
            neighbors += 1
            if (neighbors >= 14) break
          }
        }
      }

      let ax = 0
      let ay = 0
      let az = 0
      if (neighbors > 0) {
        cohX = cohX / neighbors - px
        cohY = cohY / neighbors - py
        cohZ = cohZ / neighbors - pz
        ax += cohX * cfg.cohesion * 0.08
        ay += cohY * cfg.cohesion * 0.08
        az += cohZ * cfg.cohesion * 0.08
        ax += (aliX / neighbors - velocities[ix]) * cfg.alignment
        ay += (aliY / neighbors - velocities[ix + 1]) * cfg.alignment
        az += (aliZ / neighbors - velocities[ix + 2]) * cfg.alignment
        ax += sepX * cfg.separation * 40
        ay += sepY * cfg.separation * 40
        az += sepZ * cfg.separation * 40
      }

      ax += (targetX - px) * 0.35
      ay += (targetY - py) * 0.35
      az += (targetZ - pz) * 0.35

      if (px > cfg.half) ax -= (px - cfg.half) * 0.6
      if (px < -cfg.half) ax -= (px + cfg.half) * 0.6
      if (pz > cfg.half) az -= (pz - cfg.half) * 0.6
      if (pz < -cfg.half) az -= (pz + cfg.half) * 0.6

      velocities[ix] += ax * delta
      velocities[ix + 1] += ay * delta
      velocities[ix + 2] += az * delta

      const vmag = Math.hypot(velocities[ix], velocities[ix + 1], velocities[ix + 2]) || 1
      const clamped = Math.min(maxSpeed, Math.max(minSpeed, vmag))
      velocities[ix] = (velocities[ix] / vmag) * clamped
      velocities[ix + 1] = (velocities[ix + 1] / vmag) * clamped
      velocities[ix + 2] = (velocities[ix + 2] / vmag) * clamped

      positions[ix] += velocities[ix] * delta
      positions[ix + 1] += velocities[ix + 1] * delta
      positions[ix + 2] += velocities[ix + 2] * delta
    }

    positionAttr.needsUpdate = true
  }

  const tickFireflies = (delta: number): void => {
    time += delta
    const drift = cfg.spread * 0.16
    const positions = field.positions
    for (let i = 0; i < count; i += 1) {
      const ix = i * 3
      const ph = field.phase[i]
      const homeX = field.homes[ix]
      const homeY = field.homes[ix + 1]
      const homeZ = field.homes[ix + 2]
      positions[ix] = homeX + Math.sin(time * 0.5 + ph) * drift + Math.sin(time * 1.7 + ph * 2) * drift * 0.25
      positions[ix + 1] = homeY + Math.sin(time * 0.8 + ph * 1.3) * drift * 0.4
      positions[ix + 2] = homeZ + Math.cos(time * 0.45 + ph) * drift
      const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 2 + ph))
      if (mode === 'fireflies') {
        tint.setHSL(cfg.hue / 360, 0.95, 0.6 * pulse)
        field.colors[ix] = tint.r
        field.colors[ix + 1] = tint.g
        field.colors[ix + 2] = tint.b
      }
    }
    positionAttr.needsUpdate = true
    colorAttr.needsUpdate = true
  }

  const tickFormation = (delta: number): void => {
    time += delta
    formationTime += delta
    formationTargets(cfg.formation, count, cfg.spread * 0.35, time, field.targets)
    const positions = field.positions
    const ease = Math.min(1, delta * 2.6)
    for (let i = 0; i < count; i += 1) {
      const ix = i * 3
      const jitter = Math.sin(time * 3 + field.phase[i]) * cfg.spread * 0.006
      const tx = field.targets[ix] + jitter
      const ty = field.targets[ix + 1] + jitter * 0.5
      const tz = field.targets[ix + 2] + jitter
      positions[ix] += (tx - positions[ix]) * ease
      positions[ix + 1] += (ty - positions[ix + 1]) * ease
      positions[ix + 2] += (tz - positions[ix + 2]) * ease
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.4 + i * 0.05)
      tint.setHSL(((cfg.hue + (i % 12) * 4) % 360) / 360, 0.9, 0.45 + 0.35 * pulse)
      field.colors[ix] = tint.r
      field.colors[ix + 1] = tint.g
      field.colors[ix + 2] = tint.b
    }
    positionAttr.needsUpdate = true
    colorAttr.needsUpdate = true
  }

  const tick = (delta: number): void => {
    if (mode === 'flock') tickFlock(delta)
    else if (mode === 'fireflies') tickFireflies(delta)
    else tickFormation(delta)
  }

  const update = (v: ParamValues): void => {
    cfg.speed = num(v, 'speed', 34)
    cfg.size = num(v, 'size', 18)
    cfg.perception = num(v, 'perception', 90)
    cfg.separation = num(v, 'separation', 1.4)
    cfg.cohesion = num(v, 'cohesion', 0.5)
    cfg.alignment = num(v, 'alignment', 0.9)
    cfg.hue = num(v, 'hue', 190)
    cfg.brightness = num(v, 'brightness', 1)
    const nextSpread = num(v, 'spread', 1200)
    if (nextSpread !== cfg.spread) {
      const scale = nextSpread / cfg.spread
      for (let i = 0; i < count * 3; i += 1) {
        field.positions[i] *= scale
        field.homes[i] *= scale
      }
      cfg.spread = nextSpread
      cfg.half = nextSpread / 2
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 200, 0), nextSpread * 2)
    }
    const nextFormation = str(v, 'formation', 'sphere')
    if (nextFormation !== cfg.formation) cfg.formation = nextFormation
    if (mode === 'flock') {
      material.size = cfg.size
      baseColors()
    } else {
      material.size = cfg.size
      material.opacity = Math.min(1, cfg.brightness)
    }
  }

  return { systems: [], objects: [points], tick, update }
}

/* ------------------------------------------------------------------ */
/* 10 雪 + 风吹雪 + 积雪累积                                             */
/* ------------------------------------------------------------------ */

function buildSnow(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const count = num(values, 'count', 3200)
  const flakeCount = num(values, 'flakeCount', 550)
  const bokehCount = num(values, 'bokeh', 220)
  const size = num(values, 'size', 0.5)
  const fallSpeed = num(values, 'fallSpeed', 6)
  const area = num(values, 'area', 260)
  const height = num(values, 'height', 130)
  const wind = num(values, 'wind', 6)
  const windDir = num(values, 'windDir', 35)
  const sway = num(values, 'sway', 1.2)
  const blow = num(values, 'blow', 900)
  const blowSpeed = num(values, 'blowSpeed', 14)
  const accumulation = num(values, 'accumulation', 0.6)
  const opacity = num(values, 'opacity', 0.85)
  const spin = num(values, 'spin', 1.2)
  const gust = num(values, 'gust', 0.45)

  const windVec = new QVector3(Math.cos(windDir * DEG), 0, Math.sin(windDir * DEG))
  const windMag = new ConstantValue(wind * 0.6)
  const blowMag = new ConstantValue(blowSpeed)

  const fallTime = Math.max(1, height / Math.max(1, fallSpeed))

  const fineRate = new ConstantValue((count / fallTime) * 1.6)
  const fineLife = new IntervalValue(fallTime * 0.8, fallTime * 1.2)
  const fineSpeed = new IntervalValue(0.2, 1)
  const fineSize = new IntervalValue(size * 0.6, size * 1.1)
  const fineGravity = new ConstantValue(fallSpeed)
  const fineEmitter = new RectangleEmitter({ width: area, height: area, thickness: 1 })
  const fine = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: fineEmitter,
    startLife: fineLife,
    startSpeed: fineSpeed,
    startSize: fineSize,
    startColor: new ColorRange(hexToQ4('#ffffff'), hexToQ4('#e6f0fb')),
    emissionOverTime: fineRate,
    behaviors: [
      new ApplyForce(q3(0, -1, 0), fineGravity),
      new ApplyForce(windVec, windMag),
      sizeCurve(0.7, 1, 1, 0.7),
      new ColorOverLife(whiteAlpha([[0, 0], [0.85, 0.15], [0.72, 0.8], [0, 1]], 1)),
      new TurbulenceField(q3(2, 2, 2), 2, q3(sway * 0.5, sway * 0.15, sway * 0.5), q3(0.4, 0.4, 0.4))
    ],
    renderMode: RenderMode.BillBoard,
    material: normalBlend(ctx.textures.soft, opacity * 0.9),
    rendererEmitterSettings: {}
  })
  fine.emitter.position.set(0, height, 0)
  fine.emitter.rotation.x = Math.PI / 2

  const flakeRate = new ConstantValue((flakeCount / fallTime) * 1.6)
  const flakeLife = new IntervalValue(fallTime * 0.8, fallTime * 1.3)
  const flakeSize = new IntervalValue(size * 1.9, size * 3.8)
  const flakeSpinGen = new IntervalValue(-spin, spin)
  const flakeGravity = new ConstantValue(fallSpeed * 0.78)
  const flakeEmitter = new RectangleEmitter({ width: area * 0.9, height: area * 0.9, thickness: 1 })
  const flakeRotation = new AxisAngleGenerator(q3(0, 0, 1), flakeSpinGen)
  const flakes = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: flakeEmitter,
    startLife: flakeLife,
    startSpeed: fineSpeed,
    startSize: flakeSize,
    startColor: new ColorRange(hexToQ4('#ffffff'), hexToQ4('#d8e8f8')),
    startRotation: new RandomQuatGenerator(),
    emissionOverTime: flakeRate,
    behaviors: [
      new ApplyForce(q3(0, -1, 0), flakeGravity),
      new ApplyForce(windVec, windMag),
      new Rotation3DOverLife(flakeRotation),
      sizeCurve(0.8, 1, 0.9, 0.6),
      new ColorOverLife(whiteAlpha([[0, 0], [0.9, 0.12], [0.78, 0.75], [0, 1]], 1)),
      new TurbulenceField(q3(2.5, 2.5, 2.5), 2, q3(sway * 0.8, sway * 0.3, sway * 0.8), q3(0.5, 0.5, 0.5))
    ],
    renderMode: RenderMode.BillBoard,
    material: normalBlend(ctx.textures.snowflake, opacity * 0.95),
    rendererEmitterSettings: {}
  })
  flakes.emitter.position.set(0, height * 0.82, 0)
  flakes.emitter.rotation.x = Math.PI / 2

  const blowRate = new ConstantValue((blow / Math.max(1, blowSpeed)) * 6)
  const blowLife = new IntervalValue(1.2, 3)
  const blowSize = new IntervalValue(size * 0.4, size * 0.9)
  const blowEmitter = new RectangleEmitter({ width: area * 0.8, height: area * 0.8, thickness: 3 })
  const blowing = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: blowEmitter,
    startLife: blowLife,
    startSpeed: new IntervalValue(blowSpeed * 0.6, blowSpeed * 1.2),
    startSize: blowSize,
    startColor: new ColorRange(hexToQ4('#ffffff'), hexToQ4('#dce9f5')),
    emissionOverTime: blowRate,
    behaviors: [
      new ApplyForce(windVec, blowMag),
      new ApplyForce(q3(0, -1, 0), new ConstantValue(1.5)),
      sizeCurve(0.3, 0.9, 0.9, 0.2),
      new ColorOverLife(whiteAlpha([[0, 0], [0.5, 0.2], [0.35, 0.7], [0, 1]], 1)),
      new TurbulenceField(q3(3, 2, 3), 2, q3(sway, sway * 0.3, sway), q3(0.6, 0.6, 0.6))
    ],
    renderMode: RenderMode.StretchedBillBoard,
    material: additive(ctx.textures.soft, opacity * 0.5),
    rendererEmitterSettings: { speedFactor: 1, lengthFactor: 0.12 }
  })
  blowing.emitter.position.set(0, 2.5, 0)
  blowing.emitter.rotation.x = Math.PI / 2

  const bokehRate = new ConstantValue((bokehCount / fallTime) * 1.4)
  const bokehLife = new IntervalValue(fallTime * 0.65, fallTime * 1.05)
  const bokehSize = new IntervalValue(size * 8, size * 20)
  const bokehGravity = new ConstantValue(fallSpeed * 1.15)
  const bokehEmitter = new RectangleEmitter({ width: area * 0.7, height: area * 0.7, thickness: 1 })
  const bokeh = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: bokehEmitter,
    startLife: bokehLife,
    startSpeed: fineSpeed,
    startSize: bokehSize,
    startColor: new ColorRange(hexToQ4('#ffffff'), hexToQ4('#eef6ff')),
    emissionOverTime: bokehRate,
    behaviors: [
      new ApplyForce(q3(0, -1, 0), bokehGravity),
      new ApplyForce(windVec, windMag),
      sizeCurve(0.5, 1, 1.1, 0.6),
      new ColorOverLife(whiteAlpha([[0, 0], [0.7, 0.2], [0.55, 0.8], [0, 1]], 1)),
      new TurbulenceField(q3(1.5, 1.5, 1.5), 2, q3(sway * 0.4, sway * 0.2, sway * 0.4), q3(0.3, 0.3, 0.3))
    ],
    renderMode: RenderMode.BillBoard,
    material: normalBlend(ctx.textures.soft, opacity * 0.22),
    rendererEmitterSettings: {}
  })
  bokeh.emitter.position.set(0, height * 0.55, 0)
  bokeh.emitter.rotation.x = Math.PI / 2

  setParticleOpacity(fine, opacity)
  setParticleOpacity(flakes, opacity)
  setParticleOpacity(blowing, opacity)
  setParticleOpacity(bokeh, opacity * 0.5)

  const moundHeight = (x: number, y: number, side: number): number => {
    const halfSide = side / 2
    const r = Math.hypot(x, y) / halfSide
    const falloff = 1 - smoothstep(0.4, 1, r)
    const waves =
      0.55 +
      0.3 * Math.sin(x * 0.045 + 0.7) * Math.cos(y * 0.05 - 1.1) +
      0.18 * Math.sin(x * 0.12 + y * 0.09 + 2.3) +
      0.1 * Math.sin(x * 0.31 - y * 0.27)
    return Math.max(4, side * 0.06) * falloff * Math.max(0.05, waves)
  }

  const buildMound = (side: number): THREE.BufferGeometry => {
    const segments = 72
    const geometry = new THREE.PlaneGeometry(side, side, segments, segments)
    const position = geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < position.count; i += 1) {
      position.setZ(i, moundHeight(position.getX(i), position.getY(i), side))
    }
    geometry.computeVertexNormals()
    const normal = geometry.attributes.normal as THREE.BufferAttribute
    const colors = new Float32Array(position.count * 3)
    const base = new THREE.Color('#eef4fb')
    const shade = new THREE.Color('#b9cfe6')
    const light = new THREE.Vector3(0.3, 0.35, 0.9).normalize()
    const scratch = new THREE.Vector3()
    const tint = new THREE.Color()
    for (let i = 0; i < position.count; i += 1) {
      scratch.set(normal.getX(i), normal.getY(i), normal.getZ(i))
      const lambert = Math.max(0, scratch.dot(light))
      tint.copy(base).lerp(shade, 1 - (0.3 + 0.7 * lambert))
      colors[i * 3 + 0] = tint.r
      colors[i * 3 + 1] = tint.g
      colors[i * 3 + 2] = tint.b
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geometry
  }

  const buildSparkles = (side: number): THREE.BufferGeometry => {
    const sparkleCount = 460
    const positions = new Float32Array(sparkleCount * 3)
    const halfSide = side / 2
    for (let i = 0; i < sparkleCount; i += 1) {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.sqrt(Math.random()) * halfSide * 0.88
      const x = Math.cos(angle) * radius
      const y = Math.sin(angle) * radius
      positions[i * 3 + 0] = x
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = moundHeight(x, y, side) + 1
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return geometry
  }

  const groundMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  })
  const ground = new THREE.Mesh(buildMound(area * 1.5), groundMaterial)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = 0.02

  const sparkleMaterial = new THREE.PointsMaterial({
    map: ctx.textures.spark,
    size: Math.max(0.8, size * 1.6),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    toneMapped: false
  })
  const sparkles = new THREE.Points(buildSparkles(area * 1.5), sparkleMaterial)
  sparkles.rotation.x = -Math.PI / 2
  sparkles.position.y = 0.02

  const cfg = {
    fallSpeed,
    wind,
    windDir,
    blowSpeed,
    gust,
    accumulation,
    opacity,
    spin,
    area,
    height,
    depth: 0
  }
  let time = 0

  const tick = (delta: number): void => {
    time += delta
    cfg.depth += (cfg.accumulation - cfg.depth) * Math.min(1, delta * 0.5)

    const gustPhase = Math.sin(time * 0.45) * 0.6 + Math.sin(time * 1.63 + 1.2) * 0.4
    const windScale = 1 + cfg.gust * gustPhase
    windMag.value = cfg.wind * 0.6 * windScale
    blowMag.value = cfg.blowSpeed * (1 + cfg.gust * 0.5 * gustPhase)

    const spread = 0.62 + 0.38 * Math.min(1, cfg.depth / 0.6)
    ground.scale.set(spread, spread, 0.2 + 0.8 * cfg.depth)
    groundMaterial.opacity = cfg.depth * 0.92
    sparkleMaterial.opacity = cfg.depth * (0.3 + 0.28 * (0.5 + 0.5 * Math.sin(time * 1.7)))
  }

  const update = (v: ParamValues): void => {
    const c = num(v, 'count', 3200)
    const fc = num(v, 'flakeCount', 550)
    const bc = num(v, 'bokeh', 220)
    const sz = num(v, 'size', 0.5)
    const fs = num(v, 'fallSpeed', 6)
    const ar = num(v, 'area', 260)
    const h = num(v, 'height', 130)
    const wd = num(v, 'wind', 6)
    const dir = num(v, 'windDir', 35)
    const sw = num(v, 'sway', 1.2)
    const bl = num(v, 'blow', 900)
    const bs = num(v, 'blowSpeed', 14)
    const op = num(v, 'opacity', 0.85)
    const sp = num(v, 'spin', 1.2)
    const gu = num(v, 'gust', 0.45)

    cfg.fallSpeed = fs
    cfg.wind = wd
    cfg.windDir = dir
    cfg.blowSpeed = bs
    cfg.gust = gu
    cfg.accumulation = num(v, 'accumulation', 0.6)
    cfg.opacity = op
    cfg.spin = sp
    const areaChanged = ar !== cfg.area
    cfg.area = ar
    cfg.height = h

    const nextFall = Math.max(1, h / Math.max(1, fs))
    fineRate.value = (c / nextFall) * 1.6
    fineLife.a = nextFall * 0.8
    fineLife.b = nextFall * 1.2
    fineSize.a = sz * 0.6
    fineSize.b = sz * 1.1
    fineGravity.value = fs
    fineEmitter.width = ar
    fineEmitter.height = ar
    fine.emitter.position.set(0, h, 0)
    setParticleOpacity(fine, op)

    flakeRate.value = (fc / nextFall) * 1.6
    flakeLife.a = nextFall * 0.8
    flakeLife.b = nextFall * 1.3
    flakeSize.a = sz * 1.9
    flakeSize.b = sz * 3.8
    flakeSpinGen.a = -sp
    flakeSpinGen.b = sp
    flakeGravity.value = fs * 0.78
    flakeEmitter.width = ar * 0.9
    flakeEmitter.height = ar * 0.9
    flakes.emitter.position.set(0, h * 0.82, 0)
    setParticleOpacity(flakes, op)

    blowRate.value = (bl / Math.max(1, bs)) * 6
    blowEmitter.width = ar * 0.8
    blowEmitter.height = ar * 0.8
    setParticleOpacity(blowing, op)

    bokehRate.value = (bc / nextFall) * 1.4
    bokehLife.a = nextFall * 0.65
    bokehLife.b = nextFall * 1.05
    bokehSize.a = sz * 8
    bokehSize.b = sz * 20
    bokehGravity.value = fs * 1.15
    bokehEmitter.width = ar * 0.7
    bokehEmitter.height = ar * 0.7
    bokeh.emitter.position.set(0, h * 0.55, 0)
    setParticleOpacity(bokeh, op * 0.5)

    const rad = dir * DEG
    windVec.set(Math.cos(rad), 0, Math.sin(rad))
    windMag.value = wd * 0.6
    blowMag.value = bs

    if (areaChanged) {
      ground.geometry.dispose()
      ground.geometry = buildMound(ar * 1.5)
      sparkles.geometry.dispose()
      sparkles.geometry = buildSparkles(ar * 1.5)
    }
    sparkleMaterial.size = Math.max(0.8, sz * 1.6)
  }

  return { systems: [fine, flakes, blowing, bokeh], objects: [ground, sparkles], tick, update }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const EARTH_META: Record<EarthEffectId, EffectMeta> = {
  aurora: {
    id: 'aurora',
    title: 'VFX 极光',
    subtitle: '带状帘幕 + 射线结构',
    description:
      '以少量超大带状帘幕替代海量粒子，顶点着色器用多层正弦叠加调制褶皱与底部锐利边界，片元着色器叠加垂直射线并做上红下绿的高度分层着色，整体做缓慢东西向漂移与亮度脉动。帘幕数量、宽高、距离、亮度、相位速度、褶皱幅度与频率、上下颜色均可调整。',
    params: [
      { key: 'curtainCount', label: '帘幕数量', kind: 'number', min: 4, max: 28, step: 1, unit: '条', default: 14 },
      { key: 'width', label: '帘幕宽度', kind: 'number', min: 800, max: 5000, step: 100, default: 2600 },
      { key: 'height', label: '帘幕高度', kind: 'number', min: 400, max: 3000, step: 50, default: 1400 },
      { key: 'distance', label: '观察距离', kind: 'number', min: 2500, max: 12000, step: 100, default: 5200 },
      { key: 'brightness', label: '整体亮度', kind: 'number', min: 0.2, max: 1.6, step: 0.05, default: 0.85 },
      { key: 'speed', label: '相位速度', kind: 'number', min: 0, max: 2, step: 0.05, default: 0.5 },
      { key: 'wave', label: '褶皱幅度', kind: 'number', min: 0, max: 800, step: 20, default: 320 },
      { key: 'fold', label: '褶皱频率', kind: 'number', min: 1, max: 8, step: 0.5, default: 3 },
      { key: 'bottomColor', label: '底部颜色', kind: 'color', default: '#39f7a8' },
      { key: 'topColor', label: '顶部颜色', kind: 'color', default: '#ff4f8b' }
    ],
    rebuildKeys: ['curtainCount', 'width', 'height', 'distance']
  },
  'urban-fire': {
    id: 'urban-fire',
    title: 'VFX 城市火灾蔓延',
    subtitle: '多火点 + 风场蔓延状态机',
    description:
      '街区建筑网格中每个着火单元挂一组火焰与烟羽发射器，轻量状态机按“未燃→燃烧→熄灭”推进，并按风向对下风侧邻栋提高引燃概率。建筑体色随状态在正常、燃烧、焦黑间切换，火势受风驱动弯曲。场景粒子总量按当前燃烧单元数自动均摊，蔓延到整片街区时单栋发射量下调以稳定帧率。网格规模、火焰/烟雾量、蔓延概率与间隔、燃烧时长、风向风速、烟雾浓度与亮度均可调整。',
    params: [
      { key: 'gridSize', label: '街区网格', kind: 'number', min: 2, max: 5, step: 1, unit: '×N', default: 4 },
      { key: 'fireRate', label: '火焰量', kind: 'number', min: 100, max: 1200, step: 50, unit: '个/秒', default: 520 },
      { key: 'smokeRate', label: '烟雾量', kind: 'number', min: 100, max: 900, step: 50, unit: '个/秒', default: 320 },
      { key: 'fireSize', label: '火焰尺寸', kind: 'number', min: 0.5, max: 4, step: 0.1, default: 1.8 },
      { key: 'spreadChance', label: '蔓延概率', kind: 'number', min: 0.05, max: 0.8, step: 0.05, default: 0.3 },
      { key: 'spreadInterval', label: '蔓延间隔', kind: 'number', min: 1, max: 8, step: 0.5, unit: '秒', default: 3 },
      { key: 'burnDuration', label: '燃烧时长', kind: 'number', min: 5, max: 45, step: 1, unit: '秒', default: 22 },
      { key: 'wind', label: '风速', kind: 'number', min: 0, max: 25, step: 0.5, default: 8 },
      { key: 'windDir', label: '风向', kind: 'number', min: 0, max: 360, step: 5, unit: '°', default: 60 },
      { key: 'smokeOpacity', label: '烟雾浓度', kind: 'number', min: 0.1, max: 1, step: 0.05, default: 0.9 },
      { key: 'glow', label: '火光强度', kind: 'number', min: 0.2, max: 1, step: 0.05, default: 1 }
    ],
    rebuildKeys: ['gridSize']
  },
  'wind-field': {
    id: 'wind-field',
    title: 'VFX 全球风场可视化',
    subtitle: '无散度流函数风场 + 急流与气旋',
    description:
      '海量短拖尾粒子在无散度矢量风场中平流，寿命到期后原地重生以保持总数恒定，形成流动的“风之河”。风场由多尺度流函数涡旋（u=∂ψ/∂z、w=-∂ψ/∂x，保证不可压）叠加纬向急流带与近似 Rankine 气旋切向风构成，并按高度施加风速切变；粒子采用中点积分保证轨迹平滑，拖尾用时间常数连续逼近，速度映射到深蓝→青→绿→黄→橙→红的色带。风场在粗网格上采样、粒子经双线性插值读取，逐粒子开销大幅降低。粒子数、区域范围、风速、湍流、寿命、拖尾长度、气旋强度/半径、高度与厚度、亮度均可调整。',
    params: [
      { key: 'count', label: '粒子数量', kind: 'number', min: 1000, max: 20000, step: 500, unit: '个', default: 4500 },
      { key: 'area', label: '区域范围', kind: 'number', min: 4000, max: 60000, step: 1000, default: 26000 },
      { key: 'speed', label: '风速', kind: 'number', min: 20, max: 400, step: 10, default: 140 },
      { key: 'turbulence', label: '湍流强度', kind: 'number', min: 0, max: 3, step: 0.1, default: 0.8 },
      { key: 'life', label: '粒子寿命', kind: 'number', min: 1, max: 16, step: 0.5, unit: '秒', default: 6 },
      { key: 'trail', label: '拖尾长度', kind: 'number', min: 100, max: 4000, step: 50, default: 900 },
      { key: 'eye', label: '涡旋强度', kind: 'number', min: 0, max: 3, step: 0.1, default: 1 },
      { key: 'eyeRadius', label: '涡旋半径', kind: 'number', min: 1000, max: 12000, step: 500, default: 5200 },
      { key: 'altitude', label: '风层高度', kind: 'number', min: 100, max: 4000, step: 50, default: 900 },
      { key: 'thickness', label: '风层厚度', kind: 'number', min: 0, max: 3000, step: 100, default: 700 },
      { key: 'brightness', label: '整体亮度', kind: 'number', min: 0.2, max: 1.5, step: 0.05, default: 0.9 }
    ],
    rebuildKeys: ['count']
  },
  flock: {
    id: 'flock',
    title: 'VFX 群体编队',
    subtitle: 'Boids 鸟群 / 萤火虫 / 无人机灯光秀',
    description:
      '鸟群模式用 boids 分离/对齐/凝聚三规则配合空间哈希网格做邻域加速，并追随缓慢巡游的目标点；萤火虫模式以相位噪声随机游走并做亮度脉动；编队模式改为球面、平面、螺旋、波浪等确定性图案并用缓动插值完成队形变换。个体数、尺寸、速度、活动范围、感知半径、三项权重、队形、色相与亮度均可调整。',
    params: [
      {
        key: 'mode',
        label: '表现模式',
        kind: 'select',
        default: 'flock',
        options: [
          { label: '鸟群 (boids)', value: 'flock' },
          { label: '萤火虫', value: 'fireflies' },
          { label: '无人机编队', value: 'formation' }
        ]
      },
      { key: 'count', label: '个体数量', kind: 'number', min: 200, max: 3000, step: 100, unit: '个', default: 700 },
      { key: 'size', label: '个体尺寸', kind: 'number', min: 2, max: 60, step: 1, default: 18 },
      { key: 'speed', label: '移动速度', kind: 'number', min: 5, max: 120, step: 1, default: 34 },
      { key: 'spread', label: '活动范围', kind: 'number', min: 200, max: 4000, step: 50, default: 1200 },
      { key: 'perception', label: '感知半径', kind: 'number', min: 20, max: 300, step: 5, default: 90 },
      { key: 'separation', label: '分离权重', kind: 'number', min: 0, max: 3, step: 0.1, default: 1.4 },
      { key: 'cohesion', label: '凝聚权重', kind: 'number', min: 0, max: 2, step: 0.05, default: 0.5 },
      { key: 'alignment', label: '对齐权重', kind: 'number', min: 0, max: 3, step: 0.1, default: 0.9 },
      {
        key: 'formation',
        label: '编队队形',
        kind: 'select',
        default: 'sphere',
        options: [
          { label: '球面', value: 'sphere' },
          { label: '平面', value: 'plane' },
          { label: '螺旋', value: 'helix' },
          { label: '波浪', value: 'wave' }
        ]
      },
      { key: 'hue', label: '色相', kind: 'number', min: 0, max: 360, step: 5, unit: '°', default: 190 },
      { key: 'brightness', label: '发光亮度', kind: 'number', min: 0.3, max: 2, step: 0.05, default: 1 }
    ],
    rebuildKeys: ['mode', 'count']
  },
  snow: {
    id: 'snow',
    title: 'VFX 雪 / 风吹雪 / 积雪',
    subtitle: '树状雪花 + 近景散景 + 风阵吹雪 + 积雪堆积',
    description:
      '分层还原真实降雪：细雪为柔和小点，片状雪花使用程序化六重枝晶纹理并带随机初始姿态与三维翻滚，近景再叠加一层放大虚化散景以制造景深视差。飘落阶段受统一风向与周期性阵风拖曳，贴地吹雪用拉伸拖尾沿风向外扫。地表为噪声起伏的积雪堆，随累积参数由中心向外铺展、抬升并逐渐亮起；表面散布闪烁雪晶。细雪/片状/散景数量、雪花尺寸、下落速度、范围高度、风向风速、阵风、摆动、吹雪量/速度、积雪厚度、自旋与整体不透明度均可调整。',
    params: [
      { key: 'count', label: '细雪数量', kind: 'number', min: 500, max: 9000, step: 250, unit: '个', default: 3200 },
      { key: 'flakeCount', label: '片状雪花', kind: 'number', min: 0, max: 3000, step: 100, unit: '个', default: 550 },
      { key: 'bokeh', label: '近景散景', kind: 'number', min: 0, max: 1500, step: 50, unit: '个', default: 220 },
      { key: 'size', label: '雪花尺寸', kind: 'number', min: 0.1, max: 3, step: 0.05, default: 0.5 },
      { key: 'fallSpeed', label: '下落速度', kind: 'number', min: 2, max: 20, step: 0.5, default: 6 },
      { key: 'area', label: '降雪范围', kind: 'number', min: 60, max: 800, step: 20, default: 260 },
      { key: 'height', label: '降雪高度', kind: 'number', min: 40, max: 400, step: 10, default: 130 },
      { key: 'wind', label: '风速', kind: 'number', min: 0, max: 25, step: 0.5, default: 6 },
      { key: 'windDir', label: '风向', kind: 'number', min: 0, max: 360, step: 5, unit: '°', default: 35 },
      { key: 'gust', label: '阵风强度', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.45 },
      { key: 'sway', label: '摆动强度', kind: 'number', min: 0, max: 4, step: 0.1, default: 1.2 },
      { key: 'blow', label: '吹雪浓度', kind: 'number', min: 0, max: 3000, step: 50, default: 900 },
      { key: 'blowSpeed', label: '吹雪速度', kind: 'number', min: 4, max: 30, step: 0.5, default: 14 },
      { key: 'accumulation', label: '积雪厚度', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.6 },
      { key: 'opacity', label: '整体不透明度', kind: 'number', min: 0.2, max: 1, step: 0.05, default: 0.85 },
      { key: 'spin', label: '雪花自旋', kind: 'number', min: 0, max: 4, step: 0.1, default: 1.2 }
    ]
  }
}

export const EARTH_EFFECT_IDS: EarthEffectId[] = ['aurora', 'urban-fire', 'wind-field', 'flock', 'snow']

export function buildEarthEffect(id: EarthEffectId, values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  switch (id) {
    case 'aurora':
      return buildAurora(values, ctx)
    case 'urban-fire':
      return buildUrbanFire(values, ctx)
    case 'wind-field':
      return buildWindField(values, ctx)
    case 'flock':
      return buildFlock(values, ctx)
    case 'snow':
      return buildSnow(values, ctx)
    default: {
      const exhaustive: never = id
      return exhaustive
    }
  }
}
