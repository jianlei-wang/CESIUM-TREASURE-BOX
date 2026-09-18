// CascadedShadowMaps.ts
//
// M3 T1：sun-POV 级联正交 shadow 相机（three-geospatial CascadedShadowMaps.ts 的 Cesium 移植）。
//
// Based on the following work with slight modifications.
// https://github.com/StrandedKitty/three-csm/
// https://github.com/mrdoob/three.js/tree/r169/examples/jsm/csm
//
// MIT License
//
// Copyright (c) 2019 vtHawk
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//
// 职责：把主相机视锥按 practical split 切 N 段，每段在 light space 求正交包围盒（texel 对齐），
// 产出 per-cascade {matrix（world→light clip）, inverseMatrix（clip→world）, interval（归一化视深）}。
// 纯 TS 数学（Cesium Matrix4/Cartesian3），无 GL / 无 scene 依赖 → node 单测。
//
// three → Cesium 的矩阵语义对照：
//   camera.matrixWorld        → CascadeCameraInput.inverseViewMatrix（ECEF world 系相机位姿）
//   camera.projectionMatrixInverse → Matrix4.inverse(camera.projectionMatrix)（本文件内算）
//   Matrix4.lookAt(eye,target,up)  → lookAtMatrix（zAxis = normalize(eye - target)；three 同式）
//   Matrix4.makeOrthographic(l,r,top,bottom,n,f) → Matrix4.computeOrthographicOffCenter(l,r,bottom,top,n,f)
//     （注意参数顺序：three (l,r,top,bottom) vs Cesium (l,r,bottom,top)）
import { Cartesian2, Cartesian3, Cartesian4, Matrix3, Matrix4 } from 'cesium'
import { SUN_QUANT_STEP } from './sunQuantization'

/**
 * world 锚定缺省设计值（spec v3 Global Constraints：设计值单源）。
 * 导出供 demo `?cloudsShadowScale=N`（E1' 归因实验 radii×N）等消费方按倍率派生；
 * 类缺省引用同一常量——改这里即改全局，无第二份拷贝。
 */
export const WORLD_RADII_DEFAULT = [16e3, 33.6e3, 96e3] as const
export const WORLD_INTERVALS_DEFAULT = [0, 10e3, 21e3, 60e3] as const

export interface Cascade {
  /** 归一化视深区间 [x,y)（viewZToOrthographicDepth 域，末段 y=1）。 */
  interval: Cartesian2
  /** ECEF world → light clip（消费端 getShadowUv 用）。 */
  matrix: Matrix4
  /** light clip → ECEF world（shadow.frag cascade() 用 z=-1 反投影太阳侧起点）。 */
  inverseMatrix: Matrix4
  projectionMatrix: Matrix4
  inverseProjectionMatrix: Matrix4
  viewMatrix: Matrix4
  inverseViewMatrix: Matrix4
}

export interface CascadeCameraInput {
  /** three camera.matrixWorld 等价：ECEF world 系相机位姿（Cesium camera.inverseViewMatrix）。 */
  inverseViewMatrix: Matrix4
  /** 主相机透视投影正算矩阵（Cesium camera.frustum.projectionMatrix；log-depth 不改此矩阵）。 */
  projectionMatrix: Matrix4
  /** 完整视锥 near/far（preRender 时刻、multi-frustum 分段前的值；far 见决策 D6）。 */
  near: number
  far: number
}

