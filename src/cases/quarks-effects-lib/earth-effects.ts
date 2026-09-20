import * as THREE from 'three'
import {
  ApplyForce,
  ColorOverLife,
  ColorRange,
  ConstantValue,
  ConeEmitter,
  IntervalValue,
  ParticleSystem,
  RectangleEmitter,
  RenderMode,
  RotationOverLife,
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
  sizeCurve,
  str,
  whiteAlpha,
  type BuiltEffect,
  type EffectBuildContext,
  type EffectMeta,
  type ParamValues
} from './effect-kit'

export type EarthEffectId = 'aurora' | 'urban-fire' | 'wind-field' | 'flock' | 'snow'

function createRadialDiscTexture(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,0.95)')
  grad.addColorStop(0.55, 'rgba(255,255,255,0.55)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

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
  const smokeOpacity = num(values, 'smokeOpacity', 0.45)
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
      fire.material.opacity = Math.min(1, glow)

      const smokeRate = new ConstantValue(0)
      const smokeLife = new IntervalValue(7, 14)
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
          new TurbulenceField(q3(3, 3, 3), 2, q3(0.7, 0.5, 0.7), q3(0.25, 0.25, 0.25))
        ],
        renderMode: RenderMode.BillBoard,
        material: normalBlend(ctx.textures.smoke, smokeOpacity),
        rendererEmitterSettings: {}
      })
      smoke.emitter.position.set(x, h, z)
      smoke.emitter.rotation.x = -Math.PI / 2

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
      if (cell.state !== 1) continue
      burning += 1
      cell.age += delta
      const flicker = 0.82 + 0.18 * Math.sin(time * 8 + cell.phase)
      cell.fireRate.value = cfg.fireRate * flicker
      cell.smokeRate.value = cfg.smokeRate
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
    const so = num(v, 'smokeOpacity', 0.45)
    const fireOpacity = Math.min(1, cfg.glow)
    for (const cell of cells) {
      if (cell.state === 1) {
        cell.fireRate.value = cfg.fireRate
        cell.smokeRate.value = cfg.smokeRate
      }
      cell.fire.material.opacity = fireOpacity
      cell.smoke.material.opacity = so
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
  prevX: number
  prevZ: number
  age: number
  life: number
}

