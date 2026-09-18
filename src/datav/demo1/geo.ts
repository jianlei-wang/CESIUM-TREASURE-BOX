import * as THREE from 'three'
import { applyBboxUv, loadTexture, makeProjector, parseGeo, projectV2, type LonLat } from '../common/geo'
import { renderHeatmap } from '../common/heatCanvas'
import { createLabelSprite } from '../common/textSprite'
import cityData from './cityData'

import scJson from '../assets/sc.json'
import heatJson from '../assets/heatmapData.json'
import mapUrl from '../assets/sc_map.png'
import normalUrl from '../assets/sc_normal_map.png'
import cloudUrl from '../assets/cloud.png'
import quanUrl from '../assets/guangquan01.png'
import huiguangUrl from '../assets/huiguang.png'
import rotationBorder1Url from '../assets/rotationBorder1.png'
import rotationBorder2Url from '../assets/rotationBorder2.png'
import gaoguangUrl from '../assets/gaoguang1.png'
import gridUrl from '../assets/grid.png'
import gridBlackUrl from '../assets/gridBlack.png'

const DEPTH = 6
const HEAT_SIZE = 500

export interface Demo1Tooltip {
  city: string
  population: number
  gdp: string
  area: string
}

export interface Demo1Flags {
  cloud: boolean
  bar: boolean
  heat: boolean
  rotation: boolean
}

export interface Demo1Scene {
  group: THREE.Group
  setFlags: (flags: Partial<Demo1Flags>) => void
  update: (dt: number, camera: THREE.Camera) => void
  pick: (raycaster: THREE.Raycaster) => Demo1Tooltip | null
  dispose: () => void
}

