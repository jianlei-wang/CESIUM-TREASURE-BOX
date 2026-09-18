import * as THREE from 'three'
import { geoMercator } from 'd3-geo'
import { createLabelSprite } from '../common/textSprite'

import scJson from '../assets/sc.json'
import scOutlineJson from '../assets/sc_outline.json'
import mapTextureUrl from '../assets/sc_map.png'
import normalTextureUrl from '../assets/sc_normal_map.png'
import displacementTextureUrl from '../assets/sc_displacement_map.png'

export type LonLat = [number, number]

// rings: 该区域的所有闭合环，每个环是一串 [lon,lat] 点
interface GeoPolygon {
  name: string
  center: LonLat
  centroid: LonLat
  rings: LonLat[][]
}

interface GeoData {
  polygons: GeoPolygon[]
}

/**
 * 对齐参考工程 Demo0/map/index.tsx：
 *   geoMercator().center(centroid).translate([0, 0])  （默认 scale=150）
 * d3 墨卡托的 y 朝南；调用处再 Vector2(x, -y) 翻回北朝上，才能与 sc_map 北向上纹理吻合。
 * 若投影本身已北朝上再取 -y，贴图会相对地面黑色轮廓竖直翻转。
 */
function makeProjector(center: LonLat) {
  const projection = geoMercator().center(center).translate([0, 0])
  return (lonLat: LonLat): [number, number] => {
    const p = projection(lonLat)
    return p ?? [0, 0]
  }
}

function projectV2(project: (ll: LonLat) => [number, number], lonLat: LonLat): THREE.Vector2 {
  const [x, y] = project(lonLat)
  return new THREE.Vector2(x, -y)
}

interface GeoFeature {
  properties: { name: string; center: LonLat; centroid?: LonLat }
  geometry: { type: string; coordinates: unknown }
}

function parseGeo(json: unknown): GeoData {
  const fc = json as { features: GeoFeature[] }
  const polygons: GeoPolygon[] = []
  for (const f of fc.features) {
    const raw = f.geometry.coordinates
    // Polygon: coordinates 直接是环数组；MultiPolygon: 多边形数组(每项含环数组)
    const rings = (
      f.geometry.type === 'Polygon'
        ? (raw as LonLat[][])
        : (raw as LonLat[][][]).flat(1)
    ) as LonLat[][]
    if (!rings.length) continue
    polygons.push({
      name: f.properties.name,
      center: f.properties.center,
      centroid: f.properties.centroid ?? f.properties.center,
      rings,
    })
  }
  return { polygons }
}

/**
 * 参考工程 outline.tsx / flyLine.tsx 只用 MultiPolygon 的 coordinates[0]（主轮廓，不含碎岛）。
 */
function firstPolygonRings(json: unknown): LonLat[][] {
  const fc = json as { features: GeoFeature[] }
  const rings: LonLat[][] = []
  for (const f of fc.features) {
    const raw = f.geometry.coordinates
    const firstPoly =
      f.geometry.type === 'Polygon' ? (raw as LonLat[][]) : (raw as LonLat[][][])[0]
    if (firstPoly?.length) rings.push(...firstPoly)
  }
  return rings
}

export interface DemoT0Scene {
  group: THREE.Group
  newStyle: boolean
  setNewStyle: (v: boolean) => void
  update: (dt: number) => void
  dispose: () => void
}

const RISE_COLOR = '#90aba7'
const SIDE_COLOR = '#0e171a'
const RISE_MIN = -0.8
const RISE_MAX = 0.5
const RISE_STEP = 0.003
const FLY_NUM = 50
const FLY_SEGMENTS = 200

/**
 * 构建 demo0 三维四川地图场景。
 * 对应参考工程 src/pages/Demo0/map：baseMap + outline + flyLine + 城市名标签。
 */
