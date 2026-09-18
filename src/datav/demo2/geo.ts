import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { applyBboxUv, firstPolygonRings, loadTexture, makeProjector, parseGeo, projectV2 } from '../common/geo'
import { createLabelSprite } from '../common/textSprite'

import scJson from '../assets/sc.json'
import scOutlineJson from '../assets/sc_outline.json'
import normalUrl from '../assets/sc_normal_map1.png'
import flyLineUrl from '../assets/fly_line.png'
import quanUrl from '../assets/guangquan01.png'
import quan1Url from '../assets/quan1.png'

const DEPTH = 1
const ACCENT = 0x8fc2ff

const SHIFT_VERT = `
varying vec3 vPosition;
void main() {
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const SHIFT_FRAG = `
varying vec3 vPosition;
uniform float time;
uniform float depth;
uniform vec3 baseTopColor;
uniform vec3 baseBottomColor;
uniform vec3 scanColor;
uniform float opacity;
void main() {
  float bandHeight = 0.45;
  float normalizedHeight = clamp(vPosition.z / depth, 0.0, 1.0);
  float progress = fract(time) * (1.0 + bandHeight) - bandHeight;
  float distance = (progress + bandHeight) - normalizedHeight;
  float belowHead = step(0.0, distance);
  float withinBand = clamp(1.0 - distance / bandHeight, 0.0, 1.0) * belowHead;
  float feather = smoothstep(0.0, 1.0, withinBand);
  float bandCore = pow(feather, 1.5);
  float bandEdge = smoothstep(0.0, 0.6, withinBand) * (1.0 - smoothstep(0.6, 1.0, withinBand));
  float scanStrength = (bandCore * 0.85 + bandEdge * 0.4);
  if (normalizedHeight < 0.001 || normalizedHeight > 0.999) {
    scanStrength = 0.0;
  }
  vec3 baseColor = mix(baseBottomColor, baseTopColor, normalizedHeight);
  vec3 scanned = mix(baseColor, scanColor, clamp(scanStrength, 0.0, 1.0));
  gl_FragColor = vec4(scanned, opacity);
}
`

const BOUNDARY_VERT = `
varying vec2 vUv;
varying vec3 vNormal;
varying float vHeight;
void main() {
  vUv = uv;
  vNormal = normal;
  vHeight = position.z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const BOUNDARY_FRAG = `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uDepth;
varying vec2 vUv;
varying vec3 vNormal;
varying float vHeight;
void main() {
  if (vNormal.z == 1.0 || vNormal.z == -1.0 || vUv.y == 0.0) {
    discard;
  } else {
    float h = mix(1.0, 0.0, vHeight / uDepth);
    gl_FragColor = vec4(uColor, h * uOpacity);
  }
}
`

const BEAM_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const BEAM_FRAG = `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float strength = 1.0 - abs(vUv.x - 0.5) * 2.0;
  strength = pow(strength, 2.0);
  float verticalFade = pow(sin(vUv.y * 3.14159), 0.5);
  float brightness = strength * verticalFade;
  vec3 finalColor = uColor * brightness * 2.0;
  gl_FragColor = vec4(finalColor, brightness * uOpacity);
}
`

export interface Demo2Scene {
  group: THREE.Group
  update: (dt: number) => void
  pick: (raycaster: THREE.Raycaster) => string | null
  dispose: () => void
}

export async function buildDemo2Scene(renderer: THREE.WebGLRenderer): Promise<Demo2Scene> {
  const city = parseGeo(scJson)
  const project = makeProjector(city.polygons[0].centroid)
  const [normalTex, flyTex, quanTex, quan1Tex] = await Promise.all([
    loadTexture(normalUrl),
    loadTexture(flyLineUrl, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(0.5, 2)
    }),
    loadTexture(quanUrl),
    loadTexture(quan1Url),
  ])

  const root = new THREE.Group()
  const mapHolder = new THREE.Group()
  mapHolder.rotation.x = -Math.PI / 2
  mapHolder.scale.setScalar(0.5)
  mapHolder.position.y = 0.2
  root.add(mapHolder)

  const mapGroup = new THREE.Group()
  mapGroup.scale.set(1, 1, 0.001)
  mapHolder.add(mapGroup)

  const bbox = new THREE.Box2()
  const regions: Array<{
    name: string
    center: THREE.Vector3
    shapes: THREE.Shape[]
    mesh: THREE.Object3D
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
      center: new THREE.Vector3(cx, -cy, 0),
      shapes,
      mesh: new THREE.Object3D(),
      hover: new THREE.Vector3(1, 1, 1),
    })
  }

  const sideMat = new THREE.MeshStandardMaterial({
    transparent: true,
    color: '#293b41',
    normalMap: normalTex,
    metalness: 0.5,
    roughness: 0.7,
    side: THREE.DoubleSide,
    opacity: 0,
  })
  const shiftUniforms = {
    time: { value: 0 },
    depth: { value: DEPTH },
    baseTopColor: { value: new THREE.Color('#8fc2ff') },
    baseBottomColor: { value: new THREE.Color('#10182c') },
    scanColor: { value: new THREE.Color('#8fc2ff') },
    opacity: { value: 0 },
  }
  const topMat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: shiftUniforms,
    vertexShader: SHIFT_VERT,
    fragmentShader: SHIFT_FRAG,
  })
  const edgeMat = new THREE.LineBasicMaterial({ transparent: true, color: 0xffffff, opacity: 0 })
  const pickables: THREE.Object3D[] = []
  const fadeMats: Array<THREE.Material & { opacity: number }> = [sideMat, topMat, edgeMat]

  for (const region of regions) {
    const cityGroup = new THREE.Group()
    cityGroup.userData.city = region.name
    const extrudeGeo = new THREE.ExtrudeGeometry(region.shapes, { depth: DEPTH, bevelEnabled: false })
    applyBboxUv(extrudeGeo, bbox)
    const extrude = new THREE.Mesh(extrudeGeo, [sideMat, topMat])
    extrude.castShadow = true
    extrude.receiveShadow = true
    extrude.userData.city = region.name
    cityGroup.add(extrude)
    pickables.push(extrude)

    const topGeo = new THREE.ShapeGeometry(region.shapes)
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(topGeo), edgeMat)
    edges.position.z = DEPTH + 0.05
    cityGroup.add(edges)

    const label = createLabelSprite(region.name, { color: '#8fc2ff', worldHeight: 0.45, fontSize: 32 })
    label.position.set(region.center.x, region.center.y, DEPTH + 0.2)
    cityGroup.add(label)

    region.mesh = cityGroup
    mapGroup.add(cityGroup)
  }

  const coneGeo = new THREE.ConeGeometry(0.3, 0.5, 4)
  const coneMat = new THREE.MeshBasicMaterial({
    color: ACCENT,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0,
  })
  fadeMats.push(coneMat)
  const cones: Array<{ mesh: THREE.Mesh; dir: 1 | -1 }> = []
  const coneRoot = new THREE.Group()
  coneRoot.position.z = 1
  mapGroup.add(coneRoot)
  for (const region of regions) {
    const mesh = new THREE.Mesh(coneGeo, coneMat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.copy(region.center)
    mesh.position.z = 0.3
    coneRoot.add(mesh)
    cones.push({ mesh, dir: 1 })
  }

  const ringGeo = new THREE.PlaneGeometry(0.8, 0.8)
  const ringMat = new THREE.MeshBasicMaterial({
    transparent: true,
    color: ACCENT,
    alphaMap: quanTex,
    opacity: 0,
    depthTest: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  })
  fadeMats.push(ringMat)
  const rings: THREE.Mesh[] = []
  for (const region of regions) {
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.position.copy(region.center)
    coneRoot.add(ring)
    rings.push(ring)
  }

  const origin = regions[0]?.center ?? new THREE.Vector3()
  const flyRoot = new THREE.Group()
  flyRoot.position.z = 1.1
  flyRoot.renderOrder = 10
  mapGroup.add(flyRoot)
  const flyMat = new THREE.MeshBasicMaterial({
    transparent: true,
    color: ACCENT,
    fog: false,
    map: flyTex,
    opacity: 0,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  })
  fadeMats.push(flyMat)
  for (const region of regions) {
    const mid = new THREE.Vector3().addVectors(origin, region.center).multiplyScalar(0.5).setZ(5)
    const curve = new THREE.QuadraticBezierCurve3(origin.clone().setZ(0), mid, region.center.clone().setZ(0))
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.1, 2, false), flyMat)
    flyRoot.add(tube)
  }

  const outlineShapes: THREE.Shape[] = []
  const trailPts: THREE.Vector3[] = []
  for (const ring of firstPolygonRings(scOutlineJson)) {
    const pts = ring.map((ll) => projectV2(project, ll))
    outlineShapes.push(new THREE.Shape(pts))
    if (!trailPts.length) {
      for (const v of pts) trailPts.push(new THREE.Vector3(v.x, v.y, 0))
    }
  }
  const boundaryMat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(ACCENT) },
      uOpacity: { value: 0.2 },
      uDepth: { value: 3 },
    },
    vertexShader: BOUNDARY_VERT,
    fragmentShader: BOUNDARY_FRAG,
  })
  const boundary = new THREE.Mesh(new THREE.ExtrudeGeometry(outlineShapes, { depth: 3, bevelEnabled: false }), boundaryMat)
  boundary.position.z = 1
  boundary.renderOrder = 11
  mapGroup.add(boundary)

  const trailHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 10, 10), fog: false })
  )
  const trailLineGeo = new THREE.BufferGeometry()
  const TRAIL_LEN = 48
  const trailPos = new Float32Array(TRAIL_LEN * 3)
  trailLineGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3))
  const trailLine = new THREE.Line(
    trailLineGeo,
    new THREE.LineBasicMaterial({ color: new THREE.Color(2, 10, 10), transparent: true, opacity: 0.85, fog: false })
  )
  const trailGroup = new THREE.Group()
  trailGroup.position.z = 1.1
  trailGroup.add(trailHead, trailLine)
  mapGroup.add(trailGroup)
  let trailT = 0

  const bottom = new THREE.Group()
  bottom.rotation.x = -Math.PI / 2
  bottom.position.y = -0.01
  const spin = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 16),
    new THREE.MeshBasicMaterial({
      transparent: true,
      map: quan1Tex,
      color: ACCENT,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  )
  bottom.add(spin)
  root.add(bottom)

  const mirror = new Reflector(new THREE.PlaneGeometry(100, 100), {
    clipBias: 0.003,
    textureWidth: Math.max(256, renderer.domElement.width || 1024),
    textureHeight: Math.max(256, renderer.domElement.height || 1024),
    color: 0x011024,
  })
  mirror.rotation.x = -Math.PI / 2
  mirror.position.y = -0.02
  root.add(mirror)

  const beams: THREE.Mesh[] = []
  const beamRoot = new THREE.Group()
  const beamRange = 20
  for (let i = 0; i < 20; i++) {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(ACCENT) },
        uOpacity: { value: 0.5 + Math.random() * 0.2 },
      },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
    })
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6, 1, true), mat)
    beam.position.set((Math.random() - 0.5) * beamRange, 5 - Math.random() * 5, (Math.random() - 0.5) * beamRange)
    beam.scale.y = 2 + Math.random() * 4
    beam.userData.speed = 2 + Math.random()
    beam.userData.resetHeight = 10 + Math.random() * 20
    beamRoot.add(beam)
    beams.push(beam)
  }
  root.add(beamRoot)

  const box = new THREE.Box3().setFromObject(mapHolder)
  const center = new THREE.Vector3()
  box.getCenter(center)
  mapHolder.position.x -= center.x
  mapHolder.position.z -= center.z
  mapHolder.position.y -= box.min.y

  let intro = 0
  const targetFade = { value: 0 }

  return {
    group: root,
    update(dt) {
      intro += dt
      shiftUniforms.time.value += dt / 3
      flyTex.offset.x -= dt / 5
      spin.rotation.z += dt / 5

      if (intro > 2.5) {
        targetFade.value = Math.min(1, targetFade.value + dt)
        const k = targetFade.value
        mapGroup.scale.z = Math.max(0.001, k)
        for (const m of fadeMats) m.opacity = m === ringMat || m === flyMat || m === coneMat ? k : k
        sideMat.opacity = k
        shiftUniforms.opacity.value = k
        edgeMat.opacity = k
        coneMat.opacity = k
        ringMat.opacity = k
        flyMat.opacity = k
      }

      for (const c of cones) {
        if (c.mesh.position.z >= 1) {
          c.dir = -1
          c.mesh.position.z = 1
        }
        if (c.mesh.position.z <= 0) {
          c.dir = 1
          c.mesh.position.z = 0
        }
        c.mesh.rotation.y += dt
        c.mesh.position.z += (c.dir * dt) / 2
      }
      for (const ring of rings) ring.rotation.z += dt + 0.02

      if (trailPts.length) {
        trailT += dt / 10
        const idx = Math.floor(trailT * trailPts.length) % trailPts.length
        const p = trailPts[idx]
        trailHead.position.copy(p)
        for (let i = 0; i < TRAIL_LEN; i++) {
          const src = trailPts[(idx - i + trailPts.length) % trailPts.length]
          trailPos[i * 3] = src.x
          trailPos[i * 3 + 1] = src.y
          trailPos[i * 3 + 2] = src.z
        }
        trailLineGeo.attributes.position.needsUpdate = true
      }

      for (const beam of beams) {
        beam.position.y += beam.userData.speed * dt
        if (beam.position.y > beam.userData.resetHeight) {
          beam.position.x = (Math.random() - 0.5) * beamRange
          beam.position.z = (Math.random() - 0.5) * beamRange
          beam.position.y = 1 - Math.random() * 5
          beam.scale.y = 2 + Math.random()
        }
      }

      for (const region of regions) region.mesh.scale.lerp(region.hover, 0.1)
    },
    pick(raycaster) {
      const hits = raycaster.intersectObjects(pickables, false)
      for (const region of regions) region.hover.set(1, 1, 1)
      if (!hits.length) return null
      const name = hits[0].object.userData.city as string
      const region = regions.find((r) => r.name === name)
      if (region) region.hover.setZ(1.5)
      return name
    },
    dispose() {
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        mesh.geometry?.dispose()
      })
      const tex = (mirror.material as THREE.ShaderMaterial).uniforms?.tDiffuse?.value as THREE.Texture | undefined
      tex?.dispose()
    },
  }
}
