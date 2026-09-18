import * as THREE from 'three'
import {
  DAM_X,
  DX,
  DXW,
  DZ,
  DZW,
  LX,
  LZ,
  NX,
  NXW,
  NZ,
  NZW,
  PKEYS,
  STEPS,
  backwaterX,
  bed,
  terrainColor,
  terrainH,
  type PKey
} from '../barrier-lake-lib/model'

/**
 * 堰塞湖的形成与溃决 —— 纯 Three.js 三维演化场景。
 *
 * 说明：该场景由一份独立的 Three.js 交互演示移植而来，地貌/水文解析模型与
 * 八阶段参数状态机见 ../barrier-lake-lib/model。UI 与三维逻辑分离：本模块只负责场景，
 * 步骤同步与阶段元数据通过 ../barrier-lake-lib/model 的 STEP_META / 回调抛出。
 */

export { STEP_COUNT, STEP_META, type BarrierLakeStepMeta } from '../barrier-lake-lib/model'

/** 三维场景对外抛出的状态变化 */
export interface BarrierLakeCallbacks {
  onStepChange: (index: number) => void
}

interface LabelObj {
  sp: THREE.Sprite
  line: THREE.Line
  text: string
  color: string
  pos: THREE.Vector3
  off: number
  on: boolean
}

export class BarrierLakeScene {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private root: THREE.Group
  private callbacks: BarrierLakeCallbacks

  private tPos: Float32Array
  private tCol: Float32Array
  private tGeo: THREE.BufferGeometry
  private gw: number
  private gh: number

  private wGeo: THREE.BufferGeometry
  private wUniforms: Record<string, THREE.IUniform>

  private rocks: THREE.InstancedMesh
  private rockData: Array<{
    sx: number
    sy: number
    sz: number
    ex: number
    ez: number
    eyOff: number
    sc: number
    sxr: number
    syr: number
    szr: number
    rx: number
    ry: number
    rz: number
    sp: number
    hop: number
    dl: number
    col: number
  }>

  private scar: THREE.Mesh
  private cracks: THREE.Group
  private rain: THREE.LineSegments
  private rainGeo: THREE.BufferGeometry
  private rainMat: THREE.LineBasicMaterial
  private foam: THREE.Points
  private foamGeo: THREE.BufferGeometry
  private foamMat: THREE.PointsMaterial
  private flashEl: HTMLElement | null

  private labels: Record<string, LabelObj> = {}
  private labelOn = true
  private spin = false

  private cam = { theta: -1.42, phi: 0.82, r: 240, tx: 0, ty: 2, tz: 0 }
  private camGoal = { theta: -1.42, phi: 0.82, r: 240, tx: 0, ty: 2, tz: 0 }

  private st: Record<PKey, number>
  private fromSt: Record<PKey, number>
  private toSt: Record<PKey, number>
  private cur = 0
  private animT = 1
  private animDur = 1
  private playing = false
  private playTimer = 0
  private rainManual = false
  private lastDam = -1
  private lastBreach = -1
  private lastSlide = -1
  private flashT = 0
  private time = 0
  private last = performance.now()
  private rafId = 0
  private disposed = false
  private container: HTMLElement
  private observer: ResizeObserver | null = null

  private pointers: Record<number, { x: number; y: number }> = {}
  private pCount = 0
  private lastX = 0
  private lastY = 0
  private lastDist = 0
  private dragBtn = 0

  private _c = [0, 0, 0]
  private _m4 = new THREE.Matrix4()
  private _q = new THREE.Quaternion()
  private _e = new THREE.Euler()
  private _v = new THREE.Vector3()
  private _s = new THREE.Vector3()

  private onPointerDown: (e: PointerEvent) => void
  private onPointerMove: (e: PointerEvent) => void
  private onPointerUp: (e: PointerEvent) => void
  private onWheel: (e: WheelEvent) => void
  private onContextMenu: (e: Event) => void
  private onKeyDown: (e: KeyboardEvent) => void

