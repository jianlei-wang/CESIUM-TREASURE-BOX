import * as THREE from 'three'
import {
  BW,
  BD,
  SLIDE_HALFW,
  MAX_S,
  ZA,
  ZAP,
  ZB,
  ZC0,
  SLIDE_STAGES,
  landslideColor,
  slideS,
  slideThick,
  slideSurf,
  slideTopAt,
  smooth,
  terrainH
} from '../geo-hazard-lib/model'
import { HazardThreeBase, type HazardLabelDef, type HazardThreeCallbacks, type OverlayLabel } from '../geo-hazard-lib/three-base'
import {
  buildSlideBody,
  buildTerrainBlock,
  createHazardMaterials,
  deformSlideBody,
  makeArcCrack,
  makeHouse,
  makeSideCrack,
  makeTree,
  type HazardMaterials,
  type SlideBodyData
} from '../geo-hazard-lib/three-parts'

export { SLIDE_STAGES as STAGES } from '../geo-hazard-lib/model'

interface DynamicLabel {
  label: OverlayLabel
  dyn?: 'body' | 'step' | 'tongue'
  pos?: [number, number, number]
  dy?: number
  dynY?: boolean
}

/**
 * 滑坡 Three.js 演示：以解析式圈椅状斜坡为地形，滑体沿滑动面变形下滑，
 * 配合后缘裂缝、滑体解体碎屑、坡脚村庄掩埋与防治工程示意。
 */
export class LandslideThreeScene extends HazardThreeBase {
  private mats!: HazardMaterials
  private slideData!: SlideBodyData
  private slideBody!: THREE.Mesh
  private slideSurfMesh!: THREE.Mesh
  private backWall!: THREE.Group
  private crackA!: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private crackB!: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private crackC!: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private bulgeA!: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private bulgeB!: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private lcrack!: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private rcrack!: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private debris!: THREE.InstancedMesh
  private readonly debrisSeeds: { side: number; off: number; lat: number; rot: number; sc: number }[] = []
  private readonly houses: THREE.Group[] = []
  private readonly houseBaseY: number[] = []
  private engGroup!: THREE.Group
  private dynLabels: DynamicLabel[] = []
  private curS = 0

  private static readonly DEBRIS_COUNT = 46

  constructor(container: HTMLElement, callbacks: HazardThreeCallbacks = {}) {
    super(
      container,
      { stages: SLIDE_STAGES, radius: 66, targetY: 9, fogColor: 0x1a2836, fogNear: 110, fogFar: 260 },
      callbacks
    )
    this.bootstrap()
  }

  protected buildContent(): void {
    this.mats = createHazardMaterials()
    this.root.add(buildTerrainBlock(BW, BD, terrainH, landslideColor, 104, 112, this.mats.terrain))
    this.buildSlide()
    this.buildCracks()
    this.buildDebris()
    this.buildVillage()
    this.buildEngineering()
    this.buildLabels()
  }

