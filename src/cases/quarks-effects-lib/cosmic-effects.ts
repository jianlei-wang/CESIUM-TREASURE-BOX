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
  DEG,
  additive,
  hexToQ4,
  num,
  q3,
  seededRandom,
  setParticleOpacity,
  str,
  whiteAlpha,
  type BuiltEffect,
  type EffectBuildContext,
  type EffectMeta,
  type ParamValues
} from './effect-kit'

/**
 * C 档宏大尺度效果：行星磁层、黑洞吸积盘、点云转场、地震波、声呐、星轨。
 *
 * 与其余 quarks 模块一样，全部在 CesiumQuarksLayer 的局部 ENU 坐标系内构建
 * （three +y 向上、+x 向东、+z 向南），以小时/公里级艺术单位表达天文与地质尺度，
 * 通过巨大的相机距离与对象尺度获得「尺度失控」的观感。
 */
export type CosmicEffectId = 'solar-wind' | 'blackhole' | 'pointcloud' | 'seismic' | 'sonar' | 'startrails'

/** 同其它模块：预热的连续发射系统必须把 duration 压到很小。 */
const PREWARM_DURATION = 4

/** 地球平均半径（米）：行星级效果以真实地球为基底时统一以此为尺度基准。 */
const EARTH_R = 6371000

/* ------------------------------------------------------------------ */
/* 通用工具                                                            */
/* ------------------------------------------------------------------ */

/** 把 +z（quarks 默认发射方向）对准给定世界方向 */
function aim(emitter: { quaternion: THREE.Quaternion }, dir: THREE.Vector3): void {
  emitter.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize())
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / Math.max(1e-6, b - a))
  return t * t * (3 - 2 * t)
}

function solidMaterial(color: string, opacity = 1, blending: THREE.Blending = THREE.NormalBlending): THREE.MeshBasicMaterial {
  const solid = opacity >= 1
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: !solid,
    opacity,
    depthWrite: solid,
    depthTest: true,
    side: solid ? THREE.FrontSide : THREE.DoubleSide,
    blending,
    toneMapped: false
  })
}

function setMeshOpacity(mesh: THREE.Mesh, opacity: number): void {
  ;(mesh.material as THREE.MeshBasicMaterial).opacity = opacity
}

/** 环绕指定轴旋转向量（GLSL 与 CPU 共用同一算法，保证观感一致） */
function rotateAroundAxis(v: THREE.Vector3, axis: THREE.Vector3, angle: number, target = new THREE.Vector3()): THREE.Vector3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const dot = axis.dot(v)
  target.copy(v).multiplyScalar(c)
  target.addScaledVector(new THREE.Vector3().crossVectors(axis, v), s)
  target.addScaledVector(axis, dot * (1 - c))
  return target
}

const NOISE_GLSL = `
float chHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float chNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = chHash(i);
  float b = chHash(i + vec2(1.0, 0.0));
  float c = chHash(i + vec2(0.0, 1.0));
  float d = chHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`

/* ------------------------------------------------------------------ */
/* C01 行星级太阳风与磁层                                               */
/* ------------------------------------------------------------------ */

const SHELL_VERTEX = `
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vLocal;
void main() {
  vUv = uv;
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`

const SHELL_FRAGMENT = `
uniform vec3 uColor;
uniform vec3 uEdge;
uniform float uBright;
uniform float uOpacity;
uniform float uTime;
uniform float uFlow;
uniform float uPressure;
uniform float uScale;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vLocal;
void main() {
  vec3 viewDir = normalize(-vViewPos);
  float fres = pow(1.0 - abs(dot(normalize(vNormalV), viewDir)), 2.2);
  vec3 n = vLocal / max(1.0, uScale);
  float flow = 0.62 + 0.38 * sin(n.x * 0.5 - uTime * uFlow + n.y * 0.2);
  float band = 0.55 + 0.45 * chNoise(vec2(n.x * 0.12 - uTime * 0.05, n.z * 0.2));
  float a = (0.12 + 0.88 * fres) * flow * band * (0.7 + 0.7 * uPressure) * uOpacity;
  vec3 col = mix(uColor, uEdge, fres);
  gl_FragColor = vec4(col * uBright, clamp(a, 0.0, 1.0));
}
`

const ATMO_VERTEX = `
varying vec3 vN;
varying vec3 vView;
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`

const ATMO_FRAGMENT = `
uniform vec3 uColor;
uniform float uBright;
uniform float uPower;
varying vec3 vN;
varying vec3 vView;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), vView)), uPower);
  gl_FragColor = vec4(uColor * uBright, f);
}
`

const AURORA_CURTAIN_FRAGMENT = `
uniform vec3 uColor;
uniform float uBright;
uniform float uTime;
uniform float uPulse;
varying vec2 vUv;
void main() {
  float vert = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.5, 1.0, vUv.y));
  float rays = 0.6 + 0.4 * sin(vUv.x * 44.0 + uTime * 1.6);
  rays *= 0.78 + 0.22 * sin(vUv.x * 13.0 - uTime * 0.8);
  float a = vert * rays * uBright * (0.7 + 0.6 * uPulse);
  gl_FragColor = vec4(uColor * (1.2 + uPulse), clamp(a, 0.0, 1.0));
}
`

const AURORA_RING_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/** 以 x 轴为对称轴旋成曲面，profile 为 [x, 半径] 控制点。 */
function revolveGeometry(profile: Array<[number, number]>, cols: number): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const rows = profile.length - 1
  for (let i = 0; i <= rows; i += 1) {
    const [x, rho] = profile[i]
    for (let j = 0; j <= cols; j += 1) {
      const phi = (j / cols) * Math.PI * 2
      positions.push(x, rho * Math.cos(phi), rho * Math.sin(phi))
      uvs.push(j / cols, i / rows)
    }
  }
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const a = i * (cols + 1) + j
      const b = a + 1
      const c = a + (cols + 1)
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

interface ShellUniforms {
  [key: string]: THREE.IUniform
  uColor: THREE.IUniform<THREE.Color>
  uEdge: THREE.IUniform<THREE.Color>
  uBright: THREE.IUniform<number>
  uOpacity: THREE.IUniform<number>
  uTime: THREE.IUniform<number>
  uFlow: THREE.IUniform<number>
  uPressure: THREE.IUniform<number>
  uScale: THREE.IUniform<number>
}

function shellMesh(
  profile: Array<[number, number]>,
  color: string,
  edge: string,
  cols = 72,
  scale = 1
): { mesh: THREE.Mesh; uniforms: ShellUniforms } {
  const uniforms: ShellUniforms = {
    uColor: { value: new THREE.Color(color) },
    uEdge: { value: new THREE.Color(edge) },
    uBright: { value: 1 },
    uOpacity: { value: 0.45 },
    uTime: { value: 0 },
    uFlow: { value: 6 },
    uPressure: { value: 1 },
    uScale: { value: scale }
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SHELL_VERTEX,
    fragmentShader: NOISE_GLSL + SHELL_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  })
  const mesh = new THREE.Mesh(revolveGeometry(profile, cols), material)
  return { mesh, uniforms }
}

function magnetosphereProfile(
  r0: number,
  alpha: number,
  tailRadius: number,
  tailLength: number,
  dayCount = 26,
  tailCount = 24
): Array<[number, number]> {
  const points: Array<[number, number]> = []
  for (let i = 0; i <= dayCount; i += 1) {
    const theta = (i / dayCount) * (Math.PI / 2)
    const r = r0 * Math.pow(2 / (1 + Math.cos(theta)), alpha)
    points.push([r * Math.cos(theta), r * Math.sin(theta)])
  }
  const rhoEnd = points[points.length - 1][1]
  for (let i = 1; i <= tailCount; i += 1) {
    const s = i / tailCount
    const x = -tailLength * s
    const rho = rhoEnd + (tailRadius - rhoEnd) * smoothstep(0, 0.55, s)
    points.push([x, rho])
  }
  return points
}

