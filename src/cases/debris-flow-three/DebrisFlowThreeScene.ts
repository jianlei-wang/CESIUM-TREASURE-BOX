import * as THREE from 'three'
import {
  BW,
  BD,
  S0,
  DEBRIS_STAGES,
  colorDrift,
  debrisColor,
  debrisFront,
  fanGrow,
  pathBed,
  pathWidth,
  pathX,
  pathZ,
  smooth,
  valleyH
} from '../geo-hazard-lib/model'
import { HazardThreeBase, type HazardLabelDef, type HazardThreeCallbacks, type OverlayLabel } from '../geo-hazard-lib/three-base'
import { buildTerrainBlock, createHazardMaterials, makeHouse, makeTree, type HazardMaterials } from '../geo-hazard-lib/three-parts'

export { DEBRIS_STAGES as STAGES } from '../geo-hazard-lib/model'

interface DynamicLabel {
  label: OverlayLabel
  dyn?: 'head' | 'surge' | 'fan'
  pos?: [number, number, number]
  dy?: number
  dynY?: boolean
}

/** 泥石流流体网格的纵向 / 横向离散数 */
const FLOW_N = 110
const FLOW_M = 7
/** 拦挡坝所在路径参数 */
const DAM_T = 0.46

/**
 * 泥石流 Three.js 演示：以解析式沟谷地形为底，龙头裹挟泥浆石块沿沟道下泄，
 * 沟口堆积扇逐渐扩展并威胁村庄，配合物源松散体、阵流与防治工程示意。
 */
export class DebrisFlowThreeScene extends HazardThreeBase {
  private mats!: HazardMaterials
  private flowGeo!: THREE.BufferGeometry
  private flowMat!: THREE.MeshStandardMaterial
  private flowPos!: Float32Array
  private readonly flowBase: { x: number; w: number; bed: number; z: number }[] = []
  private head!: THREE.Group
  private boulders!: THREE.InstancedMesh
  private readonly boulderSeeds: { t: number; lat: number; rot: number; sc: number }[] = []
  private fan!: THREE.Mesh
  private houses: THREE.Group[] = []
  private readonly houseBaseY: number[] = []
  private engGroup!: THREE.Group
  private dynLabels: DynamicLabel[] = []
  private curFront = 0

  private static readonly BOULDER_N = 30

  constructor(container: HTMLElement, callbacks: HazardThreeCallbacks = {}) {
    super(
      container,
      { stages: DEBRIS_STAGES, radius: 70, targetY: 11, fogColor: 0x181f26, fogNear: 120, fogFar: 280 },
      callbacks
    )
    this.bootstrap()
  }

  protected buildContent(): void {
    this.mats = createHazardMaterials()
    this.root.add(buildTerrainBlock(BW, BD, valleyH, debrisColor, 108, 116, this.mats.terrain))
    this.buildFlow()
    this.buildBoulders()
    this.buildFan()
    this.buildVillage()
    this.buildEngineering()
    this.buildLabels()
  }

  /* ------------------------------ 流体 ------------------------------ */
  private buildFlow(): void {
    const cols = FLOW_M + 1
    this.flowPos = new Float32Array((FLOW_N + 1) * cols * 3)
    const I: number[] = []
    const vid = (k: number, j: number): number => k * cols + j
    for (let k = 0; k < FLOW_N; k += 1) {
      for (let j = 0; j < FLOW_M; j += 1) {
        I.push(vid(k, j), vid(k + 1, j), vid(k + 1, j + 1))
        I.push(vid(k, j), vid(k + 1, j + 1), vid(k, j + 1))
      }
    }
    for (let k = 0; k <= FLOW_N; k += 1) {
      const t = k / FLOW_N
      this.flowBase.push({ x: pathX(t), w: pathWidth(t), bed: pathBed(t), z: pathZ(t) })
    }
    this.flowGeo = new THREE.BufferGeometry()
    this.flowGeo.setAttribute('position', new THREE.BufferAttribute(this.flowPos, 3))
    this.flowGeo.setIndex(I)
    this.flowMat = new THREE.MeshStandardMaterial({
      color: 0x4f3a22,
      roughness: 0.72,
      metalness: 0.04,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.96
    })
    const mesh = new THREE.Mesh(this.flowGeo, this.flowMat)
    mesh.castShadow = true
    mesh.frustumCulled = false
    this.root.add(mesh)

    // 龙头（前端翻滚的泥团）
    const head = new THREE.Group()
    const core = new THREE.Mesh(new THREE.SphereGeometry(1.7, 16, 12), this.mats.head)
    core.scale.set(1.35, 0.85, 1.1)
    core.castShadow = true
    const front = new THREE.Mesh(new THREE.SphereGeometry(1.1, 14, 10), this.mats.fluid)
    front.position.set(0, -0.15, 1.35)
    front.scale.set(1.5, 0.6, 1)
    head.add(core, front)
    this.head = head
    this.root.add(head)
  }