export interface CascadedShadowMapsOptions {
  /** 级联段数（three 版最多 4，与 BSM array texture 层数对应）。 */
  cascadeCount: number
  /** BSM 单边尺寸（像素，方形；three 默认 512）。 */
  mapSize: number
  /** practical split 的 uniform/log 插值系数（three 默认 0.5）。 */
  splitLambda?: number
  /** 视锥半径按 fade 带扩张（three 默认 true）。 */
  fade?: boolean
  /** ortho near/far 余量（three 默认 0）。 */
  margin?: number
  /**
   * 矩阵锚定模式（spec v3 §3.1）：'frustum'（缺省）= 现实现视锥拟合；
   * 'world' = 固定 radii + 相机位置 texel snap（世界锚定，消移动闪动）。
   */
  anchor?: 'frustum' | 'world'
  /** world 模式：每层固定半径 m（spec §3.1.1 = 1.6×d 覆盖最坏取向）。缺省 [16e3, 33.6e3, 96e3]。 */
  worldRadii?: number[]
  /** world 模式：分层区间绝对距离 m（长度 cascadeCount+1；spec §3.1.4 常数区间）。缺省 [0, 10e3, 21e3, 60e3]。 */
  worldIntervals?: number[]
  /** world 模式：壳顶球半径 m（zNear 解析式用，spec §3.1.3）。缺省 6362200（bottomRadius 6360000 + shadowTopHeight 2200）。 */
  shellTopRadius?: number
  /** world 模式：near 面裕量 m（spec §3.1.3 约束 ≤30km）。缺省 3e4。 */
  worldMargin?: number
  /** world 模式：center.z snap 粗网格 m（spec §3.1.3）。缺省 1e3。 */
  zSnapGrid?: number
}

type FrustumSplitMode = 'uniform' | 'logarithmic' | 'practical'

/** 视锥切分（对齐 three helpers/splitFrustum.ts；输出归一化到 far，末项 = 1）。 */
export function splitFrustum(
  mode: FrustumSplitMode,
  count: number,
  near: number,
  far: number,
  lambda = 0.5,
  result: number[] = []
): number[] {
  for (let i = 0; i < count; ++i) {
    const uniform = (near + ((far - near) * (i + 1)) / count) / far
    const logarithmic = (near * (far / near) ** ((i + 1) / count)) / far
    result[i] =
      mode === 'uniform' ? uniform
        : mode === 'logarithmic' ? logarithmic
          : uniform + (logarithmic - uniform) * lambda // practical = lerp(uniform, log, λ)
  }
  result.length = count
  return result
}

// ── FrustumCorners（对齐 three helpers/FrustumCorners.ts，仅保留透视分支——Cesium 相机恒透视）──
// near/far 各 4 角（clip 反投影到 camera-local），far 角再沿视线截断到给定 far（防止极端 fovy 越界）。
// 注意：角点在 camera-local 系（未乘 matrixWorld），后续经 cameraToLight 变换到 light 系。
class FrustumCorners {
  readonly near = [0, 1, 2, 3].map(() => new Cartesian3())
  readonly far = [0, 1, 2, 3].map(() => new Cartesian3())

  setFromCamera(invProj: Matrix4, near: number, far: number): this {
    // clip 角顺序（three 同款）：
    //   3 --- 0
    //   |     |
    //   2 --- 1
    const nearNdc = [
      new Cartesian3(1, 1, -1), new Cartesian3(1, -1, -1),
      new Cartesian3(-1, -1, -1), new Cartesian3(-1, 1, -1)
    ]
    const farNdc = [
      new Cartesian3(1, 1, 1), new Cartesian3(1, -1, 1),
      new Cartesian3(-1, -1, 1), new Cartesian3(-1, 1, 1)
    ]
    for (let i = 0; i < 4; ++i) {
      // NDC → camera-local：齐次反投影（w 除）。near 平面 z=-1 的点在透视下 w=near，除后距离=near。
      this.near[i] = unproject(invProj, nearNdc[i], this.near[i])
      const f = unproject(invProj, farNdc[i], this.far[i])
      // far 截断（three：按视深 |z|，multiplyScalar(Math.min(far/absZ, 1))——只截不放大。
      // 不能按欧氏范数：对角射线角点会被拉近到 cos(对角半张角)·far，末段 ortho 盒收窄 20%+）
      const absZ = Math.abs(f.z)
      if (absZ > far) Cartesian3.multiplyByScalar(f, far / absZ, f)
      this.far[i] = f
    }
    return this
  }

  /** 按归一化切分点插值出子视锥角点（对齐 three FrustumCorners.split 的 lerpVectors 语义）。 */
  split(clipDepths: readonly number[], result: FrustumCorners[]): FrustumCorners[] {
    for (let index = 0; index < clipDepths.length; ++index) {
      const frustum = (result[index] ??= new FrustumCorners())
      const prev = index === 0 ? 0 : clipDepths[index - 1]
      const next = index === clipDepths.length - 1 ? 1 : clipDepths[index]
      for (let i = 0; i < 4; ++i) {
        Cartesian3.lerp(this.near[i], this.far[i], prev, frustum.near[i])
        Cartesian3.lerp(this.near[i], this.far[i], next, frustum.far[i])
      }
    }
    result.length = clipDepths.length
    return result
  }
}