function buildSolarWind(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const R = EARTH_R
  const lat = num(values, 'lat', 40) * DEG
  const standoff = num(values, 'standoff', 10)
  const flare = num(values, 'flare', 0.32)
  const tailLength = num(values, 'tailLength', 40) * R
  const tailRadius = num(values, 'tailRadius', 12) * R
  const windSpeed = num(values, 'windSpeed', 1.6) * R
  const windRate = num(values, 'windRate', 700)
  let bz = num(values, 'bz', -6)
  const kp = num(values, 'kp', 5)
  const auroraBright = num(values, 'auroraBright', 1)
  let cmeInterval = Math.max(4, num(values, 'cmeInterval', 16))
  let cmeStrength = num(values, 'cmeStrength', 1)
  const mpColor = str(values, 'mpColor', '#3f7bff')
  const bowColor = str(values, 'bowColor', '#b25bff')

  const r0 = standoff * R * (1 + bz * 0.006)
  const alpha = flare

  // 真实地球由 Cesium 图层渲染，此处仅叠加菲涅尔边缘辉光，避免再画一个假地球
  const atmoUniforms: Record<string, THREE.IUniform> = {
    uColor: { value: new THREE.Color('#4aa3ff') },
    uBright: { value: 0.42 },
    uPower: { value: 2.6 }
  }
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.012, 64, 32),
    new THREE.ShaderMaterial({
      uniforms: atmoUniforms,
      vertexShader: ATMO_VERTEX,
      fragmentShader: ATMO_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      toneMapped: false
    })
  )

  const magnetopause = shellMesh(
    magnetosphereProfile(r0, alpha, tailRadius, tailLength, 24, 22),
    mpColor,
    '#dff0ff',
    56,
    R
  )
  const bowShock = shellMesh(
    magnetosphereProfile(r0 * 1.32, alpha * 0.9, tailRadius * 1.5, tailLength * 1.12, 24, 22),
    bowColor,
    '#ffd6ff',
    56,
    R
  )

  const poleDir = new THREE.Vector3(0, Math.sin(lat), -Math.cos(lat)).normalize()
  const auroraGroup = new THREE.Group()
  auroraGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), poleDir)
  const auroraUniforms: Array<Record<string, THREE.IUniform>> = []
  const auroraScale = 1 + kp * 0.06
  for (const side of [1, -1]) {
    const uniforms: Record<string, THREE.IUniform> = {
      uColor: { value: new THREE.Color('#4dffa8') },
      uBright: { value: auroraBright },
      uTime: { value: 0 },
      uPulse: { value: 0 }
    }
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: AURORA_RING_VERTEX,
      fragmentShader: AURORA_CURTAIN_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false
    })
    const rBottom = R * 0.32 * auroraScale
    const rTop = R * 0.44 * auroraScale
    const curtain = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rBottom, R * 0.2, 64, 1, true),
      material
    )
    curtain.position.y = side * R * 0.92
    auroraGroup.add(curtain)
    auroraUniforms.push(uniforms)
  }

  const windEmit = new ConstantValue(windRate)
  const windLife = new IntervalValue(18, 34)
  const windSpeedGen = new IntervalValue(windSpeed * 0.9, windSpeed * 1.3)
  const windSizeGen = new IntervalValue(R * 0.03, R * 0.075)
  const windEmitter = new ConeEmitter({ radius: r0 * 1.6, angle: 5 * DEG, thickness: 1 })
  const wind = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: windEmitter,
    startLife: windLife,
    startSpeed: windSpeedGen,
    startSize: windSizeGen,
    startColor: new ColorRange(hexToQ4('#bcd8ff'), hexToQ4('#3f7bff')),
    emissionOverTime: windEmit,
    behaviors: [
      new ColorOverLife(whiteAlpha([[0, 0], [0.2, 0.5], [0.7, 0.42], [1, 0]], 1))
    ],
    renderMode: RenderMode.StretchedBillBoard,
    material: additive(ctx.textures.soft),
    rendererEmitterSettings: { speedFactor: 1, lengthFactor: 0.35 }
  })
  wind.emitter.position.set(r0 * 3.2, 0, 0)
  aim(wind.emitter, new THREE.Vector3(-1, 0, 0))

  const cmeGroup = new THREE.Group()
  const cmeUniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color('#ff7ab8') },
    uBright: { value: 1 }
  }
  const cmeMaterial = new THREE.ShaderMaterial({
    uniforms: cmeUniforms,
    vertexShader: `
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: NOISE_GLSL + `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uBright;
      varying vec3 vLocal;
      void main() {
        float n = chNoise(vLocal.xy * 3.0 + uTime) * 0.6 + chNoise(vLocal.zy * 5.0 - uTime * 0.7) * 0.4;
        float a = (0.35 + 0.65 * n);
        gl_FragColor = vec4(uColor * (0.8 + n) * uBright, a * 0.6);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  })
  const cme = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), cmeMaterial)
  cmeGroup.add(cme)

  const group = new THREE.Group()
  group.position.set(0, -R, 0)
  group.add(atmosphere, bowShock.mesh, magnetopause.mesh, auroraGroup, wind.emitter, cmeGroup)

  let time = 0
  let cmeTimer = cmeInterval * 0.4

  const tick = (delta: number): void => {
    time += delta
    const pressure = 1 + Math.max(0, -bz) * 0.05
    magnetopause.uniforms.uTime.value = time
    magnetopause.uniforms.uPressure.value = pressure
    bowShock.uniforms.uTime.value = time * 0.8
    bowShock.uniforms.uPressure.value = pressure
    for (const u of auroraUniforms) {
      u.uTime.value = time
      u.uPulse.value = 0.25 + 0.35 * Math.sin(time * 0.9)
    }
    cmeUniforms.uTime.value = time

    cmeTimer += delta
    const p = clamp01(cmeTimer / cmeInterval)
    if (p >= 1) cmeTimer = 0
    const phase = clamp01(p / 0.72)
    const scale = R * 1.0 + phase * (r0 * 1.5 - R)
    cme.scale.setScalar(scale)
    cmeGroup.position.x = r0 * 5 - phase * (r0 * 5 - r0 * 0.15)
    const flash = Math.max(0, 1 - Math.abs(phase - 0.72) * 6)
    cmeUniforms.uBright.value = (0.4 + 0.9 * Math.sin(phase * Math.PI)) * cmeStrength + flash * cmeStrength
    for (const u of auroraUniforms) {
      u.uPulse.value = 0.25 + 0.35 * Math.sin(time * 0.9) + flash * 1.6
    }
  }

  const update = (v: ParamValues): void => {
    bz = num(v, 'bz', -6)
    const pressure = 1 + Math.max(0, -bz) * 0.05
    magnetopause.uniforms.uPressure.value = pressure
    const aurora = num(v, 'auroraBright', 1)
    for (const u of auroraUniforms) u.uBright.value = aurora
    magnetopause.uniforms.uColor.value.set(str(v, 'mpColor', '#3f7bff'))
    bowShock.uniforms.uColor.value.set(str(v, 'bowColor', '#b25bff'))
    cmeUniforms.uColor.value.set(str(v, 'cmeColor', '#ff7ab8'))
    cmeInterval = Math.max(4, num(v, 'cmeInterval', 16))
    cmeStrength = num(v, 'cmeStrength', 1)
    const rate = num(v, 'windRate', 700)
    windEmit.value = rate
    const speed = num(v, 'windSpeed', 1.6) * R
    windSpeedGen.a = speed * 0.9
    windSpeedGen.b = speed * 1.3
    magnetopause.uniforms.uOpacity.value = num(v, 'mpOpacity', 0.45)
    bowShock.uniforms.uOpacity.value = num(v, 'mpOpacity', 0.45) * 0.8
    setParticleOpacity(wind, num(v, 'windOpacity', 1))
  }
  magnetopause.uniforms.uOpacity.value = num(values, 'mpOpacity', 0.45)
  bowShock.uniforms.uOpacity.value = num(values, 'mpOpacity', 0.45) * 0.8

  return {
    systems: [wind],
    objects: [group],
    tick,
    update
  }
}

/* ------------------------------------------------------------------ */
/* C02 黑洞吸积盘与相对论性喷流                                          */
/* ------------------------------------------------------------------ */