  constructor(container: HTMLElement, callbacks: BarrierLakeCallbacks, flashEl: HTMLElement | null) {
    this.container = container
    this.callbacks = callbacks
    this.flashEl = flashEl
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1)

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.renderer.domElement.style.touchAction = 'none'
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 1200)

    this.buildSky()
    this.buildLights()
    this.root = new THREE.Group()
    this.scene.add(this.root)

    this.gw = NX + 1
    this.gh = NZ + 1
    const terrain = this.buildTerrain()
    this.tPos = terrain.pos
    this.tCol = terrain.col
    this.tGeo = terrain.geo

    const water = this.buildWater()
    this.wGeo = water.geo
    this.wUniforms = water.uniforms

    const rocks = this.buildRocks()
    this.rocks = rocks.mesh
    this.rockData = rocks.data

    this.scar = this.buildScar()
    this.cracks = this.buildCracks()

    const rain = this.buildRain()
    this.rain = rain.mesh
    this.rainGeo = rain.geo
    this.rainMat = rain.mat

    const foam = this.buildFoam()
    this.foam = foam.mesh
    this.foamGeo = foam.geo
    this.foamMat = foam.mat

    this.buildLabels()

    this.st = {} as Record<PKey, number>
    this.fromSt = {} as Record<PKey, number>
    this.toSt = {} as Record<PKey, number>
    for (const k of PKEYS) this.st[k] = STEPS[0].p[k]

    this.onPointerDown = (e) => this.handlePointerDown(e)
    this.onPointerMove = (e) => this.handlePointerMove(e)
    this.onPointerUp = (e) => this.handlePointerUp(e)
    this.onWheel = (e) => this.handleWheel(e)
    this.onContextMenu = (e) => e.preventDefault()
    this.onKeyDown = (e) => this.handleKeyDown(e)

    const cv = this.renderer.domElement
    cv.addEventListener('pointerdown', this.onPointerDown)
    cv.addEventListener('pointermove', this.onPointerMove)
    cv.addEventListener('pointerup', this.onPointerUp)
    cv.addEventListener('pointercancel', this.onPointerUp)
    cv.addEventListener('contextmenu', this.onContextMenu)
    cv.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('keydown', this.onKeyDown)

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(container)
    this.resize()

    this.updateTerrain(0, 0, 0)
    this.updateRocks(0, 0)
    this.gotoStep(0, true)

    this.rafId = requestAnimationFrame(this.frame)
  }

  private buildSky(): void {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(560, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { cTop: { value: new THREE.Color(0x1b3b55) }, cBot: { value: new THREE.Color(0x0b1116) } },
        vertexShader:
          'varying float vy; void main(){ vy = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader:
          'uniform vec3 cTop; uniform vec3 cBot; varying float vy; void main(){ gl_FragColor = vec4(mix(cBot, cTop, smoothstep(-0.05, 0.65, vy)), 1.0); }'
      })
    )
    this.scene.add(sky)
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xa8c8e0, 0x3a3225, 0.62))
    const sun = new THREE.DirectionalLight(0xfff2dc, 1.05)
    sun.position.set(-95, 130, 78)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -155
    sun.shadow.camera.right = 155
    sun.shadow.camera.top = 115
    sun.shadow.camera.bottom = -115
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 420
    sun.shadow.bias = -0.0007
    this.scene.add(sun)
    const fill = new THREE.DirectionalLight(0x7fa2c4, 0.3)
    fill.position.set(90, 45, -95)
    this.scene.add(fill)
  }

  private buildTerrain(): { pos: Float32Array; col: Float32Array; geo: THREE.BufferGeometry } {
    const gw = this.gw
    const gh = this.gh
    const tPos = new Float32Array(gw * gh * 3)
    const tCol = new Float32Array(gw * gh * 3)
    const tIdx: number[] = []
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i
        tPos[k * 3] = -LX / 2 + i * DX
        tPos[k * 3 + 1] = 0
        tPos[k * 3 + 2] = -LZ / 2 + j * DZ
      }
    }
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const a = j * gw + i
        const b = a + 1
        const c = a + gw
        const d = c + 1
        tIdx.push(a, c, b, b, c, d)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(tPos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(tCol, 3))
    geo.setIndex(tIdx)
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.root.add(mesh)
    return { pos: tPos, col: tCol, geo }
  }

  private updateTerrain(dam: number, breach: number, slide: number): void {
    const gw = this.gw
    const gh = this.gh
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i
        const x = this.tPos[k * 3]
        const z = this.tPos[k * 3 + 2]
        const h = terrainH(x, z, dam, breach, slide)
        this.tPos[k * 3 + 1] = h
        terrainColor(x, z, h, dam, breach, slide, this._c)
        this.tCol[k * 3] = this._c[0]
        this.tCol[k * 3 + 1] = this._c[1]
        this.tCol[k * 3 + 2] = this._c[2]
      }
    }
    const posAttr = this.tGeo.getAttribute('position') as THREE.BufferAttribute
    const colAttr = this.tGeo.getAttribute('color') as THREE.BufferAttribute
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
    this.tGeo.computeVertexNormals()
    this.tGeo.computeBoundingSphere()

    const wa = this.wGeo.getAttribute('aTerr').array as Float32Array
    const wp = this.wGeo.getAttribute('position').array as Float32Array
    for (let m = 0; m < wa.length; m++) {
      wa[m] = terrainH(wp[m * 3], wp[m * 3 + 2], dam, breach, slide)
    }
    ;(this.wGeo.getAttribute('aTerr') as THREE.BufferAttribute).needsUpdate = true
    this.lastDam = dam
    this.lastBreach = breach
    this.lastSlide = slide
  }

  private buildWater(): { geo: THREE.BufferGeometry; uniforms: Record<string, THREE.IUniform> } {
    const wPos = new Float32Array((NXW + 1) * (NZW + 1) * 3)
    const wTerr = new Float32Array((NXW + 1) * (NZW + 1))
    const wIdx: number[] = []
    for (let j = 0; j <= NZW; j++) {
      for (let i = 0; i <= NXW; i++) {
        const k = j * (NXW + 1) + i
        wPos[k * 3] = -LX / 2 + i * DXW
        wPos[k * 3 + 1] = 0
        wPos[k * 3 + 2] = -LZ / 2 + j * DZW
      }
    }
    for (let j = 0; j < NZW; j++) {
      for (let i = 0; i < NXW; i++) {
        const a = j * (NXW + 1) + i
        const b = a + 1
        const c = a + NXW + 1
        const d = c + 1
        wIdx.push(a, c, b, b, c, d)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(wPos, 3))
    geo.setAttribute('aTerr', new THREE.BufferAttribute(wTerr, 1))
    geo.setIndex(wIdx)

    const uniforms: Record<string, THREE.IUniform> = {
      uTime: { value: 0 },
      uLevel: { value: -0.5 },
      uDepth: { value: 1.6 },
      uDS: { value: 1 },
      uFlood: { value: 0 },
      uFlow: { value: 1 },
      uTurbid: { value: 0.12 },
      uWave: { value: 1 },
      uDamX: { value: DAM_X }
    }
    const mat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      vertexShader: [
        'attribute float aTerr;',
        'uniform float uTime,uLevel,uDepth,uDS,uFlood,uFlow,uWave,uDamX;',
        'varying float vWY; varying float vTerr; varying vec3 vPos;',
        'float bedF(float x){',
        '  if(x < -40.0) return (-40.0 - x) * 0.18;',
        '  if(x < 60.0)  return -(x + 40.0) * 0.03;',
        '  return -3.0 - (x - 60.0) * 0.10;',
        '}',
        'void main(){',
        '  vec3 p = position;',
        '  float bedv = bedF(p.x);',
        '  float upY = max(bedv + uDepth, uLevel);',
        '  float downY = bedv + uDepth * uDS;',
        '  float t = smoothstep(uDamX + 1.0, uDamX + 8.0, p.x);',
        '  float baseY = mix(upY, downY, t) + t * uFlood * 4.2;',
        '  float thick = baseY - bedv;',
        '  float wt = clamp(thick / (uDepth * 0.5 + 0.001), 0.0, 1.0);',
        '  float amp = uWave * (0.9 + uFlow * 0.5) * wt;',
        '  float y = baseY + (sin(p.x * 0.33 - uTime * (2.2 + uFlow * 4.0)) * 0.13 + cos(p.z * 0.41 + uTime * 1.7) * 0.09) * amp;',
        '  vWY = y; vTerr = aTerr; vPos = vec3(p.x, y, p.z);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, y, p.z, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float uTime,uFlow,uTurbid;',
        'varying float vWY; varying float vTerr; varying vec3 vPos;',
        'void main(){',
        '  float d = vWY - vTerr;',
        '  if (d <= 0.03) discard;',
        '  float dn = clamp(d / 5.5, 0.0, 1.0);',
        '  vec3 shal = mix(vec3(0.44,0.63,0.66), vec3(0.80,0.68,0.44), uTurbid);',
        '  vec3 deepc = mix(vec3(0.09,0.31,0.52), vec3(0.40,0.30,0.15), uTurbid);',
        '  vec3 col = mix(shal, deepc, dn);',
        '  float s = sin(vPos.x * 0.52 - uTime * (2.0 + uFlow * 7.0) + sin(vPos.z * 0.28) * 1.6);',
        '  col += smoothstep(0.82, 1.0, s) * (0.10 + uFlow * 0.10);',
        '  col += pow(1.0 - dn, 3.0) * 0.09;',
        '  float a = mix(0.60, 0.93, dn);',
        '  gl_FragColor = vec4(col, a);',
        '}'
      ].join('\n')
    })
    const water = new THREE.Mesh(geo, mat)
    water.frustumCulled = false
    this.root.add(water)
    return { geo, uniforms }
  }

  private buildRocks(): { mesh: THREE.InstancedMesh; data: BarrierLakeScene['rockData'] } {
    const RN = 480
    const rockGeo = new THREE.DodecahedronGeometry(1, 0)
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97, flatShading: true })
    const mesh = new THREE.InstancedMesh(rockGeo, rockMat, RN)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.root.add(mesh)

    const ROCK_COLS = [0x8a7d6b, 0x7b6a55, 0xa3865f, 0x6e5d49, 0x9c8a6e, 0x756551, 0xb0906a, 0x5f5142]
    const data: BarrierLakeScene['rockData'] = []
    const gauss = (): number => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5
    for (let i = 0; i < RN; i++) {
      const sx = DAM_X - 46 + Math.random() * 52
      const sz = -54 + Math.random() * 30
      const sy = terrainH(sx, sz, 0, 0) + 1.5
      const ex = DAM_X + gauss() * 11
      const ez = gauss() * 20
      let rsc = 0.4 + Math.pow(Math.random(), 0.7) * 2.4
      if (Math.random() < 0.06) rsc += 1.3
      data.push({
        sx,
        sy,
        sz,
        ex,
        ez,
        eyOff: -0.3 - Math.random() * 2.0,
        sc: rsc,
        sxr: 0.65 + Math.random() * 0.75,
        syr: 0.55 + Math.random() * 0.8,
        szr: 0.65 + Math.random() * 0.75,
        rx: Math.random() * 6.28,
        ry: Math.random() * 6.28,
        rz: Math.random() * 6.28,
        sp: 1.6 + Math.random() * 5.0,
        hop: 1.5 + Math.random() * 4.5,
        dl: Math.random() * 0.28,
        col: ROCK_COLS[(Math.random() * ROCK_COLS.length) | 0]
      })
    }
    for (let i = 0; i < RN; i++) mesh.setColorAt(i, new THREE.Color(data[i].col))
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    return { mesh, data }
  }

  private updateRocks(slide: number, dam: number): void {
    for (let i = 0; i < this.rockData.length; i++) {
      const r = this.rockData[i]
      const t = Math.max(0, Math.min(1, (slide - r.dl) / (1 - r.dl)))
      const te = t * t * (3 - 2 * t)
      const targetY = terrainH(r.ex, r.ez, dam, 0, slide) + r.eyOff
      const x = r.sx + (r.ex - r.sx) * te
      const z = r.sz + (r.ez - r.sz) * te
      const y = r.sy * (1 - te) + targetY * te + Math.sin(Math.PI * te) * r.hop * 0.55
      const sc = r.sc * (0.35 + 0.65 * Math.min(1, slide * 3))
      this._e.set(r.rx + t * r.sp, r.ry + t * r.sp * 0.6, r.rz + t * r.sp * 0.8)
      this._q.setFromEuler(this._e)
      this._v.set(x, y, z)
      this._s.set(sc * r.sxr, sc * r.syr, sc * r.szr)
      this._m4.compose(this._v, this._q, this._s)
      this.rocks.setMatrixAt(i, this._m4)
    }
    this.rocks.instanceMatrix.needsUpdate = true
    this.rocks.visible = slide > 0.02
  }

  private buildScar(): THREE.Mesh {
    const scarGeo = new THREE.PlaneGeometry(54, 30, 26, 16)
    const scar = new THREE.Mesh(
      scarGeo,
      new THREE.MeshStandardMaterial({ color: 0x7b5b3a, roughness: 1, transparent: true, opacity: 0, side: THREE.DoubleSide })
    )
    const p = scarGeo.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const x = DAM_X - 24 + p.getX(i)
      const z = -40 - p.getY(i)
      p.setXYZ(i, x, terrainH(x, z, 0, 0) + 0.35, z)
    }
    scarGeo.computeVertexNormals()
    this.root.add(scar)
    return scar
  }

  private buildCracks(): THREE.Group {
    const cracks = new THREE.Group()
    const points: Array<[number, number]> = [
      [-40, -46],
      [-32, -44],
      [-24, -42],
      [-16, -40]
    ]
    for (const c of points) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(15, 0.6, 0.9),
        new THREE.MeshBasicMaterial({ color: 0x2e2015, transparent: true, opacity: 0 })
      )
      m.position.set(DAM_X + c[0], terrainH(DAM_X + c[0], c[1], 0, 0) + 0.5, c[1])
      m.rotation.y = Math.random() * 0.3 - 0.15
      cracks.add(m)
    }
    this.root.add(cracks)
    return cracks
  }

  private buildRain(): { mesh: THREE.LineSegments; geo: THREE.BufferGeometry; mat: THREE.LineBasicMaterial } {
    const RN_DROP = 700
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(RN_DROP * 6)
    for (let i = 0; i < RN_DROP; i++) {
      const rx = -LX / 2 + Math.random() * LX
      const rz = -LZ / 2 + Math.random() * LZ
      const ry = Math.random() * 70
      pos[i * 6] = rx
      pos[i * 6 + 1] = ry
      pos[i * 6 + 2] = rz
      pos[i * 6 + 3] = rx
      pos[i * 6 + 4] = ry - 1.6
      pos[i * 6 + 5] = rz
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.LineBasicMaterial({ color: 0xaad8ef, transparent: true, opacity: 0 })
    const mesh = new THREE.LineSegments(geo, mat)
    mesh.frustumCulled = false
    this.root.add(mesh)
    return { mesh, geo, mat }
  }

  private buildFoam(): { mesh: THREE.Points; geo: THREE.BufferGeometry; mat: THREE.PointsMaterial } {
    const FN = 260
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(FN * 3)
    for (let i = 0; i < FN; i++) {
      pos[i * 3] = DAM_X + 4 + Math.random() * 95
      pos[i * 3 + 1] = 0
      pos[i * 3 + 2] = -16 + Math.random() * 32
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, transparent: true, opacity: 0, depthWrite: false })
    const mesh = new THREE.Points(geo, mat)
    mesh.frustumCulled = false
    this.root.add(mesh)
    return { mesh, geo, mat }
  }

  private drawLabel(sprite: THREE.Sprite, text: string, color: string): void {
    const fs = 34
    const pad = 15
    const cv = document.createElement('canvas')
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.font = '600 ' + fs + 'px "Microsoft YaHei","PingFang SC",sans-serif'
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2 + 14
    const h = fs + pad * 1.5
    cv.width = w
    cv.height = h
    const c2 = cv.getContext('2d')
    if (!c2) return
    const r = 10
    c2.fillStyle = 'rgba(10,18,25,0.86)'
    c2.strokeStyle = color
    c2.lineWidth = 2.5
    c2.beginPath()
    c2.moveTo(r, 0)
    c2.lineTo(w - r, 0)
    c2.quadraticCurveTo(w, 0, w, r)
    c2.lineTo(w, h - r)
    c2.quadraticCurveTo(w, h, w - r, h)
    c2.lineTo(r, h)
    c2.quadraticCurveTo(0, h, 0, h - r)
    c2.lineTo(0, r)
    c2.quadraticCurveTo(0, 0, r, 0)
    c2.closePath()
    c2.fill()
    c2.stroke()
    c2.fillStyle = color
    c2.fillRect(9, h * 0.24, 4, h * 0.52)
    c2.fillStyle = '#eaf3fa'
    c2.font = '600 ' + fs + 'px "Microsoft YaHei","PingFang SC",sans-serif'
    c2.textBaseline = 'middle'
    c2.fillText(text, 22, h / 2 + 1)
    const tex = new THREE.CanvasTexture(cv)
    tex.minFilter = THREE.LinearFilter
    const sm = sprite.material
    if (sm.map) sm.map.dispose()
    sm.map = tex
    sm.needsUpdate = true
    sprite.scale.set(w * 0.105, h * 0.105, 1)
  }

  private makeLabel(text: string, color: string): LabelObj {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }))
    this.drawLabel(sp, text, color)
    sp.renderOrder = 20
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.55, depthTest: false })
    )
    line.renderOrder = 19
    this.scene.add(sp)
    this.scene.add(line)
    return { sp, line, text, color, pos: new THREE.Vector3(), off: 6, on: false }
  }

  private buildLabels(): void {
    this.labels.valley = this.makeLabel('深切河谷（V形谷）', '#8fd0e8')
    this.labels.river = this.makeLabel('原河道水面', '#5fb6d8')
    this.labels.quake = this.makeLabel('地震 / 强降雨触发', '#e0644a')
    this.labels.crack = this.makeLabel('坡体拉裂 · 失稳', '#d8a24a')
    this.labels.slide = this.makeLabel('滑坡体高速下滑', '#d8a24a')
    this.labels.source = this.makeLabel('滑坡源区', '#c98a55')
    this.labels.dam = this.makeLabel('堰塞坝（松散堆积体）', '#d8a24a')
    this.labels.lake = this.makeLabel('堰塞湖 · 回水区', '#5fb6d8')
    this.labels.end = this.makeLabel('回水末端', '#8fd0e8')
    this.labels.dry = this.makeLabel('下游断流', '#c98a55')
    this.labels.spill = this.makeLabel('漫顶溢流 · 冲刷成槽', '#e0644a')
    this.labels.breach = this.makeLabel('溃口 · 库水骤泄', '#e0644a')
    this.labels.flood = this.makeLabel('下游洪峰', '#e0644a')
    this.labels.stable = this.makeLabel('稳定湖盆 · 长期保存', '#62b183')
  }

  private setLabel(L: LabelObj, x: number, y: number, z: number, off: number): void {
    L.pos.set(x, y, z)
    L.sp.position.set(x, y + (off || L.off), z)
    const pa = L.line.geometry.getAttribute('position') as THREE.BufferAttribute
    pa.setXYZ(0, x, y + 0.3, z)
    pa.setXYZ(1, x, y + (off || L.off) - 0.6, z)
    pa.needsUpdate = true
  }

  private labelVisible(L: LabelObj, v: boolean): void {
    L.sp.visible = v
    L.line.visible = v
  }

  private handlePointerDown(e: PointerEvent): void {
    const cv = this.renderer.domElement
    cv.setPointerCapture(e.pointerId)
    this.pointers[e.pointerId] = { x: e.clientX, y: e.clientY }
    this.pCount++
    if (this.pCount === 1) {
      this.lastX = e.clientX
      this.lastY = e.clientY
      this.dragBtn = e.button
    }
    if (this.pCount === 2) {
      const ks = Object.keys(this.pointers)
      const a = this.pointers[+ks[0]]
      const b = this.pointers[+ks[1]]
      this.lastDist = Math.hypot(a.x - b.x, a.y - b.y)
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.pointers[e.pointerId]) return
    this.pointers[e.pointerId].x = e.clientX
    this.pointers[e.pointerId].y = e.clientY
    if (this.pCount === 2) {
      const ks = Object.keys(this.pointers)
      const a = this.pointers[+ks[0]]
      const b = this.pointers[+ks[1]]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.lastDist > 0) {
        this.camGoal.r = Math.max(55, Math.min(430, this.camGoal.r * (this.lastDist / d)))
        this.cam.r = this.camGoal.r
      }
      this.lastDist = d
      return
    }
    if (this.pCount === 1) {
      const dx = e.clientX - this.lastX
      const dy = e.clientY - this.lastY
      this.lastX = e.clientX
      this.lastY = e.clientY
      if (this.dragBtn === 2 || e.shiftKey) {
        const s = this.camGoal.r * 0.0016
        const ct = Math.cos(this.camGoal.theta)
        const stt = Math.sin(this.camGoal.theta)
        this.camGoal.tx += -dx * stt * s * 60 * 0.016
        this.camGoal.tz += dx * ct * s * 60 * 0.016
        this.camGoal.ty += dy * s * 60 * 0.016
        this.camGoal.tx = Math.max(-110, Math.min(110, this.camGoal.tx))
        this.camGoal.tz = Math.max(-60, Math.min(60, this.camGoal.tz))
        this.camGoal.ty = Math.max(-15, Math.min(45, this.camGoal.ty))
      } else {
        this.camGoal.theta -= dx * 0.005
        this.camGoal.phi = Math.max(0.14, Math.min(1.46, this.camGoal.phi - dy * 0.004))
      }
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.pointers[e.pointerId]) {
      delete this.pointers[e.pointerId]
      this.pCount = Math.max(0, this.pCount - 1)
    }
    if (this.pCount < 2) this.lastDist = 0
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault()
    this.camGoal.r = Math.max(55, Math.min(430, this.camGoal.r * (1 + Math.sign(e.deltaY) * 0.09)))
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'ArrowRight') {
      this.playing = false
      this.nextStep()
    } else if (e.key === 'ArrowLeft') {
      this.playing = false
      this.prevStep()
    }
  }

  private applyCamera(dt: number): void {
    if (this.spin) this.camGoal.theta += dt * 0.12
    const k = Math.min(1, dt * 6)
    this.cam.theta += (this.camGoal.theta - this.cam.theta) * k
    this.cam.phi += (this.camGoal.phi - this.cam.phi) * k
    this.cam.r += (this.camGoal.r - this.cam.r) * k
    this.cam.tx += (this.camGoal.tx - this.cam.tx) * k
    this.cam.ty += (this.camGoal.ty - this.cam.ty) * k
    this.cam.tz += (this.camGoal.tz - this.cam.tz) * k
    const sp = Math.sin(this.cam.phi)
    const cp = Math.cos(this.cam.phi)
    this.camera.position.set(
      this.cam.tx + this.cam.r * sp * Math.cos(this.cam.theta),
      this.cam.ty + this.cam.r * cp,
      this.cam.tz + this.cam.r * sp * Math.sin(this.cam.theta)
    )
    this.camera.lookAt(this.cam.tx, this.cam.ty, this.cam.tz)
  }

  private setView(theta: number, phi: number, r: number, tx: number, ty: number, tz: number): void {
    this.camGoal.theta = theta
    this.camGoal.phi = phi
    this.camGoal.r = r
    this.camGoal.tx = tx
    this.camGoal.ty = ty
    this.camGoal.tz = tz
  }

  private easeInOut(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  }

  gotoStep(i: number, instant = false): void {
    this.cur = Math.max(0, Math.min(STEPS.length - 1, i))
    for (const k of PKEYS) {
      this.fromSt[k] = this.st[k]
      this.toSt[k] = STEPS[this.cur].p[k]
    }
    this.animT = instant ? 1 : 0
    this.animDur = instant ? 0.001 : STEPS[this.cur].dur
    if (instant) for (const k of PKEYS) this.st[k] = this.toSt[k]
    this.playTimer = 0
    this.callbacks.onStepChange(this.cur)
  }

  nextStep(): void {
    if (this.cur < STEPS.length - 1) this.gotoStep(this.cur + 1)
    else {
      this.playing = false
      this.callbacks.onStepChange(this.cur)
    }
  }

  prevStep(): void {
    if (this.cur > 0) this.gotoStep(this.cur - 1)
  }

  reset(): void {
    this.playing = false
    this.gotoStep(0)
    this.setView(-1.42, 0.82, 240, 0, 2, 0)
  }

  setPlaying(on: boolean): void {
    this.playing = on
    if (on && this.cur === STEPS.length - 1) this.gotoStep(0)
    this.playTimer = 0
  }

  isPlaying(): boolean {
    return this.playing
  }

  getCurrentStep(): number {
    return this.cur
  }

  setLabels(on: boolean): void {
    this.labelOn = on
  }

  setSpin(on: boolean): void {
    this.spin = on
  }

  setRainManual(on: boolean): void {
    this.rainManual = on
  }

  setViewPreset(id: number): void {
    if (id === 1) this.setView(-1.42, 0.34, 265, 0, 2, 0)
    else if (id === 2) this.setView(-1.57, 1.16, 205, 0, 2, 0)
    else if (id === 3) this.setView(-1.05, 1.12, 105, 12, 6, 0)
    else if (id === 4) this.setView(2.88, 1.02, 150, 10, 4, 0)
  }

  private resize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private frame = (now: number): void => {
    if (this.disposed) return
    this.rafId = requestAnimationFrame(this.frame)
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.time += dt

    if (this.animT < 1) {
      this.animT = Math.min(1, this.animT + dt / this.animDur)
      const e = this.easeInOut(this.animT)
      for (const k of PKEYS) {
        this.st[k] = this.fromSt[k] + (this.toSt[k] - this.fromSt[k]) * e
      }
    }
    if (this.playing) {
      this.playTimer += dt
      if (this.playTimer > STEPS[this.cur].dur + 1.9) this.nextStep()
    }

    if (
      Math.abs(this.st.dam - this.lastDam) > 0.004 ||
      Math.abs(this.st.breach - this.lastBreach) > 0.002 ||
      Math.abs(this.st.slide - this.lastSlide) > 0.004
    ) {
      this.updateTerrain(this.st.dam, this.st.breach, this.st.slide)
    }

    this.updateRocks(this.st.slide, this.st.dam)

    this.wUniforms.uTime.value = this.time
    this.wUniforms.uLevel.value = this.st.level
    this.wUniforms.uDepth.value = this.st.depth
    this.wUniforms.uDS.value = this.st.ds
    this.wUniforms.uFlood.value = this.st.flood
    this.wUniforms.uFlow.value = this.st.flow
    this.wUniforms.uTurbid.value = this.st.turbid
    this.wUniforms.uWave.value = this.st.wave

    const q = this.st.quake
    if (q > 0.01) {
      const amp = q * 0.55
      this.root.position.x = (Math.random() - 0.5) * amp
      this.root.position.y = (Math.random() - 0.5) * amp * 0.7
      this.root.position.z = (Math.random() - 0.5) * amp
      this.flashT = 0.35 + Math.random() * 0.45
    } else {
      this.root.position.x += (0 - this.root.position.x) * Math.min(1, dt * 8)
      this.root.position.y += (0 - this.root.position.y) * Math.min(1, dt * 8)
      this.root.position.z += (0 - this.root.position.z) * Math.min(1, dt * 8)
    }
    this.flashT = Math.max(0, this.flashT - dt * 2.2)
    if (this.flashEl) this.flashEl.style.opacity = (this.flashT * q * 0.9).toFixed(3)

    const rainAll = Math.min(1.4, this.st.rain + (this.rainManual ? 0.9 : 0))
    this.rainMat.opacity = Math.min(0.5, rainAll * 0.4)
    this.rain.visible = rainAll > 0.02
    if (this.rain.visible) {
      const rp = this.rainGeo.getAttribute('position').array as Float32Array
      const spd = 55 + rainAll * 45
      for (let i = 0; i < 700; i++) {
        const d = spd * dt
        rp[i * 6 + 1] -= d
        rp[i * 6 + 4] -= d
        if (rp[i * 6 + 4] < -18) {
          const nx = -LX / 2 + Math.random() * LX
          const nz = -LZ / 2 + Math.random() * LZ
          const ny = 62 + Math.random() * 22
          rp[i * 6] = nx
          rp[i * 6 + 1] = ny
          rp[i * 6 + 2] = nz
          rp[i * 6 + 3] = nx + 0.35
          rp[i * 6 + 4] = ny - 1.8
          rp[i * 6 + 5] = nz
        }
      }
      ;(this.rainGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    }

    this.foamMat.opacity = Math.min(0.85, this.st.flood * 0.9)
    this.foam.visible = this.st.flood > 0.05
    if (this.foam.visible) {
      const fp = this.foamGeo.getAttribute('position').array as Float32Array
      for (let i = 0; i < 260; i++) {
        fp[i * 3] += (7 + this.st.flow * 12) * dt
        const fx = fp[i * 3]
        const b = bed(fx)
        const wy = Math.max(b + this.st.depth, this.st.level)
        fp[i * 3 + 1] = wy + 0.25 + Math.sin(this.time * 6 + i) * 0.35
        if (fx > 128) {
          fp[i * 3] = DAM_X + 2 + Math.random() * 30
          fp[i * 3 + 2] = -16 + Math.random() * 32
        }
      }
      ;(this.foamGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    }

    const scarMat = this.scar.material as THREE.MeshStandardMaterial
    scarMat.opacity = Math.min(0.95, this.st.scar * 0.9)
    this.scar.visible = this.st.scar > 0.02
    for (const child of this.cracks.children) {
      const m = child as THREE.Mesh
      ;(m.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, this.st.scar * 0.85)
    }
    this.cracks.visible = this.st.scar > 0.02

    const show: Record<string, boolean> = {}
    for (const k of STEPS[this.cur].labels) show[k] = true
    const damTopY = terrainH(DAM_X, 0, this.st.dam, this.st.breach)
    const lakeY = Math.max(bed(-20) + this.st.depth, this.st.level)
    const endX = backwaterX(this.st.level, this.st.depth)
    if (show.valley) this.setLabel(this.labels.valley, -88, terrainH(-88, 0, this.st.dam, this.st.breach) + 1, 0, 9)
    if (show.river) this.setLabel(this.labels.river, -66, bed(-66) + this.st.depth + 0.4, 0, 7)
    if (show.quake) this.setLabel(this.labels.quake, DAM_X - 24, terrainH(DAM_X - 24, -34, 0, 0) + 22, -34, 8)
    if (show.crack) this.setLabel(this.labels.crack, DAM_X - 34, terrainH(DAM_X - 34, -45, 0, 0) + 3, -45, 8)
    if (show.source) this.setLabel(this.labels.source, DAM_X - 24, terrainH(DAM_X - 24, -40, 0, 0) + 4, -40, 9)
    if (show.slide) this.setLabel(this.labels.slide, DAM_X - 20, terrainH(DAM_X - 20, -18, this.st.dam, this.st.breach) + 6, -18, 9)
    if (show.dam) this.setLabel(this.labels.dam, DAM_X, damTopY + 1.5, 0, 8)
    if (show.lake) this.setLabel(this.labels.lake, -18, lakeY + 1, 0, 8)
    if (show.end) this.setLabel(this.labels.end, endX, Math.max(bed(endX) + this.st.depth, this.st.level) + 0.6, 0, 7)
    if (show.dry) this.setLabel(this.labels.dry, 86, bed(86) + 1.0, 0, 6)
    if (show.spill) this.setLabel(this.labels.spill, DAM_X, damTopY + 3.5, 0, 9)
    if (show.breach) this.setLabel(this.labels.breach, DAM_X + 4, terrainH(DAM_X + 4, 0, this.st.dam, this.st.breach) + 3, 0, 9)
    if (show.flood) this.setLabel(this.labels.flood, 104, bed(104) + this.st.depth + this.st.flood * 4.2 + 1.5, 0, 7)
    if (show.stable) this.setLabel(this.labels.stable, -22, Math.max(bed(-22) + this.st.depth, this.st.level) + 1, 0, 9)
    for (const lk in this.labels) this.labelVisible(this.labels[lk], this.labelOn && !!show[lk])

    this.applyCamera(dt)
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.rafId)
    this.observer?.disconnect()
    this.observer = null
    const cv = this.renderer.domElement
    cv.removeEventListener('pointerdown', this.onPointerDown)
    cv.removeEventListener('pointermove', this.onPointerMove)
    cv.removeEventListener('pointerup', this.onPointerUp)
    cv.removeEventListener('pointercancel', this.onPointerUp)
    cv.removeEventListener('contextmenu', this.onContextMenu)
    cv.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('keydown', this.onKeyDown)
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((m) => this.disposeMaterial(m))
      else if (mat) this.disposeMaterial(mat)
    })
    this.renderer.dispose()
    if (cv.parentElement === this.container) this.container.removeChild(cv)
  }

  private disposeMaterial(mat: THREE.Material): void {
    const m = mat as THREE.Material & { map?: THREE.Texture | null; normalMap?: THREE.Texture | null; displacementMap?: THREE.Texture | null }
    for (const key of ['map', 'normalMap', 'displacementMap'] as const) {
      const tex = m[key]
      if (tex) tex.dispose()
    }
    mat.dispose()
  }
}