function unproject(invProj: Matrix4, ndc: Cartesian3, result: Cartesian3): Cartesian3 {
  const v = new Cartesian4(ndc.x, ndc.y, ndc.z, 1.0)
  Matrix4.multiplyByVector(invProj, v, v)
  return Cartesian3.fromElements(v.x / v.w, v.y / v.w, v.z / v.w, result)
}

// ── three Matrix4.lookAt 的 Cesium 等价（three 语义：zAxis = normalize(eye - target)，basis 列 = (x,y,z)）──
function lookAtMatrix(
  eye: Cartesian3, target: Cartesian3, up: Cartesian3, result: Matrix4
): Matrix4 {
  const zAxis = Cartesian3.normalize(
    Cartesian3.subtract(eye, target, new Cartesian3()), new Cartesian3()
  )
  let xAxis = Cartesian3.cross(up, zAxis, new Cartesian3())
  // 极区退化保护（three 是扰动 zAxis 0.0001 再重算；此处换 fallback up，效果同为正交基）：
  // sunDir ∥ up=(0,1,0) 时 cross=0 → 用 (1,0,0)（此时 zAxis 必为 (0,±1,0)，与 (1,0,0) 不平行）
  if (Cartesian3.magnitude(xAxis) < 1e-9) {
    xAxis = Cartesian3.cross(new Cartesian3(1, 0, 0), zAxis, new Cartesian3())
  }
  Cartesian3.normalize(xAxis, xAxis)
  const yAxis = Cartesian3.cross(zAxis, xAxis, new Cartesian3())
  // basis 列 = (x,y,z)。⚠️ Cesium Matrix3/4 构造参数是 row-major 传入（参数名 columnNRowM，
  // 第一组三个 = 第 0 行的三列）——「列=basis」矩阵的正确参数序是逐行写各 basis 的分量
  //（M3 初版把 xAxis 填在第 0 组=第 0 行 → 旋转矩阵被转置；极点轴对齐场景 rot=identity
  // 转置不变被掩盖，2026-08-18 BSM 光深排查实锤：生产朝向下级联盒中心偏 189km、UV 全越界）。
  const rot = new Matrix3(
    xAxis.x, yAxis.x, zAxis.x,
    xAxis.y, yAxis.y, zAxis.y,
    xAxis.z, yAxis.z, zAxis.z
  )
  return Matrix4.fromRotationTranslation(rot, eye, result)
}

/** three Object3D.DEFAULT_UP（light 朝向 up；world=ECEF 下即 Y 轴）。 */
const UP = new Cartesian3(0, 1, 0)

export class CascadedShadowMaps {
  readonly cascades: Cascade[] = []
  readonly mapSize: number
  readonly splitLambda: number
  readonly fade: boolean
  readonly margin: number
  /** 矩阵锚定模式（'frustum' 缺省 = 视锥拟合；'world' = 世界锚定，spec v3 §3.1）。 */
  readonly anchor: 'frustum' | 'world'
  /** world 模式：每层固定 ortho 半径 m（长度 = cascadeCount）。 */
  readonly worldRadii: number[]
  /** world 模式：分层区间绝对距离 m（长度 = cascadeCount+1，near 项应为 0）。 */
  readonly worldIntervals: number[]
  /** world 模式：壳顶球半径 m（zNear 解析式）。 */
  readonly shellTopRadius: number
  /** world 模式：ortho near 面裕量 m。 */
  readonly worldMargin: number
  /** world 模式：center.z snap 粗网格 m。 */
  readonly zSnapGrid: number
  /** 最近一次 update 用的 far（= camera.far）。 */
  far = 0

