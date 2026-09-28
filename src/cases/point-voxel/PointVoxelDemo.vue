<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  ClippingPlane,
  ClippingPlaneCollection,
  Color,
  CustomShader,
  Matrix4,
  MetadataComponentType,
  MetadataType,
  PointPrimitiveCollection,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Transforms,
  UniformType,
  VoxelContent,
  VoxelPrimitive,
  VoxelShapeType,
  Math as CesiumMath,
  type PointPrimitive,
  type VoxelProvider,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import InfoTip from '../../components/InfoTip.vue'

/** 场景中心与体元素包围盒（局部 ENU 米坐标以中心为原点） */
const CENTER = { lon: 116.39, lat: 39.91, height: 300 }
const VOLUME = { width: 4200, depth: 4200, height: 2400 }
const MIN_X = -VOLUME.width / 2
const MAX_X = VOLUME.width / 2
const MIN_Y = -VOLUME.depth / 2
const MAX_Y = VOLUME.depth / 2
const MIN_Z = 0
const MAX_Z = VOLUME.height
const CENTER_LOCAL = { x: 0, y: 0, z: (MIN_Z + MAX_Z) / 2 }
const HALF_DIAGONAL = 0.5 * Math.sqrt(VOLUME.width ** 2 + VOLUME.depth ** 2 + VOLUME.height ** 2)

/** 单个体元素最多考察的候选点数上限，保证极端参数下仍是毫秒级重建 */
const MAX_CANDIDATES = 4096
/** 剖切面预览贴图分辨率（正方形像素边长） */
const CLIP_PREVIEW_SIZE = 168

type PaletteDef = { label: string; stops: [number, number, number][] }

/** 色带（5 个色标，与片元着色器中的 samplePalette 一一对应） */
const PALETTES: PaletteDef[] = [
  { label: '热度', stops: [[0, 0, 4], [64, 22, 120], [140, 41, 129], [222, 73, 104], [252, 253, 191]] },
  { label: '彩虹', stops: [[25, 60, 193], [0, 191, 219], [61, 196, 48], [250, 206, 40], [215, 48, 39]] },
  { label: '地形', stops: [[26, 52, 90], [46, 125, 77], [180, 190, 120], [150, 100, 60], [255, 255, 255]] },
  { label: '冷暖', stops: [[32, 90, 180], [120, 190, 230], [240, 240, 240], [245, 160, 90], [200, 40, 40]] }
]

function paletteColor(palette: number, t: number): [number, number, number] {
  const stops = PALETTES[palette].stops
  const c = Math.max(0, Math.min(1, t))
  const scaled = c * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(scaled))
  const local = scaled - i
  const a = stops[i]
  const b = stops[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * local),
    Math.round(a[1] + (b[1] - a[1]) * local),
    Math.round(a[2] + (b[2] - a[2]) * local)
  ]
}

/** 确定性伪随机数发生器，保证相同种子重建结果一致 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Anomaly = { x: number; y: number; z: number; amp: number; sig: number }

/** 模拟场的若干个三维高斯异常体 + 背景起伏 */
function makeAnomalies(rand: () => number): Anomaly[] {
  const list: Anomaly[] = []
  const count = 3
  for (let i = 0; i < count; i += 1) {
    list.push({
      x: 0.2 + 0.6 * rand(),
      y: 0.2 + 0.6 * rand(),
      z: 0.2 + 0.6 * rand(),
      amp: 0.55 + 0.4 * rand(),
      sig: 0.12 + 0.12 * rand()
    })
  }
  return list
}

function fieldValue(nx: number, ny: number, nz: number, anomalies: Anomaly[]): number {
  let v = 0
  for (let i = 0; i < anomalies.length; i += 1) {
    const a = anomalies[i]
    const dx = nx - a.x
    const dy = ny - a.y
    const dz = nz - a.z
    v += a.amp * Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * a.sig * a.sig))
  }
  v += 0.08 * Math.sin(nx * Math.PI * 2) * Math.cos(ny * Math.PI * 2)
  return Math.max(0, Math.min(1, v))
}

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const showVolume = ref(true)
const showPoints = ref(true)

const pointCount = ref(4000)
const seed = ref(20260928)
const gridX = ref(28)
const gridY = ref(28)
const gridZ = ref(20)
const searchRadius = ref(0.22)
const idwPower = ref(2)
const fillEmpty = ref(true)

const palette = ref(0)
const opacity = ref(0.72)
const valueMin = ref(0)
const valueMax = ref(1)
const stepSize = ref(1)
const sse = ref(8)
const nearest = ref(false)
const pointSize = ref(5)
/** 圆滑过渡强度（0=硬块状，100=最圆滑）：同时控制体元素场平滑与表面光照抑制 */
const smoothTransition = ref(60)

/** 任意方向剖切参数：方位角/倾角定义法线方向，偏移决定切面位置 */
const clip = reactive({ enabled: true, azimuth: 45, tilt: 0, offset: 0, flip: false })
const clipPreview = ref('')

const stats = reactive({
  points: 0,
  voxels: 0,
  filled: 0,
  elapsed: 0,
  dataMin: 0,
  dataMax: 1
})

const picked = ref<{ x: number; y: number; z: number; value: number; valid: boolean } | null>(null)

const legendStyle = computed(() => {
  const stops = PALETTES[palette.value].stops.map((s) => `rgb(${s[0]}, ${s[1]}, ${s[2]})`).join(', ')
  return { background: `linear-gradient(90deg, ${stops})` }
})