  /* ---------------------------- 物源石块 ---------------------------- */
  private buildBoulders(): void {
    const n = DebrisFlowThreeScene.BOULDER_N
    this.boulders = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), this.mats.rock, n)
    this.boulders.castShadow = true
    for (let i = 0; i < n; i += 1) {
      this.boulderSeeds.push({
        t: 0.02 + Math.random() * 0.9,
        lat: (Math.random() - 0.5) * 1.5,
        rot: Math.random() * 3.14,
        sc: 0.5 + Math.random() * 0.95
      })
    }
    this.root.add(this.boulders)
  }

  /* ---------------------------- 堆积扇 ---------------------------- */
  private buildFan(): void {
    const seg = 30
    const P: number[] = [0, 0, 0]
    const I: number[] = []
    for (let i = 0; i <= seg; i += 1) {
      const a = -Math.PI * 0.52 + (Math.PI * 1.04 * i) / seg
      const r = 1
      P.push(Math.sin(a) * r * 15, 0.15 + 0.35 * Math.cos(a * 1.7), Math.cos(a) * r * 12)
    }
    for (let i = 1; i <= seg; i += 1) I.push(0, i, i + 1)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3))
    geo.setIndex(I)
    geo.computeVertexNormals()
    this.fan = new THREE.Mesh(geo, this.mats.fan)
    this.fan.receiveShadow = true
    this.fan.castShadow = true
    this.fan.visible = false
    this.root.add(this.fan)
  }

  /* ---------------------------- 沟口村庄 ---------------------------- */
  private buildVillage(): void {
    const cx = pathX(1)
    const spots: [number, number][] = [
      [cx - 6.5, 19.5],
      [cx - 2.5, 20.8],
      [cx + 2.6, 20.2],
      [cx + 6.8, 21.4],
      [cx - 4.4, 23.4],
      [cx + 4.6, 23.8]
    ]
    for (const [x, z] of spots) {
      const h = makeHouse(2.4, 1.7, 2.0, this.mats)
      const y = Math.max(valleyH(x, z), 0.06)
      h.position.set(x, y, z)
      h.rotation.y = (Math.random() - 0.5) * 0.5
      this.root.add(h)
      this.houses.push(h)
      this.houseBaseY.push(y)
    }
    const trees: [number, number, number][] = [
      [cx - 12, 21, 1],
      [cx + 12.5, 22, 0.9],
      [cx - 10, 25, 0.85],
      [cx + 11, 25.5, 0.9],
      [-13, 4, 0.8],
      [13, 2, 0.75],
      [-14.5, 8, 0.7],
      [14, 9, 0.7]
    ]
    for (const [x, z, s] of trees) {
      const t = makeTree(s, this.mats)
      t.position.set(x, Math.max(valleyH(x, z), 0.06), z)
      this.root.add(t)
    }
  }

  /* ---------------------------- 防治工程 ---------------------------- */
  private buildEngineering(): void {
    const g = new THREE.Group()
    g.visible = false
    // 谷坊 / 拦挡坝（两座）
    for (const tt of [DAM_T, 0.3]) {
      const z = pathZ(tt)
      const w = pathWidth(tt)
      const bed = pathBed(tt)
      const dam = new THREE.Mesh(new THREE.BoxGeometry(w * 1.5, 3.6, 1.5), this.mats.eng)
      dam.position.set(pathX(tt), bed + 1.1, z)
      dam.castShadow = true
      g.add(dam)
      const crest = new THREE.Mesh(new THREE.BoxGeometry(w * 1.65, 0.5, 2.0), this.mats.eng2)
      crest.position.set(pathX(tt), bed + 3.0, z)
      g.add(crest)
    }
    // 排导槽（沟口两侧导流墙）
    for (const side of [-1, 1]) {
      const zc = 19
      const cx = pathX(1)
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.2, 10), this.mats.eng)
      wall.position.set(cx + side * 3.4, Math.max(valleyH(cx + side * 3.4, zc), 0.06) + 0.7, zc)
      wall.castShadow = true
      g.add(wall)
    }
    // 停淤场（沟口消能停淤）
    const field = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 7), this.mats.eng2)
    field.position.set(pathX(0.86), Math.max(valleyH(pathX(0.86), pathZ(0.86)), 0.06) + 0.2, pathZ(0.86))
    g.add(field)
    this.engGroup = g
    this.root.add(g)
  }

  /* ------------------------------ 标注 ------------------------------ */
  private addDebrisLabel(def: Omit<HazardLabelDef, 'kind'>, ext: Omit<DynamicLabel, 'label'>): void {
    const label = this.addLabel({ ...def, kind: def.id.startsWith('eg-') ? 'eng' : 'debris' })
    this.dynLabels.push({ label, ...ext })
  }

  private buildLabels(): void {
    const P = (id: string, text: string, detail: string, ext: Omit<DynamicLabel, 'label'> = {}, from?: number) =>
      this.addDebrisLabel({ id, text, detail, from }, ext)

    P('db-source', '形成区（物源区）', '沟谷上游的汇水盆地，坡面崩滑与松散堆积物在此富集。暴雨时坡面产流汇入，为泥石流提供水与固体物质。', { pos: [-9, 0, S0 + 3], dy: 2.2, dynY: true })
    P('db-channel', '流通区（沟道）', '沟道狭窄、纵坡陡峻，泥石流在此高速下泄。沟床与两侧的泥沙、漂砾被持续冲刷、裹入，流量与容重不断增大。', { pos: [11, 0, -4], dy: 2.4, dynY: true })
    P('db-head', '龙头', '泥石流前端隆起的“水—泥—石”混合体，裹挟着巨大的漂砾向前翻滚推进，是破坏力最强的部位。', { dyn: 'head' })
    P('db-surge', '阵流（波状流）', '泥石流拥塞—溃决反复发生，形成一波接一波的阵性流动。阵流往往比清水洪峰高出数倍，冲击力极强。', { dyn: 'surge' })
    P('db-fan', '堆积扇', '泥石流出沟后地形骤缓、水分下渗，石块泥沙就地停积，形成扇形堆积体。扇体上大小混杂、无层序，是泥石流最典型的地貌标志。', { dyn: 'fan' })
    P('db-boulder', '漂砾', '被流体从沟道搬运而下的大块石，在堆积扇上杂乱分布。巨大的漂砾常直接砸毁房屋、堵塞桥涵。', { pos: [-4, 0, 2], dy: 1.8, dynY: true }, 0.24)
    P('db-village', '沟口村庄', '泥石流的堆积区常是人口密集的沟口地段。扇体扩展、漂砾冲击与淤埋，使沟口村庄面临最直接的威胁。', { pos: [0, 0, 22.5], dy: 2.6, dynY: true }, 0.5)
    P('eg-dam', '拦挡坝（谷坊）', '在沟道内修建的拦挡构筑物，可拦蓄泥石流固体物质、削减洪峰流量并抬高沟床侵蚀基准。', { pos: [0, 0, pathZ(DAM_T)], dy: 4.0, dynY: true })
    P('eg-groove', '排导槽', '在沟口修筑的导流通道，将泥石流定向排导至指定区域，使其避开村庄与重要设施。', { pos: [pathX(1) + 3.4, 0, 19], dy: 3.0, dynY: true })
    P('eg-field', '停淤场', '利用沟口开阔地设置的沉沙停淤区，让泥石流在此减速停积，减少进入下游保护对象的固体物质。', { pos: [pathX(0.86), 0, pathZ(0.86)], dy: 2.6, dynY: true })
  }

  protected onEngineering(on: boolean): void {
    this.engGroup.visible = on
  }

  /* --------------------------- 逐帧更新 --------------------------- */
  private flowHeight(t: number, front: number): number {
    if (t >= front) return 0
    const lead = smooth(0, 0.03, front - t)
    const tail = smooth(0, 0.05, t)
    const surge = 0.72 + 0.28 * Math.sin((front - t) * 52.0)
    const headBulge = 1 + 1.0 * Math.exp(-Math.pow((front - t) / 0.03, 2))
    return 2.3 * lead * tail * surge * headBulge * (0.72 + 0.28 * (1 - t))
  }

  protected updateHazard(p: number, dt: number): void {
    void dt
    const front = this.state.eng ? Math.min(debrisFront(p), DAM_T - 0.01) : debrisFront(p)
    this.curFront = front
    const muddy = smooth(0.1, 0.34, p)
    const cols = FLOW_M + 1
    const anyActive = front > 0.001

    for (let k = 0; k <= FLOW_N; k += 1) {
      const base = this.flowBase[k]
      const t = k / FLOW_N
      const h = anyActive ? this.flowHeight(t, front) : 0
      for (let j = 0; j <= FLOW_M; j += 1) {
        const lat = -1 + (2 * j) / FLOW_M
        const x = base.x + lat * base.w * 0.94
        const crown = Math.sqrt(Math.max(0, 1 - lat * lat))
        const y = valleyH(x, base.z) + (h > 0.001 ? h * crown : -0.85)
        const idx = (k * cols + j) * 3
        this.flowPos[idx] = x
        this.flowPos[idx + 1] = y
        this.flowPos[idx + 2] = base.z
      }
    }
    this.flowGeo.attributes.position.needsUpdate = true
    this.flowGeo.computeVertexNormals()

    // 流体颜色：清水 → 泥浆
    const c = colorDrift(0x5fa8d8, 0x4a3620, muddy)
    this.flowMat.color.setRGB(c[0], c[1], c[2])
    this.flowMat.opacity = 0.55 + 0.41 * muddy

    // 龙头位置
    this.head.visible = anyActive && front < 1
    if (this.head.visible) {
      const bt = front
      this.head.position.set(pathX(bt), pathBed(bt) + 1.15 * (0.6 + 0.4 * muddy), pathZ(bt))
      this.head.rotation.y = Math.atan2(pathX(front) - pathX(Math.max(0, front - 0.02)), pathZ(front) - pathZ(Math.max(0, front - 0.02)))
      const pulse = 1 + 0.08 * Math.sin(p * 90)
      this.head.scale.setScalar(pulse)
    }

    // 漂砾：前端越过后随流体搬运
    const v = tmpVec
    const q = tmpQuat
    const sc = tmpScale
    const e = tmpEuler
    for (let i = 0; i < this.boulderSeeds.length; i += 1) {
      const sd = this.boulderSeeds[i]
      let bt = sd.t
      if (front > sd.t && !this.state.eng) bt = Math.max(0, front - 0.02 - (i % 5) * 0.016)
      else if (this.state.eng) bt = Math.min(sd.t, DAM_T - 0.02)
      const bx = pathX(bt) + sd.lat * pathWidth(bt) * 0.7
      const by = Math.max(valleyH(bx, pathZ(bt)), 0.06) + 0.34
      v.set(bx, by, pathZ(bt))
      e.set(sd.rot + p * 4, sd.rot * 1.3, sd.rot * 0.7)
      q.setFromEuler(e)
      sc.setScalar(sd.sc * (front > sd.t ? 0.9 : 0.62))
      tmpMat4.compose(v, q, sc)
      this.boulders.setMatrixAt(i, tmpMat4)
    }
    this.boulders.instanceMatrix.needsUpdate = true

    // 堆积扇
    const fan = this.state.eng ? 0 : fanGrow(p)
    this.fan.visible = fan > 0.01
    this.fan.position.set(pathX(1), pathBed(1) - 0.3, pathZ(1) - 1.5)
    this.fan.scale.setScalar(0.28 + 1.0 * fan)
    this.mats.fan.opacity = fan * 0.95

    // 村庄被扇体掩埋
    for (let h = 0; h < this.houses.length; h += 1) {
      const hz = this.houses[h].position.z
      const bur = smooth(18, 20.5, hz) * fan
      this.houses[h].position.y = this.houseBaseY[h] - bur * 2.0
    }
  }

  protected updateLabels(p: number): void {
    const front = this.curFront
    for (const item of this.dynLabels) {
      const L = item.label
      if (!this.labelAllowed(L, p)) {
        this.hideLabel(L)
        continue
      }
      let lx: number
      let ly: number
      let lz: number
      if (item.dyn === 'head') {
        lx = pathX(front)
        lz = pathZ(front)
        ly = pathBed(front) + 3.4
      } else if (item.dyn === 'surge') {
        const bt = Math.max(0, front - 0.14)
        lx = pathX(bt) - pathWidth(bt) * 0.8
        lz = pathZ(bt)
        ly = pathBed(bt) + 2.6
      } else if (item.dyn === 'fan') {
        lx = pathX(1) + 5
        lz = pathZ(1) + 3
        ly = pathBed(1) + 2.4
      } else if (item.pos) {
        lx = item.pos[0]
        lz = item.pos[2]
        ly = (item.dynY ? Math.max(valleyH(lx, lz), 0.06) : item.pos[1]) + (item.dy ?? 0)
      } else {
        this.hideLabel(L)
        continue
      }
      this.placeLabel(L, lx, ly, lz)
    }
  }
}

const tmpVec = new THREE.Vector3()
const tmpQuat = new THREE.Quaternion()
const tmpScale = new THREE.Vector3()
const tmpEuler = new THREE.Euler()
const tmpMat4 = new THREE.Matrix4()