  private readonly cameraFrustum = new FrustumCorners()
  private readonly frusta: FrustumCorners[] = []
  private readonly lightFrustum = new FrustumCorners() // 每 cascade 复用（three scratch 风格）
  private readonly splits: number[] = []
  /**
   * world 分支语义键（spec §3.2 静止跳过）：上次 update 的「各层 snap 后 center 三分量 +
   * 量化太阳格点序号」拼串。undefined = 尚未 update 过（首帧必判变化）。
   */
  private _lastWorldKey: string | undefined

  constructor(options: CascadedShadowMapsOptions) {
    this.mapSize = options.mapSize
    this.splitLambda = options.splitLambda ?? 0.5
    this.fade = options.fade ?? true
    this.margin = options.margin ?? 0
    this.anchor = options.anchor ?? 'frustum'
    this.worldRadii = options.worldRadii ?? [...WORLD_RADII_DEFAULT]
    this.worldIntervals = options.worldIntervals ?? [...WORLD_INTERVALS_DEFAULT]
    this.shellTopRadius = options.shellTopRadius ?? 6362200
    this.worldMargin = options.worldMargin ?? 3e4
    this.zSnapGrid = options.zSnapGrid ?? 1e3
    for (let i = 0; i < options.cascadeCount; ++i) {
      this.cascades.push({
        interval: new Cartesian2(),
        matrix: new Matrix4(),
        inverseMatrix: new Matrix4(),
        projectionMatrix: new Matrix4(),
        inverseProjectionMatrix: new Matrix4(),
        viewMatrix: new Matrix4(),
        inverseViewMatrix: new Matrix4()
      })
    }
  }

  get cascadeCount(): number {
    return this.cascades.length
  }