const DISK_VERTEX = `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const DISK_FRAGMENT = `
uniform float uTime;
uniform float uInner;
uniform float uOuter;
uniform float uSpin;
uniform float uBright;
uniform float uDoppler;
uniform vec3 uHot;
uniform vec3 uCold;
varying vec3 vLocal;
void main() {
  float r = length(vLocal.xy);
  float rn = r / max(1.0, uOuter);
  float t = clamp((r - uInner) / max(1.0, uOuter - uInner), 0.0, 1.0);
  float ang = atan(vLocal.y, vLocal.x);
  float spiral = 0.5 + 0.5 * sin(ang * 3.0 + rn * 8.3 - uTime * uSpin);
  float turb = chNoise(vec2(ang * 3.2, rn * 4.1 - uTime * 0.25));
  float temp = pow(1.0 - t, 1.7);
  float emissive = temp * (0.55 + 0.55 * spiral) * (0.65 + 0.6 * turb);
  float dop = 1.0 + uDoppler * clamp(vLocal.x / max(1.0, r), -1.0, 1.0);
  vec3 col = mix(uCold, uHot, pow(1.0 - t, 0.75));
  float alpha = smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.72, 1.0, t));
  alpha *= (0.3 + 0.7 * emissive) * 0.85;
  gl_FragColor = vec4(col * emissive * dop * uBright, clamp(alpha, 0.0, 1.0));
}
`

function buildBlackhole(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const R = EARTH_R
  const innerR = num(values, 'innerR', 0.35) * R
  const outerR = num(values, 'outerR', 1.0) * R
  const horizon = innerR / 3
  const hover = R * 1.4
  const spin = num(values, 'spin', 2.2)
  const brightness = num(values, 'brightness', 1.8)
  const doppler = num(values, 'doppler', 0.55)
  const jetPower = num(values, 'jetPower', 1)
  const jetLength = num(values, 'jetLength', 1.1) * R
  const knotCount = Math.max(0, Math.round(num(values, 'knots', 5)))
  const tilt = num(values, 'tilt', 24)
  const hotColor = str(values, 'hotColor', '#fff3dc')
  const coldColor = str(values, 'coldColor', '#b8350f')
  const jetColor = str(values, 'jetColor', '#8fd0ff')

  const horizonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(horizon, 48, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#000000'), toneMapped: false })
  )

  const diskUniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uInner: { value: innerR },
    uOuter: { value: outerR },
    uSpin: { value: spin },
    uBright: { value: brightness },
    uDoppler: { value: doppler },
    uHot: { value: new THREE.Color(hotColor) },
    uCold: { value: new THREE.Color(coldColor) }
  }
  const diskMaterial = new THREE.ShaderMaterial({
    uniforms: diskUniforms,
    vertexShader: DISK_VERTEX,
    fragmentShader: NOISE_GLSL + DISK_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  })
  const disk = new THREE.Mesh(new THREE.RingGeometry(innerR, outerR, 220, 12), diskMaterial)
  disk.rotation.x = -Math.PI / 2

  const photonRing = new THREE.Mesh(
    new THREE.TorusGeometry(horizon * 1.18, horizon * 0.028, 10, 160),
    solidMaterial('#dff0ff', 0.95, THREE.AdditiveBlending)
  )
  photonRing.rotation.x = -Math.PI / 2

  const lensArc = new THREE.Mesh(
    new THREE.TorusGeometry(horizon * 1.55, horizon * 0.02, 8, 120, Math.PI),
    solidMaterial('#ffd2a1', 0.85, THREE.AdditiveBlending)
  )
  lensArc.scale.y = 1.25

  const jetGroup = new THREE.Group()
  const jetConeMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(jetColor),
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  })
  const jetCones: THREE.Mesh[] = []
  for (const side of [1, -1]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(horizon * 2.9, jetLength, 40, 1, true), jetConeMaterial)
    cone.position.y = side * jetLength * 0.5
    cone.rotation.x = side > 0 ? 0 : Math.PI
    jetGroup.add(cone)
    jetCones.push(cone)
  }

  const knotMaterial = solidMaterial('#bfe4ff', 0.9, THREE.AdditiveBlending)
  const knots: THREE.Mesh[] = []
  for (let i = 0; i < knotCount; i += 1) {
    for (const side of [1, -1]) {
      const knot = new THREE.Mesh(new THREE.TorusGeometry(horizon * 0.9 + i * horizon * 0.16, horizon * 0.15, 8, 48), knotMaterial.clone())
      knot.rotation.x = Math.PI / 2
      knot.position.y = side * (horizon * 7.5 + i * (jetLength * 0.75 / Math.max(1, knotCount)))
      jetGroup.add(knot)
      knots.push(knot)
    }
  }

  const jetRateGen = new ConstantValue(2200)
  const makeJet = (side: number): ParticleSystem => {
    const emitter = new ConeEmitter({ radius: horizon * 0.44, angle: 4 * DEG, thickness: 1 })
    const jetSpeed = jetLength * 0.55
    const system = new ParticleSystem({
      duration: PREWARM_DURATION,
      looping: true,
      prewarm: true,
      worldSpace: true,
      shape: emitter,
      startLife: new IntervalValue(0.9, 2.2),
      startSpeed: new IntervalValue(jetSpeed * 0.85, jetSpeed * 1.4),
      startSize: new IntervalValue(horizon * 0.38, horizon * 1.15),
      startColor: new ColorRange(hexToQ4('#ffffff'), hexToQ4(jetColor)),
      emissionOverTime: jetRateGen,
      behaviors: [
        new ColorOverLife(whiteAlpha([[0, 0], [0.15, 0.75], [1, 0]], 1)),
        new TurbulenceField(
          q3(jetLength * 0.004, jetLength * 0.004, jetLength * 0.004),
          2,
          q3(jetSpeed * 0.06, jetSpeed * 0.03, jetSpeed * 0.06),
          q3(30, 30, 30)
        )
      ],
      renderMode: RenderMode.StretchedBillBoard,
      material: additive(ctx.textures.glow),
      rendererEmitterSettings: { speedFactor: 1, lengthFactor: 0.18 }
    })
    system.emitter.position.set(0, hover + side * horizon * 0.6, 0)
    aim(system.emitter, new THREE.Vector3(0, side, 0))
    return system
  }
  const jetUp = makeJet(1)
  const jetDown = makeJet(-1)

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(horizon * 1.5, 32, 16),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffcf9a'),
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    })
  )

  const group = new THREE.Group()
  group.position.set(0, hover, 0)
  group.rotation.z = tilt * DEG
  group.add(horizonMesh, disk, photonRing, lensArc, jetGroup, jetUp.emitter, jetDown.emitter, core)

  let time = 0
  const tick = (delta: number): void => {
    time += delta
    diskUniforms.uTime.value = time
    const pulse = 0.85 + 0.15 * Math.sin(time * 1.4)
    for (let i = 0; i < knots.length; i += 1) {
      const knot = knots[i]
      const mat = knot.material as THREE.MeshBasicMaterial
      mat.opacity = (0.5 + 0.5 * Math.sin(time * 2 - i * 1.1)) * 0.9
      knot.scale.setScalar(0.9 + 0.25 * Math.sin(time * 1.6 - i))
    }
    ;(core.material as THREE.MeshBasicMaterial).opacity = 0.28 + pulse * 0.18
  }

  const update = (v: ParamValues): void => {
    diskUniforms.uSpin.value = num(v, 'spin', 2.2)
    diskUniforms.uBright.value = num(v, 'brightness', 1.8)
    diskUniforms.uDoppler.value = num(v, 'doppler', 0.55)
    diskUniforms.uHot.value.set(str(v, 'hotColor', '#fff3dc'))
    diskUniforms.uCold.value.set(str(v, 'coldColor', '#b8350f'))
    const jp = num(v, 'jetPower', 1)
    jetRateGen.value = 2200 * jp
    const jc = new THREE.Color(str(v, 'jetColor', '#8fd0ff'))
    jetConeMaterial.color.copy(jc)
    setParticleOpacity(jetUp, Math.min(1, 0.5 + jp * 0.5))
    setParticleOpacity(jetDown, Math.min(1, 0.5 + jp * 0.5))
    group.rotation.z = num(v, 'tilt', 24) * DEG
  }

  return { systems: [jetUp, jetDown], objects: [group], tick, update }
}

/* ------------------------------------------------------------------ */
/* C03 点云地球转场                                                     */
/* ------------------------------------------------------------------ */

const POINTCLOUD_VERTEX = `
uniform float uT;
uniform float uSize;
uniform float uBright;
uniform float uArc;
uniform float uPointScale;
attribute vec3 aEarth;
attribute vec3 aNebula;
attribute vec3 aColor;
attribute float aLand;
attribute float aSeed;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float p1 = clamp(uT, 0.0, 1.0);
  float p2 = clamp(uT - 1.0, 0.0, 1.0);
  float d1 = aSeed * 0.35;
  float d2 = aSeed * 0.2;
  float e1 = smoothstep(0.0, 1.0, clamp((p1 - d1) / max(0.05, 1.0 - d1), 0.0, 1.0));
  float e2 = smoothstep(0.0, 1.0, clamp((p2 - d2) / max(0.05, 1.0 - d2), 0.0, 1.0));
  vec3 p = mix(position, aEarth, e1);
  p = mix(p, aNebula, e2);
  float arc1 = sin(e1 * 3.1415926);
  float arc2 = sin(e2 * 3.1415926);
  p += normalize(p + vec3(0.001)) * (arc1 * uArc + arc2 * uArc * 1.7);
  vec3 cEarth = mix(vec3(0.05, 0.22, 0.58), vec3(0.28, 0.72, 0.36), aLand);
  vec3 cNeb = mix(vec3(0.55, 0.75, 1.0), vec3(1.0, 0.62, 0.9), aSeed);
  vec3 col = mix(aColor, cEarth, e1);
  col = mix(col, cNeb, e2);
  vColor = col * uBright;
  vAlpha = mix(1.0, mix(mix(0.08, 0.35, aLand), 1.0, e2), e1);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float boost = 1.0 + 1.4 * (arc1 + arc2);
  gl_PointSize = uSize * boost * (uPointScale / max(1.0, -mv.z));
}
`

const POINTCLOUD_FRAGMENT = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, r);
  a = pow(a, 1.9);
  gl_FragColor = vec4(vColor, a * vAlpha);
}
`