const BAR_VERT = `
varying vec3 vPosition;
void main() {
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const BAR_FRAG = `
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform float uSize;
varying vec3 vPosition;
void main() {
  float t = clamp(vPosition.z / max(uSize, 0.001), 0.0, 1.0);
  vec3 c = mix(uColor1, uColor2, t);
  gl_FragColor = vec4(c, 1.0);
}
`

const RIPPLE_VERT = `
varying vec3 vPosition;
void main() {
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const RIPPLE_FRAG = `
uniform float uTime;
uniform vec3 uColor;
uniform sampler2D map;
uniform sampler2D alphaMap;
varying vec3 vPosition;
void main() {
  vec2 uv = vPosition.xy / 1000.0 + 0.5;
  vec4 tex = texture2D(map, uv * 80.0);
  float a = texture2D(alphaMap, uv * 80.0).r * 0.5;
  float r = uTime * 10.0;
  float w = min(20.0, uTime * 5.0);
  float d = distance(vPosition.xy, vec2(0.0));
  vec3 outgoing = tex.rgb * uColor;
  if (d > r && d < r + 2.0 * w) {
    float per = 0.0;
    if (d < r + w) {
      per = (d - r) / max(w, 0.001);
      outgoing = mix(outgoing, uColor, per);
      gl_FragColor = vec4(outgoing, mix(0.0, a, per));
    } else {
      per = (d - r - w) / max(w, 0.001);
      outgoing = mix(uColor, outgoing, per);
      gl_FragColor = vec4(outgoing, mix(a, 0.0, per));
    }
  } else {
    gl_FragColor = vec4(outgoing, 0.0);
  }
}
`

const HEAT_VERT = `
varying vec2 vUv;
uniform float z_scale;
uniform sampler2D greyMap;
void main() {
  vUv = uv;
  vec4 frgColor = texture2D(greyMap, uv);
  float height = z_scale * frgColor.a;
  vec3 transformed = vec3(position.x, position.y, height);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`
const HEAT_FRAG = `
varying vec2 vUv;
uniform sampler2D heatMap;
uniform vec3 u_color;
uniform float u_opacity;
void main() {
  gl_FragColor = vec4(u_color, u_opacity) * texture2D(heatMap, vUv);
}
`

interface HeatFeature {
  geometry: { coordinates: number[] }
  properties: { value: number }
}

export async function buildDemo1Scene(): Promise<Demo1Scene> {
  const city = parseGeo(scJson)
  const project = makeProjector(city.polygons[0].centroid, 1000)

  const wrapRepeat = (t: THREE.Texture) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
  }
  const [
    mapTex,
    normalTex,
    cloudTex,
    quanTex,
    huiguangTex,
    rb1,
    rb2,
    gaoGuang,
    gridTex,
    gridBlackTex,
  ] = await Promise.all([
    loadTexture(mapUrl, wrapRepeat),
    loadTexture(normalUrl, wrapRepeat),
    loadTexture(cloudUrl),
    loadTexture(quanUrl),
    loadTexture(huiguangUrl, (t) => {
      t.colorSpace = THREE.SRGBColorSpace
      wrapRepeat(t)
    }),
    loadTexture(rotationBorder1Url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace
    }),
    loadTexture(rotationBorder2Url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace
    }),
    loadTexture(gaoguangUrl, (t) => {
      t.colorSpace = THREE.SRGBColorSpace
      wrapRepeat(t)
    }),
    loadTexture(gridUrl, (t) => {
      wrapRepeat(t)
      t.repeat.set(80, 80)
    }),
    loadTexture(gridBlackUrl, (t) => {
      wrapRepeat(t)
      t.repeat.set(80, 80)
    }),
  ])

  const root = new THREE.Group()
  const mapHolder = new THREE.Group()
  mapHolder.rotation.x = -Math.PI / 2
  mapHolder.position.x = 20
  root.add(mapHolder)

  const mapGroup = new THREE.Group()
  mapGroup.scale.set(1, 1, 0.01)
  mapHolder.add(mapGroup)

  const bbox = new THREE.Box2()
  const regions: Array<{
    name: string
    center: THREE.Vector3
    shapes: THREE.Shape[]
    mesh: THREE.Object3D
    bar: THREE.Group
    hover: THREE.Vector3
  }> = []

  for (const p of city.polygons) {
    const shapes: THREE.Shape[] = []
    for (const ring of p.rings) {
      const pts = ring.map((ll) => {
        const v = projectV2(project, ll)
        bbox.expandByPoint(v)
        return v
      })
      shapes.push(new THREE.Shape(pts))
    }
    const [cx, cy] = project(p.centroid)
    regions.push({
      name: p.name,
      center: new THREE.Vector3(cx, -cy, DEPTH + 0.1),
      shapes,
      mesh: new THREE.Object3D(),
      bar: new THREE.Group(),
      hover: new THREE.Vector3(1, 1, 1),
    })
  }

  const topMat = new THREE.MeshStandardMaterial({ map: mapTex, normalMap: normalTex })
  const sideMat = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0,
    metalness: 0.2,
    roughness: 0.5,
    side: THREE.DoubleSide,
    color: '#f9f3e7',
  })
  const edgeMat = new THREE.LineBasicMaterial({
    transparent: true,
    opacity: 0,
    color: 0xffffff,
  })

  const color1 = new THREE.Color(0xfbdf88)
  const color2 = new THREE.Color(0xea580c)
  const pickables: THREE.Object3D[] = []
  const bars: THREE.Group[] = []
  const rings: THREE.Mesh[] = []

  for (const region of regions) {
    const cityGroup = new THREE.Group()
    cityGroup.userData.city = region.name
    cityGroup.userData.hover = region.hover

    const topGeo = new THREE.ShapeGeometry(region.shapes)
    applyBboxUv(topGeo, bbox)
    const top = new THREE.Mesh(topGeo, topMat)
    top.position.z = DEPTH + 0.1
    cityGroup.add(top)

    const extrude = new THREE.Mesh(
      new THREE.ExtrudeGeometry(region.shapes, { depth: DEPTH, steps: 1, bevelEnabled: false }),
      sideMat
    )
    extrude.castShadow = true
    extrude.receiveShadow = true
    extrude.userData.city = region.name
    cityGroup.add(extrude)
    pickables.push(extrude)

    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(topGeo), edgeMat)
    edges.position.z = DEPTH + 0.2
    cityGroup.add(edges)

    const pop = cityData[region.name as keyof typeof cityData]?.population ?? 0
    const barHeight = 4.0 * 5 * (pop / 1000)
    const barGroup = new THREE.Group()
    barGroup.position.copy(region.center)
    bars.push(barGroup)

    const barMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor1: { value: color1 },
        uColor2: { value: color2 },
        uSize: { value: barHeight },
      },
      vertexShader: BAR_VERT,
      fragmentShader: BAR_FRAG,
      transparent: true,
      depthTest: false,
      fog: false,
    })
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, barHeight), barMat)
    box.position.z = barHeight / 2
    barGroup.add(box)

    const glowMat = new THREE.MeshBasicMaterial({
      transparent: true,
      color: color2,
      map: huiguangTex,
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
    for (const deg of [0, 60, 120]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(3.5, barHeight), glowMat)
      plane.rotation.x = Math.PI / 2
      plane.rotation.y = (Math.PI / 180) * deg
      plane.position.z = barHeight / 2
      barGroup.add(plane)
    }

    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 5),
      new THREE.MeshBasicMaterial({
        transparent: true,
        color: 0xffffff,
        map: quanTex,
        alphaMap: quanTex,
        depthTest: false,
        fog: false,
        blending: THREE.AdditiveBlending,
      })
    )
    barGroup.add(ring)
    rings.push(ring)

    const label = createLabelSprite(region.name, { color: '#ea580c', worldHeight: 4, fontSize: 36 })
    label.position.set(0, 0, barHeight + 2)
    barGroup.add(label)

    cityGroup.add(barGroup)
    region.bar = barGroup
    region.mesh = cityGroup
    mapGroup.add(cityGroup)
  }

  const heatPoints = (heatJson as { features: HeatFeature[] }).features.map((el) => {
    const [x = 0, y = 0] = project(el.geometry.coordinates as LonLat)
    return { x: Math.floor(x + HEAT_SIZE / 2), y: Math.floor(y + HEAT_SIZE / 2), value: el.properties.value }
  })
  const heatMaps = renderHeatmap({ size: HEAT_SIZE, points: heatPoints, radius: 10, min: 0, max: 2000 })
  const heatColor = new THREE.CanvasTexture(heatMaps.color)
  const heatGrey = new THREE.CanvasTexture(heatMaps.grey)
  const heatMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    uniforms: {
      heatMap: { value: heatColor },
      greyMap: { value: heatGrey },
      z_scale: { value: 4.0 },
      u_color: { value: new THREE.Color('#ffffff') },
      u_opacity: { value: 1.0 },
    },
    vertexShader: HEAT_VERT,
    fragmentShader: HEAT_FRAG,
  })
  const heatMesh = new THREE.Mesh(new THREE.PlaneGeometry(HEAT_SIZE, HEAT_SIZE, 80, 80), heatMat)
  heatMesh.position.z = DEPTH + 1
  heatMesh.renderOrder = 11
  mapGroup.add(heatMesh)

  const bottom = new THREE.Group()
  bottom.rotation.x = -Math.PI / 2
  bottom.position.y = -0.1
  root.add(bottom)

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshBasicMaterial({
      transparent: true,
      map: gaoGuang,
      color: '#fbdf88',
      blending: THREE.NormalBlending,
    })
  )
  glow.renderOrder = 1
  bottom.add(glow)
  const border1 = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshBasicMaterial({
      transparent: true,
      map: rb1,
      color: '#fbdf88',
      opacity: 0.2,
      depthWrite: false,
      alphaTest: 0.02,
      blending: THREE.NormalBlending,
    })
  )
  border1.position.z = 0.1
  border1.renderOrder = 4
  bottom.add(border1)
  const border2 = new THREE.Mesh(
    new THREE.PlaneGeometry(225, 225),
    new THREE.MeshBasicMaterial({
      transparent: true,
      map: rb2,
      color: '#fbdf88',
      opacity: 0.4,
      depthWrite: false,
      alphaTest: 0.02,
      blending: THREE.NormalBlending,
    })
  )
  border2.position.z = 0.1
  border2.renderOrder = 5
  bottom.add(border2)

  const gridBase = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000),
    new THREE.MeshBasicMaterial({
      transparent: true,
      map: gridTex,
      alphaMap: gridBlackTex,
      color: '#fbdf88',
      opacity: 0.1,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })
  )
  gridBase.position.z = 0.05
  gridBase.renderOrder = 2
  bottom.add(gridBase)

  const rippleUniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xea580c) } }
  const ripple = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { ...rippleUniforms, map: { value: gridTex }, alphaMap: { value: gridBlackTex } },
      vertexShader: RIPPLE_VERT,
      fragmentShader: RIPPLE_FRAG,
    })
  )
  ripple.position.z = 0.05
  ripple.renderOrder = 3
  bottom.add(ripple)

  const cloudGroup = new THREE.Group()
  cloudGroup.position.set(0, 60, 0)
  const cloudMat = new THREE.MeshLambertMaterial({
    map: cloudTex,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const cloudMeshes: THREE.Mesh[] = []
  const cloudSeeds = [
    [100, 20, 20],
    [-60, 10, 60],
    [40, 30, -40],
    [-80, 25, -20],
  ]
  for (const [x, y, z] of cloudSeeds) {
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 24), cloudMat)
      m.position.set(x + (Math.random() - 0.5) * 50, y + (Math.random() - 0.5) * 10, z + (Math.random() - 0.5) * 30)
      m.rotation.y = Math.random() * Math.PI
      cloudGroup.add(m)
      cloudMeshes.push(m)
    }
  }
  root.add(cloudGroup)

  let intro = 0
  const flags: Demo1Flags = { cloud: true, bar: true, heat: true, rotation: true }

  return {
    group: root,
    setFlags(next) {
      Object.assign(flags, next)
      cloudGroup.visible = flags.cloud
      heatMesh.visible = flags.heat
      bottom.visible = flags.rotation
      for (const b of bars) b.visible = flags.bar
    },
    update(dt, camera) {
      intro = Math.min(1, intro + dt * 0.55)
      const s = intro * intro * (3 - 2 * intro)
      mapGroup.scale.z = 0.01 + 0.99 * s
      sideMat.opacity = s
      edgeMat.opacity = s

      for (const ring of rings) ring.rotation.z += dt + 0.02
      border1.rotation.z += 0.001
      border2.rotation.z += -0.004
      rippleUniforms.uTime.value += dt * 10
      if (rippleUniforms.uTime.value > 100) rippleUniforms.uTime.value = 0

      cloudGroup.rotation.y = Math.cos(performance.now() / 2000) / 2
      cloudGroup.rotation.x = Math.sin(performance.now() / 2000) / 2
      for (const m of cloudMeshes) m.lookAt(camera.position)

      for (const region of regions) {
        region.mesh.scale.lerp(region.hover, 0.1)
      }
    },
    pick(raycaster) {
      const hits = raycaster.intersectObjects(pickables, false)
      for (const region of regions) region.hover.set(1, 1, 1)
      if (!hits.length) return null
      const name = hits[0].object.userData.city as string
      const region = regions.find((r) => r.name === name)
      if (region) region.hover.set(1, 1, 1.5)
      const info = cityData[name as keyof typeof cityData]
      if (!info) return { city: name, population: 0, gdp: '-', area: '-' }
      return { city: name, ...info }
    },
    dispose() {
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        mesh.geometry?.dispose()
      })
      heatColor.dispose()
      heatGrey.dispose()
    },
  }
}