/** 体元素值域标记（r=value, g=valid），交由片元着色器做色带映射 */
const voxelShader = new CustomShader({
  uniforms: {
    uPalette: { type: UniformType.INT, value: 0 },
    uValueMin: { type: UniformType.FLOAT, value: 0 },
    uValueMax: { type: UniformType.FLOAT, value: 1 },
    uOpacity: { type: UniformType.FLOAT, value: 0.72 },
    uShading: { type: UniformType.FLOAT, value: 0.5 }
  },
  fragmentShaderText: `
    vec3 samplePalette(float t) {
      t = clamp(t, 0.0, 1.0);
      vec3 c0;
      vec3 c1;
      vec3 c2;
      vec3 c3;
      vec3 c4;
      if (uPalette == 0) {
        c0 = vec3(0.000, 0.000, 0.016);
        c1 = vec3(0.251, 0.086, 0.471);
        c2 = vec3(0.549, 0.161, 0.506);
        c3 = vec3(0.871, 0.286, 0.408);
        c4 = vec3(0.988, 0.992, 0.749);
      } else if (uPalette == 1) {
        c0 = vec3(0.098, 0.235, 0.757);
        c1 = vec3(0.000, 0.749, 0.859);
        c2 = vec3(0.239, 0.769, 0.188);
        c3 = vec3(0.980, 0.808, 0.157);
        c4 = vec3(0.843, 0.188, 0.153);
      } else if (uPalette == 2) {
        c0 = vec3(0.102, 0.204, 0.353);
        c1 = vec3(0.180, 0.490, 0.302);
        c2 = vec3(0.706, 0.745, 0.471);
        c3 = vec3(0.588, 0.392, 0.235);
        c4 = vec3(1.000, 1.000, 1.000);
      } else {
        c0 = vec3(0.125, 0.353, 0.706);
        c1 = vec3(0.471, 0.745, 0.902);
        c2 = vec3(0.941, 0.941, 0.941);
        c3 = vec3(0.961, 0.627, 0.353);
        c4 = vec3(0.784, 0.157, 0.157);
      }
      float scaled = t * 4.0;
      if (scaled < 1.0) {
        return mix(c0, c1, scaled);
      }
      if (scaled < 2.0) {
        return mix(c1, c2, scaled - 1.0);
      }
      if (scaled < 3.0) {
        return mix(c2, c3, scaled - 2.0);
      }
      return mix(c3, c4, scaled - 3.0);
    }

    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      vec4 meta = fsInput.metadata.color;
      float value = meta.r;
      float valid = meta.g;
      vec3 color = vec3(0.0);
      float alpha = 0.0;
      if (valid > 0.5) {
        float t = clamp((value - uValueMin) / max(0.000001, uValueMax - uValueMin), 0.0, 1.0);
        color = samplePalette(t);
        alpha = uOpacity * (0.05 + 0.95 * t);
      }
      float ndotl = max(dot(normalize(fsInput.attributes.normalEC), normalize(vec3(0.3, 0.5, 0.8))), 0.0);
      float shade = mix(1.0, 0.6 + 0.4 * ndotl, uShading);
      material.diffuse = color * shade;
      material.alpha = alpha;
    }
  `
})

let viewer: Viewer | undefined
let voxelPrimitive: VoxelPrimitive | undefined
let pointCollection: PointPrimitiveCollection | undefined
let pointPrimitives: PointPrimitive[] = []
let handler: ScreenSpaceEventHandler | undefined

let clipCollection: ClippingPlaneCollection | undefined
let clipPlane: ClippingPlane | undefined

/** 归一化空间 [0,1]^3 中的采样点与场值 */
let normPositions: Float32Array | undefined
let pointValues: Float32Array | undefined
/** 体元素网格重建结果（保留用于拾取查询与剖切面采样） */
let voxelValues: Float32Array | undefined
let voxelValid: Uint8Array | undefined

function generatePoints(): void {
  const n = pointCount.value
  const rand = mulberry32(seed.value)
  const anomalies = makeAnomalies(rand)
  const norm = new Float32Array(n * 3)
  const values = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const nx = rand()
    const ny = rand()
    const nz = rand()
    norm[i * 3] = nx
    norm[i * 3 + 1] = ny
    norm[i * 3 + 2] = nz
    const noisy = fieldValue(nx, ny, nz, anomalies) + (rand() - 0.5) * 0.08
    values[i] = Math.max(0, Math.min(1, noisy))
  }
  normPositions = norm
  pointValues = values
  stats.points = n
}

/** 对体元素标量场做可分离的三维高斯模糊，削弱体素的块状边界，得到更圆滑的过渡 */
function smoothVoxelField(
  values: Float32Array,
  valid: Uint8Array,
  gx: number,
  gy: number,
  gz: number,
  passes: number
): void {
  const strideY = gx
  const strideZ = gx * gy
  const out = new Float32Array(values.length)
  // 3x3x3 高斯核权重：面 4、棱 2、角 1、中心 8
  const offsets: [number, number, number, number][] = [[0, 0, 0, 8]]
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0 && dz === 0) continue
        const dist = Math.abs(dx) + Math.abs(dy) + Math.abs(dz)
        const weight = dist === 1 ? 4 : dist === 2 ? 2 : 1
        offsets.push([dx, dy, dz, weight])
      }
    }
  }
  for (let p = 0; p < passes; p += 1) {
    for (let z = 0; z < gz; z += 1) {
      for (let y = 0; y < gy; y += 1) {
        for (let x = 0; x < gx; x += 1) {
          const index = z * strideZ + y * strideY + x
          if (!valid[index]) {
            out[index] = values[index]
            continue
          }
          let sum = 0
          let wsum = 0
          for (let o = 0; o < offsets.length; o += 1) {
            const off = offsets[o]
            const nx = x + off[0]
            const ny = y + off[1]
            const nz = z + off[2]
            if (nx < 0 || ny < 0 || nz < 0 || nx >= gx || ny >= gy || nz >= gz) continue
            const nIndex = nz * strideZ + ny * strideY + nx
            if (!valid[nIndex]) continue
            const w = off[3]
            sum += w * values[nIndex]
            wsum += w
          }
          out[index] = wsum > 0 ? sum / wsum : values[index]
        }
      }
    }
    values.set(out)
  }
}