export async function buildDemo0Scene(newStyle: boolean): Promise<DemoT0Scene> {
  const city = parseGeo(scJson)
  const outlineRings = firstPolygonRings(scOutlineJson)
  const project = makeProjector(city.polygons[0].centroid)

  const group = new THREE.Group()
  const disposables: Array<() => void> = []
  const labels: THREE.Sprite[] = []

  const bbox = new THREE.Box2()
  const allRingsXY: THREE.Vector2[][] = []

  for (const p of city.polygons) {
    const regionRings: THREE.Vector2[][] = []
    for (const polygon of p.rings) {
      const ring: THREE.Vector2[] = []
      for (const ringPts of polygon) {
        const v = projectV2(project, ringPts)
        ring.push(v)
        bbox.expandByPoint(v)
      }
      regionRings.push(ring)
    }
    allRingsXY.push(...regionRings)
  }

  // ---- 顶面贴图加载 ----
  const loader = new THREE.TextureLoader()
  const texOpts = (t: THREE.Texture) => {
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    t.colorSpace = THREE.SRGBColorSpace
  }
  const [mapTex, normalTex, displacementTex] = await Promise.all([
    new Promise<THREE.Texture>((resolve) => loader.load(mapTextureUrl, (t) => { texOpts(t); resolve(t) })),
    new Promise<THREE.Texture>((resolve) => loader.load(normalTextureUrl, (t) => { texOpts(t); resolve(t) })),
    new Promise<THREE.Texture>((resolve) => loader.load(displacementTextureUrl, (t) => { texOpts(t); resolve(t) })),
  ])

  const topMaterial = new THREE.MeshStandardMaterial({
    map: mapTex,
    normalMap: normalTex,
    displacementMap: newStyle ? displacementTex : null,
    metalness: 0.2,
    roughness: 0.5,
    side: THREE.DoubleSide,
  })
  const bw = bbox.max.x - bbox.min.x
  const bh = bbox.max.y - bbox.min.y
  const bmin = bbox.min

  const makeUv = (geometry: THREE.ShapeGeometry) => {
    const pos = geometry.attributes.position
    const uv: number[] = []
    for (let i = 0; i < pos.count; i++) {
      uv.push((pos.getX(i) - bmin.x) / bw, (pos.getY(i) - bmin.y) / bh)
    }
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  }

  // 区域顶面网格
  const baseGroup = new THREE.Group()
  baseGroup.position.z = 0.51
  group.add(baseGroup)

  for (const p of city.polygons) {
    const shapes: THREE.Shape[] = []
    for (const polygon of p.rings) {
      const shape = new THREE.Shape(
        polygon.map((ll) => projectV2(project, ll))
      )
      shapes.push(shape)
    }
    for (const shape of shapes) {
      const geometry = new THREE.ShapeGeometry(shape)
      makeUv(geometry)
      const mesh = new THREE.Mesh(geometry, topMaterial)
      baseGroup.add(mesh)
    }
  }

  // 区域边界灰线（默认样式）：参考工程 BaseMap 中 color #a7a7a7 Line
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xa7a7a7 })
  const lineGroup = new THREE.Group()
  lineGroup.position.z = 0.52
  const lineDisposables: Array<() => void> = []
  const drawBoundaryLines = (visible: boolean) => {
    lineGroup.clear()
    lineDisposables.forEach((fn) => fn())
    lineDisposables.length = 0
    for (const ring of allRingsXY) {
      const points = ring.map((v) => new THREE.Vector3(v.x, v.y, 0))
      const geo = new THREE.BufferGeometry().setFromPoints(points)
      const line = new THREE.Line(geo, lineMaterial)
      line.visible = visible
      lineGroup.add(line)
      lineDisposables.push(() => geo.dispose())
    }
  }
  drawBoundaryLines(!newStyle)
  group.add(lineGroup)

  // 城市名标签（Sprite 常面向相机，替代 drei Billboard+Text，避免远程字体）
  const labelGroup = new THREE.Group()
  labelGroup.position.z = 0.68
  for (const p of city.polygons) {
    const center = projectV2(project, p.centroid)
    const sprite = createLabelSprite(p.name, { fontSize: 42, worldHeight: 0.9 })
    sprite.position.set(center.x, center.y, 0)
    labelGroup.add(sprite)
    labels.push(sprite)
  }
  group.add(labelGroup)

  // ---- 轮廓侧壁（挤出 + 上升扫光）----
  const sideGroup = new THREE.Group()
  group.add(sideGroup)
  const sideDisposables: Array<() => void> = []
  const uniforms = {
    uRiseTime: { value: RISE_MIN },
    uRiseColor: { value: new THREE.Color(RISE_COLOR) },
  }
  const sideMaterial = new THREE.MeshPhysicalMaterial({
    color: SIDE_COLOR,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  })
  sideMaterial.onBeforeCompile = (shader) => {
    shader.uniforms = { ...shader.uniforms, ...uniforms }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `
        #include <common>
        varying vec3 vTransformedNormal;
        varying float vHeight;
      `
      )
      .replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vTransformedNormal = normalize(normal);
        vHeight = transformed.z;
      `
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `
        #include <common>
        uniform vec3 uRiseColor;
        uniform float uRiseTime;
        varying float vHeight;
        varying vec3 vTransformedNormal;

        vec3 riseLine() {
          float smoothness = 0.5;
          float speed = uRiseTime;
          bool isTopBottom = (vTransformedNormal.z > 0.0 || vTransformedNormal.z < 0.0) && vTransformedNormal.x == 0.0 && vTransformedNormal.y == 0.0;
          float ratio = isTopBottom ? 0.0 : smoothstep(speed, speed + smoothness, vHeight) - smoothstep(speed + smoothness, speed + smoothness * 2.0, vHeight);
          return uRiseColor * ratio;
        }
      `
      )
      .replace(
        '#include <dithering_fragment>',
        `
        #include <dithering_fragment>
        gl_FragColor = gl_FragColor + vec4(riseLine(), 1.0);
      `
      )
  }

  const buildSideWalls = () => {
    sideGroup.clear()
    sideDisposables.forEach((fn) => fn())
    sideDisposables.length = 0
    for (const ring of outlineRings) {
      const shape = new THREE.Shape(ring.map((ll) => projectV2(project, ll)))
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false })
      const mesh = new THREE.Mesh(geo, sideMaterial)
      sideGroup.add(mesh)
      sideDisposables.push(() => geo.dispose())
    }
  }
  buildSideWalls()

  // ---- 边缘流光（沿轮廓行走的点带）----
  // 参考工程 flyLine.tsx：只取主轮廓环，高度 0.49（贴在挤出顶面之下、底图之上）
  const mainRing = outlineRings[0] ?? []
  const allOutlineV3 = mainRing.map((ll) => {
    const v = projectV2(project, ll)
    return new THREE.Vector3(v.x, v.y, 0.49)
  })

  const flyGeometry = new THREE.BufferGeometry()
  const flyShader = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color('#ffffff') } },
    vertexShader: `
      attribute float percent;
      varying float vAlpha;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(percent * 4.0, 0.1);
        vAlpha = percent;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float r = distance(gl_PointCoord, vec2(0.5));
        if (r > 0.5) discard;
        float a = pow(1.0 - r / 0.5, 6.0);
        gl_FragColor = vec4(uColor, a * vAlpha);
      }
    `,
  })
  const curveBase = new THREE.CatmullRomCurve3(allOutlineV3, true, 'catmullrom', 0.2)
  const sampled = curveBase.getSpacedPoints(800)
  const pointsObj = new THREE.Points(flyGeometry, flyShader)
  const flyGroup = new THREE.Group()
  flyGroup.position.z = 0.02
  flyGroup.add(pointsObj)
  group.add(flyGroup)

  let flyIndex = Math.floor((sampled.length - FLY_NUM) * Math.random())
  let flyCurve = new THREE.CatmullRomCurve3(
    sampled.slice(flyIndex, flyIndex + FLY_NUM),
    false,
    'catmullrom',
    0.2
  )
  const setFlySegment = () => {
    const start = Math.floor(flyIndex)
    const end = start + FLY_NUM
    let segment: THREE.Vector3[]
    if (end <= sampled.length) {
      segment = sampled.slice(start, end)
    } else {
      const overflow = end - sampled.length
      segment = sampled.slice(start).concat(sampled.slice(0, overflow))
    }
    flyCurve = new THREE.CatmullRomCurve3(segment, false, 'catmullrom', 0.2)
    const pts = flyCurve.getSpacedPoints(FLY_SEGMENTS)
    flyGeometry.setFromPoints(pts)
    const half = Math.floor(pts.length / 2)
    const percents = pts.map((_, i) => (i < half ? i / half : 1 - (i - half) / half))
    flyGeometry.setAttribute('percent', new THREE.BufferAttribute(new Float32Array(percents), 1))
  }
  setFlySegment()

  const update = (dt: number) => {
    uniforms.uRiseTime.value = uniforms.uRiseTime.value >= RISE_MAX ? RISE_MIN : uniforms.uRiseTime.value + RISE_STEP
    if (dt > 0) {
      flyIndex = (flyIndex + 60 * dt) % sampled.length
      setFlySegment()
    }
  }

  // Center bottom：整组居中，底缘贴合地面（参考 drei Center top 的位置意图）
  const geoBox = new THREE.Box3().setFromObject(group)
  const boxSize = new THREE.Vector3()
  const boxCenter = new THREE.Vector3()
  geoBox.getSize(boxSize)
  geoBox.getCenter(boxCenter)
  group.position.set(-boxCenter.x, -boxCenter.y, -boxCenter.z)
  // 略抬高使底缘在地面之上一点
  group.position.y += 0.01

  const setNewStyle = (v: boolean) => {
    drawBoundaryLines(!v)
    topMaterial.displacementMap = v ? displacementTex : null
    topMaterial.needsUpdate = true
  }

  const dispose = () => {
    disposables.forEach((fn) => fn())
    lineDisposables.forEach((fn) => fn())
    sideDisposables.forEach((fn) => fn())
    flyGeometry.dispose()
    flyShader.dispose()
    labels.forEach((l) => {
      l.material.map?.dispose()
      l.material.dispose()
    })
    topMaterial.dispose()
  }

  return { group, newStyle, setNewStyle, update, dispose }
}

export { makeProjector }