function buildPointCloud(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  void ctx
  const R = EARTH_R
  const earthCenter = new THREE.Vector3(0, -R, 0)
  const count = Math.max(2000, Math.round(num(values, 'count', 90000)))
  const earthR = num(values, 'earthR', 1) * R
  const citySpan = num(values, 'citySpan', 0.03) * R
  const cityHeight = num(values, 'cityHeight', 0.008) * R
  const arms = Math.max(2, Math.round(num(values, 'arms', 3)))
  const pitch = num(values, 'pitch', 0.24)
  const nebulaR = num(values, 'nebulaR', 4) * R
  const pointSize = num(values, 'pointSize', 2)
  let cycle = Math.max(4, num(values, 'cycle', 18))
  const brightness = num(values, 'brightness', 0.9)
  const colorA = str(values, 'colorA', '#ffd27a')
  const colorB = str(values, 'colorB', '#7ab8ff')

  const rand = seededRandom(20260921)
  const positions = new Float32Array(count * 3)
  const earth = new Float32Array(count * 3)
  const nebula = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const land = new Float32Array(count)
  const seed = new Float32Array(count)

  const cA = new THREE.Color(colorA)
  const cB = new THREE.Color(colorB)
  const tmp = new THREE.Color()

  for (let i = 0; i < count; i += 1) {
    // 城市态：楼宇立面点云
    const gx = (rand() - 0.5) * citySpan
    const gz = (rand() - 0.5) * citySpan
    const h = (0.25 + Math.pow(rand(), 1.6)) * cityHeight
    const py = rand() < 0.72 ? rand() * h : h
    positions[i * 3] = gx
    positions[i * 3 + 1] = py
    positions[i * 3 + 2] = gz

    // 地球态：球面 + 噪声陆地掩膜
    const u = rand() * 2 - 1
    const theta = rand() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    const dx = s * Math.cos(theta)
    const dy = u
    const dz = s * Math.sin(theta)
    const landNoise =
      Math.sin(dx * 3.1 + 0.7) * Math.cos(dy * 2.6 - 0.3) + Math.sin(dz * 2.2 + dy * 1.4) * 0.8
    const isLand = landNoise > 0.55 ? 1 : 0
    const radius = earthR * (isLand ? 1.03 : 1.015)
    earth[i * 3] = earthCenter.x + dx * radius
    earth[i * 3 + 1] = earthCenter.y + dy * radius
    earth[i * 3 + 2] = earthCenter.z + dz * radius
    land[i] = isLand

    // 星云态：对数螺旋臂
    const rr = Math.pow(rand(), 0.62) * nebulaR
    const arm = Math.floor(rand() * arms)
    const armAngle = (arm / arms) * Math.PI * 2 + rr * pitch
    const spread = (rand() - 0.5) * (0.5 + 3.5 / (1 + rr * 0.004))
    const angle = armAngle + spread
    const thickness = (rand() - 0.5) * (60 + rr * 0.18)
    nebula[i * 3] = earthCenter.x + Math.cos(angle) * rr
    nebula[i * 3 + 1] = earthCenter.y + thickness
    nebula[i * 3 + 2] = earthCenter.z + Math.sin(angle) * rr

    tmp.copy(cA).lerp(cB, rand())
    colors[i * 3] = tmp.r
    colors[i * 3 + 1] = tmp.g
    colors[i * 3 + 2] = tmp.b
    seed[i] = rand()
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aEarth', new THREE.BufferAttribute(earth, 3))
  geometry.setAttribute('aNebula', new THREE.BufferAttribute(nebula, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aLand', new THREE.BufferAttribute(land, 1))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))

  const uniforms: Record<string, THREE.IUniform> = {
    uT: { value: 0 },
    uSize: { value: pointSize },
    uBright: { value: brightness },
    uArc: { value: R * 0.35 },
    uPointScale: { value: R * 2 }
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: POINTCLOUD_VERTEX,
    fragmentShader: POINTCLOUD_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false

  let time = 0
  const tick = (delta: number): void => {
    time += delta
    const phase = (time / cycle) % 1
    // 0..0.4 城市->地球，0.4..0.6 停留，0.6..1 地球->星云
    if (phase < 0.4) uniforms.uT.value = smoothstep(0, 1, phase / 0.4)
    else if (phase < 0.6) uniforms.uT.value = 1
    else uniforms.uT.value = 1 + smoothstep(0, 1, (phase - 0.6) / 0.4)
    const fade = phase > 0.94 ? 1 - (phase - 0.94) / 0.06 : 1
    uniforms.uBright.value = brightness * fade
  }

  const update = (v: ParamValues): void => {
    cycle = Math.max(4, num(v, 'cycle', 18))
    uniforms.uSize.value = num(v, 'pointSize', 2)
    uniforms.uBright.value = num(v, 'brightness', 0.9)
  }

  return { systems: [], objects: [points], tick, update }
}

/* ------------------------------------------------------------------ */
/* C04 地震波传播环                                                     */
/* ------------------------------------------------------------------ */

const SEISMIC_FRAGMENT = `
uniform float uTime;
uniform float uP;
uniform float uS;
uniform float uR;
uniform float uWidth;
uniform float uDecay;
uniform float uBright;
uniform vec3 uPC;
uniform vec3 uSC;
uniform vec3 uRC;
varying vec3 vLocal;
float arr(float r, float radius, float speed) {
  float amp = exp(-r / (uDecay * speed)) / sqrt(1.0 + r * 0.0035);
  float d = (r - radius) / uWidth;
  return exp(-d * d) * amp;
}
void main() {
  float r = length(vLocal.xy);
  float radiusP = mod(uTime * uP, 3200.0);
  float radiusS = mod(uTime * uS, 3200.0);
  float radiusR = mod(uTime * uR, 3200.0);
  float P = arr(r, radiusP, uP) * 0.7;
  float S = arr(r, radiusS, uS) * 1.05;
  float R = arr(r, radiusR, uR) * 1.5;
  float echo = arr(r, mod(radiusR + 900.0, 3200.0), uR) * 0.45;
  echo += arr(r, mod(radiusR + 1800.0, 3200.0), uR) * 0.2;
  float epi = exp(-r * r / 1400.0);
  vec3 col = uPC * P + uSC * S + uRC * (R + echo) + vec3(1.0, 0.85, 0.6) * epi * 0.9;
  float a = (P + S + R + echo) * uBright + epi * 0.55;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`

const SEISMIC_VERTEX = `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

function buildSeismic(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const groundR = num(values, 'groundR', 1600)
  const pSpeed = num(values, 'pSpeed', 620)
  const sSpeed = num(values, 'sSpeed', 360)
  const rSpeed = num(values, 'rSpeed', 210)
  const waveWidth = num(values, 'waveWidth', 46)
  const decay = num(values, 'decay', 1500)
  const brightness = num(values, 'brightness', 1.1)
  const magnitude = num(values, 'magnitude', 6.4)
  const buildCount = Math.max(0, Math.round(num(values, 'buildings', 260)))
  let shake = num(values, 'shake', 16)
  const magnitudeScale = 0.4 + magnitude * 0.12

  const groundUniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uP: { value: pSpeed },
    uS: { value: sSpeed },
    uR: { value: rSpeed },
    uWidth: { value: waveWidth },
    uDecay: { value: decay },
    uBright: { value: brightness * magnitudeScale },
    uPC: { value: new THREE.Color('#9fd8ff') },
    uSC: { value: new THREE.Color('#ffb14a') },
    uRC: { value: new THREE.Color('#ff5a3c') }
  }
  const groundMaterial = new THREE.ShaderMaterial({
    uniforms: groundUniforms,
    vertexShader: SEISMIC_VERTEX,
    fragmentShader: SEISMIC_FRAGMENT.replace('float arr(', NOISE_GLSL + '\nfloat arr('),
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  })
  const ground = new THREE.Mesh(new THREE.CircleGeometry(groundR, 128), groundMaterial)
  ground.rotation.x = -Math.PI / 2

  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(groundR, 96),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#0d1b2a'),
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      toneMapped: false
    })
  )
  disk.rotation.x = -Math.PI / 2
  disk.position.y = -1

  const rand = seededRandom(6412)
  const buildGeo = new THREE.BoxGeometry(1, 1, 1)
  buildGeo.translate(0, 0.5, 0)
  const buildMesh = new THREE.InstancedMesh(
    buildGeo,
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#9fb3c8'), toneMapped: false }),
    buildCount
  )
  buildMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  buildMesh.frustumCulled = false
  interface Building {
    x: number
    z: number
    w: number
    h: number
    dist: number
    angle: number
    phase: number
  }
  const buildings: Building[] = []
  const dummy = new THREE.Object3D()
  for (let i = 0; i < buildCount; i += 1) {
    const angle = rand() * Math.PI * 2
    const dist = 60 + Math.pow(rand(), 0.7) * (groundR * 0.55)
    const w = 18 + rand() * 26
    const h = 30 + Math.pow(rand(), 1.4) * 150
    buildings.push({ x: Math.cos(angle) * dist, z: Math.sin(angle) * dist, w, h, dist, angle, phase: rand() * 6.28 })
  }

  const faultGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-groundR * 0.5, 2, -groundR * 0.32),
    new THREE.Vector3(groundR * 0.5, 2, groundR * 0.32)
  ])
  const fault = new THREE.Line(faultGeo, new THREE.LineBasicMaterial({ color: new THREE.Color('#ff3b3b'), toneMapped: false }))

  const group = new THREE.Group()
  group.add(disk, ground, buildMesh, fault)

  let time = 0
  const tick = (delta: number): void => {
    time += delta
    groundUniforms.uTime.value = time
    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i]
      const arriveP = b.dist / Math.max(1, pSpeed)
      const arriveS = b.dist / Math.max(1, sSpeed)
      const pAmp = Math.max(0, Math.exp(-(time - arriveP) / 1.1) * (time >= arriveP ? 1 : 0))
      const sAmp = Math.max(0, Math.exp(-(time - arriveS) / 1.6) * (time >= arriveS ? 1 : 0))
      const amp = Math.min(1, (pAmp * 0.35 + sAmp) * 1.2)
      const wobble = Math.sin(time * 9 + b.phase) * amp * shake
      dummy.position.set(b.x + Math.cos(b.angle) * wobble, 0, b.z + Math.sin(b.angle) * wobble)
      dummy.rotation.z = Math.sin(time * 8 + b.phase) * amp * 0.05
      dummy.scale.set(b.w, b.h * (1 + amp * 0.02), b.w)
      dummy.updateMatrix()
      buildMesh.setMatrixAt(i, dummy.matrix)
    }
    buildMesh.instanceMatrix.needsUpdate = true
  }

  const update = (v: ParamValues): void => {
    groundUniforms.uP.value = num(v, 'pSpeed', 620)
    groundUniforms.uS.value = num(v, 'sSpeed', 360)
    groundUniforms.uR.value = num(v, 'rSpeed', 210)
    groundUniforms.uWidth.value = num(v, 'waveWidth', 46)
    groundUniforms.uDecay.value = num(v, 'decay', 1500)
    shake = num(v, 'shake', 16)
    const mag = num(v, 'magnitude', 6.4)
    groundUniforms.uBright.value = num(v, 'brightness', 1.1) * (0.4 + mag * 0.12)
    groundUniforms.uPC.value.set(str(v, 'pColor', '#9fd8ff'))
    groundUniforms.uSC.value.set(str(v, 'sColor', '#ffb14a'))
    groundUniforms.uRC.value.set(str(v, 'rColor', '#ff5a3c'))
  }

  void ctx
  return { systems: [], objects: [group], tick, update }
}

/* ------------------------------------------------------------------ */
/* C05 声呐扫描波                                                       */
/* ------------------------------------------------------------------ */

const BEAM_VERTEX = `
uniform float uHeight;
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const BEAM_FRAGMENT = `
uniform float uTime;
uniform float uInterval;
uniform float uOpacity;
uniform float uColorMix;
uniform vec3 uColor;
uniform float uHeight;
varying vec3 vLocal;
void main() {
  float t = clamp((vLocal.y + uHeight * 0.5) / max(1.0, uHeight), 0.0, 1.0);
  float head = fract(uTime / max(0.5, uInterval));
  float d = t - head;
  float front = exp(-(d * d) / 0.0016);
  float trail = smoothstep(0.0, 0.35, head - t) * (1.0 - smoothstep(0.55, 1.0, t));
  float a = (front * 0.95 + trail * 0.1) * uOpacity;
  vec3 col = mix(uColor, vec3(1.0), front * uColorMix);
  gl_FragColor = vec4(col * (0.5 + front * 1.8), clamp(a, 0.0, 1.0));
}
`

function buildSonar(values: ParamValues, ctx: EffectBuildContext): BuiltEffect {
  const range = num(values, 'range', 1500)
  const beamAngle = num(values, 'beamAngle', 26)
  let pulseInterval = Math.max(0.6, num(values, 'interval', 2.6))
  let pulseSpeed = num(values, 'pulseSpeed', 1)
  const opacity = num(values, 'opacity', 0.6)
  const seabedDepth = num(values, 'seabedDepth', 220)
  const turbidity = num(values, 'turbidity', 0.55)
  const snowRate = num(values, 'snowRate', 600)
  let echoStrength = num(values, 'echoStrength', 1)
  const targetDist = num(values, 'targetDist', 780)
  const beamColor = str(values, 'beamColor', '#35e0ff')

  const water = new THREE.Mesh(
    new THREE.SphereGeometry(range * 1.12, 40, 24),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#04202e'),
      transparent: true,
      opacity: 0.72,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false
    })
  )
  water.renderOrder = -2

  const seabedUniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color('#0e3a44') },
    uGrid: { value: 1 }
  }
  const seabedMaterial = new THREE.ShaderMaterial({
    uniforms: seabedUniforms,
    vertexShader: SEISMIC_VERTEX,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      float chHash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float chNoise2(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(chHash2(i), chHash2(i + vec2(1.0,0.0)), f.x), mix(chHash2(i + vec2(0.0,1.0)), chHash2(i + vec2(1.0,1.0)), f.x), f.y);
      }
      varying vec3 vLocal;
      void main() {
        float n = chNoise2(vLocal.xy * 0.01) * 0.6 + chNoise2(vLocal.xy * 0.04 + uTime * 0.05) * 0.4;
        vec3 col = uColor * (0.55 + 0.75 * n);
        gl_FragColor = vec4(col, 0.95);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false
  })
  const seabed = new THREE.Mesh(new THREE.CircleGeometry(range * 1.4, 96), seabedMaterial)
  seabed.rotation.x = -Math.PI / 2
  seabed.position.y = -seabedDepth
  seabed.renderOrder = -1

  const surfacePlane = new THREE.Mesh(
    new THREE.CircleGeometry(range * 1.4, 64),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#5fd4ff'),
      transparent: true,
      opacity: 0.06,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false
    })
  )
  surfacePlane.rotation.x = -Math.PI / 2
  surfacePlane.position.y = 60

  const beamUniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uInterval: { value: pulseInterval },
    uOpacity: { value: opacity },
    uColorMix: { value: 0.6 },
    uColor: { value: new THREE.Color(beamColor) },
    uHeight: { value: range }
  }
  const beamMaterial = new THREE.ShaderMaterial({
    uniforms: beamUniforms,
    vertexShader: BEAM_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  })
  const beamRadius = Math.tan(beamAngle * DEG) * range
  const beam = new THREE.Mesh(new THREE.ConeGeometry(beamRadius, range, 64, 1, true), beamMaterial)
  beam.rotation.z = -Math.PI / 2
  beam.position.x = range * 0.5

  const target = new THREE.Group()
  const hull = new THREE.Mesh(
    new THREE.CapsuleGeometry(20, 90, 8, 20),
    solidMaterial('#243b4a', 1)
  )
  hull.rotation.z = Math.PI / 2
  const sail = new THREE.Mesh(new THREE.BoxGeometry(12, 26, 30), solidMaterial('#1b2d39', 1))
  sail.position.y = 22
  target.add(hull, sail)
  target.position.set(targetDist, -seabedDepth * 0.45, 0)

  const echo = new THREE.Mesh(
    new THREE.SphereGeometry(70, 24, 16),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#d8fbff'),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    })
  )
  echo.position.copy(target.position)

  const snowRateGen = new ConstantValue(snowRate)
  const snow = new ParticleSystem({
    duration: PREWARM_DURATION,
    looping: true,
    prewarm: true,
    worldSpace: true,
    shape: new SphereEmitter({ radius: range * 0.7, thickness: 1 }),
    startLife: new IntervalValue(9, 18),
    startSpeed: new IntervalValue(0.4, 2.4),
    startSize: new IntervalValue(1.2, 3.2),
    startColor: new ColorRange(hexToQ4('#dff7ff'), hexToQ4('#7fc6d8')),
    emissionOverTime: snowRateGen,
    behaviors: [
      new ApplyForce(q3(0, -1, 0), new ConstantValue(0.5)),
      new ColorOverLife(whiteAlpha([[0, 0], [0.2, 0.55], [0.8, 0.4], [1, 0]], 1)),
      new TurbulenceField(q3(4, 4, 4), 2, q3(0.6, 0.6, 0.6), q3(0.4, 0.4, 0.4))
    ],
    renderMode: RenderMode.BillBoard,
    material: additive(ctx.textures.soft),
    rendererEmitterSettings: {}
  })
  snow.emitter.position.y = -seabedDepth * 0.5

  const seabedLine = new THREE.Mesh(
    new THREE.RingGeometry(0, range * 0.7, 64, 1, -Math.PI / 2 - beamAngle * DEG / 2, beamAngle * DEG),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#5fe8ff'),
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false
    })
  )
  seabedLine.rotation.x = -Math.PI / 2
  seabedLine.position.y = -seabedDepth + 1

  const group = new THREE.Group()
  group.add(water, seabed, surfacePlane, beam, target, echo, snow.emitter, seabedLine)
  water.renderOrder = -2

  let time = 0
  const tick = (delta: number): void => {
    time += delta
    beamUniforms.uTime.value = time * pulseSpeed
    seabedUniforms.uTime.value = time
    const head = ((time * pulseSpeed) / pulseInterval) % 1
    const headDist = head * range
    const echoPulse = Math.max(0, 1 - Math.abs(headDist - targetDist) / 90)
    ;(echo.material as THREE.MeshBasicMaterial).opacity = echoPulse * 0.75 * echoStrength
    echo.scale.setScalar(1 + echoPulse * 0.6)
    const targetMat = hull.material as THREE.MeshBasicMaterial
    targetMat.color.setRGB(0.14 + echoPulse * 0.6, 0.23 + echoPulse * 0.7, 0.29 + echoPulse * 0.7)
  }

  const update = (v: ParamValues): void => {
    pulseInterval = Math.max(0.6, num(v, 'interval', 2.6))
    pulseSpeed = num(v, 'pulseSpeed', 1)
    echoStrength = num(v, 'echoStrength', 1)
    beamUniforms.uInterval.value = pulseInterval
    beamUniforms.uOpacity.value = num(v, 'opacity', 0.6)
    beamUniforms.uColor.value.set(str(v, 'beamColor', '#35e0ff'))
    snowRateGen.value = num(v, 'snowRate', 600)
    setParticleOpacity(snow, 0.85)
    ;(water.material as THREE.MeshBasicMaterial).opacity = 0.4 + num(v, 'turbidity', 0.55) * 0.5
    seabedUniforms.uColor.value.set(str(v, 'seabedColor', '#0e3a44'))
  }

  return { systems: [snow], objects: [group], tick, update }
}