/** 以空间哈希桶加速的空间点插值，把离散点重建为规则体元素网格 */
function buildVoxelField(): { metadata: Float32Array; values: Float32Array; valid: Uint8Array; filled: number } {
  const gx = gridX.value
  const gy = gridY.value
  const gz = gridZ.value
  const total = gx * gy * gz
  const values = new Float32Array(total)
  const valid = new Uint8Array(total)
  const metadata = new Float32Array(total * 4)

  const norm = normPositions
  const vals = pointValues
  const n = pointCount.value
  if (!norm || !vals || n === 0) {
    return { metadata, values, valid, filled: 0 }
  }

  const radius = searchRadius.value
  const power = idwPower.value
  const cell = Math.max(1e-3, radius)
  const nb = Math.max(1, Math.ceil(1 / cell))
  const buckets: number[][] = new Array(nb * nb * nb)
  for (let i = 0; i < n; i += 1) {
    const ix = Math.min(nb - 1, Math.floor(norm[i * 3] * nb))
    const iy = Math.min(nb - 1, Math.floor(norm[i * 3 + 1] * nb))
    const iz = Math.min(nb - 1, Math.floor(norm[i * 3 + 2] * nb))
    const key = (iz * nb + iy) * nb + ix
    if (buckets[key]) buckets[key].push(i)
    else buckets[key] = [i]
  }

  const radius2 = radius * radius
  const half = power / 2
  const candidates: number[] = []
  let filled = 0

  const nearestIndex = (px: number, py: number, pz: number): number => {
    const cx = Math.min(nb - 1, Math.max(0, Math.floor(px * nb)))
    const cy = Math.min(nb - 1, Math.max(0, Math.floor(py * nb)))
    const cz = Math.min(nb - 1, Math.max(0, Math.floor(pz * nb)))
    let best = -1
    let bestD2 = Number.POSITIVE_INFINITY
    let examined = 0
    for (let r = 0; r <= nb; r += 1) {
      if (best >= 0) {
        const ringMin = Math.max(0, r - 1) * cell
        if (ringMin * ringMin > bestD2) break
      }
      for (let dz = -r; dz <= r; dz += 1) {
        for (let dy = -r; dy <= r; dy += 1) {
          for (let dx = -r; dx <= r; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue
            const bx = cx + dx
            const by = cy + dy
            const bz = cz + dz
            if (bx < 0 || by < 0 || bz < 0 || bx >= nb || by >= nb || bz >= nb) continue
            const list = buckets[(bz * nb + by) * nb + bx]
            if (!list) continue
            for (let k = 0; k < list.length; k += 1) {
              const j = list[k]
              const ddx = px - norm[j * 3]
              const ddy = py - norm[j * 3 + 1]
              const ddz = pz - norm[j * 3 + 2]
              const d2 = ddx * ddx + ddy * ddy + ddz * ddz
              if (d2 < bestD2) {
                bestD2 = d2
                best = j
              }
            }
            examined += list.length
            if (examined >= MAX_CANDIDATES) return best
          }
        }
      }
    }
    return best
  }

  for (let z = 0; z < gz; z += 1) {
    const pz = (z + 0.5) / gz
    const cz = Math.min(nb - 1, Math.max(0, Math.floor(pz * nb)))
    for (let y = 0; y < gy; y += 1) {
      const py = (y + 0.5) / gy
      const cy = Math.min(nb - 1, Math.max(0, Math.floor(py * nb)))
      for (let x = 0; x < gx; x += 1) {
        const px = (x + 0.5) / gx
        const cx = Math.min(nb - 1, Math.max(0, Math.floor(px * nb)))
        candidates.length = 0
        let overflow = false
        for (let dz = -1; dz <= 1 && !overflow; dz += 1) {
          const bz = cz + dz
          if (bz < 0 || bz >= nb) continue
          for (let dy = -1; dy <= 1 && !overflow; dy += 1) {
            const by = cy + dy
            if (by < 0 || by >= nb) continue
            for (let dx = -1; dx <= 1; dx += 1) {
              const bx = cx + dx
              if (bx < 0 || bx >= nb) continue
              const list = buckets[(bz * nb + by) * nb + bx]
              if (!list) continue
              for (let k = 0; k < list.length; k += 1) {
                candidates.push(list[k])
                if (candidates.length >= MAX_CANDIDATES) {
                  overflow = true
                  break
                }
              }
              if (overflow) break
            }
          }
        }

        const stride = candidates.length > MAX_CANDIDATES / 2 ? Math.ceil(candidates.length / (MAX_CANDIDATES / 2)) : 1
        let wsum = 0
        let vsum = 0
        for (let k = 0; k < candidates.length; k += stride) {
          const j = candidates[k]
          const ddx = px - norm[j * 3]
          const ddy = py - norm[j * 3 + 1]
          const ddz = pz - norm[j * 3 + 2]
          const d2 = ddx * ddx + ddy * ddy + ddz * ddz
          if (d2 > radius2) continue
          const w = 1 / Math.pow(Math.max(d2, 1e-8), half)
          wsum += w
          vsum += w * vals[j]
        }

        const index = (z * gy + y) * gx + x
        if (wsum > 0) {
          values[index] = vsum / wsum
          valid[index] = 1
          filled += 1
        } else if (fillEmpty.value) {
          const j = nearestIndex(px, py, pz)
          if (j >= 0) {
            values[index] = vals[j]
            valid[index] = 1
            filled += 1
          }
        }
      }
    }
  }

  if (smoothTransition.value > 0) {
    smoothVoxelField(values, valid, gx, gy, gz, Math.max(1, Math.round(smoothTransition.value / 25)))
  }

  let dataMin = Number.POSITIVE_INFINITY
  let dataMax = Number.NEGATIVE_INFINITY
  for (let i = 0; i < total; i += 1) {
    if (!valid[i]) continue
    const v = values[i]
    if (v < dataMin) dataMin = v
    if (v > dataMax) dataMax = v
  }
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
    dataMin = 0
    dataMax = 1
  }
  const span = dataMax - dataMin || 1

  for (let i = 0; i < total; i += 1) {
    if (!valid[i]) continue
    const t = (values[i] - dataMin) / span
    metadata[i * 4] = t
    metadata[i * 4 + 1] = 1
  }

  stats.dataMin = dataMin
  stats.dataMax = dataMax
  voxelValues = values
  voxelValid = valid
  return { metadata, values, valid, filled }
}

function modelMatrix(): Matrix4 {
  return Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(CENTER.lon, CENTER.lat, CENTER.height))
}

/** 剖切面法线（局部 ENU 坐标，单位向量） */
function clipNormal(): { x: number; y: number; z: number } {
  const az = CesiumMath.toRadians(clip.azimuth)
  const tilt = CesiumMath.toRadians(clip.tilt)
  return {
    x: Math.cos(tilt) * Math.cos(az),
    y: Math.cos(tilt) * Math.sin(az),
    z: Math.sin(tilt)
  }
}

/** 剖切面上的一点：位于体积中心，沿法线按偏移量平移 */
function clipPlanePoint(n: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const halfExtent = 0.5 * (Math.abs(n.x) * VOLUME.width + Math.abs(n.y) * VOLUME.depth + Math.abs(n.z) * VOLUME.height)
  const s = (clip.offset / 100) * halfExtent
  return {
    x: CENTER_LOCAL.x + n.x * s,
    y: CENTER_LOCAL.y + n.y * s,
    z: CENTER_LOCAL.z + n.z * s
  }
}

