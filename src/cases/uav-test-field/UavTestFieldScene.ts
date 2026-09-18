import * as THREE from 'three'

export type CraftKind = 'uav' | 'plane'
export type VerdictKind = 'run' | 'pass' | 'warn' | 'fail'

export interface UavSubjectMeta {
  id: string
  name: string
  clause: string
  cat: string
  desc: string
  free?: boolean
  no?: number
}

export interface UavHudState {
  craft: string
  status: string
  alt: number
  manual: boolean
}

export interface UavSubjectState {
  id: string
  name: string
  clause: string
  desc: string
}

export interface UavTestCallbacks {
  onHud?: (s: UavHudState) => void
  onSubject?: (s: UavSubjectState | null) => void
  onMetrics?: (html: string) => void
  onVerdict?: (text: string, kind: VerdictKind) => void
}

export const UAV_CAT_ORDER = ['总览', '空域安全管控类', '结构与能源安全类', '飞行性能与电磁类', '通用要求']

/** 测试科目元数据（用于侧边栏渲染，构建逻辑在场景类内） */
export const UAV_SUBJECTS: UavSubjectMeta[] = [
  { id: 'free', name: '自由飞行（试飞场总览）', clause: '', cat: '总览', free: true, desc: '' },
  {
    id: 'fence',
    no: 1,
    name: '电子围栏',
    clause: '5.1',
    cat: '空域安全管控类',
    desc: '验证内置禁飞/限飞区数据库：无人机接近或进入特定地理范围时，向操作员发出通知/警告，并自动执行飞行预案（阻止起飞、限制高度、悬停、降落、返航等）。'
  },
  {
    id: 'remote',
    no: 2,
    name: '远程识别',
    clause: '5.2',
    cat: '空域安全管控类',
    desc: '无人机飞行中通过 Wi-Fi/蓝牙广播识别信息（身份、位置、高度、速度、时间），并向综合监管服务平台报送，便于监管与溯源。'
  },
  {
    id: 'emergency',
    no: 3,
    name: '应急处置',
    clause: '5.3',
    cat: '空域安全管控类',
    desc: '飞行中遇链路丢失、电量/动力不足等突发状况，应具备悬停/空中盘旋、返航、降落、开伞等一种或多种处置能力；导航失效时需向操作员预警。'
  },
  {
    id: 'struct',
    no: 4,
    name: '结构强度',
    clause: '5.4',
    cat: '结构与能源安全类',
    desc: '在承受规定载荷时结构不产生有害变形；承受最大起飞重量 1.33 倍载荷时，主要承力结构不被破坏。'
  },
  {
    id: 'body',
    no: 5,
    name: '机体结构',
    clause: '5.5',
    cat: '结构与能源安全类',
    desc: '机体及部件不应有锐边，避免划伤或刺伤用户；无桨叶保护罩的无人机桨叶禁止金属材质，桨尖需圆角。'
  },
  {
    id: 'drop',
    no: 6,
    name: '整机跌落',
    clause: '5.6',
    cat: '结构与能源安全类',
    desc: '锂离子电池电量调至满电 30%±2%，从 10 m 高度自由垂直跌落，机体结构与电池包不得发生爆炸、起火。'
  },
  {
    id: 'power',
    no: 7,
    name: '动力能源系统',
    clause: '5.7',
    cat: '结构与能源安全类',
    desc: '电池包具备防短路、防过充、防过放、过压、过流、过温等保护；异常时不起火、不爆炸、不漏液。'
  },
  {
    id: 'control',
    no: 8,
    name: '可控性',
    clause: '5.8',
    cat: '飞行性能与电磁类',
    desc: '飞控具备最大高度/速度/姿态限制；悬停精度、航迹精度、定位导航精度满足指标（多旋翼悬停 RMS ≤ 2m，自动返航降落点 ≤ 5m）。'
  },
  {
    id: 'antierr',
    no: 9,
    name: '防差错',
    clause: '5.9',
    cat: '飞行性能与电磁类',
    desc: '电池、电机、桨叶等可拆卸部件，机械接口应有防错结构或标识，防止装反、错装；软件防误操作、防非法改装。'
  },
  {
    id: 'sense',
    no: 10,
    name: '感知和避让',
    clause: '5.10',
    cat: '飞行性能与电磁类',
    desc: '无桨叶保护罩的轻型/小型无人机必须具备障碍物感知、告警与自动悬停/避让/降落能力。障碍物正面面积 ≥ 2㎡，纹理丰富。'
  },
  {
    id: 'datalink',
    no: 11,
    name: '数据链保护',
    clause: '5.11',
    cat: '飞行性能与电磁类',
    desc: '控制/数据链路应具备加密能力、防劫持能力；链路中断后自动重连并状态同步；复杂电磁环境下传输稳定，指令防篡改。'
  },
  {
    id: 'emc',
    no: 12,
    name: '电磁兼容性',
    clause: '5.12',
    cat: '飞行性能与电磁类',
    desc: '在真实电磁环境中安全工作且不干扰外部设备；按 GB/T 38909 开展辐射发射、辐射抗扰、静电放电、工频磁场抗扰等试验。'
  },
  {
    id: 'wind',
    no: 13,
    name: '抗风性',
    clause: '5.13',
    cat: '飞行性能与电磁类',
    desc: '旋翼类无人机在飞行控制参与下，承受持续风与阵风时保持姿态可控、不倾覆。轻型起降抗 3 级风、飞行抗 4 级风（按 GB/T 38930）。'
  },
  {
    id: 'noise',
    no: 14,
    name: '噪声',
    clause: '5.14',
    cat: '飞行性能与电磁类',
    desc: '旋翼无人机需在说明书/铭牌标注距机体 1 m 处 A 计权声压级，分别标注悬停与典型飞行速度工况及测试环境。'
  },
  {
    id: 'lights',
    no: 15,
    name: '灯光',
    clause: '5.15',
    cat: '飞行性能与电磁类',
    desc: '轻型/小型无人机须安装航向灯；夜间空中 120 m 肉眼可见；航向灯采用红/白/绿等与其他用途灯光交替闪烁，且不与他灯同色。'
  },
  {
    id: 'mark',
    no: 16,
    name: '标识',
    clause: '5.16',
    cat: '通用要求',
    desc: '机身不可拆分部位与外包装须清晰耐久标识唯一产品识别码；外包装印刷安全飞行警示；机身标注微型/轻型/小型分类符号，无需工具即可查看。'
  },
  {
    id: 'manual',
    no: 17,
    name: '使用说明书',
    clause: '5.17',
    cat: '通用要求',
    desc: '须提供纸质或电子说明书，包含操作程序、安全使用规则、故障处理、环境适应性警示（雷暴/台风等）与安全警示图标，内容完整规范。'
  }
]

interface SubjectInstance {
  root: THREE.Group
  update?: (dt: number, t: number) => void
  dispose?: () => void
}

interface ActiveSubject {
  id: string
  name: string
  label: string
  root: THREE.Group | null
  update: ((dt: number, t: number) => void) | null
  dispose: (() => void) | null
}

const HORIZON = new THREE.Color(0xcfe4ff)

/** 无人机试飞场三维场景：园区建模、自由飞行 / 手动操控与 GB 42590 测试科目演示。 */
export class UavTestFieldScene {
  private readonly container: HTMLElement
  private readonly callbacks: UavTestCallbacks
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly clock = new THREE.Clock()
  private readonly observer: ResizeObserver

  private readonly sun: THREE.DirectionalLight
  private readonly hemi: THREE.HemisphereLight
  private readonly ambient: THREE.AmbientLight

  private rafId = 0
  private disposed = false

  private readonly lightMats: THREE.MeshStandardMaterial[] = []
  private readonly eqDyn: { radar?: THREE.Object3D; anemo?: THREE.Object3D; vane?: THREE.Object3D } = {}
  private readonly siteDyn: { flag?: THREE.Object3D } = {}
  private readonly clouds: THREE.Group[] = []

  private readonly uav: THREE.Group
  private readonly plane: THREE.Group
  private craft: THREE.Group
  private craftKind: CraftKind = 'uav'
  private activeCurve: THREE.CatmullRomCurve3
  private trail: THREE.Mesh | null = null

  private readonly uavCurve: THREE.CatmullRomCurve3
  private readonly planeCurve: THREE.CatmullRomCurve3

  private M!: Record<string, THREE.MeshStandardMaterial>
  private concrete!: THREE.MeshStandardMaterial
  private fenceSteel!: THREE.MeshStandardMaterial
  private netMat!: THREE.MeshStandardMaterial

  private manual = false
  private yaw = 0
  private readonly vel = new THREE.Vector3()
  private inMoveX = 0
  private inMoveZ = 0
  private inAlt = 0
  private inYaw = 0
  private autoT = 0
  private readonly dummy = new THREE.Object3D()
  private readonly tmpV = new THREE.Vector3()
  private readonly fwd = new THREE.Vector3()
  private readonly rgt = new THREE.Vector3()
  private readonly keys: Record<string, boolean> = {}

  private readonly cam = { theta: 0, phi: 0, r: 90, tx: 0, ty: 5, tz: 14, gtheta: 0, gphi: 0, gr: 90 }
  private readonly pointers = new Map<number, { x: number; y: number }>()
  private lastX = 0
  private lastY = 0
  private dragBtn = -1
  private lastDist = 0

  private subjects: Record<string, () => SubjectInstance> = {}
  private readonly testZone = new THREE.Vector3(-20, 0, 16)
  private currentSubject: ActiveSubject | null = null

  private pendingMetrics = '<span style="color:#9fb3c8">初始化测试场景…</span>'
  private pendingVerdict: { text: string; kind: VerdictKind } = { text: '测试中', kind: 'run' }
  private lastEmit = 0

  private readonly onPointerDown: (e: PointerEvent) => void
  private readonly onPointerMove: (e: PointerEvent) => void
  private readonly onPointerUp: (e: PointerEvent) => void
  private readonly onWheel: (e: WheelEvent) => void
  private readonly onContextMenu: (e: Event) => void
  private readonly onKeyDown: (e: KeyboardEvent) => void
  private readonly onKeyUp: (e: KeyboardEvent) => void