function buildWindField(values: ParamValues, _ctx: EffectBuildContext): BuiltEffect {
  const count = Math.max(200, Math.round(num(values, 'count', 7000)))
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
  const colors = new Float32Array(count * 6)
  const half = area / 2

  const particles: WindParticle[] = []
  const spawn = (p: WindParticle): void => {
    p.x = (Math.random() * 2 - 1) * half
    p.z = (Math.random() * 2 - 1) * half
    p.y = altitude + (Math.random() * 2 - 1) * thickness
    p.prevX = p.x
    p.prevZ = p.z
    p.age = Math.random() * life
    p.life = life * (0.6 + Math.random() * 0.8)
  }

  for (let i = 0; i < count; i += 1) {
    const particle: WindParticle = { x: 0, y: 0, z: 0, prevX: 0, prevZ: 0, age: 0, life }
    spawn(particle)
    particles.push(particle)
  }

  const geometry = new THREE.BufferGeometry()
  const positionAttr = new THREE.BufferAttribute(positions, 3)
  const colorAttr = new THREE.BufferAttribute(colors, 3)
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
  const halfRef = { value: half }
  let time = 0

  const color = new THREE.Color()

  const field = (x: number, z: number, out: { x: number; z: number }): void => {
    const s = 0.00035
    const t = time
    let vx =
      Math.sin(z * s + t * 0.11) +
      0.55 * Math.sin((x + z) * s * 2.3 - t * 0.16) +
      0.35 * Math.sin((x * 0.7 - z) * s * 3.1 + t * 0.23)
    let vz =
      Math.cos(x * s - t * 0.13) +
      0.55 * Math.cos((x - z) * s * 1.9 + t * 0.19) +
      0.35 * Math.cos((x + z * 0.6) * s * 2.7 - t * 0.27)
    vx += cfg.turbulence * 0.7 * Math.sin(z * s * 9 + t * 0.9)
    vz += cfg.turbulence * 0.7 * Math.cos(x * s * 9 - t * 0.8)
    const r2 = x * x + z * z
    const e = cfg.eye * Math.exp(-r2 / (2 * cfg.eyeRadius * cfg.eyeRadius))
    vx += -z * 0.00035 * e
    vz += x * 0.00035 * e
    out.x = vx
    out.z = vz
  }

  const sample = { x: 0, z: 0 }

  const tick = (delta: number): void => {
    time += delta
    const step = cfg.speed * delta
    const halfNow = halfRef.value
    const trailSq = cfg.trail * cfg.trail

    for (let i = 0; i < count; i += 1) {
      const p = particles[i]
      p.age += delta
      field(p.x, p.z, sample)
      const magnitude = Math.hypot(sample.x, sample.z)
      p.x += sample.x * step
      p.z += sample.z * step

      const dx = p.x - p.prevX
      const dz = p.z - p.prevZ
      if (dx * dx + dz * dz > trailSq) {
        p.prevX = p.x
        p.prevZ = p.z
      }

      if (p.age > p.life || Math.abs(p.x) > halfNow || Math.abs(p.z) > halfNow) {
        spawn(p)
        p.life = cfg.life * (0.6 + Math.random() * 0.8)
        p.age = 0
      }

      const base = i * 6
      positions[base + 0] = p.prevX
      positions[base + 1] = p.y
      positions[base + 2] = p.prevZ
      positions[base + 3] = p.x
      positions[base + 4] = p.y
      positions[base + 5] = p.z

      const speedLevel = Math.min(1, Math.max(0, (magnitude - 0.7) / 2.4))
      color.setHSL(0.62 - 0.62 * speedLevel, 1, 0.5 + 0.12 * speedLevel)
      colors[base + 0] = color.r
      colors[base + 1] = color.g
      colors[base + 2] = color.b
      colors[base + 3] = color.r
      colors[base + 4] = color.g
      colors[base + 5] = color.b
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
  const count = num(values, 'count', 4200)
  const flakeCount = num(values, 'flakeCount', 700)
  const size = num(values, 'size', 0.5)
  const fallSpeed = num(values, 'fallSpeed', 6)
  const area = num(values, 'area', 260)
  const height = num(values, 'height', 150)
  const wind = num(values, 'wind', 6)
  const windDir = num(values, 'windDir', 35)
  const sway = num(values, 'sway', 1.2)
  const blow = num(values, 'blow', 1200)
  const blowSpeed = num(values, 'blowSpeed', 14)
  const accumulation = num(values, 'accumulation', 0.6)
  const opacity = num(values, 'opacity', 0.85)
  const spin = num(values, 'spin', 1.2)

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
    duration: 400,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: fineEmitter,
    startLife: fineLife,
    startSpeed: fineSpeed,
    startSize: fineSize,
    startColor: new ColorRange(hexToQ4('#ffffff'), hexToQ4('#dbe9f7')),
    emissionOverTime: fineRate,
    behaviors: [
      new ApplyForce(q3(0, -1, 0), fineGravity),
      new ApplyForce(windVec, windMag),
      sizeCurve(0.7, 1, 1, 0.7),
      new ColorOverLife(whiteAlpha([[0, 0], [0.85, 0.15], [0.7, 0.8], [0, 1]], 1)),
      new TurbulenceField(q3(2, 2, 2), 2, q3(sway * 0.5, sway * 0.15, sway * 0.5), q3(0.4, 0.4, 0.4))
    ],
    renderMode: RenderMode.BillBoard,
    material: normalBlend(ctx.textures.soft, opacity),
    rendererEmitterSettings: {}
  })
  fine.emitter.position.set(0, height, 0)
  fine.emitter.rotation.x = Math.PI / 2

  const flakeRate = new ConstantValue((flakeCount / fallTime) * 1.6)
  const flakeLife = new IntervalValue(fallTime * 0.8, fallTime * 1.3)
  const flakeSize = new IntervalValue(size * 1.8, size * 3.4)
  const flakeSpinGen = new IntervalValue(-spin, spin)
  const flakeGravity = new ConstantValue(fallSpeed * 0.75)
  const flakeEmitter = new RectangleEmitter({ width: area * 0.9, height: area * 0.9, thickness: 1 })
  const flakes = new ParticleSystem({
    duration: 400,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: flakeEmitter,
    startLife: flakeLife,
    startSpeed: fineSpeed,
    startSize: flakeSize,
    startColor: new ColorRange(hexToQ4('#ffffff'), hexToQ4('#cfe2f5')),
    emissionOverTime: flakeRate,
    behaviors: [
      new ApplyForce(q3(0, -1, 0), flakeGravity),
      new ApplyForce(windVec, windMag),
      new RotationOverLife(flakeSpinGen),
      sizeCurve(0.8, 1, 0.9, 0.6),
      new ColorOverLife(whiteAlpha([[0, 0], [0.9, 0.12], [0.75, 0.75], [0, 1]], 1)),
      new TurbulenceField(q3(2.5, 2.5, 2.5), 2, q3(sway * 0.8, sway * 0.3, sway * 0.8), q3(0.5, 0.5, 0.5))
    ],
    renderMode: RenderMode.BillBoard,
    material: additive(ctx.textures.glow, opacity * 0.7),
    rendererEmitterSettings: {}
  })
  flakes.emitter.position.set(0, height * 0.8, 0)
  flakes.emitter.rotation.x = Math.PI / 2

  const blowRate = new ConstantValue((blow / Math.max(1, blowSpeed)) * 6)
  const blowLife = new IntervalValue(1.2, 3)
  const blowSize = new IntervalValue(size * 0.4, size * 0.9)
  const blowEmitter = new RectangleEmitter({ width: area * 0.8, height: area * 0.8, thickness: 3 })
  const blowing = new ParticleSystem({
    duration: 300,
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

  const groundTexture = createRadialDiscTexture()
  const groundMaterial = new THREE.MeshBasicMaterial({
    map: groundTexture,
    color: new THREE.Color('#f4f8fd'),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  })
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(area * 1.4, area * 1.4), groundMaterial)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = 0.05

  const cfg = {
    fallSpeed,
    wind,
    windDir,
    blowSpeed,
    accumulation,
    opacity,
    spin,
    area,
    height,
    depth: 0
  }

  const tick = (delta: number): void => {
    cfg.depth += (cfg.accumulation - cfg.depth) * Math.min(1, delta * 0.5)
    groundMaterial.opacity = cfg.depth * 0.6
  }

  const update = (v: ParamValues): void => {
    const c = num(v, 'count', 4200)
    const fc = num(v, 'flakeCount', 700)
    const sz = num(v, 'size', 0.5)
    const fs = num(v, 'fallSpeed', 6)
    const ar = num(v, 'area', 260)
    const h = num(v, 'height', 150)
    const wd = num(v, 'wind', 6)
    const dir = num(v, 'windDir', 35)
    const sw = num(v, 'sway', 1.2)
    const bl = num(v, 'blow', 1200)
    const bs = num(v, 'blowSpeed', 14)
    const op = num(v, 'opacity', 0.85)
    const sp = num(v, 'spin', 1.2)

    cfg.fallSpeed = fs
    cfg.wind = wd
    cfg.windDir = dir
    cfg.blowSpeed = bs
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
    fine.material.opacity = op

    flakeRate.value = (fc / nextFall) * 1.6
    flakeLife.a = nextFall * 0.8
    flakeLife.b = nextFall * 1.3
    flakeSize.a = sz * 1.8
    flakeSize.b = sz * 3.4
    flakeSpinGen.a = -sp
    flakeSpinGen.b = sp
    flakeGravity.value = fs * 0.75
    flakeEmitter.width = ar * 0.9
    flakeEmitter.height = ar * 0.9
    flakes.emitter.position.set(0, h * 0.8, 0)
    flakes.material.opacity = op * 0.7

    blowRate.value = (bl / Math.max(1, bs)) * 6
    blowEmitter.width = ar * 0.8
    blowEmitter.height = ar * 0.8
    blowing.material.opacity = op * 0.5

    const rad = dir * DEG
    windVec.set(Math.cos(rad), 0, Math.sin(rad))
    windMag.value = wd * 0.6
    blowMag.value = bs

    if (areaChanged) {
      ground.geometry.dispose()
      ground.geometry = new THREE.PlaneGeometry(ar * 1.4, ar * 1.4)
    }
  }

  return { systems: [fine, flakes, blowing], objects: [ground], tick, update }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const EARTH_META: Record<EarthEffectId, EffectMeta> = {
  aurora: {
    id: 'aurora',
    title: 'Three.Quarks 极光',
    subtitle: '带状帘幕 + 射线结构',
    description:
      '参考“极光”方案：以少量超大带状帘幕替代海量粒子，顶点着色器用多层正弦叠加调制褶皱与底部锐利边界，片元着色器叠加垂直射线并做上红下绿的高度分层着色，整体做缓慢东西向漂移与亮度脉动。帘幕数量、宽高、距离、亮度、相位速度、褶皱幅度与频率、上下颜色均可调整。',
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
    title: 'Three.Quarks 城市火灾蔓延',
    subtitle: '多火点 + 风场蔓延状态机',
    description:
      '参考“城市火灾蔓延”方案：街区建筑网格中每个着火单元挂一组火焰与烟羽发射器，轻量状态机按“未燃→燃烧→熄灭”推进，并按风向对下风侧邻栋提高引燃概率。建筑体色随状态在正常、燃烧、焦黑间切换，火势受风驱动弯曲。网格规模、火焰/烟雾量、蔓延概率与间隔、燃烧时长、风向风速、烟雾浓度与亮度均可调整。',
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
      { key: 'smokeOpacity', label: '烟雾浓度', kind: 'number', min: 0.1, max: 0.8, step: 0.05, default: 0.45 },
      { key: 'glow', label: '火光强度', kind: 'number', min: 0.3, max: 2, step: 0.1, default: 1 }
    ],
    rebuildKeys: ['gridSize']
  },
  'wind-field': {
    id: 'wind-field',
    title: 'Three.Quarks 全球风场可视化',
    subtitle: '风之河 + 短拖尾平流',
    description:
      '参考“全球风场可视化”方案：海量短拖尾粒子在程序化矢量风场中平流，寿命到期后原地重生以保持总数恒定，形成流动的“风之河”；矢量场叠加多层低频风带、高频湍流与台风式涡旋，速度映射到蓝→绿→黄→红的色带。粒子数、区域范围、风速、湍流、寿命、拖尾长度、涡旋强度/半径、高度与厚度、亮度均可调整。',
    params: [
      { key: 'count', label: '粒子数量', kind: 'number', min: 1000, max: 20000, step: 500, unit: '个', default: 7000 },
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
    title: 'Three.Quarks 群体编队',
    subtitle: 'Boids 鸟群 / 萤火虫 / 无人机灯光秀',
    description:
      '参考“鸟群 / 萤火虫 / 无人机编队灯光秀”方案：鸟群模式用 boids 分离/对齐/凝聚三规则配合空间哈希网格做邻域加速，并追随缓慢巡游的目标点；萤火虫模式以相位噪声随机游走并做亮度脉动；编队模式改为球面、平面、螺旋、波浪等确定性图案并用缓动插值完成队形变换。个体数、尺寸、速度、活动范围、感知半径、三项权重、队形、色相与亮度均可调整。',
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
    title: 'Three.Quarks 雪 / 风吹雪 / 积雪',
    subtitle: '三类雪花 + 风驱动吹雪 + 地面积雪',
    description:
      '参考“雪 + 风吹雪 + 积雪累积”方案：细雪、片状雪花、湿雪三类发射器以不同终端速度与摆动噪声制造视差，飘落阶段受统一风向拖曳；近地表另设吹雪层，密度随风速放大；地表叠加一张随累积参数渐显的径向积雪面。粒子数、雪花数、尺寸、下落速度、范围、高度、风向风速、摆动、吹雪量/速度、积雪厚度与整体不透明度、自旋速度均可调整。',
    params: [
      { key: 'count', label: '细雪数量', kind: 'number', min: 500, max: 9000, step: 250, unit: '个', default: 4200 },
      { key: 'flakeCount', label: '片状雪花', kind: 'number', min: 0, max: 3000, step: 100, unit: '个', default: 700 },
      { key: 'size', label: '雪花尺寸', kind: 'number', min: 0.1, max: 3, step: 0.05, default: 0.5 },
      { key: 'fallSpeed', label: '下落速度', kind: 'number', min: 2, max: 20, step: 0.5, default: 6 },
      { key: 'area', label: '降雪范围', kind: 'number', min: 60, max: 800, step: 20, default: 260 },
      { key: 'height', label: '降雪高度', kind: 'number', min: 40, max: 400, step: 10, default: 150 },
      { key: 'wind', label: '风速', kind: 'number', min: 0, max: 25, step: 0.5, default: 6 },
      { key: 'windDir', label: '风向', kind: 'number', min: 0, max: 360, step: 5, unit: '°', default: 35 },
      { key: 'sway', label: '摆动强度', kind: 'number', min: 0, max: 4, step: 0.1, default: 1.2 },
      { key: 'blow', label: '吹雪浓度', kind: 'number', min: 0, max: 3000, step: 50, default: 1200 },
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