const normalText = computed(() => {
  const n = clipNormal()
  return `${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}`
})

function createPrimitive(metadata: Float32Array): void {
  if (!viewer || viewer.isDestroyed()) return
  if (voxelPrimitive) {
    viewer.scene.primitives.remove(voxelPrimitive)
    voxelPrimitive = undefined
  }
  const provider = {
    shape: VoxelShapeType.BOX,
    dimensions: new Cartesian3(gridX.value, gridY.value, gridZ.value),
    paddingBefore: Cartesian3.ZERO,
    paddingAfter: Cartesian3.ZERO,
    shapeTransform: Matrix4.IDENTITY,
    globalTransform: Matrix4.IDENTITY,
    minBounds: new Cartesian3(MIN_X, MIN_Y, MIN_Z),
    maxBounds: new Cartesian3(MAX_X, MAX_Y, MAX_Z),
    names: ['color'],
    types: [MetadataType.VEC4],
    componentTypes: [MetadataComponentType.FLOAT32],
    maximumTileCount: 1,
    availableLevels: 1,
    requestData: (): Promise<VoxelContent> => Promise.resolve(VoxelContent.fromMetadataArray([metadata]))
  } as unknown as VoxelProvider

  const primitive = new VoxelPrimitive({
    provider,
    modelMatrix: modelMatrix(),
    customShader: voxelShader,
    calculateStatistics: false
  })
  primitive.screenSpaceError = sse.value
  primitive.stepSize = stepSize.value
  primitive.nearestSampling = nearest.value
  primitive.minBounds = new Cartesian3(MIN_X, MIN_Y, MIN_Z)
  primitive.maxBounds = new Cartesian3(MAX_X, MAX_Y, MAX_Z)
  primitive.show = showVolume.value

  // 任意方向剖切：ClippingPlaneCollection 以图元模型矩阵所在的局部 ENU 坐标系解释平面
  // 图元销毁时会一并销毁其剖切面集合，因此每次重建都创建新的集合
  clipPlane = new ClippingPlane(new Cartesian3(0, 0, 1), 0)
  clipCollection = new ClippingPlaneCollection({
    modelMatrix: modelMatrix(),
    enabled: clip.enabled,
    planes: [clipPlane]
  })
  primitive.clippingPlanes = clipCollection

  viewer.scene.primitives.add(primitive)
  voxelPrimitive = primitive
  updateClipPlane()
}

function createPointCloud(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (pointCollection) {
    viewer.scene.primitives.remove(pointCollection)
    pointCollection = undefined
    pointPrimitives = []
  }
  const norm = normPositions
  const vals = pointValues
  if (!norm || !vals) return
  const n = pointCount.value
  const mm = modelMatrix()
  const collection = new PointPrimitiveCollection({ modelMatrix: mm })
  for (let i = 0; i < n; i += 1) {
    const x = MIN_X + norm[i * 3] * VOLUME.width
    const y = MIN_Y + norm[i * 3 + 1] * VOLUME.depth
    const z = MIN_Z + norm[i * 3 + 2] * VOLUME.height
    const [r, g, b] = paletteColor(palette.value, vals[i])
    const point = collection.add({
      position: new Cartesian3(x, y, z),
      pixelSize: pointSize.value,
      color: new Color(r / 255, g / 255, b / 255, 0.9),
      disableDepthTestDistance: 0
    })
    pointPrimitives.push(point)
  }
  collection.show = showPoints.value
  viewer.scene.primitives.add(collection)
  pointCollection = collection
}

function applyPointColors(): void {
  const vals = pointValues
  if (!vals) return
  for (let i = 0; i < pointPrimitives.length; i += 1) {
    const [r, g, b] = paletteColor(palette.value, vals[i])
    pointPrimitives[i].color = new Color(r / 255, g / 255, b / 255, 0.9)
  }
  viewer?.scene.requestRender()
}

function applyPointSize(): void {
  for (let i = 0; i < pointPrimitives.length; i += 1) pointPrimitives[i].pixelSize = pointSize.value
  viewer?.scene.requestRender()
}

function selectPalette(index: number): void {
  palette.value = index
  applyPointColors()
  refreshShader()
  refreshClipPreview()
}

function togglePoints(): void {
  showPoints.value = !showPoints.value
  if (pointCollection) pointCollection.show = showPoints.value
  viewer?.scene.requestRender()
}

function toggleVolume(): void {
  showVolume.value = !showVolume.value
  if (voxelPrimitive) voxelPrimitive.show = showVolume.value
  viewer?.scene.requestRender()
}

function toggleFillEmpty(): void {
  fillEmpty.value = !fillEmpty.value
  regenerate()
}

function toggleNearest(): void {
  nearest.value = !nearest.value
  if (voxelPrimitive) voxelPrimitive.nearestSampling = nearest.value
  viewer?.scene.requestRender()
}

function applyStepSize(): void {
  if (voxelPrimitive) voxelPrimitive.stepSize = stepSize.value
  viewer?.scene.requestRender()
}

function applySse(): void {
  if (voxelPrimitive) voxelPrimitive.screenSpaceError = sse.value
  viewer?.scene.requestRender()
}

/** 依据方位角/倾角/偏移/反转更新剖切平面 */
function updateClipPlane(): void {
  if (!clipCollection || !clipPlane || !viewer || viewer.isDestroyed()) return
  const n = clipNormal()
  const p = clipPlanePoint(n)
  let nx = n.x
  let ny = n.y
  let nz = n.z
  if (clip.flip) {
    nx = -nx
    ny = -ny
    nz = -nz
  }
  clipPlane.normal = new Cartesian3(nx, ny, nz)
  clipPlane.distance = -(nx * p.x + ny * p.y + nz * p.z)
  clipCollection.enabled = clip.enabled
  viewer.scene.requestRender()
}

function toggleClipEnabled(): void {
  clip.enabled = !clip.enabled
  updateClipPlane()
  refreshClipPreview()
}

function toggleClipFlip(): void {
  clip.flip = !clip.flip
  updateClipPlane()
  refreshClipPreview()
}

function onClipAlign(): void {
  updateClipPlane()
  refreshClipPreview()
}

function onRangeChange(): void {
  refreshShader()
  refreshClipPreview()
}

function onOpacityChange(): void {
  refreshShader()
  refreshClipPreview()
}