  constructor(container: HTMLElement, callbacks: UavTestCallbacks = {}) {
    this.container = container
    this.callbacks = callbacks
    const W = container.clientWidth || 800
    const H = container.clientHeight || 600

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(W, H)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    const cv = this.renderer.domElement
    cv.style.display = 'block'
    cv.style.width = '100%'
    cv.style.height = '100%'
    cv.style.touchAction = 'none'
    container.appendChild(cv)

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(HORIZON, 140, 360)

    this.camera = new THREE.PerspectiveCamera(55, W / H, 0.5, 2000)

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a5f3a, 0.9)
    this.scene.add(this.hemi)
    this.ambient = new THREE.AmbientLight(0xffffff, 0.25)
    this.scene.add(this.ambient)
    this.sun = new THREE.DirectionalLight(0xfff4e6, 2.6)
    this.sun.position.set(85, 140, 60)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 420
    this.sun.shadow.camera.left = -140
    this.sun.shadow.camera.right = 140
    this.sun.shadow.camera.top = 140
    this.sun.shadow.camera.bottom = -140
    this.sun.shadow.bias = -0.0004
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)

    this.buildMaterials()
    this.buildGround()
    this.buildSky()
    this.addRunway()
    this.addPad()
    this.addHangar()
    this.addEquipment()
    this.buildSite()
    this.addTrees()
    this.buildClouds()

    this.uav = this.createDrone()
    this.uav.userData.groundY = 0.6
    this.uav.userData.loop = 52
    this.uav.visible = true
    this.scene.add(this.uav)

    this.plane = this.createPlane()
    this.plane.userData.groundY = 1.4
    this.plane.userData.loop = 70
    this.plane.visible = false
    this.scene.add(this.plane)

    this.craft = this.uav

    const pathPoints = [
      new THREE.Vector3(-38, 0.6, 0),
      new THREE.Vector3(28, 0.6, 0),
      new THREE.Vector3(34, 5, -3),
      new THREE.Vector3(34, 20, -28),
      new THREE.Vector3(0, 23, -50),
      new THREE.Vector3(-38, 21, -28),
      new THREE.Vector3(-44, 19, 6),
      new THREE.Vector3(-18, 16, 32),
      new THREE.Vector3(0, 9, 35),
      new THREE.Vector3(0, 0.6, 34),
      new THREE.Vector3(-22, 0.6, 18)
    ]
    const planePathPoints = [
      new THREE.Vector3(-42, 1.4, 1),
      new THREE.Vector3(28, 1.4, -1),
      new THREE.Vector3(40, 9, -10),
      new THREE.Vector3(46, 24, -44),
      new THREE.Vector3(4, 27, -72),
      new THREE.Vector3(-50, 25, -34),
      new THREE.Vector3(-54, 20, 22),
      new THREE.Vector3(-22, 16, 46),
      new THREE.Vector3(-46, 9, 12),
      new THREE.Vector3(-40, 1.4, -1)
    ]
    this.uavCurve = new THREE.CatmullRomCurve3(pathPoints, true, 'catmullrom', 0.5)
    this.planeCurve = new THREE.CatmullRomCurve3(planePathPoints, true, 'catmullrom', 0.5)
    this.activeCurve = this.uavCurve
    this.rebuildTrail()

    this.buildTestZone()
    this.buildSubjects()

    // 相机初始位姿：position(58,44,70) → target(0,5,14)
    this.cam.tx = 0
    this.cam.ty = 5
    this.cam.tz = 14
    this.cam.gtheta = 0.803
    this.cam.gphi = 1.119
    this.cam.gr = 90
    this.cam.theta = this.cam.gtheta
    this.cam.phi = this.cam.gphi
    this.cam.r = this.cam.gr
    this.applyCam()

    this.onPointerDown = (e) => this.handlePointerDown(e)
    this.onPointerMove = (e) => this.handlePointerMove(e)
    this.onPointerUp = (e) => this.handlePointerUp(e)
    this.onWheel = (e) => this.handleWheel(e)
    this.onContextMenu = (e) => e.preventDefault()
    this.onKeyDown = (e) => this.handleKeyDown(e)
    this.onKeyUp = (e) => {
      this.keys[e.code] = false
    }

    cv.addEventListener('pointerdown', this.onPointerDown)
    cv.addEventListener('pointermove', this.onPointerMove)
    cv.addEventListener('pointerup', this.onPointerUp)
    cv.addEventListener('pointercancel', this.onPointerUp)
    cv.addEventListener('contextmenu', this.onContextMenu)
    cv.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(container)
    this.resize()

    this.emit(true)
    this.rafId = requestAnimationFrame(this.frame)
  }

  /* ============================ 材质与基础场景 ============================ */
  private buildMaterials(): void {
    this.M = {
      steel: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.7, roughness: 0.45 }),
      steelDark: new THREE.MeshStandardMaterial({ color: 0x5b626b, metalness: 0.7, roughness: 0.5 }),
      white: new THREE.MeshStandardMaterial({ color: 0xeef2f6, metalness: 0.1, roughness: 0.7 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xffd23f, metalness: 0.2, roughness: 0.5 }),
      blue: new THREE.MeshStandardMaterial({ color: 0x1f6feb, metalness: 0.3, roughness: 0.5 }),
      red: new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff2a20, emissiveIntensity: 0.6 })
    }
    this.concrete = new THREE.MeshStandardMaterial({ color: 0xbfc4cb, roughness: 0.9 })
    this.fenceSteel = new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.6, roughness: 0.5 })
    this.netMat = new THREE.MeshStandardMaterial({
      color: 0x2b3038,
      roughness: 0.85,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide
    })
  }

  private makeGroundTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#4a7a43'
    ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 2600; i += 1) {
      const x = Math.random() * 256
      const y = Math.random() * 256
      const g = 60 + Math.random() * 70
      ctx.fillStyle = `rgba(${30 + Math.random() * 30},${g},${35 + Math.random() * 25},0.5)`
      ctx.fillRect(x, y, 2, 2)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(60, 60)
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    return tex
  }

  private buildGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(800, 800),
      new THREE.MeshStandardMaterial({ map: this.makeGroundTexture(), roughness: 1.0, metalness: 0.0 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    this.scene.add(ground)

    const grid = new THREE.GridHelper(800, 160, 0x2f5a30, 0x21501f)
    grid.position.y = 0.02
    grid.material.transparent = true
    grid.material.opacity = 0.22
    this.scene.add(grid)
  }

  private buildSky(): void {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(700, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          top: { value: new THREE.Color(0x2f6fd0) },
          bottom: { value: HORIZON.clone() },
          offset: { value: 60 },
          exponent: { value: 0.55 }
        },
        vertexShader: `
          varying vec3 vWorld;
          void main(){
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 top; uniform vec3 bottom; uniform float offset; uniform float exponent;
          varying vec3 vWorld;
          void main(){
            float h = normalize(vWorld + vec3(0.0, offset, 0.0)).y;
            float t = pow(max(h, 0.0), exponent);
            gl_FragColor = vec4(mix(bottom, top, clamp(t, 0.0, 1.0)), 1.0);
          }`
      })
    )
    this.scene.add(sky)
  }

  /* ============================ 跑道 / 起降场 / 机库 ============================ */
  private addRunway(): void {
    const grp = new THREE.Group()
    const asphalt = new THREE.Mesh(
      new THREE.BoxGeometry(78, 0.3, 10),
      new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.95, metalness: 0.0 })
    )
    asphalt.position.y = 0.15
    asphalt.receiveShadow = true
    grp.add(asphalt)

    const lineMat = new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.6 })
    for (const z of [-4.6, 4.6]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(76, 0.05, 0.3), lineMat)
      edge.position.set(0, 0.31, z)
      grp.add(edge)
    }
    for (let x = -34; x <= 34; x += 6) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(3, 0.05, 0.3), lineMat)
      dash.position.set(x, 0.31, 0)
      grp.add(dash)
    }
    for (let x = -36; x <= 36; x += 6) {
      for (const z of [-5.2, 5.2]) {
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6),
          new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
        )
        pole.position.set(x, 0.3, z)
        grp.add(pole)
        const bulb = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 10, 10),
          new THREE.MeshStandardMaterial({ color: 0xffcc33, emissive: 0xffaa00, emissiveIntensity: 1.0 })
        )
        bulb.position.set(x, 0.65, z)
        grp.add(bulb)
        this.lightMats.push(bulb.material)
      }
    }
    this.scene.add(grp)
  }

  private addPad(): void {
    const grp = new THREE.Group()
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6, 0.2, 48),
      new THREE.MeshStandardMaterial({ color: 0x2f343b, roughness: 0.9 })
    )
    pad.position.set(0, 0.1, 34)
    pad.receiveShadow = true
    grp.add(pad)

    const ringMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffcc00, emissiveIntensity: 0.5 })
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.18, 10, 60), ringMat)
    ring.rotation.x = Math.PI / 2
    ring.position.set(0, 0.21, 34)
    grp.add(ring)

    const hMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffcc00, emissiveIntensity: 0.4 })
    const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 2.4), hMat)
    h1.position.set(-1.2, 0.22, 34)
    const h2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 2.4), hMat)
    h2.position.set(1.2, 0.22, 34)
    const h3 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.05, 0.6), hMat)
    h3.position.set(0, 0.22, 34)
    grp.add(h1, h2, h3)

    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2
      const x = Math.cos(a) * 5.6
      const z = 34 + Math.sin(a) * 5.6
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
      )
      pole.position.set(x, 0.3, z)
      grp.add(pole)
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0x33ff88, emissive: 0x22ff77, emissiveIntensity: 1.0 })
      )
      bulb.position.set(x, 0.65, z)
      grp.add(bulb)
      this.lightMats.push(bulb.material)
    }
    this.scene.add(grp)
  }

  private addHangar(): void {
    const cx = 12
    const cz = 16
    const W = 18
    const H = 7
    const D = 14
    const grp = new THREE.Group()

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xd2d6dc, roughness: 0.85, metalness: 0.05 })
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.5, metalness: 0.4 })
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x26292f, roughness: 0.95 })
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x3a6ea5,
      roughness: 0.2,
      metalness: 0.3,
      emissive: 0x16314d,
      emissiveIntensity: 0.4
    })
    const signMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffcc00, emissiveIntensity: 0.5 })

    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.3, D), new THREE.MeshStandardMaterial({ color: 0x9a9ea3, roughness: 1 }))
    floor.position.set(cx, 0.15, cz)
    floor.receiveShadow = true
    grp.add(floor)

    const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.4), wallMat)
    back.position.set(cx, H / 2, cz + D / 2)
    back.castShadow = true
    back.receiveShadow = true
    grp.add(back)
    const interior = new THREE.Mesh(new THREE.BoxGeometry(W - 0.6, H - 0.6, 0.2), darkMat)
    interior.position.set(cx, H / 2, cz + D / 2 - 0.3)
    grp.add(interior)

    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.4, H, D), wallMat)
      side.position.set(cx + (s * W) / 2, H / 2, cz)
      side.castShadow = true
      side.receiveShadow = true
      grp.add(side)
      for (let i = -1; i <= 1; i += 1) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 2.4), glassMat)
        win.position.set(cx + s * (W / 2 - 0.2), 3.6, cz + i * 3.5)
        grp.add(win)
      }
    }

    const jambW = (W - 10) / 2
    for (const s of [-1, 1]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(jambW, H, 0.4), wallMat)
      jamb.position.set(cx + s * (W / 2 - jambW / 2), H / 2, cz - D / 2)
      jamb.castShadow = true
      jamb.receiveShadow = true
      grp.add(jamb)
    }

    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(W / 2, W / 2, D, 28, 1, true, Math.PI / 2, Math.PI),
      roofMat
    )
    roof.rotation.x = Math.PI / 2
    roof.position.set(cx, H, cz)
    roof.castShadow = true
    roof.receiveShadow = true
    grp.add(roof)

    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 3.4), signMat)
    sign.position.set(cx - W / 2 + 0.25, 4.2, cz - D / 2 - 0.05)
    grp.add(sign)

    const parked = this.createDrone()
    parked.position.set(cx, 0.6, cz + 2)
    parked.rotation.y = Math.PI
    for (const p of parked.userData.props as THREE.Group[]) p.rotation.y = 0.4
    grp.add(parked)

    this.scene.add(grp)
  }

  /* ============================ 通导监气反设备 ============================ */
  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  /** 文字标签（始终面向相机的 Sprite） */
  private makeLabel(text: string, bg?: string): THREE.Sprite {
    const fs = 46
    const pad = 14
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')!
    const font = `bold ${fs}px "PingFang SC","Microsoft YaHei",sans-serif`
    ctx.font = font
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2
    const h = fs + pad * 2
    c.width = w
    c.height = h
    ctx.font = font
    ctx.fillStyle = bg || 'rgba(18,26,38,0.85)'
    this.roundRect(ctx, 0, 0, w, h, 16)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 3
    this.roundRect(ctx, 2, 2, w - 4, h - 4, 14)
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, w / 2, h / 2 + 2)
    const tex = new THREE.CanvasTexture(c)
    tex.anisotropy = 4
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
    spr.scale.set(w / 26, h / 26, 1)
    spr.renderOrder = 999
    return spr
  }

  private addLabel(group: THREE.Object3D, text: string, y: number, bg?: string): void {
    const l = this.makeLabel(text, bg)
    l.position.set(0, y, 0)
    group.add(l)
  }

  private commTower(): THREE.Group {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.1, 14, 4), this.M.steel)
    body.position.y = 7
    body.castShadow = true
    body.receiveShadow = true
    g.add(body)
    for (let y = 2.5; y <= 13; y += 2.4) {
      const r = 1.1 - (1.1 - 0.45) * (y / 14)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 6, 4), this.M.steelDark)
      ring.rotation.x = Math.PI / 2
      ring.position.y = y
      g.add(ring)
    }
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.7, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), this.M.white)
    dish.rotation.x = Math.PI
    dish.position.y = 14.4
    dish.castShadow = true
    g.add(dish)
    const feedArm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 8), this.M.steelDark)
    feedArm.position.set(0, 14.9, 0.6)
    feedArm.rotation.x = Math.PI / 2.3
    g.add(feedArm)
    const feed = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), this.M.steelDark)
    feed.position.set(0, 15.3, 1.0)
    g.add(feed)
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 8), this.M.steelDark)
    rod.position.y = 15.6
    g.add(rod)
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), this.M.red)
    tip.position.y = 16.7
    g.add(tip)
    this.lightMats.push(tip.material)
    this.addLabel(g, '通信塔', 18.2)
    return g
  }

  private navStation(): THREE.Group {
    const g = new THREE.Group()
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 1.4), this.M.white)
    box.position.y = 0.6
    box.castShadow = true
    box.receiveShadow = true
    g.add(box)
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 1.1), this.M.blue)
    panel.position.set(0, 1.35, 1.0)
    panel.rotation.x = -0.5
    panel.castShadow = true
    g.add(panel)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 12), this.M.steel)
    pole.position.y = 3.7
    pole.castShadow = true
    g.add(pole)
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.9, 16), this.M.yellow)
    ant.position.y = 6.55
    g.add(ant)
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), this.M.yellow)
    knob.position.y = 7.05
    g.add(knob)
    for (const dx of [-0.4, 0.4]) {
      const a = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8), this.M.steelDark)
      a.position.set(dx, 5.4, 0)
      g.add(a)
    }
    this.addLabel(g, '导航基站', 8.0)
    return g
  }

  private radarTower(): THREE.Group {
    const g = new THREE.Group()
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.9, 1.6, 16), this.M.steelDark)
    base.position.y = 0.8
    base.castShadow = true
    base.receiveShadow = true
    g.add(base)
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 10, 12), this.M.steel)
    mast.position.y = 6.6
    mast.castShadow = true
    g.add(mast)
    const head = new THREE.Group()
    head.position.y = 12
    g.add(head)
    const rad = new THREE.Mesh(new THREE.SphereGeometry(2.2, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.45), this.M.white)
    rad.rotation.x = Math.PI
    rad.castShadow = true
    head.add(rad)
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.3, 8), this.M.steelDark)
    strut.position.set(0, 0, 1.1)
    strut.rotation.x = Math.PI / 2.2
    head.add(strut)
    const camArm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8), this.M.steelDark)
    camArm.position.set(0.7, 11.4, 0)
    camArm.rotation.z = Math.PI / 2.4
    g.add(camArm)
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.6), this.M.steelDark)
    cam.position.set(1.4, 11.0, 0)
    g.add(cam)
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 12), this.M.blue)
    lens.rotation.x = Math.PI / 2
    lens.position.set(1.7, 11.0, 0)
    g.add(lens)
    this.addLabel(g, '监视雷达', 15.2)
    this.eqDyn.radar = head
    return g
  }

  private metStation(): THREE.Group {
    const g = new THREE.Group()
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), this.M.white)
    box.position.y = 0.6
    box.castShadow = true
    box.receiveShadow = true
    g.add(box)
    for (let i = -1; i <= 1; i += 1) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.12, 0.06), this.M.steelDark)
      slat.position.set(0, 0.6 + i * 0.3, 0.61)
      g.add(slat)
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 6, 12), this.M.steel)
    pole.position.y = 3.6
    pole.castShadow = true
    g.add(pole)
    const anemo = new THREE.Group()
    anemo.position.y = 6.5
    g.add(anemo)
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), this.M.steelDark)
    anemo.add(hub)
    for (let i = 0; i < 3; i += 1) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.05), this.M.steelDark)
      arm.position.x = 0.55
      arm.rotation.y = (i * Math.PI * 2) / 3
      anemo.add(arm)
      const cup = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), this.M.white)
      cup.position.set(1.1, 0, 0)
      cup.rotation.y = (i * Math.PI * 2) / 3
      anemo.add(cup)
    }
    const vane = new THREE.Group()
    vane.position.y = 5.6
    g.add(vane)
    const vshaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 8), this.M.steelDark)
    vshaft.position.y = 0.5
    vane.add(vshaft)
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6, 12), this.M.red)
    arrow.rotation.x = Math.PI / 2
    arrow.position.z = 0.5
    vane.add(arrow)
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.05), this.M.white)
    tail.position.z = -0.5
    vane.add(tail)
    this.addLabel(g, '气象站', 8.2)
    this.eqDyn.anemo = anemo
    this.eqDyn.vane = vane
    return g
  }

  private counterTower(): THREE.Group {
    const g = new THREE.Group()
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.7, 1.4, 16), this.M.steelDark)
    base.position.y = 0.7
    base.castShadow = true
    base.receiveShadow = true
    g.add(base)
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 9, 12), this.M.steel)
    mast.position.y = 6
    mast.castShadow = true
    g.add(mast)
    for (let i = 0; i < 4; i += 1) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.2, 1.2), this.M.white)
      panel.position.set(0, 9 + i * 0.7, 0)
      panel.rotation.z = (i - 1.5) * 0.35
      panel.castShadow = true
      g.add(panel)
    }
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.M.blue)
    dome.position.y = 11.5
    g.add(dome)
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), this.M.red)
    beacon.position.y = 12.6
    g.add(beacon)
    this.lightMats.push(beacon.material)
    this.addLabel(g, '反制设备', 14.2, 'rgba(120,20,20,0.85)')
    return g
  }

  private addEquipment(): void {
    const place = (fn: () => THREE.Group, x: number, z: number): void => {
      const o = fn()
      o.position.set(x, 0, z)
      this.scene.add(o)
    }
    place(() => this.commTower(), -30, -12)
    place(() => this.navStation(), -11, 30)
    place(() => this.metStation(), 11, 30)
    place(() => this.radarTower(), 34, 31)
    place(() => this.counterTower(), -47, -10)
  }

  /* ============================ 围墙 / 办公区 ============================ */
  private readonly gate = { z: 44, x1: -5, x2: 5 }

  private fenceSegment(x1: number, z1: number, x2: number, z2: number, hasGate = false): THREE.Group {
    const g = new THREE.Group()
    const len = Math.hypot(x2 - x1, z2 - z1)
    const mx = (x1 + x2) / 2
    const mz = (z1 + z2) / 2
    const seg = new THREE.Group()
    const base = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, 0.5), this.concrete)
    base.position.y = 0.3
    base.receiveShadow = true
    base.castShadow = true
    seg.add(base)
    const step = 5
    for (let d = -len / 2; d <= len / 2 + 0.01; d += step) {
      const gx = mx + d
      if (hasGate && gx > this.gate.x1 - 0.5 && gx < this.gate.x2 + 0.5) continue
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3, 8), this.fenceSteel)
      post.position.set(d, 2.1, 0)
      post.castShadow = true
      seg.add(post)
    }
    for (const y of [0.7, 3.4]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.1), this.fenceSteel)
      bar.position.set(0, y, 0)
      seg.add(bar)
    }
    const net = new THREE.Mesh(new THREE.BoxGeometry(len, 2.6, 0.04), this.netMat)
    net.position.set(0, 2.05, 0)
    seg.add(net)
    if (Math.abs(z2 - z1) > Math.abs(x2 - x1)) seg.rotation.y = Math.PI / 2
    seg.position.set(mx, 0, mz)
    g.add(seg)
    return g
  }

  private gateLeaf(px: number, dir: number): void {
    const leaf = new THREE.Group()
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 5), this.netMat)
    panel.position.set(0, 1.5, 2.5)
    leaf.add(panel)
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 5), this.fenceSteel)
    top.position.set(0, 3, 2.5)
    leaf.add(top)
    const bot = top.clone()
    bot.position.y = 0
    leaf.add(bot)
    leaf.position.set(px, 0.6, this.gate.z)
    leaf.rotation.y = dir * 0.5
    this.scene.add(leaf)
  }

  private makeCar(): THREE.Group {
    const c = new THREE.Group()
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.7, 3.2),
      new THREE.MeshStandardMaterial({ color: 0x2b6cb0, roughness: 0.4, metalness: 0.3 })
    )
    body.position.y = 0.55
    body.castShadow = true
    c.add(body)
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.6), new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.2 }))
    cab.position.set(0, 1.1, 0.2)
    c.add(cab)
    for (const x of [-0.9, 0.9]) {
      for (const z of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0x111111 }))
        w.position.set(x, 0.35, z)
        c.add(w)
      }
    }
    return c
  }

  private buildOffice(): THREE.Group {
    const g = new THREE.Group()
    g.position.set(30, 0, 18)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8ebef, roughness: 0.85 })
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x2b6cb0, metalness: 0.4, roughness: 0.25, transparent: true, opacity: 0.85 })
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a4756, roughness: 0.6, metalness: 0.3 })

    const main = new THREE.Mesh(new THREE.BoxGeometry(13, 9, 9), wallMat)
    main.position.set(-5, 4.5, -2)
    main.castShadow = true
    main.receiveShadow = true
    g.add(main)
    const roof = new THREE.Mesh(new THREE.BoxGeometry(13.4, 0.6, 9.4), roofMat)
    roof.position.set(-5, 9.3, -2)
    g.add(roof)
    const winZ = new THREE.Mesh(new THREE.BoxGeometry(11, 6, 0.2), glassMat)
    winZ.position.set(-5, 5, 3.1)
    g.add(winZ)
    const winN = winZ.clone()
    winN.position.z = -7.1
    g.add(winN)
    const winX = new THREE.Mesh(new THREE.BoxGeometry(0.2, 6, 7), glassMat)
    winX.position.set(2.6, 5, -2)
    g.add(winX)
    const winX2 = winX.clone()
    winX2.position.x = -12.6
    g.add(winX2)
    const door = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.25), new THREE.MeshStandardMaterial({ color: 0x4a3520 }))
    door.position.set(-5, 1.5, 3.2)
    g.add(door)

    const sub = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 7), wallMat)
    sub.position.set(6, 2, 4)
    sub.castShadow = true
    sub.receiveShadow = true
    g.add(sub)
    const subRoof = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.4, 7.4), new THREE.MeshStandardMaterial({ color: 0x2f8f6b }))
    subRoof.position.set(6, 4.2, 4)
    g.add(subRoof)

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 11, 10), this.fenceSteel)
    pole.position.set(0, 5.5, -7)
    pole.castShadow = true
    g.add(pole)
    const flag = new THREE.Group()
    flag.position.set(0, 10, -7)
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 1.4),
      new THREE.MeshStandardMaterial({ color: 0xd8332c, side: THREE.DoubleSide, roughness: 0.9 })
    )
    cloth.position.x = 1.2
    flag.add(cloth)
    g.add(flag)
    this.siteDyn.flag = flag

    const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 })
    for (let i = 0; i < 3; i += 1) {
      const ln = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 4), lineMat)
      ln.position.set(2 + i * 2.4, 0.05, 9)
      g.add(ln)
      const car = this.makeCar()
      car.position.set(2 + i * 2.4, 0, 9)
      g.add(car)
    }

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 1 })
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6b2f, roughness: 1 })
    for (const [tx, tz] of [
      [-12, 8],
      [-12, 2],
      [14, 9],
      [14, 1]
    ]) {
      const t = new THREE.Group()
      const h = 4 + Math.random() * 2
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, h, 6), trunkMat)
      trunk.position.y = h / 2
      trunk.castShadow = true
      const crown = new THREE.Mesh(new THREE.ConeGeometry(2.2, h * 1.2, 8), leafMat)
      crown.position.y = h + h * 0.4
      crown.castShadow = true
      t.add(trunk, crown)
      t.position.set(tx, 0, tz)
      g.add(t)
    }
    this.addLabel(g, '办公区', 13, 'rgba(20,50,40,0.85)')
    return g
  }

  private buildSite(): void {
    const X0 = -52
    const X1 = 46
    const Z0 = -18
    const Z1 = 44
    this.scene.add(this.fenceSegment(X0, Z1, this.gate.x1, Z1, true))
    this.scene.add(this.fenceSegment(this.gate.x2, Z1, X1, Z1, true))
    this.scene.add(this.fenceSegment(X1, Z1, X1, Z0))
    this.scene.add(this.fenceSegment(X1, Z0, X0, Z0))
    this.scene.add(this.fenceSegment(X0, Z0, X0, Z1))
    for (const x of [this.gate.x1, this.gate.x2]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 4, 10), this.fenceSteel)
      p.position.set(x, 2, this.gate.z)
      p.castShadow = true
      this.scene.add(p)
    }
    this.gateLeaf(this.gate.x1, 1)
    this.gateLeaf(this.gate.x2, -1)
    this.scene.add(this.buildOffice())
  }

  private addTrees(): void {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 1 })
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6b2f, roughness: 1 })
    for (let i = 0; i < 40; i += 1) {
      const ang = Math.random() * Math.PI * 2
      const rad = 70 + Math.random() * 120
      const x = Math.cos(ang) * rad
      const z = Math.sin(ang) * rad
      const tree = new THREE.Group()
      const h = 4 + Math.random() * 4
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, h, 6), trunkMat)
      trunk.position.y = h / 2
      trunk.castShadow = true
      const crown = new THREE.Mesh(new THREE.ConeGeometry(2 + Math.random(), h * 1.2, 8), leafMat)
      crown.position.y = h + h * 0.4
      crown.castShadow = true
      tree.add(trunk, crown)
      tree.position.set(x, 0, z)
      this.scene.add(tree)
    }
  }

  private buildClouds(): void {
    const makeCloud = (): THREE.Group => {
      const g = new THREE.Group()
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.9 })
      const n = 4 + Math.floor(Math.random() * 3)
      for (let i = 0; i < n; i += 1) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(6 + Math.random() * 6, 10, 10), mat)
        s.position.set((Math.random() - 0.5) * 24, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 12)
        s.scale.y = 0.6
        g.add(s)
      }
      return g
    }
    for (let i = 0; i < 9; i += 1) {
      const c = makeCloud()
      c.position.set((Math.random() - 0.5) * 500, 120 + Math.random() * 80, (Math.random() - 0.5) * 500)
      this.scene.add(c)
      this.clouds.push(c)
    }
  }

  /* ============================ 飞行器 ============================ */
  private alignCylinder(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
    const dir = new THREE.Vector3().subVectors(to, from)
    const len = dir.length()
    mesh.scale.y = len
    mesh.position.copy(from).add(to).multiplyScalar(0.5)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  }

  private createDrone(): THREE.Group {
    const craft = new THREE.Group()
    const matBody = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.6, roughness: 0.4 })
    const matAccent = new THREE.MeshStandardMaterial({ color: 0x1f6feb, metalness: 0.4, roughness: 0.5 })
    const matDark = new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.7, roughness: 0.3 })
    const matMotor = new THREE.MeshStandardMaterial({ color: 0x0f1115, metalness: 0.8, roughness: 0.3 })
    const matProp = new THREE.MeshStandardMaterial({ color: 0xaab2bd, metalness: 0.3, roughness: 0.6, transparent: true, opacity: 0.85 })

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 2.2), matBody)
    body.castShadow = true
    craft.add(body)
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.35, 1.5), matAccent)
    top.position.y = 0.4
    top.castShadow = true
    craft.add(top)

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), matDark)
    nose.position.set(0, -0.05, 1.2)
    nose.castShadow = true
    craft.add(nose)
    const cam = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.2 }))
    cam.position.set(0, -0.15, 1.35)
    craft.add(cam)
    const frontLight = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xff2222, emissiveIntensity: 1 }))
    frontLight.position.set(0, 0.1, 1.25)
    craft.add(frontLight)

    const corners: [number, number][] = [
      [2.0, 2.0],
      [-2.0, 2.0],
      [2.0, -2.0],
      [-2.0, -2.0]
    ]
    const props: THREE.Group[] = []
    for (const [x, z] of corners) {
      const motorPos = new THREE.Vector3(x, 0.2, z)
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 8), matDark)
      this.alignCylinder(arm, new THREE.Vector3(0, 0.15, 0), motorPos)
      arm.castShadow = true
      craft.add(arm)

      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.4, 16), matMotor)
      motor.position.set(x, 0.3, z)
      motor.castShadow = true
      craft.add(motor)

      const prop = new THREE.Group()
      prop.position.set(x, 0.55, z)
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.15, 12), matMotor)
      prop.add(hub)
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.03, 0.16), matProp)
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 1.9), matProp)
      prop.add(b1, b2)
      craft.add(prop)
      props.push(prop)
    }

    for (const sx of [0.7, -0.7]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 2.0), matDark)
      skid.position.set(sx, -0.45, 0)
      skid.castShadow = true
      craft.add(skid)
      for (const sz of [0.7, -0.7]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), matDark)
        leg.position.set(sx, -0.25, sz)
        craft.add(leg)
      }
    }

    craft.userData.props = props
    return craft
  }

  private createPlane(): THREE.Group {
    const g = new THREE.Group()
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe8edf2, metalness: 0.3, roughness: 0.5 })
    const redMat = new THREE.MeshStandardMaterial({ color: 0xff3b30, metalness: 0.3, roughness: 0.5 })
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1f27, metalness: 0.6, roughness: 0.4 })
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd0ff, metalness: 0.1, roughness: 0.1, transparent: true, opacity: 0.5 })

    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.32, 4.2, 16), bodyMat)
    fuse.rotation.x = Math.PI / 2
    fuse.castShadow = true
    g.add(fuse)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.9, 16), bodyMat)
    nose.rotation.x = -Math.PI / 2
    nose.position.z = 2.4
    nose.castShadow = true
    g.add(nose)
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.4, 16), redMat)
    stripe.rotation.x = Math.PI / 2
    stripe.position.z = 1.4
    g.add(stripe)
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), glassMat)
    canopy.position.set(0, 0.35, 0.6)
    canopy.scale.set(1, 0.8, 1.4)
    canopy.castShadow = true
    g.add(canopy)
    const wing = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.12, 1.5), bodyMat)
    wing.position.set(0, 0.1, -0.3)
    wing.rotation.y = 0.18
    wing.castShadow = true
    g.add(wing)
    for (const x of [-3.5, 3.5]) {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 1.5), redMat)
      tip.position.set(x, 0.1, -0.3)
      tip.rotation.y = 0.18
      g.add(tip)
    }
    const htail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 0.9), bodyMat)
    htail.position.set(0, 0.15, -2.0)
    htail.castShadow = true
    g.add(htail)
    const vtail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 1.0), bodyMat)
    vtail.position.set(0, 0.6, -2.0)
    vtail.castShadow = true
    g.add(vtail)

    const gear = (x: number, z: number, h: number): void => {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, h, 8), darkMat)
      strut.position.set(x, -h / 2 - 0.1, z)
      g.add(strut)
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 14), darkMat)
      wh.rotation.z = Math.PI / 2
      wh.position.set(x, -h - 0.15, z)
      g.add(wh)
    }
    gear(0, 1.4, 0.5)
    gear(-1.6, -0.4, 0.6)
    gear(1.6, -0.4, 0.6)

    const prop = new THREE.Group()
    prop.position.set(0, 0, 2.9)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 12), darkMat)
    hub.rotation.x = Math.PI / 2
    prop.add(hub)
    for (let i = 0; i < 3; i += 1) {
      const bl = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.02, 1.6),
        new THREE.MeshStandardMaterial({ color: 0x33373d, transparent: true, opacity: 0.85 })
      )
      bl.rotation.z = (i * Math.PI * 2) / 3
      prop.add(bl)
    }
    prop.userData.axis = 'z'
    g.add(prop)
    g.userData.props = [prop]
    return g
  }

  private rebuildTrail(): void {
    if (this.trail) {
      this.scene.remove(this.trail)
      this.trail.geometry.dispose()
    }
    this.trail = new THREE.Mesh(
      new THREE.TubeGeometry(this.activeCurve, 240, 0.08, 6, true),
      new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.18 })
    )
    this.scene.add(this.trail)
  }

  /* ============================ 测试区 ============================ */
  private buildTestZone(): void {
    const g = new THREE.Group()
    g.position.copy(this.testZone)
    this.scene.add(g)
    const PW = 44
    const PD = 20
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(PW, 0.08, PD),
      new THREE.MeshStandardMaterial({ color: 0x6f7c8c, roughness: 0.95, transparent: true, opacity: 0.32 })
    )
    pad.position.y = 0.04
    pad.receiveShadow = true
    g.add(pad)
    const grid = new THREE.GridHelper(PW, PW / 2, 0xffd23f, 0x8a93a0)
    grid.position.y = 0.09
    grid.material.opacity = 0.45
    grid.material.transparent = true
    g.add(grid)
    const mk = (w: number, d: number, x: number, z: number): void => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, d), this.M.yellow)
      b.position.set(x, 0.11, z)
      g.add(b)
    }
    mk(PW, 0.5, 0, PD / 2)
    mk(PW, 0.5, 0, -PD / 2)
    mk(0.5, PD, PW / 2, 0)
    mk(0.5, PD, -PW / 2, 0)
    const sign = this.makeLabel('无人机测试区 · UAV TEST ZONE', 'rgba(31,111,235,.92)')
    sign.position.set(0, 4.5, PD / 2 + 1)
    sign.scale.multiplyScalar(1.25)
    g.add(sign)
  }

  /* ============================ 测试科目构建 ============================ */
  private gBox(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    m.castShadow = true
    m.receiveShadow = true
    return m
  }

  private gCyl(rt: number, rb: number, h: number, mat: THREE.Material, seg = 18): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat)
    m.castShadow = true
    m.receiveShadow = true
    return m
  }

  private gRing(r: number, tube: number, mat: THREE.Material): THREE.Mesh {
    return new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 42), mat)
  }

  private makeNoiseTex(): THREE.CanvasTexture {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const x = c.getContext('2d')!
    x.fillStyle = '#9aa0a6'
    x.fillRect(0, 0, 128, 128)
    for (let i = 0; i < 520; i += 1) {
      x.fillStyle = `rgba(${(Math.random() * 255) | 0},${(Math.random() * 255) | 0},${(Math.random() * 255) | 0},.7)`
      x.fillRect(Math.random() * 128, Math.random() * 128, 5, 5)
    }
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(3, 3)
    return t
  }

  private addGroundLabel(root: THREE.Object3D, text: string, x: number, z: number, bg: string): void {
    const l = this.makeLabel(text, bg)
    l.position.set(x, 0.7, z)
    l.scale.multiplyScalar(1.12)
    root.add(l)
  }

  private forceUAV(): void {
    if (this.craftKind !== 'uav') this.setCraft('uav')
    this.uav.visible = true
    this.plane.visible = false
    this.craft = this.uav
  }

  private setMetrics(html: string): void {
    this.pendingMetrics = html
  }

  private setVerdict(text: string, kind: VerdictKind = 'run'): void {
    this.pendingVerdict = { text, kind }
  }

  private place(p: THREE.Vector3, yawDeg = 0): void {
    this.uav.position.copy(p)
    this.uav.rotation.set(0, THREE.MathUtils.degToRad(yawDeg), 0)
  }

  private hover(base: THREE.Vector3, t: number, amp: number): void {
    this.uav.position.set(base.x + Math.sin(t * 1.2) * amp, base.y + Math.sin(t * 2.3) * amp * 0.6, base.z + Math.cos(t * 1.0) * amp)
  }

  private buildSubjects(): void {
    const S = this
    this.subjects = {
      fence: () => {
        const root = new THREE.Group()
        S.scene.add(root)
        const fc = new THREE.Vector3(6, 0, 0)
        const R = 9
        const dome = new THREE.Mesh(
          new THREE.CylinderGeometry(R, R, 42, 44, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.1, side: THREE.DoubleSide })
        )
        dome.position.set(fc.x, 21, fc.z)
        root.add(dome)
        const wall = new THREE.Mesh(
          new THREE.CylinderGeometry(R, R, 42, 44, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xff3b30, wireframe: true, transparent: true, opacity: 0.16 })
        )
        wall.position.copy(dome.position)
        root.add(wall)
        const ringTop = S.gRing(R, 0.16, new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.5 }))
        ringTop.rotation.x = Math.PI / 2
        ringTop.position.set(fc.x, 0.15, fc.z)
        root.add(ringTop)
        const lbl = S.makeLabel('禁飞区 NO-FLY', 'rgba(180,32,32,.92)')
        lbl.position.set(fc.x, 20, fc.z)
        lbl.scale.multiplyScalar(1.2)
        root.add(lbl)
        const home = new THREE.Vector3(-16, 6, 0)
        S.forceUAV()
        S.place(home, 0)
        return {
          root,
          update: (_dt, t) => {
            const tc = t % 15
            const bound = new THREE.Vector3(fc.x - R - 2, 6, fc.z)
            let pos: THREE.Vector3
            let yaw: number
            let status: string
            if (tc < 7) {
              const k = tc / 7
              pos = home.clone().lerp(bound, k)
              yaw = Math.atan2(bound.x - home.x, bound.z - home.z)
              status = '正常飞行 · 接近禁飞区'
              S.setVerdict('测试中', 'run')
            } else if (tc < 13) {
              const k = (tc - 7) / 6
              pos = bound.clone().lerp(home, k)
              yaw = Math.atan2(home.x - bound.x, home.z - bound.z)
              status = '<b style="color:#ffd23f">越界拦截 · 自动返航</b>'
              S.setVerdict('触发：自动返航预案', 'warn')
            } else {
              pos = home.clone()
              yaw = 0
              status = '已返航 · 未越界'
              S.setVerdict('合格 · 未越界', 'pass')
            }
            S.uav.position.copy(pos)
            S.uav.rotation.set(0, yaw, 0)
            const d = S.uav.position.distanceTo(fc) - R
            S.setMetrics(`距围栏边界：<b>${Math.max(0, d).toFixed(1)}</b> m<br>状态：${status}<br>处置预案：悬停 / 返航`)
          },
          dispose: () => S.scene.remove(root)
        }
      },
      remote: () => {
        const root = new THREE.Group()
        S.scene.add(root)
        const base = new THREE.Vector3(-6, 14, 6)
        S.forceUAV()
        S.place(base, 0)
        const st = new THREE.Group()
        st.position.set(16, 0, 10)
        root.add(st)
        const cab = S.gBox(3, 2.2, 2.4, S.M.white)
        cab.position.y = 1.1
        st.add(cab)
        const ant = S.gCyl(0.05, 0.05, 3, S.M.steel)
        ant.position.y = 3.4
        st.add(ant)
        const dish = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), S.M.steel)
        dish.position.y = 3.2
        dish.rotation.x = Math.PI
        st.add(dish)
        S.addLabel(st, '综合监管平台', 5.2, 'rgba(31,111,235,.9)')
        const rings: THREE.Mesh[] = []
        for (let i = 0; i < 3; i += 1) {
          const r = S.gRing(1, 0.06, new THREE.MeshBasicMaterial({ color: 0x46c2ff, transparent: true, opacity: 0.6 }))
          r.rotation.x = Math.PI / 2
          r.position.copy(base)
          root.add(r)
          rings.push(r)
        }
        const sn = 'UAV-CN-2026-0001'
        return {
          root,
          update: (_dt, t) => {
            S.hover(base, t, 0.5)
            S.uav.rotation.y = Math.sin(t * 0.4) * 0.3
            rings.forEach((r, i) => {
              const ph = (t * 0.5 + i / 3) % 1
              const s = 1 + ph * 11
              r.scale.set(s, s, s)
              ;(r.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - ph)
              r.position.copy(S.uav.position)
            })
            const h = S.uav.position.y.toFixed(1)
            const sp = (6 + Math.sin(t) * 1.5).toFixed(1)
            S.setMetrics(`广播方式：<b>Wi-Fi / 蓝牙</b><br>身份码：<b>${sn}</b><br>高度：<b>${h}</b> m · 速度：<b>${sp}</b> m/s<br>平台接收：<b style="color:#7dffb0">正常</b>`)
            S.setVerdict('合格 · 持续广播', 'pass')
          },
          dispose: () => S.scene.remove(root)
        }
      },
      emergency: () => {
        const root = new THREE.Group()
        S.scene.add(root)
        const home = new THREE.Vector3(0, 0.6, 8)
        const cruise = new THREE.Vector3(0, 16, -4)
        S.forceUAV()
        S.place(cruise, 0)
        const warn = S.makeLabel('链路丢失 · 自动处置', 'rgba(255,59,48,.92)')
        warn.position.copy(cruise).add(new THREE.Vector3(0, 4, 0))
        warn.visible = false
        root.add(warn)
        return {
          root,
          update: (_dt, t) => {
            const tc = t % 18
            if (tc < 6) {
              S.uav.position.lerp(cruise, 0.05)
              S.uav.rotation.set(0, 0, 0)
              warn.visible = false
              S.setMetrics(`状态：<b>正常巡航</b><br>链路：<b style="color:#7dffb0">正常</b>`)
              S.setVerdict('测试中', 'run')
            } else if (tc < 9) {
              S.uav.position.copy(cruise)
              warn.visible = true
              S.setMetrics(`状态：<b style="color:#ff9b94">链路丢失</b><br>处置：<b>自动悬停 / 盘旋</b>`)
              S.setVerdict('触发：链路失效保护', 'warn')
            } else if (tc < 16) {
              const k = (tc - 9) / 7
              const p = cruise.clone().lerp(home, k)
              S.uav.position.copy(p)
              S.uav.rotation.set(0, Math.PI, 0)
              warn.visible = true
              S.setMetrics(`状态：<b style="color:#ffd23f">自动返航 + 降落</b><br>进度：<b>${(k * 100).toFixed(0)}%</b>`)
              S.setVerdict('执行返航降落预案', 'warn')
            } else {
              S.uav.position.copy(home)
              warn.visible = false
              S.setMetrics(`状态：<b>已安全降落</b><br>处置：返航 / 降落`)
              S.setVerdict('合格 · 应急处置有效', 'pass')
            }
          },
          dispose: () => S.scene.remove(root)
        }
      },
      struct: () => {
        const root = new THREE.Group()
        S.scene.add(root)
        const cx = 0
        const cz = 6
        for (const dx of [-3, 3]) {
          const post = S.gCyl(0.25, 0.3, 7, S.M.steel)
          post.position.set(cx + dx, 3.5, cz)
          root.add(post)
        }
        const beam = S.gBox(8, 0.4, 0.6, S.M.steelDark)
        beam.position.set(cx, 7.1, cz)
        root.add(beam)
        const ram = S.gCyl(0.3, 0.3, 1.6, S.M.blue)
        ram.position.set(cx, 6.1, cz)
        root.add(ram)
        const ram2 = ram.clone()
        ram2.position.x = cx - 1.6
        root.add(ram2)
        const ram3 = ram.clone()
        ram3.position.x = cx + 1.6
        root.add(ram3)
        const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(cx, 9.5, cz), 2.2, 0xffd23f, 0.8, 0.5)
        root.add(arrow)
        S.forceUAV()
        S.place(new THREE.Vector3(cx, 5.2, cz), 0)
        const gauge = S.makeLabel('载荷 1.33×MTOW', 'rgba(31,111,235,.9)')
        gauge.position.set(cx, 10.6, cz)
        gauge.scale.multiplyScalar(1.1)
        root.add(gauge)
        return {
          root,
          update: (_dt, t) => {
            const f = 0.5 + 0.5 * Math.sin(t * 1.5)
            ram.scale.y = 1 + f * 0.4
            ram2.scale.y = 1 + f * 0.4
            ram3.scale.y = 1 + f * 0.4
            ram.position.y = 6.1 - f * 0.2
            ram2.position.y = 6.1 - f * 0.2
            ram3.position.y = 6.1 - f * 0.2
            S.setMetrics(`试验载荷：<b>1.33 × 最大起飞重量</b><br>主要承力结构：<b style="color:#7dffb0">无破坏</b><br>有害变形：<b>否</b>`)
            S.setVerdict('合格 · 结构完好', 'pass')
          },
          dispose: () => S.scene.remove(root)
        }
      },
      body: () => {
        const root = new THREE.Group()
        S.scene.add(root)
        S.forceUAV()
        S.place(new THREE.Vector3(0, 4.5, 8), 0)
        const a1 = S.makeLabel('圆角边缘 · 无锐边', 'rgba(46,204,113,.9)')
        a1.position.set(3, 6, 8)
        root.add(a1)
        const a2 = S.makeLabel('桨叶端部圆角（非金属）', 'rgba(46,204,113,.9)')
        a2.position.set(-3.5, 5.2, 8)
        root.add(a2)
        const a3 = S.makeLabel('防夹伤设计', 'rgba(46,204,113,.9)')
        a3.position.set(0, 3.4, 11)
        root.add(a3)
        return {
          root,
          update: (_dt, t) => {
            S.uav.rotation.y = t * 0.5
            S.setMetrics(`锐边检查：<b style="color:#7dffb0">通过</b><br>桨叶端部：<b>圆角 · 非金属</b><br>防夹伤：<b>具备</b>`)
            S.setVerdict('合格 · 无锐边', 'pass')
          },
          dispose: () => S.scene.remove(root)
        }
      },
      drop: () => {
        const root = new THREE.Group()
        S.scene.add(root)
        const x = 4
        const z = 8
        S.forceUAV()
        let vy = 0
        let y = 10
        S.uav.position.set(x, y, z)
        S.uav.rotation.set(0, 0, 0)
        const dust = new THREE.Mesh(new THREE.RingGeometry(0.1, 2.6, 24), new THREE.MeshBasicMaterial({ color: 0xbfae9a, transparent: true, opacity: 0 }))
        dust.rotation.x = -Math.PI / 2
        dust.position.set(x, 0.1, z)
        root.add(dust)
        const batt = S.makeLabel('电池包：无爆炸 / 无起火', 'rgba(46,204,113,.92)')
        batt.position.set(x, 1.6, z)
        batt.visible = false
        root.add(batt)
        return {
          root,
          update: (dt, t) => {
            const tc = t % 7
            if (tc < 1.4) {
              vy += 18 * dt
              y -= vy * dt
              if (y < 0.6) {
                y = 0.6
                vy = 0
              }
              S.uav.position.set(x, y, z)
              batt.visible = false
              ;(dust.material as THREE.MeshBasicMaterial).opacity = 0
              S.setMetrics(`跌落高度：<b>10.0</b> m<br>电池电量：<b>30%</b><br>当前：<b>自由跌落 (${(10 - y).toFixed(1)}m)</b>`)
              S.setVerdict('测试中', 'run')
            } else {
              S.uav.position.set(x, 0.6, z)
              ;(dust.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.5 - (tc - 1.4) * 0.3)
              dust.scale.setScalar(1 + (tc - 1.4))
              batt.visible = true
              S.setMetrics(`跌落高度：<b>10.0</b> m<br>电池电量：<b>30%</b><br>结果：<b style="color:#7dffb0">无爆炸 / 无起火</b>`)
              S.setVerdict('合格 · 安全', 'pass')
            }
          },
          dispose: () => S.scene.remove(root)
        }
      },
      power: () => {
        const root = new THREE.Group()
        S.scene.add(root)
        const x = -6
        const z = 10
        S.forceUAV()
        S.place(new THREE.Vector3(0, 6, 0), 0)
        S.uav.visible = false
        const bench = S.gBox(5, 1, 3, S.M.steelDark)
        bench.position.set(x, 0.5, z)
        root.add(bench)
        const battMat = new THREE.MeshStandardMaterial({ color: 0x2b6cb0, metalness: 0.4, roughness: 0.5, emissive: 0x000000 })
        const batt = S.gBox(3, 1.2, 1.6, battMat)
        batt.position.set(x, 1.6, z)
        root.add(batt)
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), new THREE.MeshStandardMaterial({ color: 0x46c2ff, emissive: 0x46c2ff, emissiveIntensity: 1 }))
        led.position.set(x + 1.6, 2.3, z)
        root.add(led)
        const list = S.makeLabel('过压/过流/短路/过温/静电 保护', 'rgba(31,111,235,.9)')
        list.position.set(x, 3.4, z)
        root.add(list)
        return {
          root,
          update: (_dt, t) => {
            const tc = t % 10
            const ledMat = led.material as THREE.MeshStandardMaterial
            if (tc < 5) {
              const k = tc / 5
              battMat.emissive.setRGB(0.6 * k, 0.05 * k, 0)
              battMat.color.setRGB(0.17 + 0.4 * k, 0.42 - 0.2 * k, 0.69 - 0.3 * k)
              ledMat.emissive.setHex(0xff3b30)
              ledMat.color.setHex(0xff3b30)
              S.setMetrics(`电池类型：<b>锂离子</b><br>温度：<b style="color:#ff9b94">${(30 + k * 50).toFixed(0)}℃ 上升</b><br>状态：<b style="color:#ffd23f">过温保护触发</b>`)
              S.setVerdict('监测：温度异常', 'warn')
            } else {
              const k = (tc - 5) / 5
              battMat.emissive.setRGB(0, 0, 0)
              battMat.color.setHex(0x2b6cb0)
              ledMat.emissive.setHex(0x46c2ff)
              ledMat.color.setHex(0x46c2ff)
              S.setMetrics(`电池类型：<b>锂离子</b><br>温度：<b style="color:#7dffb0">${(80 - k * 45).toFixed(0)}℃ 回落</b><br>状态：<b style="color:#7dffb0">保护生效 · 不起火</b>`)
              S.setVerdict('合格 · 多重保护', 'pass')
            }
          },
          dispose: () => {
            S.scene.remove(root)
            S.uav.visible = true
          }
        }
      },
      control: () => {
        const root = new THREE.Group()
        S.scene.add(root)
        const base = new THREE.Vector3(-8, 8, -6)
        S.forceUAV()
        S.place(base, 0)
        const cage = new THREE.Mesh(
          new THREE.BoxGeometry(4, 4, 4),
          new THREE.MeshBasicMaterial({ color: 0x46c2ff, transparent: true, opacity: 0.12, wireframe: true })
        )
        cage.position.copy(base)
        root.add(cage)
        const lock = S.makeLabel('GPS 定位锁定', 'rgba(46,204,113,.9)')
        lock.position.copy(base).add(new THREE.Vector3(0, 3, 0))
        root.add(lock)
        return {
          root,
          update: (_dt, t) => {
            S.hover(base, t, 0.6)
            S.uav.rotation.y = Math.sin(t * 0.5) * 0.1
            const rms = Math.sqrt((0.6 * 0.6) / 2).toFixed(2)
            S.setMetrics(`悬停精度：<b>RMS ${rms} m (≤2m)</b><br>自动返航精度：<b>≤ 5 m</b><br>限速/限高：<b>已启用</b>`)
            S.setVerdict('合格 · 精度达标', 'pass')
          },
          dispose: () => S.scene.remove(root)
        }
      },
      antierr: () => {
        const root = new THREE.Group()
        S.scene.add(root)
        S.forceUAV()
        S.place(new THREE.Vector3(0, 5, 8), 0)
        S.uav.visible = false
        const slot = (x: number, label: string): { plug: THREE.Group; x: number } => {
          const g = new THREE.Group()
          g.position.set(x, 1.4, 8)
          root.add(g)
          const baseM = S.gBox(1.4, 0.5, 1.4, S.M.steelDark)
          g.add(baseM)
          const key = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.5), S.M.yellow)
          key.position.set(0.4, 0.45, 0)
          g.add(key)
          const lbl = S.makeLabel(label, 'rgba(31,111,235,.9)')
          lbl.position.set(0, 1.4, 0)
          g.add(lbl)
          const plug = new THREE.Group()
          const pbody = S.gBox(1.2, 0.4, 1.2, S.M.white)
          plug.add(pbody)
          const pkey = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.5), S.M.yellow)
          pkey.position.set(0.4, -0.35, 0)
          plug.add(pkey)
          plug.position.set(x, 3.2, 8)
          root.add(plug)
          void baseM
          return { plug, x }
        }
        const s1 = slot(-4, '电池接口')
        const s2 = slot(0, '电机接口')
        const s3 = slot(4, '桨叶接口')
        return {
          root,
          update: (_dt, t) => {
            const tc = t % 8
            ;[s1, s2, s3].forEach((s, i) => {
              const ph = (tc + i * 2.6) % 8
              let y: number
              let ok: boolean
              if (ph < 4) {
                y = 3.2 - ph * 0.45
                ok = false
              } else {
                y = 1.4
                ok = true
              }
              s.plug.position.y = y
              void ok
              s.plug.position.x = s.x
            })
            S.setMetrics(`电池接口：<b style="color:#7dffb0">防反插</b><br>电机/桨叶：<b style="color:#7dffb0">防误装</b><br>非法改装：<b>已锁止</b>`)
            S.setVerdict('合格 · 防错结构', 'pass')
          },
          dispose: () => {
            S.scene.remove(root)
            S.uav.visible = true
          }
        }
      },
      sense: () => {
        const root = new THREE.Group()
        S.scene.add(root)
        const start = new THREE.Vector3(-18, 6, 0)
        const obs = new THREE.Vector3(6, 6, 0)
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5, 5), new THREE.MeshStandardMaterial({ map: S.makeNoiseTex(), roughness: 1 }))
        panel.position.copy(obs)
        panel.castShadow = true
        root.add(panel)
        S.addGroundLabel(root, '障碍物 ≥ 2㎡', obs.x, obs.z + 3.4, 'rgba(180,32,32,.9)')
        S.forceUAV()
        S.place(start, 0)
        const warn = S.makeLabel('感知告警 · 自动避让', 'rgba(255,210,63,.92)')
        warn.position.set(0, 9, 0)
        warn.visible = false
        root.add(warn)
        return {
          root,
          update: (_dt, t) => {
            const tc = t % 12
            if (tc < 5) {
              const k = tc / 5
              const p = start.clone().lerp(new THREE.Vector3(-2, 6, 0), k)
              S.uav.position.copy(p)
              S.uav.rotation.y = 0
              warn.visible = false
              S.setMetrics(`距障碍：<b>${(S.uav.position.distanceTo(obs) - 2.8).toFixed(1)}</b> m<br>感知：<b>正常</b>`)
              S.setVerdict('测试中', 'run')
            } else if (tc < 8) {
              const k = (tc - 5) / 3
              const p = new THREE.Vector3(-2 + k * 1, 6 + k * 5, 0)
              S.uav.position.copy(p)
              S.uav.rotation.y = -0.4
              warn.visible = true
              S.setMetrics(`距障碍：<b style="color:#ffd23f">${(S.uav.position.distanceTo(obs) - 2.8).toFixed(1)}</b> m<br>告警：<b style="color:#ffd23f">已触发</b><br>动作：<b>上升绕避</b>`)
              S.setVerdict('感知告警 + 自动避让', 'warn')
            } else {
              const k = (tc - 8) / 4
              const p = new THREE.Vector3(-1, 11, 0).lerp(new THREE.Vector3(14, 11, 0), k)
              S.uav.position.copy(p)
              warn.visible = false
              S.setMetrics(`最小安全距离：<b style="color:#7dffb0">≥ 2 m</b><br>避让：<b style="color:#7dffb0">成功</b>`)
              S.setVerdict('合格 · 成功避让', 'pass')
            }
          },
          dispose: () => S.scene.remove(root)
        }
      },
      datalink: () => {
        const root = new THREE.Group()
        S.scene.add(root)
        const rc = new THREE.Vector3(-14, 1.2, 10)
        const air = new THREE.Vector3(2, 12, -2)
        S.forceUAV()
        S.place(air, 0)
        const box = S.gBox(2, 1.4, 1.4, S.M.steelDark)
        box.position.copy(rc)
        root.add(box)
        const ant = S.gCyl(0.05, 0.05, 2.4, S.M.steel)
        ant.position.set(rc.x, 2.6, rc.z)
        root.add(ant)
        S.addGroundLabel(root, '地面控制站', rc.x, rc.z + 2.2, 'rgba(31,111,235,.9)')
        const link = new THREE.Mesh(
          new THREE.CylinderGeometry(0.18, 0.18, rc.distanceTo(air), 8),
          new THREE.MeshStandardMaterial({ color: 0x46c2ff, emissive: 0x1f6feb, emissiveIntensity: 0.6, transparent: true, opacity: 0.7 })
        )
        const mid = rc.clone().add(air).multiplyScalar(0.5)
        link.position.copy(mid)
        link.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), air.clone().sub(rc).normalize())
        root.add(link)
        const intr = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1, 12), new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0x661010 }))
        root.add(intr)
        const intrMat = intr.material as THREE.MeshStandardMaterial
        return {
          root,
          update: (_dt, t) => {
            const ph = (t * 0.4) % 1
            intr.position.lerpVectors(rc.clone().add(new THREE.Vector3(-6, 4, 0)), mid, ph)
            intr.position.y += Math.sin(t * 4) * 0.1
            const blocked = ph > 0.6
            intrMat.color.setHex(blocked ? 0x555555 : 0xff3b30)
            S.setMetrics(`加密方式：<b>AES / 私有协议</b><br>防劫持：<b style="color:#7dffb0">${blocked ? '已拦截' : '监测中'}</b><br>防重放/完整性：<b style="color:#7dffb0">启用</b>`)
            S.setVerdict(blocked ? '合格 · 链路受保护' : '监测非法接入', 'pass')
          },
          dispose: () => S.scene.remove(root)
        }
      },
      emc: () => {
        const root = new THREE.Group()
        S.scene.add(root)
        const cx = 0
        const cz = 0
        const Sv = 14
        const H = 9
        const room = new THREE.Mesh(
          new THREE.BoxGeometry(Sv, H, Sv),
          new THREE.MeshStandardMaterial({ color: 0x2a2f3a, side: THREE.BackSide, metalness: 0.6, roughness: 0.4 })
        )
        room.position.set(cx, H / 2, cz)
        root.add(room)
        const absMat = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 1 })
        for (let gx = -Sv / 2 + 1; gx <= Sv / 2 - 1; gx += 2) {
          for (let gz = -Sv / 2 + 1; gz <= Sv / 2 - 1; gz += 2) {
            const py = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 4), absMat)
            py.position.set(cx + gx, 0.7, cz + gz)
            py.rotation.x = Math.PI
            root.add(py)
          }
        }
        S.forceUAV()
        S.place(new THREE.Vector3(cx, H / 2 + 1, cz), 0)
        const rings: THREE.Mesh[] = []
        for (let i = 0; i < 3; i += 1) {
          const r = S.gRing(1, 0.05, new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.5 }))
          r.rotation.x = Math.PI / 2
          r.position.copy(S.uav.position)
          root.add(r)
          rings.push(r)
        }
        S.addGroundLabel(root, '电波暗室 EMC', cx, cz - Sv / 2 - 1, 'rgba(31,111,235,.9)')
        return {
          root,
          update: (_dt, t) => {
            S.hover(new THREE.Vector3(cx, H / 2 + 1, cz), t, 0.4)
            rings.forEach((r, i) => {
              const ph = (t * 0.4 + i / 3) % 1
              const s = 1 + ph * 5
              r.scale.set(s, s, s)
              ;(r.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - ph)
              r.position.copy(S.uav.position)
            })
            S.setMetrics(`辐射发射：<b style="color:#7dffb0">≤ 限值</b><br>辐射抗扰：<b style="color:#7dffb0">B 级</b><br>静电放电：<b style="color:#7dffb0">±8kV 通过</b>`)
            S.setVerdict('合格 · 兼容达标', 'pass')
          },
          dispose: () => S.scene.remove(root)
        }
      },
      wind: () => {
        const root = new THREE.Group()
        S.scene.add(root)
        const WX = -13
        const base = new THREE.Vector3(3, 9, 0)
        S.forceUAV()
        S.place(base, -Math.PI / 2)

        const wallW = 15
        const wallH = 13
        const frame = new THREE.Group()
        frame.position.set(WX, wallH / 2, 0)
        root.add(frame)
        const bar = (w: number, h: number, d: number, x: number, y: number, z: number): void => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), S.M.steel)
          m.position.set(x, y, z)
          m.castShadow = true
          m.receiveShadow = true
          frame.add(m)
        }
        bar(0.5, wallH, 0.5, -wallW / 2, 0, 0)
        bar(0.5, wallH, 0.5, wallW / 2, 0, 0)
        bar(wallW, 0.5, 0.5, 0, wallH / 2, 0)
        bar(wallW, 0.5, 0.5, 0, -wallH / 2, 0)

        const cv = document.createElement('canvas')
        cv.width = cv.height = 256
        const cx = cv.getContext('2d')!
        const wallTex = new THREE.CanvasTexture(cv)
        wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping
        wallTex.repeat.set(2, 1)
        cx.fillStyle = '#08222f'
        cx.fillRect(0, 0, 256, 256)
        for (let i = 0; i < 30; i += 1) {
          const x = (i * 29) % 256
          const grd = cx.createLinearGradient(x, 0, x - 40, 256)
          grd.addColorStop(0, 'rgba(120,225,255,0.9)')
          grd.addColorStop(1, 'rgba(120,225,255,0)')
          cx.strokeStyle = grd
          cx.lineWidth = 2 + (i % 3)
          cx.beginPath()
          cx.moveTo(x, 0)
          cx.lineTo(x - 40, 256)
          cx.stroke()
        }
        const panel = new THREE.Mesh(
          new THREE.PlaneGeometry(wallW - 0.7, wallH - 0.7),
          new THREE.MeshBasicMaterial({ map: wallTex, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
        )
        panel.rotation.y = Math.PI / 2
        frame.add(panel)

        const fan = new THREE.Group()
        fan.position.set(WX - 0.7, 2.4, 0)
        root.add(fan)
        const housing = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 1.3, 22, 1, true), S.M.steelDark)
        housing.rotation.z = Math.PI / 2
        fan.add(housing)
        const blades = new THREE.Group()
        fan.add(blades)
        for (let i = 0; i < 5; i += 1) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.0, 0.5), S.M.steel)
          b.position.y = 1.0
          const g = new THREE.Group()
          g.rotation.x = (i * Math.PI * 2) / 5
          g.add(b)
          blades.add(g)
        }

        for (const z of [-wallW / 2 + 1, wallW / 2 - 1]) {
          const l = new THREE.Mesh(new THREE.BoxGeometry(0.35, wallH, 0.35), S.M.steel)
          l.position.set(WX, wallH / 2, z)
          l.castShadow = true
          root.add(l)
        }
        const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 1.1), S.M.white)
        cab.position.set(WX, 1.1, wallW / 2 + 1.6)
        cab.castShadow = true
        root.add(cab)
        const wallLbl = S.makeLabel('数字风墙', 'rgba(31,111,235,.92)')
        wallLbl.position.set(WX, wallH + 2.5, 0)
        wallLbl.scale.multiplyScalar(1.1)
        root.add(wallLbl)

        const N = 600
        const ppos = new Float32Array(N * 3)
        for (let i = 0; i < N; i += 1) {
          ppos[i * 3] = WX + Math.random() * 26
          ppos[i * 3 + 1] = 0.5 + Math.random() * 12
          ppos[i * 3 + 2] = -7 + Math.random() * 14
        }
        const pg = new THREE.BufferGeometry()
        pg.setAttribute('position', new THREE.BufferAttribute(ppos, 3))
        const wind = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xbfe0ff, size: 0.32, transparent: true, opacity: 0.7 }))
        root.add(wind)

        return {
          root,
          update: (dt, t) => {
            wallTex.offset.x -= dt * 0.6
            blades.rotation.x += dt * 9
            const arr = wind.geometry.attributes.position.array as Float32Array
            const sp = 9 + Math.sin(t * 2) * 2.5
            for (let i = 0; i < N; i += 1) {
              arr[i * 3] += sp * dt
              if (arr[i * 3] > WX + 26) arr[i * 3] = WX
            }
            wind.geometry.attributes.position.needsUpdate = true
            S.uav.position.set(base.x + Math.sin(t * 1.4) * 0.45, base.y + Math.sin(t * 2.1) * 0.22, base.z + Math.cos(t * 1.1) * 0.3)
            S.uav.rotation.set(-Math.sin(t * 2.1) * 0.05, -Math.PI / 2, Math.sin(t * 1.4) * 0.07)
            S.setMetrics(`数字风墙：<b>持续风 + 阵风</b><br>风速：<b>4 级 (5.5~8 m/s)</b><br>姿态保持：<b style="color:#7dffb0">可控</b><br>倾覆：<b>否</b>`)
            S.setVerdict('合格 · 姿态稳定', 'pass')
          },
          dispose: () => S.scene.remove(root)
        }
      },
      noise: () => {
        const root = new THREE.Group()
        S.scene.add(root)
        const base = new THREE.Vector3(-4, 7, 6)
        S.forceUAV()
        S.place(base, 0)
        const rings: THREE.Mesh[] = []
        for (let i = 0; i < 3; i += 1) {
          const r = S.gRing(1, 0.05, new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.5 }))
          r.rotation.x = Math.PI / 2
          r.position.copy(base)
          root.add(r)
          rings.push(r)
        }
        S.addGroundLabel(root, '测点：机体 1m', base.x, base.z + 2.5, 'rgba(31,111,235,.9)')
        return {
          root,
          update: (_dt, t) => {
            S.hover(base, t, 0.4)
            rings.forEach((r, i) => {
              const ph = (t * 0.45 + i / 3) % 1
              const s = 1 + ph * 6
              r.scale.set(s, s, s)
              ;(r.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - ph)
              r.position.copy(S.uav.position)
            })
            const db = (68 + Math.sin(t * 2) * 2).toFixed(1)
            S.setMetrics(`测距：<b>机体 1 m</b><br>悬停噪声：<b>${db} dB(A)</b><br>限值：<b>≤ 80 dB(A)</b>`)
            S.setVerdict(parseFloat(db) <= 80 ? '合格 · 噪声达标' : '超限', parseFloat(db) <= 80 ? 'pass' : 'fail')
          },
          dispose: () => S.scene.remove(root)
        }
      },
      lights: () => {
        const root = new THREE.Group()
        S.scene.add(root)
        const sv = { sun: S.sun.intensity, hemi: S.hemi.intensity, amb: S.ambient.intensity }
        S.sun.intensity = 0.12
        S.hemi.intensity = 0.12
        S.ambient.intensity = 0.08
        const base = new THREE.Vector3(0, 10, 6)
        S.forceUAV()
        S.place(base, 0)
        const mk = (c: number): THREE.Mesh =>
          new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.4 }))
        const nl = mk(0xff3b30)
        nl.position.set(-0.6, 0, 0)
        const nr = mk(0x2bd44a)
        nr.position.set(0.6, 0, 0)
        const nt = mk(0xffffff)
        nt.position.set(0, 0.6, 0)
        S.uav.add(nl)
        S.uav.add(nr)
        S.uav.add(nt)
        const vis = S.makeLabel('120m 肉眼可见', 'rgba(255,210,63,.92)')
        vis.position.set(0, 13, 6)
        root.add(vis)
        const nlMat = nl.material as THREE.MeshStandardMaterial
        const nrMat = nr.material as THREE.MeshStandardMaterial
        const ntMat = nt.material as THREE.MeshStandardMaterial
        return {
          root,
          update: (_dt, t) => {
            S.uav.position.copy(base)
            S.uav.rotation.y = t * 0.4
            const ph = (t * 2) % 3
            nlMat.emissiveIntensity = ph < 1 ? 1.4 : 0.1
            nrMat.emissiveIntensity = ph >= 1 && ph < 2 ? 1.4 : 0.1
            ntMat.emissiveIntensity = ph >= 2 ? 1.4 : 0.1
            S.setMetrics(`航向灯：<b>红/绿/白 交替</b><br>夜间 120m：<b style="color:#7dffb0">可见</b><br>色冲突：<b>无</b>`)
            S.setVerdict('合格 · 灯光合规', 'pass')
          },
          dispose: () => {
            S.scene.remove(root)
            S.uav.remove(nl)
            S.uav.remove(nr)
            S.uav.remove(nt)
            S.sun.intensity = sv.sun
            S.hemi.intensity = sv.hemi
            S.ambient.intensity = sv.amb
          }
        }
      },
      mark: () => {
        const root = new THREE.Group()
        S.scene.add(root)
        S.forceUAV()
        S.place(new THREE.Vector3(0, 4.5, 8), 0)
        const a1 = S.makeLabel('唯一识别码 UAV-CN-2026-0001', 'rgba(31,111,235,.92)')
        a1.position.set(0, 6, 8)
        root.add(a1)
        const a2 = S.makeLabel('风险警示：桨叶伤人', 'rgba(255,59,48,.9)')
        a2.position.set(3.2, 4.6, 8)
        root.add(a2)
        const a3 = S.makeLabel('类别标识：轻型', 'rgba(46,204,113,.9)')
        a3.position.set(-3, 3.6, 8)
        root.add(a3)
        return {
          root,
          update: (_dt, t) => {
            S.uav.rotation.y = Math.sin(t * 0.5) * 0.4
            S.setMetrics(`唯一识别码：<b style="color:#7dffb0">机身/包装/软件 一致</b><br>风险警示：<b style="color:#7dffb0">已标注</b><br>类别符号：<b style="color:#7dffb0">可见</b>`)
            S.setVerdict('合格 · 标识合规', 'pass')
          },
          dispose: () => S.scene.remove(root)
        }
      },
      manual: () => {
        const root = new THREE.Group()
        S.scene.add(root)
        S.forceUAV()
        S.place(new THREE.Vector3(-6, 5, 10), 0)
        S.uav.rotation.y = 0.6
        const book = new THREE.Group()
        book.position.set(4, 4, 10)
        book.rotation.y = -0.4
        root.add(book)
        const pageMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.9, side: THREE.DoubleSide })
        const pg1 = new THREE.Mesh(new THREE.PlaneGeometry(3, 4), pageMat)
        pg1.position.set(-1.55, 0, 0)
        pg1.rotation.y = 0.18
        book.add(pg1)
        const pg2 = new THREE.Mesh(new THREE.PlaneGeometry(3, 4), pageMat)
        pg2.position.set(1.55, 0, 0)
        pg2.rotation.y = -0.18
        book.add(pg2)
        const spine = S.gBox(0.2, 4.2, 0.4, S.M.steelDark)
        book.add(spine)
        const cov = S.makeLabel('使用说明书 · 内容完整', 'rgba(31,111,235,.92)')
        cov.position.set(4, 6.6, 10)
        root.add(cov)
        const items = ['操作程序', '安全使用规则', '故障处理', '环境适应性警示', '安全警示图标']
        items.forEach((it, i) => {
          const l = S.makeLabel('✓ ' + it, 'rgba(46,204,113,.9)')
          l.position.set(4, 2.6 - i * 0.9, 11.6)
          l.scale.multiplyScalar(0.8)
          root.add(l)
        })
        return {
          root,
          update: (_dt, t) => {
            book.rotation.y = -0.4 + Math.sin(t * 0.4) * 0.08
            S.setMetrics(`形式：<b>纸质 + 电子</b><br>必备章节：<b style="color:#7dffb0">5/5 完整</b><br>警示图标：<b style="color:#7dffb0">规范</b>`)
            S.setVerdict('合格 · 内容完整', 'pass')
          },
          dispose: () => S.scene.remove(root)
        }
      }
    }
  }

  /* ============================ 科目切换 ============================ */
  enterSubject(id: string): void {
    const builder = this.subjects[id]
    const meta = UAV_SUBJECTS.find((s) => s.id === id)
    if (!builder || !meta || meta.free) return
    this.scene.add(this.uav)
    this.scene.add(this.plane)
    if (this.currentSubject?.dispose) this.currentSubject.dispose()
    this.manual = false
    if (this.craftKind !== 'uav') this.setCraft('uav')
    this.forceUAV()
    const inst = builder()
    const root = inst.root
    root.position.copy(this.testZone)
    root.add(this.uav)
    root.add(this.plane)
    this.currentSubject = {
      id,
      name: meta.name,
      label: meta.name + ' 测试',
      root,
      update: inst.update ?? null,
      dispose: inst.dispose ?? null
    }
    this.pendingVerdict = { text: '测试中', kind: 'run' }
    this.pendingMetrics = '<span style="color:#9fb3c8">初始化测试场景…</span>'
    this.callbacks.onSubject?.({ id, name: meta.name, clause: meta.clause, desc: meta.desc })
    this.emit(true)
  }

  exitTest(): void {
    this.scene.add(this.uav)
    this.scene.add(this.plane)
    if (this.currentSubject?.dispose) this.currentSubject.dispose()
    this.currentSubject = null
    this.manual = false
    if (this.craftKind !== 'uav') this.setCraft('uav')
    this.autoT = 0
    this.uav.position.copy(this.activeCurve.getPointAt(0))
    this.uav.rotation.set(0, 0, 0)
    this.callbacks.onSubject?.(null)
    this.emit(true)
  }

  retest(): void {
    if (this.currentSubject) this.enterSubject(this.currentSubject.id)
  }

  getManual(): boolean {
    return this.manual
  }

  toggleManual(): boolean {
    this.manual = !this.manual
    if (this.manual) {
      this.tmpV.set(0, 0, 1).applyQuaternion(this.craft.quaternion)
      this.yaw = Math.atan2(this.tmpV.x, this.tmpV.z)
      this.vel.set(0, 0, 0)
    }
    this.emit(true)
    return this.manual
  }

  setJoystick(side: 'left' | 'right', nx: number, ny: number): void {
    if (side === 'left') {
      this.inMoveX = nx
      this.inMoveZ = -ny
    } else {
      this.inYaw = nx
      this.inAlt = -ny
    }
  }

  getSubjectId(): string | null {
    return this.currentSubject ? this.currentSubject.id : null
  }

  /* ============================ 操控 / 相机 ============================ */
  private setCraft(kind: CraftKind): void {
    if (kind === this.craftKind) return
    const next = kind === 'uav' ? this.uav : this.plane
    const other = kind === 'uav' ? this.plane : this.uav
    next.position.copy(this.craft.position)
    next.position.y = Math.max(next.position.y, this.craft.userData.groundY as number)
    next.quaternion.copy(this.craft.quaternion)
    next.visible = true
    other.visible = false
    this.craft = next
    this.activeCurve = kind === 'uav' ? this.uavCurve : this.planeCurve
    this.vel.set(0, 0, 0)
    this.autoT = 0
    this.craftKind = kind
    this.rebuildTrail()
  }

  private applyCam(): void {
    const sp = Math.sin(this.cam.phi)
    const cp = Math.cos(this.cam.phi)
    this.camera.position.set(
      this.cam.tx + this.cam.r * sp * Math.sin(this.cam.theta),
      this.cam.ty + this.cam.r * cp,
      this.cam.tz + this.cam.r * sp * Math.cos(this.cam.theta)
    )
    this.camera.lookAt(this.cam.tx, this.cam.ty, this.cam.tz)
  }

  private handlePointerDown(e: PointerEvent): void {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    this.lastX = e.clientX
    this.lastY = e.clientY
    this.dragBtn = e.button
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      this.lastDist = Math.hypot(a.x - b.x, a.y - b.y)
    }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.lastDist > 0) this.cam.gr = THREE.MathUtils.clamp(this.cam.gr * (1 + (this.lastDist - dist) * 0.004), 18, 320)
      this.lastDist = dist
      return
    }
    const dx = e.clientX - this.lastX
    const dy = e.clientY - this.lastY
    this.lastX = e.clientX
    this.lastY = e.clientY
    if (this.dragBtn === 2) {
      const k = this.cam.gr * 0.0016
      const right = new THREE.Vector3(Math.cos(this.cam.theta), 0, -Math.sin(this.cam.theta))
      const fwd = new THREE.Vector3(-Math.sin(this.cam.theta), 0, -Math.cos(this.cam.theta))
      this.cam.tx -= right.x * dx * k + fwd.x * dy * k
      this.cam.tz -= right.z * dx * k + fwd.z * dy * k
      this.cam.gtheta = this.cam.theta
      return
    }
    this.cam.gtheta -= dx * 0.005
    this.cam.gphi = THREE.MathUtils.clamp(this.cam.gphi - dy * 0.005, 0.12, 1.5)
  }

  private handlePointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId)
    if (this.pointers.size < 2) this.lastDist = 0
    if (this.pointers.size === 0) this.dragBtn = -1
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault()
    this.cam.gr = THREE.MathUtils.clamp(this.cam.gr * (1 + (e.deltaY > 0 ? 0.08 : -0.08)), 18, 320)
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const tag = e.target && (e.target as HTMLElement).tagName ? (e.target as HTMLElement).tagName.toLowerCase() : ''
    if (tag === 'input' || tag === 'textarea') return
    this.keys[e.code] = true
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault()
  }

  private resize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  /* ============================ 主循环 ============================ */
  private updateHUD(): { craft: string; status: string; alt: number; manual: boolean } {
    let status: string
    if (this.currentSubject) {
      status = this.currentSubject.label
    } else if (this.manual) {
      status = this.craft.position.y < 1.6 ? '地面停放 / 滑行' : '手动飞行'
    } else {
      const y = this.craft.position.y
      status = y < 1.6 ? '跑道滑跑' : y < 7 ? '垂直起降' : '空中巡航'
    }
    return {
      craft: this.craftKind === 'uav' ? '无人机' : '有人机',
      status,
      alt: this.craft.position.y,
      manual: this.manual
    }
  }

  private emit(force = false): void {
    const now = performance.now()
    if (!force && now - this.lastEmit < 90) return
    this.lastEmit = now
    this.callbacks.onHud?.(this.updateHUD())
    this.callbacks.onMetrics?.(this.pendingMetrics)
    this.callbacks.onVerdict?.(this.pendingVerdict.text, this.pendingVerdict.kind)
  }

  private frame = (): void => {
    if (this.disposed) return
    this.rafId = requestAnimationFrame(this.frame)
    const dt = Math.min(this.clock.getDelta(), 0.05)
    const elapsed = this.clock.getElapsedTime()

    if (this.currentSubject) {
      if (this.currentSubject.update) this.currentSubject.update(dt, elapsed)
    } else if (!this.manual) {
      this.autoT = (this.autoT + dt / (this.craft.userData.loop as number)) % 1
      const target = this.activeCurve.getPointAt(this.autoT)
      this.craft.position.lerp(target, 1 - Math.exp(-dt * 3.5))
      this.dummy.position.copy(this.craft.position)
      this.tmpV.copy(this.craft.position).add(this.activeCurve.getTangentAt(this.autoT))
      this.dummy.lookAt(this.tmpV)
      this.craft.quaternion.slerp(this.dummy.quaternion, 1 - Math.exp(-dt * 3.5))
    } else {
      let mx = this.inMoveX
      let mz = this.inMoveZ
      let al = this.inAlt
      let yw = this.inYaw
      if (this.keys.KeyA) mx -= 1
      if (this.keys.KeyD) mx += 1
      if (this.keys.KeyW) mz += 1
      if (this.keys.KeyS) mz -= 1
      if (this.keys.KeyQ) al -= 1
      if (this.keys.KeyE) al += 1
      if (this.keys.ArrowUp) al += 1
      if (this.keys.ArrowDown) al -= 1
      if (this.keys.ArrowLeft) yw -= 1
      if (this.keys.ArrowRight) yw += 1
      const boost = this.keys.ShiftLeft || this.keys.ShiftRight ? 1.8 : 1
      mx = THREE.MathUtils.clamp(mx, -1, 1)
      mz = THREE.MathUtils.clamp(mz, -1, 1)
      al = THREE.MathUtils.clamp(al, -1, 1)
      yw = THREE.MathUtils.clamp(yw, -1, 1)

      this.yaw += yw * 1.7 * dt
      this.fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))
      this.rgt.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
      const desired = this.fwd.multiplyScalar(mz * 22 * boost).addScaledVector(this.rgt, mx * 22 * boost)
      this.vel.lerp(desired, 1 - Math.exp(-dt * 3))
      this.craft.position.addScaledVector(this.vel, dt)
      this.craft.position.y += al * 12 * boost * dt
      this.craft.position.y = THREE.MathUtils.clamp(this.craft.position.y, this.craft.userData.groundY as number, 70)
      this.craft.position.x = THREE.MathUtils.clamp(this.craft.position.x, -240, 240)
      this.craft.position.z = THREE.MathUtils.clamp(this.craft.position.z, -240, 240)

      const tiltX = THREE.MathUtils.clamp(mz * 0.22, -0.22, 0.22)
      const tiltZ = THREE.MathUtils.clamp(-mx * 0.22, -0.22, 0.22)
      this.craft.rotation.order = 'YXZ'
      this.craft.rotation.set(tiltX, this.yaw, tiltZ)
    }

    const props = this.craft.userData.props as THREE.Group[]
    props.forEach((p, i) => {
      const axis = (p.userData.axis as 'x' | 'y' | 'z') || 'y'
      p.rotation[axis] += (i % 2 ? -1 : 1) * 48 * dt
    })

    this.lightMats.forEach((m, i) => {
      m.emissiveIntensity = 0.55 + 0.45 * Math.sin(elapsed * 3 + i * 0.6)
    })

    if (this.eqDyn.radar) this.eqDyn.radar.rotation.y += dt * 0.9
    if (this.eqDyn.anemo) this.eqDyn.anemo.rotation.y += dt * 2.4
    if (this.eqDyn.vane) this.eqDyn.vane.rotation.y = Math.sin(elapsed * 0.7) * 1.1
    if (this.siteDyn.flag) this.siteDyn.flag.rotation.z = Math.sin(elapsed * 1.5) * 0.12

    for (const c of this.clouds) {
      c.position.x += dt * 1.6
      if (c.position.x > 320) c.position.x = -320
    }

    const ease = 1 - Math.pow(0.001, dt)
    this.cam.theta += (this.cam.gtheta - this.cam.theta) * ease
    this.cam.phi += (this.cam.gphi - this.cam.phi) * ease
    this.cam.r += (this.cam.gr - this.cam.r) * (1 - Math.pow(0.004, dt))
    this.applyCam()

    this.renderer.render(this.scene, this.camera)
    this.emit()
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.rafId)
    this.observer.disconnect()
    const cv = this.renderer.domElement
    cv.removeEventListener('pointerdown', this.onPointerDown)
    cv.removeEventListener('pointermove', this.onPointerMove)
    cv.removeEventListener('pointerup', this.onPointerUp)
    cv.removeEventListener('pointercancel', this.onPointerUp)
    cv.removeEventListener('contextmenu', this.onContextMenu)
    cv.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat?.dispose()
    })
    this.renderer.dispose()
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
  }
}