  /**
   * @param sunDirection 指向太阳的单位向量（ECEF world 系；与 camera.inverseViewMatrix 同系）
   * @param distance shadow 相机沿 sunDirection 相对包盒的偏移（three 默认 1；
   *   ortho 盒深 = radius*2 + margin，distance 过大时场景会超出盒深——编排侧应传小值）
   * @returns 矩阵是否变化（world 分支 = 语义键比较——编排据此跳过静止帧 shadowPass.render，
   *   spec §3.2；frustum 分支恒 true——视锥拟合逐帧重排，无静止白赚，绑定约束）
   */
  update(camera: CascadeCameraInput, sunDirection: Cartesian3, distance = 1): boolean {
    if (this.anchor === 'world') {
      return this.updateWorld(camera, sunDirection)
    }
    const far = camera.far
    this.far = far

    // 1) 切分区间 + 子视锥角点（camera-local 系）
    splitFrustum('practical', this.cascadeCount, camera.near, far, this.splitLambda, this.splits)
    const invProj = Matrix4.inverse(camera.projectionMatrix, new Matrix4())
    this.cameraFrustum.setFromCamera(invProj, camera.near, far)
    this.cameraFrustum.split(this.splits, this.frusta)
    for (let i = 0; i < this.cascadeCount; ++i) {
      this.cascades[i].interval.x = this.splits[i - 1] ?? camera.near / far
      this.cascades[i].interval.y = this.splits[i] ?? 0
    }
    // three 版 interval.x 首段是 0（splits[-1] ?? 0）——near/far 归一化域下 near/far≈0，统一取 0
    this.cascades[0].interval.x = 0

    // 2) light 朝向 + 相机→light 变换
    //    lightOrientation：位于原点、zAxis = normalize(0 - (-sunDir)) = sunDirection（+Z 指向太阳）
    const lightOrientation = lookAtMatrix(
      Cartesian3.ZERO, Cartesian3.multiplyByScalar(sunDirection, -1, new Cartesian3()),
      UP, new Matrix4()
    )
    const invLightOrientation = Matrix4.inverse(lightOrientation, new Matrix4())
    // cameraToLight = inv(lightOrientation) × cameraWorld（camera-local 点 → light 旋转系；
    // light 旋转系原点仍在 world 原点——ECEF 下即地心）
    const cameraToLight = Matrix4.multiply(
      invLightOrientation, camera.inverseViewMatrix, new Matrix4()
    )

    // 3) 每 cascade：ortho 包围盒 + texel 对齐 center + light 相机矩阵
    for (let i = 0; i < this.cascadeCount; ++i) {
      const cascade = this.cascades[i]
      const frustum = this.frusta[i]
      // light space 下的 8 角（bbox 用；diagonal 距离是旋转不变量，在 camera-local 系算等价）
      for (let j = 0; j < 4; ++j) {
        Matrix4.multiplyByPoint(cameraToLight, frustum.near[j], this.lightFrustum.near[j])
        Matrix4.multiplyByPoint(cameraToLight, frustum.far[j], this.lightFrustum.far[j])
      }
      // 对角线半径（three getFrustumRadius：max(far 面对角, 全视锥对角)×0.5 + fade 扩张）。
      // fade 的 z 分量必须取 camera-local z（= 视线深度，|z| ≤ far）；light 旋转系原点在地心，
      // 其 z ≈ 6.4e6，若在该系取值会把扩张量放大 ~30×（ECEF 移植坑，three 原版即在变换前取值）。
      let diagonal = Math.max(
        Cartesian3.distance(frustum.far[0], frustum.far[2]),
        Cartesian3.distance(frustum.far[0], frustum.near[2])
      )
      if (this.fade) {
        // three：diagonal += 0.25 × (farCorner.z/(far-near))² × (far-near)
        const zRatio = frustum.far[0].z / (far - camera.near)
        diagonal += 0.25 * zRatio * zRatio * (far - camera.near)
      }
      const radius = diagonal * 0.5

      // ortho 投影（注意 Cesium 参数序 (l,r,bottom,top,near,far)；three 是 (l,r,top,bottom,n,f)）
      Matrix4.computeOrthographicOffCenter(
        -radius, radius, -radius, radius, -this.margin, radius * 2 + this.margin,
        cascade.projectionMatrix
      )

      // bbox center（light space 8 角包围盒；z 取 max.z + margin = 最靠太阳侧的面外 margin）
      const min = new Cartesian3(
        Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY
      )
      const max = new Cartesian3(
        Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY
      )
      for (let j = 0; j < 4; ++j) {
        for (const p of [this.lightFrustum.near[j], this.lightFrustum.far[j]]) {
          min.x = Math.min(min.x, p.x); max.x = Math.max(max.x, p.x)
          min.y = Math.min(min.y, p.y); max.y = Math.max(max.y, p.y)
          min.z = Math.min(min.z, p.z); max.z = Math.max(max.z, p.z)
        }
      }
      const center = new Cartesian3(
        (min.x + max.x) / 2, (min.y + max.y) / 2, max.z + this.margin
      )
      // texel 对齐（防 shadow 相机平移亚像素抖动；three 同款 snapping）
      const texel = (radius * 2) / this.mapSize
      center.x = Math.round(center.x / texel) * texel
      center.y = Math.round(center.y / texel) * texel

      // light 相机：position = sunDirection×distance + centerWorld（world 系，朝太阳侧偏移），
      // centerWorld = lightOrientation × center（light 旋转系 → world）。
      const centerWorld = Matrix4.multiplyByPoint(lightOrientation, center, new Cartesian3())
      const position = Cartesian3.add(
        Cartesian3.multiplyByScalar(sunDirection, distance, new Cartesian3()),
        centerWorld,
        new Cartesian3()
      )
      // 朝向取 zAxis = +sunDirection（相机 -Z 视线沿 -sunDirection 朝场景）：
      // three 原式 lookAt(center, position) 的 zAxis = -sunDirection，与本写法差一个绕 up 的 180°
      // 旋转（x 镜像）。BSM 管线（生成 shadow.frag z=-1 反投影 + 消费 getShadowUv）只在 clip.x,y
      // 取 uv、深度在 ray 距离域比较，生成/消费共用同一矩阵 → 两种朝向数学等价；此处取「看向
      // 场景」的自然朝向，使 clip.z 语义（[-1,1] ↔ 场景盒）在 cascade 调试可视化/未来 z 剔除下默认正确。
      lookAtMatrix(position, centerWorld, UP, cascade.inverseViewMatrix)

      // 4) 派生矩阵（对齐 three update 末尾六件套）
      Matrix4.inverse(cascade.projectionMatrix, cascade.inverseProjectionMatrix)
      Matrix4.inverse(cascade.inverseViewMatrix, cascade.viewMatrix)
      Matrix4.multiply(cascade.projectionMatrix, cascade.viewMatrix, cascade.matrix)
      Matrix4.multiply(cascade.inverseViewMatrix, cascade.inverseProjectionMatrix, cascade.inverseMatrix)
    }
    return true
  }