  /* ------------------------------ 滑体 ------------------------------ */
  private buildSlide(): void {
    this.slideData = buildSlideBody()
    this.slideBody = new THREE.Mesh(this.slideData.geo, this.mats.slide)
    this.slideBody.castShadow = true
    this.slideBody.receiveShadow = true
    this.root.add(this.slideBody)

    // 滑动面（滑带）
    const nx = 26
    const nz = 40
    const P: number[] = []
    const I: number[] = []
    const vid = (a: number, b: number): number => b * (nx + 1) + a
    for (let j = 0; j <= nz; j += 1) {
      for (let i = 0; i <= nx; i += 1) {
        const x = -SLIDE_HALFW - 0.4 + ((2 * (SLIDE_HALFW + 0.4)) * i) / nx
        const z = ZAP + ((ZB - ZAP) * j) / nz
        P.push(x, slideSurf(x, z) + 0.04, z)
      }
    }
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        I.push(vid(i, j), vid(i, j + 1), vid(i + 1, j + 1))
        I.push(vid(i, j), vid(i + 1, j + 1), vid(i + 1, j))
      }
    }
    const surfGeo = new THREE.BufferGeometry()
    surfGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3))
    surfGeo.setIndex(I)
    surfGeo.computeVertexNormals()
    this.slideSurfMesh = new THREE.Mesh(surfGeo, this.mats.slideSurf)
    this.slideSurfMesh.renderOrder = 2
    this.root.add(this.slideSurfMesh)

    // 滑坡壁（后缘陡坎）
    const wall = new THREE.Group()
    const seg = 22
    const hw = SLIDE_HALFW - 0.6
    for (let i = 0; i < seg; i += 1) {
      const x = -hw + ((2 * hw) * i) / (seg - 1)
      const x2 = -hw + ((2 * hw) * (i + 1)) / (seg - 1)
      const yb = slideSurf(x, ZA + 0.4)
      const yt = slideSurf(x, ZA + 0.4) + Math.max(slideThick(x, ZA + 0.4), 0.4)
      const yb2 = slideSurf(x2, ZA + 0.4)
      const yt2 = slideSurf(x2, ZA + 0.4) + Math.max(slideThick(x2, ZA + 0.4), 0.4)
      const pts = [
        new THREE.Vector3(x, yb, ZA + 0.9),
        new THREE.Vector3(x2, yb2, ZA + 0.9),
        new THREE.Vector3(x2, yt2, ZA + 0.25),
        new THREE.Vector3(x, yt, ZA + 0.25)
      ]
      const g = new THREE.BufferGeometry().setFromPoints(pts)
      g.setIndex([0, 1, 2, 0, 2, 3])
      g.computeVertexNormals()
      const m = new THREE.Mesh(g, this.mats.wall)
      m.castShadow = true
      wall.add(m)
    }
    wall.visible = false
    this.backWall = wall
    this.root.add(wall)
  }

  /* ------------------------------ 裂缝 ------------------------------ */
  private buildCracks(): void {
    const mat = () => this.mats.line.clone()
    this.crackA = makeArcCrack(ZA - 2.2, 11, 1.0, terrainH, mat())
    this.crackB = makeArcCrack(ZA - 4.6, 9.5, 0.8, terrainH, mat())
    this.crackC = makeArcCrack(ZA - 7.2, 8, 0.6, terrainH, mat())
    this.root.add(this.crackA, this.crackB, this.crackC)
    this.bulgeA = makeArcCrack(12.5, 9, -1.6, terrainH, mat())
    this.bulgeB = makeArcCrack(15.2, 7, -1.1, terrainH, mat())
    this.bulgeA.visible = false
    this.bulgeB.visible = false
    this.root.add(this.bulgeA, this.bulgeB)
    const edgeX = SLIDE_HALFW - 1.1
    this.lcrack = makeSideCrack(-edgeX, ZAP + 1.5, ZB + MAX_S - 1.5, 0.7, terrainH, mat())
    this.rcrack = makeSideCrack(edgeX, ZAP + 1.5, ZB + MAX_S - 1.5, -0.7, terrainH, mat())
    this.lcrack.visible = false
    this.rcrack.visible = false
    this.root.add(this.lcrack, this.rcrack)
  }

  /* ---------------------------- 解体碎屑 ---------------------------- */
  private buildDebris(): void {
    const n = LandslideThreeScene.DEBRIS_COUNT
    this.debris = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.62, 0), this.mats.rock, n)
    this.debris.castShadow = true
    for (let i = 0; i < n; i += 1) {
      this.debrisSeeds.push({
        side: i % 2 === 0 ? -1 : 1,
        off: 1.2 + Math.random() * 11,
        lat: (Math.random() - 0.5) * 15,
        rot: Math.random() * 3.14,
        sc: 0.55 + Math.random() * 0.9
      })
    }
    this.debris.visible = false
    this.root.add(this.debris)
  }

  /* ---------------------------- 坡脚村庄 ---------------------------- */
  private buildVillage(): void {
    const spots: [number, number][] = [
      [-7.5, 15.5],
      [-2.5, 16.4],
      [2.6, 15.8],
      [7.4, 16.6],
      [-5.0, 19.2],
      [4.0, 19.6]
    ]
    for (const [x, z] of spots) {
      const h = makeHouse(2.4, 1.7, 2.0, this.mats)
      const y = Math.max(terrainH(x, z), 0.06)
      h.position.set(x, y, z)
      h.rotation.y = (Math.random() - 0.5) * 0.5
      this.root.add(h)
      this.houses.push(h)
      this.houseBaseY.push(y)
    }
    const road = new THREE.Mesh(new THREE.BoxGeometry(BW - 4, 0.22, 3.2), this.mats.road)
    road.position.set(0, Math.max(terrainH(0, 21), 0.06) + 0.12, 21)
    road.receiveShadow = true
    this.root.add(road)
    const trees: [number, number, number][] = [
      [-13, 12.5, 1],
      [-15.5, 17, 0.85],
      [12.5, 11, 1.05],
      [14.5, 17.5, 0.9],
      [-11, 4, 0.8],
      [12, 2, 0.75],
      [-14, -3, 0.7],
      [13.5, -6, 0.7]
    ]
    for (const [x, z, s] of trees) {
      const t = makeTree(s, this.mats)
      t.position.set(x, Math.max(terrainH(x, z), 0.06), z)
      this.root.add(t)
    }
  }

  /* ---------------------------- 防治工程 ---------------------------- */
  private buildEngineering(): void {
    const g = new THREE.Group()
    g.visible = false
    // 后缘截水沟
    const zc = ZA - 3.4
    for (let i = 0; i < 20; i += 1) {
      const x = -14 + (28 * i) / 19
      const y = Math.max(terrainH(x, zc), 0.06)
      const seg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 1.3), this.mats.eng)
      seg.position.set(x, y - 0.15, zc + 0.6 * Math.cos(x * 0.14))
      g.add(seg)
    }
    // 抗滑桩
    const pz = 3.2
    for (let k = 0; k < 6; k += 1) {
      const px = -11 + k * 4.4
      const py = Math.max(terrainH(px, pz), 0.06)
      const pile = new THREE.Mesh(new THREE.BoxGeometry(1.05, 8.2, 1.05), this.mats.eng)
      pile.position.set(px, py - 2.4, pz)
      pile.castShadow = true
      g.add(pile)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.5, 1.35), this.mats.eng2)
      cap.position.set(px, py + 1.7, pz)
      g.add(cap)
    }
    // 抗滑挡墙
    const wz = 12.2
    for (let m = 0; m < 16; m += 1) {
      const wx = -13 + (26 * m) / 15
      const wy = Math.max(terrainH(wx, wz), 0.06)
      const wseg = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3.4, 1.1), this.mats.eng)
      wseg.position.set(wx, wy + 1.2, wz)
      wseg.castShadow = true
      g.add(wseg)
    }
    // 仰斜排水孔
    for (let n = 0; n < 5; n += 1) {
      const dx = -8 + n * 4
      const dz = -6 + n * 2.2
      const dy = Math.max(terrainH(dx, dz), 0.06)
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 5.5, 8), this.mats.eng2)
      pipe.position.set(dx, dy + 0.4, dz)
      pipe.rotation.x = Math.PI / 2 - 0.22
      g.add(pipe)
    }
    this.engGroup = g
    this.root.add(g)
  }

  /* ------------------------------ 标注 ------------------------------ */
  private addSlideLabel(def: Omit<HazardLabelDef, 'kind'>, ext: Omit<DynamicLabel, 'label'>): void {
    const label = this.addLabel({ ...def, kind: def.id.startsWith('eg-') ? 'eng' : 'slide' })
    this.dynLabels.push({ label, ...ext })
  }

  private buildLabels(): void {
    const P = (id: string, text: string, detail: string, ext: Omit<DynamicLabel, 'label'> = {}, from?: number) =>
      this.addSlideLabel({ id, text, detail, from }, ext)

    P('lb-body', '滑坡体', '脱离母体向下滑动的那部分岩土体。滑动后虽已破碎，但仍保留相当的层序与结构，表面上常发育滑坡台阶。', { dyn: 'body' })
    P('lb-surf', '滑动面（滑带）', '滑体与下伏稳定岩土之间的剪切破坏面，含水量高、强度低，多呈弧形（圈椅状）。它是滑坡的“命门”，治理时常用测斜仪确定其深度。', { pos: [-10.5, 0, -6], dy: 1.2 })
    P('lb-wall', '滑坡壁', '滑体下滑后在后缘暴露出的圈椅状陡坎，是最醒目的滑坡识别标志。壁面上常留下滑动擦痕。', { pos: [0, 0, ZA - 0.4], dy: 3.2, dynY: true }, 0.24)
    P('lb-step', '滑坡台阶', '滑体各段滑动速度不同，形成阶梯状小平台，常与滑坡洼地相间排列。', { dyn: 'step' })
    P('lb-tongue', '滑坡舌', '滑体前端伸出的舌状堆积体，常推挤、掩埋坡脚的房屋、道路与农田。', { dyn: 'tongue' })
    P('lb-crack', '拉张裂缝', '坡体蠕动时后缘受拉形成的弧形裂缝，是最宝贵的临灾前兆——裂缝快速扩展、地面下错，往往意味着滑动即将发生。', { pos: [9.5, 0, ZA - 4.6], dy: 1.6, dynY: true })
    P('lb-exit', '剪出口', '滑动面前端与坡面相交、滑体剪出的部位，多位于坡脚附近。它决定了滑坡舌的覆盖范围。', { pos: [-9.5, 0, ZB + 0.5], dy: 1.4, dynY: true })
    P('lb-bed', '稳定山体（滑床）', '滑动面以下未发生移动的岩土体，是滑坡的稳定依托。抗滑桩必须深嵌其中才能发挥作用。', { pos: [-15.5, 0, 6], dy: 2.0, dynY: true })
    P('lb-pond', '滑坡洼地 / 滑坡湖', '滑体后部或台阶之间形成的封闭洼地，积水成湖。洼地存在说明滑体曾发生差异位移。', { pos: [0, 0, ZA - 3.0], dy: 1.4, dynY: true }, 0.35)
    P('lb-bury', '被掩埋的村庄', '滑坡舌推挤、掩埋坡脚建筑。滑坡危害通常集中在坡体与坡脚范围，边界相对清晰。', { pos: [0, 0, 17.5], dy: 2.6, dynY: true }, 0.58)
    P('eg-drain', '截排水沟', '在滑坡后缘外围修建，拦截坡外汇水、防止雨水入渗坡体。排水是滑坡治理最经济、最优先的措施。', { pos: [0, 0, ZA - 3.4], dy: 1.6, dynY: true })
    P('eg-pile', '抗滑桩', '穿过滑体、深嵌滑床的钢筋混凝土桩，直接提供抗滑力，是大型滑坡治理的主力支挡工程。', { pos: [-5, 0, 3.2], dy: 3.0, dynY: true })
    P('eg-wall', '抗滑挡墙', '修建在坡脚或滑体前缘的挡土结构，依靠自重与嵌固抵抗滑体推力，常与排水、削方减载配合使用。', { pos: [8, 0, 12.2], dy: 3.4, dynY: true })
  }

  protected onEngineering(on: boolean): void {
    this.engGroup.visible = on
  }

  /* --------------------------- 逐帧更新 --------------------------- */
  protected updateHazard(p: number, dt: number): void {
    void dt
    if (this.state.eng) {
      // 防治工程生效：抑制滑坡移动，滑体保持稳定原状
      deformSlideBody(this.slideData, 0)
      this.mats.slideSurf.opacity = 0
      this.backWall.visible = false
      this.crackA.visible = this.crackB.visible = this.crackC.visible = false
      this.lcrack.visible = this.rcrack.visible = false
      this.bulgeA.visible = this.bulgeB.visible = false
      this.debris.visible = false
      for (let h = 0; h < this.houses.length; h += 1) this.houses[h].position.y = this.houseBaseY[h]
      this.curS = 0
      return
    }

    const s = slideS(p)
    this.curS = s
    deformSlideBody(this.slideData, s)

    // 滑动面与滑坡壁：随滑体后缘让位而逐渐裸露
    const reveal = smooth(0.4, 3.6, s)
    this.mats.slideSurf.opacity = 0.92 * reveal
    this.backWall.visible = s > 1.4

    // 裂缝
    const cr = smooth(0.02, 0.14, p)
    this.crackA.material.opacity = cr
    this.crackB.material.opacity = cr * 0.8
    this.crackC.material.opacity = cr * 0.6
    this.crackA.visible = this.crackB.visible = this.crackC.visible = cr > 0.05
    const lcr = smooth(0.1, 0.32, p)
    this.lcrack.material.opacity = lcr
    this.rcrack.material.opacity = lcr * 0.9
    this.lcrack.visible = this.rcrack.visible = lcr > 0.05
    this.bulgeA.visible = this.bulgeB.visible = p > 0.62
    this.bulgeA.material.opacity = this.bulgeB.material.opacity = smooth(0.62, 0.78, p) * 0.85

    // 碎屑解体
    const dis = smooth(0.36, 0.6, p)
    this.debris.visible = dis > 0.02
    if (this.debris.visible) {
      const zFront = ZB + s - 1.5
      const v = tmpVec
      const q = tmpQuat
      const sc = tmpScale
      const e = tmpEuler
      for (let i = 0; i < this.debrisSeeds.length; i += 1) {
        const sd = this.debrisSeeds[i]
        const zz = zFront + sd.off * dis * 1.25
        const xx = sd.lat * (0.55 + 0.45 * dis)
        const yy = Math.max(terrainH(xx, zz), 0.06) + 0.4
        v.set(xx, yy, zz)
        e.set(sd.rot + p * 6, sd.rot * 1.7, sd.rot * 0.6)
        q.setFromEuler(e)
        sc.setScalar(sd.sc * (0.6 + 0.4 * dis))
        tmpMat4.compose(v, q, sc)
        this.debris.setMatrixAt(i, tmpMat4)
      }
      this.debris.instanceMatrix.needsUpdate = true
    }

    // 房屋掩埋
    for (let h = 0; h < this.houses.length; h += 1) {
      const hz = this.houses[h].position.z
      const bur = smooth(ZB + s + 1.5, ZB + s - 3.5, hz) * smooth(0.5, 0.72, p)
      this.houses[h].position.y = this.houseBaseY[h] - bur * 1.5
    }
  }

  protected updateLabels(p: number): void {
    const s = this.curS
    const zc = ZC0 + s
    for (const item of this.dynLabels) {
      const L = item.label
      if (!this.labelAllowed(L, p)) {
        this.hideLabel(L)
        continue
      }
      let lx: number
      let ly: number
      let lz: number
      if (item.dyn === 'body') {
        lx = 0
        lz = zc
        ly = slideTopAt(0, ZC0, s) + 3.6
      } else if (item.dyn === 'step') {
        lx = 7.2
        lz = zc + 3.6
        ly = slideTopAt(lx, ZC0 + 3.6, s) + 2.4
      } else if (item.dyn === 'tongue') {
        lx = 0
        lz = Math.min(ZB + s + 0.8, 21.5)
        ly = slideTopAt(0, ZB - 0.6, s) + 2.2
      } else if (item.pos) {
        lx = item.pos[0]
        lz = item.pos[2]
        ly = (item.dynY ? Math.max(terrainH(lx, lz), 0.06) : item.pos[1]) + (item.dy ?? 0)
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