function refreshShader(): void {
  voxelShader.uniforms.uPalette.value = palette.value
  voxelShader.uniforms.uValueMin.value = valueMin.value
  voxelShader.uniforms.uValueMax.value = valueMax.value
  voxelShader.uniforms.uOpacity.value = opacity.value
  voxelShader.uniforms.uShading.value = Math.max(0, Math.min(1, 1 - smoothTransition.value / 100))
  viewer?.scene.requestRender()
}

/** 在体元素网格上做三线性插值采样，超出范围或无效返回 null */
function sampleVoxel(nx: number, ny: number, nz: number): number | null {
  if (!voxelValues || !voxelValid) return null
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1 || nz < 0 || nz > 1) return null
  const gx = gridX.value
  const gy = gridY.value
  const gz = gridZ.value
  const fx = nx * gx - 0.5
  const fy = ny * gy - 0.5
  const fz = nz * gz - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const z0 = Math.floor(fz)
  const tx = fx - x0
  const ty = fy - y0
  const tz = fz - z0

  let sum = 0
  let wsum = 0
  for (let dz = 0; dz <= 1; dz += 1) {
    const zi = z0 + dz
    if (zi < 0 || zi >= gz) continue
    const wz = dz === 1 ? tz : 1 - tz
    for (let dy = 0; dy <= 1; dy += 1) {
      const yi = y0 + dy
      if (yi < 0 || yi >= gy) continue
      const wy = dy === 1 ? ty : 1 - ty
      for (let dx = 0; dx <= 1; dx += 1) {
        const xi = x0 + dx
        if (xi < 0 || xi >= gx) continue
        const wx = dx === 1 ? tx : 1 - tx
        const w = wx * wy * wz
        if (w <= 0) continue
        const idx = (zi * gy + yi) * gx + xi
        if (!voxelValid[idx]) continue
        sum += w * voxelValues[idx]
        wsum += w
      }
    }
  }
  if (wsum <= 0) return null
  return sum / wsum
}

/** 在当前剖切平面上采样体元素场，渲染为 PNG 预览图 */
function refreshClipPreview(): void {
  if (typeof document === 'undefined' || !voxelValues || !voxelValid) {
    clipPreview.value = ''
    return
  }
  const size = CLIP_PREVIEW_SIZE
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    clipPreview.value = ''
    return
  }
  const image = ctx.createImageData(size, size)
  const data = image.data

  const n = clipNormal()
  const p0 = clipPlanePoint(n)
  const upX = Math.abs(n.z) > 0.9 ? 1 : 0
  const upZ = Math.abs(n.z) > 0.9 ? 0 : 1
  // e1 = normalize(cross(up, n))
  let e1x = -upZ * n.y
  let e1y = upZ * n.x - upX * n.z
  let e1z = upX * n.y
  let e1len = Math.hypot(e1x, e1y, e1z)
  if (e1len < 1e-6) {
    e1x = 1
    e1y = 0
    e1z = 0
    e1len = 1
  }
  e1x /= e1len
  e1y /= e1len
  e1z /= e1len
  // e2 = cross(n, e1)
  const e2x = n.y * e1z - n.z * e1y
  const e2y = n.z * e1x - n.x * e1z
  const e2z = n.x * e1y - n.y * e1x

  // 与体渲染着色器保持同一套映射：先把原始值归一化到数据的 [dataMin,dataMax]，
  // 再按值域下限/上限二次映射，得到与实际剖面一致的颜色
  const dataSpan = Math.abs(stats.dataMax - stats.dataMin) || 1
  const dataLo = Math.min(stats.dataMin, stats.dataMax)
  const rangeSpan = valueMax.value - valueMin.value
  const rangeLo = valueMin.value
  const alphaBase = opacity.value

  for (let py = 0; py < size; py += 1) {
    const vNdc = ((py + 0.5) / size) * 2 - 1
    const v = -vNdc * HALF_DIAGONAL
    for (let px = 0; px < size; px += 1) {
      const uNdc = ((px + 0.5) / size) * 2 - 1
      const u = uNdc * HALF_DIAGONAL
      const wx = p0.x + e1x * u + e2x * v
      const wy = p0.y + e1y * u + e2y * v
      const wz = p0.z + e1z * u + e2z * v
      const nx = (wx - MIN_X) / VOLUME.width
      const ny = (wy - MIN_Y) / VOLUME.depth
      const nz = (wz - MIN_Z) / VOLUME.height
      const offset = (py * size + px) * 4
      const val = sampleVoxel(nx, ny, nz)
      if (val === null) {
        data[offset + 3] = 0
        continue
      }
      const nrm = (val - dataLo) / dataSpan
      const t = Math.max(0, Math.min(1, (nrm - rangeLo) / (Math.abs(rangeSpan) < 1e-6 ? 1e-6 : rangeSpan)))
      const [r, g, b] = paletteColor(palette.value, t)
      data[offset] = r
      data[offset + 1] = g
      data[offset + 2] = b
      data[offset + 3] = Math.round(255 * alphaBase * (0.05 + 0.95 * t))
    }
  }

  ctx.putImageData(image, 0, 0)
  clipPreview.value = canvas.toDataURL('image/png')
}

function downloadClipPreview(): void {
  if (!clipPreview.value) return
  const link = document.createElement('a')
  link.href = clipPreview.value
  link.download = `voxel-slice-az${clip.azimuth}-tilt${clip.tilt}-off${clip.offset}.png`
  link.click()
}

/** 采样点 -> 体元素网格 -> 单图元，完整重建链路 */
function regenerate(): void {
  if (!viewer || viewer.isDestroyed()) return
  try {
    statusMessage.value = '正在重建体元素…'
    const t0 = performance.now()
    generatePoints()
    const built = buildVoxelField()
    stats.voxels = gridX.value * gridY.value * gridZ.value
    stats.filled = built.filled
    stats.elapsed = Math.round((performance.now() - t0) * 10) / 10
    createPrimitive(built.metadata)
    createPointCloud()
    refreshShader()
    refreshClipPreview()
    statusMessage.value =
      '✓ 已生成 ' + stats.points + ' 个采样点 · ' + stats.voxels + ' 个体元素 · 用时 ' + stats.elapsed + ' ms'
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
}

function resetCamera(duration: number): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(CENTER.lon, CENTER.lat - 0.028, 3600),
    orientation: {
      heading: CesiumMath.toRadians(0),
      pitch: CesiumMath.toRadians(-28),
      roll: 0
    },
    duration
  })
}