  /**
   * world 锚定分支（spec v3 §3.1）：
   * - interval 常数（不复用 splitFrustum——near=0 产 NaN，§3.1.4）
   * - center = 相机 light 投影 snap 到固定 texel 网格（原点=地心；§3.1.2）
   * - zNear 局部相对式（盘内壳顶之上 + margin；§3.1.3）+ 光心域→相机相对域换算
   * - 单源矩阵构造（light 基一次求出，§3.1.9）
   *
   * @returns 矩阵是否变化（语义键比较，spec §3.2 静止跳过）。键相同 → 本次矩阵输出与上次
   *   逐位相同（跳过安全前提 m7：updateWorld 的矩阵输出仅依赖 center×N（snap 后确定值）与
   *   light 基（太阳函数）——interval/radius/margin 均构造期常数，far/near 不进矩阵）。
   */
  private updateWorld(camera: CascadeCameraInput, sunDirection: Cartesian3): boolean {
    const intervals = this.worldIntervals
    const radii = this.worldRadii
    const far = intervals[this.cascadeCount]
    this.far = far

    // 1) 常数 interval（归一化域）
    for (let i = 0; i < this.cascadeCount; i++) {
      this.cascades[i].interval.x = intervals[i] / far
      this.cascades[i].interval.y = intervals[i + 1] / far
    }
    this.cascades[0].interval.x = 0

    // 2) light 基（单源；z=+sunDirection 指向太阳，与现实现 lookAtMatrix(0,-sun) 同基）
    const zAxis = Cartesian3.normalize(sunDirection, new Cartesian3())
    let xAxis = Cartesian3.cross(UP, zAxis, new Cartesian3())
    if (Cartesian3.magnitude(xAxis) < 1e-9) {
      xAxis = Cartesian3.cross(new Cartesian3(1, 0, 0), zAxis, new Cartesian3())
    }
    Cartesian3.normalize(xAxis, xAxis)
    const yAxis = Cartesian3.cross(zAxis, xAxis, new Cartesian3())
    // ⚠️ row-major 参数序（69ee488 坑）：「列=basis」须逐行写各 basis 分量
    const rot = new Matrix3(
      xAxis.x, yAxis.x, zAxis.x,
      xAxis.y, yAxis.y, zAxis.y,
      xAxis.z, yAxis.z, zAxis.z
    )
    const invRot = Matrix3.transpose(rot, new Matrix3())

    // 3) 相机位置 → light 系（纯旋转，原点=地心）
    const camPos = Matrix4.getTranslation(camera.inverseViewMatrix, new Cartesian3())
    const camLight = Matrix3.multiplyByVector(invRot, camPos, new Cartesian3())

    // 语义键·太阳项：量化格点序号（整数比较，比向量 epsilon 比较更简且稳定）。粒度 =
    // SUN_QUANT_STEP（与编排侧量化网格同源，§3.1.8）——编排喂量化太阳时键格点恰为输入
    // 格点（矩阵只在格点跳变，键精确匹配）；喂精确太阳时 <半格微变被吸收进跳过（与量化
    // 设计同精度）。用 zAxis（已 normalize，同输入确定性同值）而非原始 sunDirection——
    // 不假设调用者已归一。theta 用 clamp 防浮点越界 acos NaN。
    const thetaGrid = Math.round(
      Math.acos(Math.min(1, Math.max(-1, zAxis.z))) / SUN_QUANT_STEP
    )
    const phiGrid = Math.round(Math.atan2(zAxis.y, zAxis.x) / SUN_QUANT_STEP)

    // 语义键·center 项：每层 snap 后的三分量（snap 输出 = 整数格点 × 格宽，同格点输入
    // 逐位同值 → 字符串稳定；跨格点必变）。矩阵重算总是执行（值幂等），键仅决定返回值。
    let key = ''
    for (let i = 0; i < this.cascadeCount; i++) {
      const radius = radii[i]
      const texel = (radius * 2) / this.mapSize
      const cascade = this.cascades[i]

      // center.xy snap 到固定 texel 网格；center.z snap 到粗网格（z 无消费语义，§3.1.3）
      const center = new Cartesian3(
        Math.round(camLight.x / texel) * texel,
        Math.round(camLight.y / texel) * texel,
        Math.round(camLight.z / this.zSnapGrid) * this.zSnapGrid
      )
      key += `${center.x},${center.y},${center.z};`

      // zNear 局部相对式（光心域，spec §3.1.3）：盘内壳顶最大 z + margin。
      // 定义域扩展（fix round 1）：rhoMin ≥ Rtop 时盘柱与壳顶球不相交、盒内无云，
      // 负数开根会 NaN 污染整矩阵（实测 8km+0°/100km 低仰角/449km+10° 全炸）——
      // clamp 到 0 使 zNear=margin 良定义，深度图空白即该域正确结果。
      const rhoC = Math.hypot(center.x, center.y)          // 盘心距日轴
      const rhoMin = Math.max(0, rhoC - radius)             // 盘缘最近距日轴
      const Rtop = this.shellTopRadius
      const zNearGeo = Math.sqrt(Math.max(0, Rtop * Rtop - rhoMin * rhoMin)) + this.worldMargin
      // 域换算（fix round 2 符号修正）：欲令 z=−1 面（太阳侧 march 起点）落在光心域
      // z = zNearGeo，按 Cesium near 语义（z_clip=−1 ⟺ z_view=−near）须 near = center.z −
      // zNearGeo。brief/spec 原式 zNearGeo−center.z 差一符号：z 面曾落在 2·center.z−zNearGeo
      // （低空相机+低仰角时切进壳内/地下，|p|<Rtop），T2 zNear 用例当初绿是被 xy 双扣掩护
      // （角点 rho 被推到 |2c|≈1.27e7，|p| 恒巨）——xy 修复后掩护消失显形。
      // orthoNear 可为负（面在太阳侧=相机身后，正交投影合法，frustum 分支 near=−margin 同款）。
      const orthoNear = center.z - zNearGeo
      const orthoFar = orthoNear + 2e5 // far 随意给足（clip.z 全管线无消费，spec §3.1.3）

      // ortho（对称盒，light 相机相对域；Cesium 参数序 (l,r,bottom,top,near,far)）。
      // ⚠️ 域语义（fix round 2，task-2-report 论证）：§3.1.9 单源构造的 viewMatrix 已平移
      // −centerWorld（盒中心归零），projection 参数必须在相机相对域取 ±radius 对称盒——
      // 若塞光心域绝对坐标 c±radius 则 center 被双重扣除（clip.xy=(x−2c)/r₀），北极用例
      // c.xy=0 退化无偏被掩盖，一般机位盒中心偏到 2c（~1e6m）→ 云壳出盒 → BSM 全空。
      // 与 frustum 分支同款；z 域同样须相机相对域（见下方 orthoNear 符号修正）。
      Matrix4.computeOrthographicOffCenter(
        -radius, radius, -radius, radius,
        orthoNear, orthoFar,
        cascade.projectionMatrix
      )

      // 单源 light 相机：rotation=rot、translation=centerWorld（§3.1.9，不走 lookAtMatrix）
      const centerWorld = Matrix3.multiplyByVector(rot, center, new Cartesian3())
      Matrix4.fromRotationTranslation(rot, centerWorld, cascade.inverseViewMatrix)

      Matrix4.inverse(cascade.projectionMatrix, cascade.inverseProjectionMatrix)
      Matrix4.inverse(cascade.inverseViewMatrix, cascade.viewMatrix)
      Matrix4.multiply(cascade.projectionMatrix, cascade.viewMatrix, cascade.matrix)
      Matrix4.multiply(cascade.inverseViewMatrix, cascade.inverseProjectionMatrix, cascade.inverseMatrix)
    }

    // 键比较（spec §3.2）：相同 → 本次矩阵与上次逐位一致，编排可跳过 render（返回 false）。
    key += `${thetaGrid},${phiGrid}`
    if (key === this._lastWorldKey) return false
    this._lastWorldKey = key
    return true
  }
}