/* ------------------------------------------------------------------ */
/* C06 银河星轨延时                                                     */
/* ------------------------------------------------------------------ */

const SKY_FRAGMENT = `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uAirglow;
varying vec3 vWorld;
void main() {
  float h = clamp(normalize(vWorld).y, 0.0, 1.0);
  vec3 col = mix(uBottom, uTop, pow(h, 0.6));
  col += uAirglow * exp(-h * 9.0);
  gl_FragColor = vec4(col, 1.0);
}
`

const SKY_VERTEX = `
varying vec3 vWorld;
void main() {
  vWorld = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const TRAIL_VERTEX = `
uniform vec3 uPole;
uniform float uAngle;
uniform float uRadius;
attribute float aT;
attribute vec3 aColor;
attribute float aMag;
varying vec3 vColor;
varying float vAlpha;
vec3 rotateAxis(vec3 v, vec3 axis, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}
void main() {
  vec3 p = rotateAxis(position, normalize(uPole), uAngle * aT) * uRadius;
  vColor = aColor;
  float edge = smoothstep(0.0, 0.08, aT) * (1.0 - smoothstep(0.86, 1.0, aT));
  vAlpha = edge * (1.0 - aMag * 0.35);
  float alt = normalize(p).y;
  vAlpha *= smoothstep(-0.02, 0.08, alt);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

const TRAIL_FRAGMENT = `
uniform float uBright;
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(vColor * (1.4 + uBright), vAlpha * uBright);
}
`

const STAR_VERTEX = `
uniform vec3 uPole;
uniform float uAngle;
uniform float uRadius;
uniform float uSize;
uniform float uSizeScale;
uniform float uTime;
attribute float aMag;
attribute float aSeed;
varying vec3 vColor;
varying float vAlpha;
vec3 rotateAxis(vec3 v, vec3 axis, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}
void main() {
  vec3 p = rotateAxis(position, normalize(uPole), uAngle) * uRadius;
  float twinkle = 0.75 + 0.25 * sin(uTime * 3.0 + aSeed * 20.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (1.0 - aMag * 0.5) * twinkle * (uSizeScale / max(1.0, -mv.z));
  vColor = vec3(0.85 + 0.15 * sin(aSeed * 30.0), 0.9, 1.0);
  float alt = normalize(p).y;
  vAlpha = (1.0 - aMag * 0.45) * smoothstep(-0.02, 0.08, alt);
}
`

const STAR_FRAGMENT = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  float core = smoothstep(0.5, 0.0, r);
  float flare = exp(-abs(d.x) * 40.0) * exp(-abs(d.y) * 6.0) + exp(-abs(d.y) * 40.0) * exp(-abs(d.x) * 6.0);
  float a = pow(core, 2.2) + flare * 0.25;
  gl_FragColor = vec4(vColor, clamp(a, 0.0, 1.0) * vAlpha);
}
`

function buildStarTrails(values: ParamValues, _ctx: EffectBuildContext): BuiltEffect {
  void _ctx
  let exposure = num(values, 'exposure', 1.8)
  let latitude = num(values, 'latitude', 42)
  const starCount = Math.max(100, Math.round(num(values, 'starCount', 1100)))
  let trailBright = num(values, 'trailBright', 1)
  const segments = 26
  const radius = EARTH_R * 0.05
  let cycle = Math.max(6, num(values, 'cycle', 22))
  let meteorRate = Math.max(0, num(values, 'meteor', 0.35))
  const cityGlow = num(values, 'cityGlow', 0.6)
  const skyTop = str(values, 'skyTop', '#01030c')
  const skyBottom = str(values, 'skyBottom', '#0a1b33')
  const airglow = str(values, 'airglow', '#123a4a')

  const pole = new THREE.Vector3(0, Math.sin(latitude * DEG), -Math.cos(latitude * DEG)).normalize()

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 32, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(skyTop) },
        uBottom: { value: new THREE.Color(skyBottom) },
        uAirglow: { value: new THREE.Color(airglow) }
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: false
    })
  )
  sky.renderOrder = -3

  const rand = seededRandom(19870604)
  const trailPositions = new Float32Array(starCount * (segments + 1) * 3)
  const trailT = new Float32Array(starCount * (segments + 1))
  const trailColor = new Float32Array(starCount * (segments + 1) * 3)
  const trailMag = new Float32Array(starCount * (segments + 1))
  const starPositions = new Float32Array(starCount * 3)
  const starMag = new Float32Array(starCount)
  const starSeed = new Float32Array(starCount)
  const trailIndices: number[] = []
  const color = new THREE.Color()

  for (let i = 0; i < starCount; i += 1) {
    const u = rand() * 1.6 - 0.3
    const theta = rand() * Math.PI * 2
    const s = Math.sqrt(Math.max(0, 1 - u * u))
    const dir = new THREE.Vector3(s * Math.cos(theta), Math.abs(u) * 0.9 + 0.02, s * Math.sin(theta)).normalize()
    const mag = Math.pow(rand(), 1.9)
    const warm = rand()
    color.setHSL(0.55 + warm * 0.12, 0.35 * warm, 0.6 + 0.35 * (1 - mag))
    starPositions[i * 3] = dir.x
    starPositions[i * 3 + 1] = dir.y
    starPositions[i * 3 + 2] = dir.z
    starMag[i] = mag
    starSeed[i] = rand()
    for (let k = 0; k <= segments; k += 1) {
      const index = i * (segments + 1) + k
      trailPositions[index * 3] = dir.x
      trailPositions[index * 3 + 1] = dir.y
      trailPositions[index * 3 + 2] = dir.z
      trailT[index] = k / segments
      trailColor[index * 3] = color.r
      trailColor[index * 3 + 1] = color.g
      trailColor[index * 3 + 2] = color.b
      trailMag[index] = mag
    }
    for (let k = 0; k < segments; k += 1) {
      const a = i * (segments + 1) + k
      trailIndices.push(a, a + 1)
    }
  }

  const trailGeometry = new THREE.BufferGeometry()
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3))
  trailGeometry.setAttribute('aT', new THREE.BufferAttribute(trailT, 1))
  trailGeometry.setAttribute('aColor', new THREE.BufferAttribute(trailColor, 3))
  trailGeometry.setAttribute('aMag', new THREE.BufferAttribute(trailMag, 1))
  trailGeometry.setIndex(trailIndices)
  const trailUniforms: Record<string, THREE.IUniform> = {
    uPole: { value: pole.clone() },
    uAngle: { value: 0 },
    uRadius: { value: radius },
    uBright: { value: trailBright }
  }
  const trailMaterial = new THREE.ShaderMaterial({
    uniforms: trailUniforms,
    vertexShader: TRAIL_VERTEX,
    fragmentShader: TRAIL_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  })
  const trails = new THREE.LineSegments(trailGeometry, trailMaterial)
  trails.renderOrder = -1
  trails.frustumCulled = false

  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  starGeometry.setAttribute('aMag', new THREE.BufferAttribute(starMag, 1))
  starGeometry.setAttribute('aSeed', new THREE.BufferAttribute(starSeed, 1))
  const starUniforms: Record<string, THREE.IUniform> = {
    uPole: { value: pole.clone() },
    uAngle: { value: 0 },
    uRadius: { value: radius * 0.999 },
    uSize: { value: 3.2 },
    uSizeScale: { value: radius * 0.346 },
    uTime: { value: 0 }
  }
  const starMaterial = new THREE.ShaderMaterial({
    uniforms: starUniforms,
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  })
  const stars = new THREE.Points(starGeometry, starMaterial)
  stars.renderOrder = 0
  stars.frustumCulled = false

  // 地平线山体剪影：改由真实地球地形承担，这里不再绘制假的山体环

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2.2, radius * 0.09),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffb066'),
      transparent: true,
      opacity: 0.28 * cityGlow,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false
    })
  )
  glow.position.set(0, radius * 0.015, radius * 0.9)
  glow.renderOrder = 0

  const meteor = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 0.085, radius * 0.0023),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffffff'),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false
    })
  )
  meteor.renderOrder = 1

  const group = new THREE.Group()
  group.add(sky, trails, stars, glow, meteor)

  let time = 0
  let meteorTimer = 1
  let meteorLife = 0
  const meteorDir = new THREE.Vector3()
  const meteorPos = new THREE.Vector3()

  const tick = (delta: number): void => {
    time += delta
    const phase = (time / cycle) % 1
    const angle = exposure * 15.041 * DEG * smoothstep(0, 1, Math.min(1, phase / 0.9))
    const fade = phase > 0.93 ? 1 - (phase - 0.93) / 0.07 : 1
    trailUniforms.uAngle.value = angle
    trailUniforms.uBright.value = trailBright * fade
    starUniforms.uAngle.value = angle
    starUniforms.uTime.value = time

    meteorTimer -= delta
    if (meteorTimer <= 0 && meteorRate > 0) {
      meteorTimer = 1 / meteorRate
      meteorLife = 1.4
      const a = rand() * Math.PI * 2
      const alt = 0.5 + rand() * 0.5
      meteorPos.set(Math.cos(a) * radius * 0.9, alt * radius, Math.sin(a) * radius * 0.9)
      meteorDir.set(-Math.cos(a + 0.6), -0.25, -Math.sin(a + 0.6)).normalize()
    }
    if (meteorLife > 0) {
      meteorLife -= delta
      meteor.position.copy(meteorPos).addScaledVector(meteorDir, (1.4 - meteorLife) * radius * 0.346)
      meteor.lookAt(meteor.position.clone().add(meteorDir))
      ;(meteor.material as THREE.MeshBasicMaterial).opacity = Math.max(0, meteorLife / 1.4) * 0.9
    } else {
      ;(meteor.material as THREE.MeshBasicMaterial).opacity = 0
    }
  }

  const update = (v: ParamValues): void => {
    exposure = num(v, 'exposure', 1.8)
    cycle = Math.max(6, num(v, 'cycle', 22))
    meteorRate = Math.max(0, num(v, 'meteor', 0.35))
    trailBright = num(v, 'trailBright', 1)
    latitude = num(v, 'latitude', 42)
    const nextPole = new THREE.Vector3(0, Math.sin(latitude * DEG), -Math.cos(latitude * DEG)).normalize()
    ;(trailUniforms.uPole.value as THREE.Vector3).copy(nextPole)
    ;(starUniforms.uPole.value as THREE.Vector3).copy(nextPole)
    starUniforms.uSize.value = num(v, 'starSize', 3.2) * 3.2
    ;(glow.material as THREE.MeshBasicMaterial).opacity = 0.28 * num(v, 'cityGlow', 0.6)
    const skyMat = sky.material as THREE.ShaderMaterial
    ;(skyMat.uniforms.uTop.value as THREE.Color).set(str(v, 'skyTop', '#01030c'))
    ;(skyMat.uniforms.uBottom.value as THREE.Color).set(str(v, 'skyBottom', '#0a1b33'))
    ;(skyMat.uniforms.uAirglow.value as THREE.Color).set(str(v, 'airglow', '#123a4a'))
  }

  return { systems: [], objects: [group], tick, update }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const COSMIC_META: Record<CosmicEffectId, EffectMeta> = {
  'solar-wind': {
    id: 'solar-wind',
    title: 'VFX 行星级太阳风与磁层',
    subtitle: '弓激波 + 磁层顶 + 太阳风粒子 + CME 冲击 + 极光卵',
    description:
      '以真实地球为基底的行星尺度效果：外层弓激波、内层磁层顶构成双层半透明泪滴状空腔包裹地球，随太阳风动压与南向 Bz 收缩，太阳风粒子自日侧涌入、沿腔体外滑入磁尾；太阳风暴来袭时 CME 高密度壳层撞入，磁层被压缩、极区极光卵骤然增强。尺度以地球半径 Re 为基准，磁层顶约 10 Re、磁尾延伸数十 Re，相机位于数 Re 高度可见整个地球。太阳风速度/密度、Bz、Kp、磁层顶距离与磁尾长度、CME 强度/间隔、极光亮度与颜色均可实时调整。',
    params: [
      { key: 'lat', label: '地磁纬度', kind: 'number', min: -70, max: 70, step: 1, unit: '°', default: 40, tip: '观测锚点纬度，决定极光卵相对地球自转轴的位置（修改后重建）。' },
      { key: 'standoff', label: '磁层顶距离', kind: 'number', min: 6, max: 16, step: 0.5, unit: 'Re', default: 10, tip: '日侧磁层顶到地心的距离，南向 Bz 增大时自动收缩（修改后重建）。' },
      { key: 'flare', label: '磁层张角', kind: 'number', min: 0.2, max: 0.6, step: 0.02, default: 0.32, tip: '磁层顶向磁尾扩张的幂指数，越大腔体越像喇叭（修改后重建）。' },
      { key: 'tailLength', label: '磁尾长度', kind: 'number', min: 15, max: 90, step: 1, unit: 'Re', default: 40, tip: '背阳面磁尾延伸的长度（修改后重建）。' },
      { key: 'tailRadius', label: '磁尾半径', kind: 'number', min: 4, max: 30, step: 0.5, unit: 'Re', default: 12, tip: '磁尾瓣的截面半径（修改后重建）。' },
      { key: 'bz', label: 'IMF Bz', kind: 'number', min: -16, max: 16, step: 1, unit: 'nT', default: -6, tip: '行星际磁场径向分量，越负磁层顶压缩越明显、极光越活跃。' },
      { key: 'kp', label: 'Kp 指数', kind: 'number', min: 0, max: 9, step: 0.5, default: 5, tip: '地磁活动指数，决定极光卵向低纬扩张的尺度（修改后重建）。' },
      { key: 'windSpeed', label: '太阳风速度', kind: 'number', min: 0.4, max: 4, step: 0.1, unit: 'Re/s', default: 1.6, tip: '太阳风流的速度（地球半径/秒），同时决定粒子贯穿磁尾所需时间。' },
      { key: 'windRate', label: '太阳风密度', kind: 'number', min: 200, max: 2200, step: 50, unit: '个/秒', default: 700, tip: '太阳风粒子的每秒发射量（对性能影响较大）。' },
      { key: 'cmeInterval', label: 'CME 间隔', kind: 'number', min: 4, max: 40, step: 1, unit: '秒', default: 16, tip: '日冕物质抛射壳层重复来袭的周期。' },
      { key: 'cmeStrength', label: 'CME 强度', kind: 'number', min: 0.2, max: 2, step: 0.1, default: 1, tip: 'CME 冲击壳层的亮度与极光脉冲强度。' },
      { key: 'auroraBright', label: '极光亮度', kind: 'number', min: 0, max: 3, step: 0.1, default: 1, tip: '极区极光卵的辉光强度。' },
      { key: 'mpOpacity', label: '磁层不透明度', kind: 'number', min: 0.1, max: 1, step: 0.05, default: 0.45, tip: '弓激波与磁层顶壳层的透明程度。' },
      { key: 'mpColor', label: '磁层顶颜色', kind: 'color', default: '#3f7bff', tip: '内层磁层顶的基础色。' },
      { key: 'bowColor', label: '弓激波颜色', kind: 'color', default: '#b25bff', tip: '外层弓激波的基础色。' },
      { key: 'cmeColor', label: 'CME 颜色', kind: 'color', default: '#ff7ab8', tip: '日冕物质抛射壳层的颜色。' }
    ],
    rebuildKeys: ['lat', 'standoff', 'flare', 'tailLength', 'tailRadius', 'kp']
  },
  blackhole: {
    id: 'blackhole',
    title: 'VFX 黑洞吸积盘与相对论喷流',
    subtitle: '开普勒剪切盘 + 多普勒集束 + 光子环 + 螺旋喷流',
    description:
      '以真实地球为基底的宏大天体场景：巨大黑洞悬停在地球上空约 1.4 Re 处，真实地球作为前景/基底出现在画面下方。开普勒剪切盘自动生成旋臂与缠绕结构，盘面按有效温度做黑体着色，approaching 侧多普勒增亮偏蓝、receding 侧偏暗偏红；中心为黑洞剪影、边缘细亮光子环，上方叠加被引力弯折的次级成像弧；两极相对论性喷流带螺旋磁场结构与周期性激波亮结。尺度以地球半径 Re 为基准（盘面约 1 Re、喷流约 1 Re），配合数 Re 的相机距离呈现尺度失控的观感。盘内外半径、自转速度、亮度、多普勒强度、喷流功率/长度/亮结数、整体倾角与冷热颜色均可调整。',
    params: [
      { key: 'innerR', label: '盘内半径', kind: 'number', min: 0.15, max: 1.2, step: 0.05, unit: 'Re', default: 0.35, tip: '吸积盘内缘半径（以地球半径 Re 为基准），通常为最内稳定圆轨道附近。' },
      { key: 'outerR', label: '盘外半径', kind: 'number', min: 0.5, max: 3, step: 0.05, unit: 'Re', default: 1, tip: '吸积盘外缘半径，越大盘面越开阔。' },
      { key: 'spin', label: '盘自转速度', kind: 'number', min: 0.2, max: 6, step: 0.1, default: 2.2, tip: '螺旋密度波沿盘面旋转的角速度。' },
      { key: 'brightness', label: '盘面亮度', kind: 'number', min: 0.2, max: 3, step: 0.05, default: 1.8, tip: '吸积盘的整体发光强度。' },
      { key: 'doppler', label: '多普勒强度', kind: 'number', min: 0, max: 1.2, step: 0.05, default: 0.55, tip: '相对论集束造成的左右亮度差，越高 approaching 侧越亮。' },
      { key: 'tilt', label: '整体倾角', kind: 'number', min: 0, max: 70, step: 1, unit: '°', default: 24, tip: '吸积盘相对水平面的倾斜，配合相机俯角改变观感。' },
      { key: 'jetPower', label: '喷流功率', kind: 'number', min: 0.1, max: 2.5, step: 0.05, default: 1, tip: '两极喷流的粒子密度与亮度。' },
      { key: 'jetLength', label: '喷流长度', kind: 'number', min: 0.4, max: 2.6, step: 0.05, unit: 'Re', default: 1.1, tip: '喷流沿极轴延伸的长度（以地球半径 Re 为基准）。' },
      { key: 'knots', label: '激波亮结数', kind: 'number', min: 0, max: 9, step: 1, default: 5, tip: '喷流上周期性亮结的数量（修改后重建）。' },
      { key: 'hotColor', label: '内缘颜色', kind: 'color', default: '#fff3dc', tip: '吸积盘内缘（最热）的辐射色。' },
      { key: 'coldColor', label: '外缘颜色', kind: 'color', default: '#b8350f', tip: '吸积盘外缘（较冷）的辐射色。' },
      { key: 'jetColor', label: '喷流颜色', kind: 'color', default: '#8fd0ff', tip: '相对论喷流的颜色。' }
    ],
    rebuildKeys: ['innerR', 'outerR', 'jetLength', 'knots', 'jetColor']
  },
  pointcloud: {
    id: 'pointcloud',
    title: 'VFX 点云地球转场',
    subtitle: '城市点云 → 地球板块 → 螺旋星云 三态形变',
    description:
      '以真实地球为基底的尺度转场：同一批点在三种语义状态间连续形变——城市态在真实地表锚点上空聚成一片楼宇灯海，随后浮升汇聚成与真实地球表面重合的点云地球（噪声陆海掩膜使大陆清晰可辨、海洋点下沉隐藏），再解体为对数螺旋臂的星云态，循环往复。全部位置以地球半径 Re 为基准（地球态 1 Re、星云态数 Re），相机位于数 Re 高度可见整个真实地球。着色器按逐点随机延迟做缓动插值，过渡中段沿球面外推并放大尺寸，形成解体—重组感。点数、地球半径倍数、城市范围/高度、螺旋臂数与张角、星云半径、点尺寸、循环周期、亮度与配色均可调整。',
    params: [
      { key: 'count', label: '点云数量', kind: 'number', min: 20000, max: 220000, step: 5000, unit: '个', default: 90000, tip: '三态共用的点数，越大越细腻但显存与算力开销越高（修改后重建）。' },
      { key: 'earthR', label: '地球半径', kind: 'number', min: 0.5, max: 1.6, step: 0.02, unit: 'Re', default: 1, tip: '地球态点云球面相对真实地球半径的倍数，1.0 时与真实地球表面重合。' },
      { key: 'citySpan', label: '城市范围', kind: 'number', min: 0.01, max: 0.2, step: 0.005, unit: 'Re', default: 0.03, tip: '城市态点云簇的横向范围（以地球半径 Re 为基准）。' },
      { key: 'cityHeight', label: '城市高度', kind: 'number', min: 0.002, max: 0.05, step: 0.001, unit: 'Re', default: 0.008, tip: '城市态楼宇的最大高度。' },
      { key: 'arms', label: '螺旋臂数', kind: 'number', min: 2, max: 6, step: 1, default: 3, tip: '星云态的螺旋臂数量（修改后重建）。' },
      { key: 'pitch', label: '螺旋张角', kind: 'number', min: 0.05, max: 0.5, step: 0.01, default: 0.24, tip: '星云螺旋臂的对数螺距，越大缠绕越松。' },
      { key: 'nebulaR', label: '星云半径', kind: 'number', min: 1.5, max: 12, step: 0.5, unit: 'Re', default: 4, tip: '星云态的盘面半径（以地球半径 Re 为基准）。' },
      { key: 'pointSize', label: '点尺寸', kind: 'number', min: 0.5, max: 6, step: 0.1, default: 2, tip: '单个点的基础像素尺寸（含距离衰减）。' },
      { key: 'cycle', label: '循环周期', kind: 'number', min: 6, max: 40, step: 1, unit: '秒', default: 18, tip: '城市→地球→星云的完整循环时长。' },
      { key: 'brightness', label: '整体亮度', kind: 'number', min: 0.2, max: 2.5, step: 0.05, default: 0.9, tip: '点云的整体亮度增益。' },
      { key: 'colorA', label: '配色起始色', kind: 'color', default: '#ffd27a', tip: '点云基础配色的起始色。' },
      { key: 'colorB', label: '配色结束色', kind: 'color', default: '#7ab8ff', tip: '点云基础配色的结束色。' }
    ],
    rebuildKeys: ['count', 'arms', 'earthR', 'citySpan', 'cityHeight', 'pitch', 'nebulaR', 'colorA', 'colorB']
  },
  seismic: {
    id: 'seismic',
    title: 'VFX 地震波传播环',
    subtitle: 'P/S/面波三环 + 尾波回绕 + 烈度圈 + 建筑摆动',
    description:
      '以贴地同心环带还原地震波传播：蓝白 P 波最快、橙黄 S 波次之、红色面波最慢且振幅最大并多次尾波回绕，环带振幅随球面几何扩散与介质衰减变化；震中持续发光，周围建筑按波到时间产生水平摆动，近震中与软土场地响应更大。震级、P/S/面波速度、环带宽度、衰减长度、亮度、建筑数量与摆动幅度、三类波的着色均可实时调整。',
    params: [
      { key: 'magnitude', label: '震级', kind: 'number', min: 3, max: 9, step: 0.1, default: 6.4, tip: '地震矩震级，整体放大波环亮度与建筑响应。' },
      { key: 'pSpeed', label: 'P 波速度', kind: 'number', min: 300, max: 1100, step: 20, unit: 'u/s', default: 620, tip: '纵波（压缩波）的视传播速度，最快到达。' },
      { key: 'sSpeed', label: 'S 波速度', kind: 'number', min: 180, max: 700, step: 20, unit: 'u/s', default: 360, tip: '横波（剪切波）的视传播速度。' },
      { key: 'rSpeed', label: '面波速度', kind: 'number', min: 100, max: 500, step: 10, unit: 'u/s', default: 210, tip: '面波（Rayleigh/Love）的视传播速度，最慢、振幅最大。' },
      { key: 'waveWidth', label: '波前宽度', kind: 'number', min: 10, max: 120, step: 2, unit: 'u', default: 46, tip: '各波环带的径向厚度。' },
      { key: 'decay', label: '衰减长度', kind: 'number', min: 400, max: 4000, step: 100, unit: 'u', default: 1500, tip: '振幅随距离指数衰减的特征长度。' },
      { key: 'brightness', label: '波环亮度', kind: 'number', min: 0.2, max: 2.5, step: 0.05, default: 1.1, tip: '三类波环的整体亮度。' },
      { key: 'groundR', label: '地面范围', kind: 'number', min: 600, max: 2600, step: 100, unit: 'u', default: 1600, tip: '波场覆盖的地面半径。' },
      { key: 'buildings', label: '建筑数量', kind: 'number', min: 0, max: 500, step: 20, default: 260, tip: '参与摆动响应的建筑实例数量（修改后重建）。' },
      { key: 'shake', label: '摆动幅度', kind: 'number', min: 0, max: 40, step: 1, unit: 'u', default: 16, tip: '建筑随波前晃动的水平位移幅度。' },
      { key: 'pColor', label: 'P 波颜色', kind: 'color', default: '#9fd8ff', tip: '纵波波环的颜色。' },
      { key: 'sColor', label: 'S 波颜色', kind: 'color', default: '#ffb14a', tip: '横波波环的颜色。' },
      { key: 'rColor', label: '面波颜色', kind: 'color', default: '#ff5a3c', tip: '面波与尾波波环的颜色。' }
    ],
    rebuildKeys: ['groundR', 'buildings']
  },
  sonar: {
    id: 'sonar',
    title: 'VFX 声呐扫描波',
    subtitle: '水体介质 + 主动脉冲锥 + 目标回波 + 多波束覆盖',
    description:
      '以深水介质与海底散射噪声构成水下空间，主动声呐以锥形脉冲向外推进、前沿最亮、后方按双程衰减留余辉；波前扫过海底时留下扇形多波束覆盖条带，命中目标时产生随距离衰减的回波闪亮，并有大量悬浮的海洋雪缓缓下沉。脉冲间隔/推进速度、波束张角、水体浑浊度、海雪密度、回波强度、目标距离、海底深度与颜色均可实时调整。',
    params: [
      { key: 'range', label: '探测距离', kind: 'number', min: 600, max: 2600, step: 100, unit: 'u', default: 1500, tip: '主动声呐脉冲的最大传播距离。' },
      { key: 'beamAngle', label: '波束张角', kind: 'number', min: 6, max: 60, step: 1, unit: '°', default: 26, tip: '声呐锥形波束的半张角，越大覆盖越宽。' },
      { key: 'interval', label: '脉冲间隔', kind: 'number', min: 0.6, max: 8, step: 0.1, unit: '秒', default: 2.6, tip: '相邻两次声呐脉冲的发射间隔。' },
      { key: 'pulseSpeed', label: '脉冲速度', kind: 'number', min: 0.2, max: 4, step: 0.1, default: 1, tip: '脉冲前沿沿波束推进的速度倍率。' },
      { key: 'opacity', label: '波束不透明度', kind: 'number', min: 0.1, max: 1, step: 0.05, default: 0.6, tip: '声呐波束的可见程度。' },
      { key: 'turbidity', label: '水体浑浊度', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.55, tip: '水体介质的浓度，越高越浑浊幽暗。' },
      { key: 'snowRate', label: '海雪密度', kind: 'number', min: 0, max: 2200, step: 50, unit: '个/秒', default: 600, tip: '悬浮海洋雪颗粒的每秒生成量（对性能影响较大）。' },
      { key: 'targetDist', label: '目标距离', kind: 'number', min: 200, max: 2200, step: 50, unit: 'u', default: 780, tip: '被探测目标相对声呐的水平距离。' },
      { key: 'echoStrength', label: '回波强度', kind: 'number', min: 0, max: 2, step: 0.05, default: 1, tip: '目标反射回波的亮度。' },
      { key: 'seabedDepth', label: '海底深度', kind: 'number', min: 80, max: 600, step: 20, unit: 'u', default: 220, tip: '海底相对声呐所在的深度。' },
      { key: 'beamColor', label: '波束颜色', kind: 'color', default: '#35e0ff', tip: '声呐脉冲波束的颜色。' },
      { key: 'seabedColor', label: '海底颜色', kind: 'color', default: '#0e3a44', tip: '海底散射噪声着色。' }
    ],
    rebuildKeys: ['range', 'beamAngle', 'seabedDepth', 'targetDist']
  },
  startrails: {
    id: 'startrails',
    title: 'VFX 银河星轨延时',
    subtitle: '天球坐标 + 同心星轨 + 真实地球地景 + 延时质感',
    description:
      '以真实地球为观测基底的夜景长曝光：观测锚点落在真实地表，天极方向由观测纬度决定，星点绕天极轴旋转并在曝光时长内拖出同心圆弧轨迹，天极高度严格等于当地纬度；天顶半径约 0.05 Re 的天球仅保留地平线以上半球，地平以下由压暗后的真实地球影像作为夜间地景与剪影，星轨被地平线正确截断，地平附近受大气消光偏红偏暗。画面叠加银河、城市光污染穹顶与偶尔划过的流星，曝光周期循环时星轨从无到有生长。曝光时长、观测纬度、星数、星轨亮度、星点尺寸、循环周期、流星频率、城市辉光与天空配色均可实时调整。',
    params: [
      { key: 'exposure', label: '曝光时长', kind: 'number', min: 0.3, max: 4, step: 0.1, unit: '小时', default: 1.8, tip: '等效长曝光时长，决定星轨圆弧的展开角度（15°/小时）。' },
      { key: 'latitude', label: '观测纬度', kind: 'number', min: -70, max: 70, step: 1, unit: '°', default: 42, tip: '观测者纬度，天极高度等于纬度、赤道处星轨为长弧。' },
      { key: 'starCount', label: '星点数量', kind: 'number', min: 200, max: 2600, step: 100, default: 1100, tip: '参与绘制星轨的星点数量（修改后重建）。' },
      { key: 'trailBright', label: '星轨亮度', kind: 'number', min: 0.2, max: 2.5, step: 0.05, default: 1, tip: '星轨与星点的整体亮度。' },
      { key: 'starSize', label: '星点尺寸', kind: 'number', min: 0.3, max: 3, step: 0.1, default: 1, tip: '亮星的像素尺寸倍率。' },
      { key: 'cycle', label: '循环周期', kind: 'number', min: 6, max: 45, step: 1, unit: '秒', default: 22, tip: '星轨从零生长到最大弧长所需的时间。' },
      { key: 'meteor', label: '流星频率', kind: 'number', min: 0, max: 2, step: 0.05, unit: '次/秒', default: 0.35, tip: '流星出现的平均频率。' },
      { key: 'cityGlow', label: '城市辉光', kind: 'number', min: 0, max: 2, step: 0.05, default: 0.6, tip: '地平线方向光污染穹顶的强度。' },
      { key: 'skyTop', label: '天顶颜色', kind: 'color', default: '#01030c', tip: '天顶方向的夜空底色。' },
      { key: 'skyBottom', label: '地平颜色', kind: 'color', default: '#0a1b33', tip: '地平方向的夜空底色。' },
      { key: 'airglow', label: '气辉颜色', kind: 'color', default: '#123a4a', tip: '地平附近的大气气辉颜色。' }
    ],
    rebuildKeys: ['starCount']
  }
}

export const COSMIC_EFFECT_IDS: CosmicEffectId[] = [
  'solar-wind',
  'blackhole',
  'pointcloud',
  'seismic',
  'sonar',
  'startrails'
]

export function buildCosmicEffect(
  id: CosmicEffectId,
  values: ParamValues,
  ctx: EffectBuildContext
): BuiltEffect {
  switch (id) {
    case 'solar-wind':
      return buildSolarWind(values, ctx)
    case 'blackhole':
      return buildBlackhole(values, ctx)
    case 'pointcloud':
      return buildPointCloud(values, ctx)
    case 'seismic':
      return buildSeismic(values, ctx)
    case 'sonar':
      return buildSonar(values, ctx)
    case 'startrails':
      return buildStarTrails(values, ctx)
    default: {
      const exhaustive: never = id
      return exhaustive
    }
  }
}