/** sampleIndex -> 体元素网格坐标（x 最快、z 最慢） */
function decodeIndex(index: number): { x: number; y: number; z: number } {
  const gx = gridX.value
  const gy = gridY.value
  const z = Math.floor(index / (gx * gy))
  const rest = index % (gx * gy)
  const y = Math.floor(rest / gx)
  const x = rest % gx
  return { x, y, z }
}

function handlePick(position: Cartesian2): void {
  if (!voxelPrimitive || !voxelPrimitive.ready || !viewer || viewer.isDestroyed()) {
    picked.value = null
    return
  }
  const cell = viewer.scene.pickVoxel(position)
  if (!cell || cell.primitive !== voxelPrimitive) {
    picked.value = null
    return
  }
  const { x, y, z } = decodeIndex(cell.sampleIndex)
  const index = cell.sampleIndex
  const isValid = !!voxelValid?.[index]
  picked.value = {
    x,
    y,
    z,
    value: voxelValues?.[index] ?? 0,
    valid: isValid
  }
}

onMounted(() => {
  if (!container.value) return

  const webgl2 = (() => {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('experimental-webgl2'))
  })()
  if (!webgl2) {
    statusMessage.value = '当前浏览器/显卡没有可用的 WebGL2，Cesium VoxelPrimitive 需要 WebGL2'
    return
  }

  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    if (!viewer || viewer.isDestroyed()) return

    viewer.scene.requestRenderMode = false
    viewer.scene.maximumRenderTimeChange = Infinity
    resetCamera(0)
    regenerate()

    handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(
      (movement: { endPosition: Cartesian2 }) => handlePick(movement.endPosition),
      ScreenSpaceEventType.MOUSE_MOVE
    )
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (handler && !handler.isDestroyed()) handler.destroy()
  handler = undefined
  if (voxelPrimitive && viewer && !viewer.isDestroyed()) viewer.scene.primitives.remove(voxelPrimitive)
  voxelPrimitive = undefined
  if (pointCollection && viewer && !viewer.isDestroyed()) viewer.scene.primitives.remove(pointCollection)
  pointCollection = undefined
  pointPrimitives = []
  clipPlane = undefined
  clipCollection = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="pv-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">高性能体元素渲染</div>
      <p class="status" :class="{ ok: statusMessage.startsWith('✓') }">{{ statusMessage }}</p>

      <div class="section-title">
        点数据源
        <InfoTip title="点数据源" text="由模拟函数生成的离散空间点集（含 x/y/z 坐标与数值），作为体元素重建的输入数据。" />
      </div>
      <div class="control-row">
        <span class="row-label">
          采样点数
          <InfoTip title="采样点数" text="随机生成的离散空间点数量。点数越多，插值重建出的体元素场越连续平滑，重建耗时略有增加。" />
        </span>
        <input type="range" min="500" max="12000" step="250" v-model.number="pointCount" @change="regenerate" />
        <span class="row-value">{{ pointCount }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          随机种子
          <InfoTip title="随机种子" text="控制随机点生成的种子。相同种子得到完全相同的点集与重建结果，便于复现和对比不同参数。" />
        </span>
        <input type="range" min="1" max="99999" step="1" v-model.number="seed" @change="regenerate" />
        <span class="row-value">{{ seed }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          显示原始点云
          <InfoTip title="显示原始点云" text="是否叠加以彩色点显示的原始离散采样点，用于对比插值前后的空间分布差异。" />
        </span>
        <button class="switch-button" :class="{ 'is-on': showPoints }" role="switch" :aria-checked="showPoints" @click="togglePoints">
          <span class="switch-knob"></span>
        </button>
      </div>
      <div class="control-row">
        <span class="row-label">
          点尺寸
          <InfoTip title="点尺寸" text="原始点云中点图元的像素直径，仅影响点云显示。" />
        </span>
        <input type="range" min="2" max="10" step="1" v-model.number="pointSize" @input="applyPointSize" />
        <span class="row-value">{{ pointSize }}px</span>
      </div>

      <div class="section-title">
        体元素网格
        <InfoTip title="体元素网格" text="离散点经反距离加权插值（IDW）重建为规则体元素网格，再交由单个 VoxelPrimitive 在 GPU 上光线步进渲染。" />
      </div>
      <div class="control-row">
        <span class="row-label">
          网格 X
          <InfoTip title="网格 X" text="体元素网格在 X 方向的分辨率。分辨率越高细节越丰富，体元素总数与显存占用也越大。" />
        </span>
        <input type="range" min="8" max="40" step="2" v-model.number="gridX" @change="regenerate" />
        <span class="row-value">{{ gridX }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          网格 Y
          <InfoTip title="网格 Y" text="体元素网格在 Y 方向的分辨率，作用与网格 X 相同。" />
        </span>
        <input type="range" min="8" max="40" step="2" v-model.number="gridY" @change="regenerate" />
        <span class="row-value">{{ gridY }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          网格 Z
          <InfoTip title="网格 Z" text="体元素网格在垂直方向的分辨率，决定剖切面在垂向的精细程度。" />
        </span>
        <input type="range" min="8" max="32" step="2" v-model.number="gridZ" @change="regenerate" />
        <span class="row-value">{{ gridZ }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          搜索半径
          <InfoTip title="搜索半径" text="反距离加权插值的搜索半径（归一化空间）。半径越大，参与计算的点越多，结果越平滑；过小会出现空洞。" />
        </span>
        <input type="range" min="0.08" max="0.35" step="0.01" v-model.number="searchRadius" @change="regenerate" />
        <span class="row-value">{{ searchRadius.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          距离幂次
          <InfoTip title="距离幂次" text="IDW 权重衰减指数。幂次越大，越接近最近邻插值，数值边界越锐利；越小则过渡越平缓。" />
        </span>
        <input type="range" min="1" max="4" step="0.5" v-model.number="idwPower" @change="regenerate" />
        <span class="row-value">{{ idwPower.toFixed(1) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          空体元素最近邻填充
          <InfoTip title="空体元素最近邻填充" text="对搜索半径内无点、插值失败的体元素改用最近采样点的值填充，避免体渲染出现空洞。" />
        </span>
        <button class="switch-button" :class="{ 'is-on': fillEmpty }" role="switch" :aria-checked="fillEmpty" @click="toggleFillEmpty">
          <span class="switch-knob"></span>
        </button>
      </div>

      <div class="section-title">
        体渲染参数
        <InfoTip title="体渲染参数" text="控制体元素数值到颜色、透明度的映射，以及 GPU 光线步进的采样质量。" />
      </div>
      <div class="palette-row">
        <button
          v-for="(item, i) in PALETTES"
          :key="item.label"
          type="button"
          class="palette-button"
          :class="{ active: palette === i }"
          @click="selectPalette(i)"
        >
          {{ item.label }}
        </button>
      </div>
      <div class="control-row">
        <span class="row-label">
          不透明度
          <InfoTip title="不透明度" text="体渲染的整体透明度。值越低，越能透过前方结构看到后方的数值分布。" />
        </span>
        <input type="range" min="0.1" max="1" step="0.02" v-model.number="opacity" @input="onOpacityChange" />
        <span class="row-value">{{ opacity.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          值域下限
          <InfoTip title="值域下限" text="数值归一化映射的下限。高于该值的体元素才会着色显示，用于突出目标数值区间。" />
        </span>
        <input type="range" min="0" max="1" step="0.02" v-model.number="valueMin" @input="onRangeChange" />
        <span class="row-value">{{ valueMin.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          值域上限
          <InfoTip title="值域上限" text="数值归一化映射的上限，与值域下限共同拉伸对比度。" />
        </span>
        <input type="range" min="0" max="1" step="0.02" v-model.number="valueMax" @input="onRangeChange" />
        <span class="row-value">{{ valueMax.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          光线步长
          <InfoTip title="光线步长" text="GPU 光线步进的采样步长。越小越精细、层次越准确，但性能开销越大。" />
        </span>
        <input type="range" min="0.3" max="3" step="0.1" v-model.number="stepSize" @input="applyStepSize" />
        <span class="row-value">{{ stepSize }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          屏幕误差
          <InfoTip title="屏幕误差" text="体元素按屏幕空间误差细分（LOD）的阈值。越小细节越高，显存与耗时越高。" />
        </span>
        <input type="range" min="4" max="32" step="2" v-model.number="sse" @input="applySse" />
        <span class="row-value">{{ sse }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          圆滑过渡
          <InfoTip title="圆滑过渡" text="数值越大，体元素场的过渡越圆滑：数值较大时对重建后的标量场做多次三维高斯平滑，并同时减弱体素表面的光照反差，从而消除明显的块状边界。" />
        </span>
        <input type="range" min="0" max="100" step="5" v-model.number="smoothTransition" @input="refreshShader" @change="regenerate" />
        <span class="row-value">{{ smoothTransition }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          最近邻采样
          <InfoTip title="最近邻采样" text="体元素采样方式。开启后体元素呈清晰的方块状，关闭则三线性平滑过渡。" />
        </span>
        <button class="switch-button" :class="{ 'is-on': nearest }" role="switch" :aria-checked="nearest" @click="toggleNearest">
          <span class="switch-knob"></span>
        </button>
      </div>
      <div class="control-row">
        <span class="row-label">
          显示体元素
          <InfoTip title="显示体元素" text="是否显示体渲染结果，关闭后仅保留原始点云。" />
        </span>
        <button class="switch-button" :class="{ 'is-on': showVolume }" role="switch" :aria-checked="showVolume" @click="toggleVolume">
          <span class="switch-knob"></span>
        </button>
      </div>

      <div class="section-title">
        任意方向剖切
        <InfoTip title="任意方向剖切" text="沿任意方位角与倾角的平面剖切体元素，切面处的切片会实时渲染为 PNG 预览显示在左上角。" />
      </div>
      <div class="control-row">
        <span class="row-label">
          启用剖切
          <InfoTip title="启用剖切" text="开启后按当前平面裁剪体元素，仅保留法线指向的一侧；关闭后显示完整体元素。" />
        </span>
        <button class="switch-button" :class="{ 'is-on': clip.enabled }" role="switch" :aria-checked="clip.enabled" @click="toggleClipEnabled">
          <span class="switch-knob"></span>
        </button>
      </div>
      <div class="control-row">
        <span class="row-label">
          方位角
          <InfoTip title="方位角" text="剖切面法线在水平面内的投影方向，取值 0-360°。改变它可让剖切面绕垂直轴旋转到任意朝向。" />
        </span>
        <input type="range" min="0" max="360" step="1" v-model.number="clip.azimuth" @input="onClipAlign" />
        <span class="row-value">{{ clip.azimuth }}°</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          倾角
          <InfoTip title="倾角" text="剖切面法线的仰角，取值 0-90°。0° 为竖直剖切面，90° 为水平剖切面，中间值得到任意倾斜角度的剖切。" />
        </span>
        <input type="range" min="0" max="90" step="1" v-model.number="clip.tilt" @input="onClipAlign" />
        <span class="row-value">{{ clip.tilt }}°</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          偏移
          <InfoTip title="偏移" text="剖切面沿法线方向的平移量，取值 -100%~100%，决定切面切过体积的位置。" />
        </span>
        <input type="range" min="-100" max="100" step="1" v-model.number="clip.offset" @input="onClipAlign" />
        <span class="row-value">{{ clip.offset }}%</span>
      </div>
      <div class="control-row">
        <span class="row-label">
          反转保留侧
          <InfoTip title="反转保留侧" text="翻转剖切面法线方向，改为保留另一侧的体元素。" />
        </span>
        <button class="switch-button" :class="{ 'is-on': clip.flip }" role="switch" :aria-checked="clip.flip" @click="toggleClipFlip">
          <span class="switch-knob"></span>
        </button>
      </div>

      <div class="actions">
        <button class="action-button" @click="regenerate">重新生成</button>
        <button class="action-button" @click="resetCamera(1)">恢复视图</button>
      </div>
    </div>

    <div class="clip-panel">
      <div class="clip-title">剖切面预览</div>
      <div class="clip-image-wrap">
        <img v-if="clipPreview" class="clip-image" :src="clipPreview" alt="剖切面预览" />
        <div v-else class="clip-empty">暂无切面</div>
      </div>
      <div class="clip-meta">
        <div class="clip-meta-row"><span>方位角</span><b>{{ clip.azimuth }}°</b></div>
        <div class="clip-meta-row"><span>倾角</span><b>{{ clip.tilt }}°</b></div>
        <div class="clip-meta-row"><span>偏移</span><b>{{ clip.offset }}%</b></div>
        <div class="clip-meta-row"><span>保留侧</span><b>{{ clip.flip ? '反向' : '正向' }}</b></div>
        <div class="clip-meta-row"><span>法线</span><b>({{ normalText }})</b></div>
      </div>
      <button class="clip-download" :disabled="!clipPreview" @click="downloadClipPreview">下载 PNG</button>
    </div>

    <div class="legend-panel">
      <div class="legend-title">图例 / 数据说明</div>
      <div class="legend-bar" :style="legendStyle"></div>
      <div class="legend-caption"><span>低值 {{ stats.dataMin.toFixed(2) }}</span><span>高值 {{ stats.dataMax.toFixed(2) }}</span></div>
      <div class="stat"><span>采样点数</span><b>{{ stats.points }}</b></div>
      <div class="stat"><span>体元素总数</span><b>{{ stats.voxels }}</b></div>
      <div class="stat"><span>有效体元素</span><b>{{ stats.filled }}</b></div>
      <div class="stat"><span>填充率</span><b>{{ stats.voxels ? Math.round((stats.filled / stats.voxels) * 100) : 0 }}%</b></div>
      <div class="stat"><span>重建耗时</span><b>{{ stats.elapsed }} ms</b></div>
      <p class="legend-note">模拟离散点 → IDW 插值重建体元素网格 → 单图元 GPU 光线步进渲染；鼠标移动可查询体元素位置与数值。</p>
    </div>

    <div v-if="picked" class="pick-panel">
      <div class="pick-title">体元素信息</div>
      <div v-if="picked.valid">
        <div class="pick-row"><span>网格坐标</span><b>{{ picked.x }}, {{ picked.y }}, {{ picked.z }}</b></div>
        <div class="pick-row"><span>数值</span><b>{{ picked.value.toFixed(3) }}</b></div>
      </div>
      <div v-else class="pick-empty">该处为空体元素</div>
    </div>
  </div>
</template>

<style scoped>
.pv-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }

.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 268px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; box-sizing: border-box; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.88); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.status { margin: 5px 0 0; font-size: 10px; line-height: 1.5; color: #9fd8ff; }
.status.ok { color: #66ff99; }
.section-title { display: flex; align-items: center; gap: 4px; margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 1 1 auto; min-width: 0; display: inline-flex; align-items: center; gap: 4px; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 46px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 0 0 84px; min-width: 0; accent-color: #2f80ed; }
.switch-button { position: relative; flex: 0 0 auto; width: 34px; height: 18px; border: 0; border-radius: 9px; background: #40506b; cursor: pointer; transition: background 0.2s; }
.switch-button.is-on { background: #2f80ed; }
.switch-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #eef4ff; transition: transform 0.2s; }
.switch-button.is-on .switch-knob { transform: translateX(16px); }
.palette-row { display: flex; gap: 4px; margin-bottom: 4px; }
.palette-button { flex: 1; padding: 4px 0; border: 1px solid rgba(157, 188, 224, 0.35); border-radius: 5px; background: rgba(255, 255, 255, 0.06); color: #b9d2ea; font-size: 11px; cursor: pointer; }
.palette-button:hover { border-color: #5eacf5; color: #fff; }
.palette-button.active { border-color: #2f80ed; background: #2f80ed; color: #fff; font-weight: 600; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.action-button { flex: 1 1 calc(50% - 3px); height: 26px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.action-button:hover { background: #3f8ef5; }

.clip-panel { position: absolute; top: 12px; left: 12px; z-index: 10; width: 190px; padding: 10px; box-sizing: border-box; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.88); backdrop-filter: blur(6px); color: #dce8f5; }
.clip-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 7px; color: #65d3eb; }
.clip-image-wrap { position: relative; width: 170px; height: 170px; box-sizing: border-box; border-radius: 6px; border: 1px solid rgba(157, 188, 224, 0.35); overflow: hidden; background-color: #0b1f3a; background-image: linear-gradient(45deg, rgba(255, 255, 255, 0.07) 25%, transparent 25%), linear-gradient(-45deg, rgba(255, 255, 255, 0.07) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.07) 75%), linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.07) 75%); background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0; }
.clip-image { display: block; width: 100%; height: 100%; }
.clip-empty { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #7f96b3; font-size: 11px; }
.clip-meta { margin-top: 8px; }
.clip-meta-row { display: flex; justify-content: space-between; align-items: center; margin-top: 3px; font-size: 10px; }
.clip-meta-row span { color: #9fb8d4; }
.clip-meta-row b { color: #dce8f5; font-weight: 700; font-variant-numeric: tabular-nums; }
.clip-download { width: 100%; height: 24px; margin-top: 8px; border: 1px solid rgba(47, 128, 237, 0.7); border-radius: 5px; background: rgba(47, 128, 237, 0.18); color: #9fd8ff; font-size: 11px; cursor: pointer; }
.clip-download:hover:not(:disabled) { background: rgba(47, 128, 237, 0.32); color: #eaf6ff; }
.clip-download:disabled { opacity: 0.45; cursor: not-allowed; }

.legend-panel { position: absolute; bottom: 12px; left: 12px; z-index: 10; width: 214px; padding: 10px 12px; box-sizing: border-box; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.88); backdrop-filter: blur(6px); color: #dce8f5; }
.legend-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 7px; color: #65d3eb; }
.legend-bar { height: 10px; border-radius: 3px; border: 1px solid rgba(255, 255, 255, 0.25); }
.legend-caption { display: flex; justify-content: space-between; margin: 4px 0 8px; font-size: 10px; color: #9fc8e8; }
.stat { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; font-size: 11px; }
.stat span { color: #c3d5e8; }
.stat b { color: #65d3eb; font-weight: 700; font-variant-numeric: tabular-nums; }
.legend-note { margin: 8px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }

.pick-panel { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); z-index: 10; min-width: 210px; padding: 9px 13px; box-sizing: border-box; border: 1px solid rgba(101, 211, 235, 0.4); border-radius: 8px; background: rgba(8, 24, 48, 0.9); backdrop-filter: blur(6px); font-size: 11px; color: #dce8f5; }
.pick-title { font-size: 12px; font-weight: 700; color: #65d3eb; letter-spacing: 0.04em; margin-bottom: 4px; }
.pick-row { display: flex; justify-content: space-between; align-items: center; margin-top: 5px; }
.pick-row span { color: #c3d5e8; }
.pick-row b { color: #ffffff; font-variant-numeric: tabular-nums; }
.pick-empty { color: #9fc8e8; line-height: 1.5; }
</style>
