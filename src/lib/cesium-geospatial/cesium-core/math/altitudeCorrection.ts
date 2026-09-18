import { Cartesian3, Ellipsoid } from 'cesium'

const normalScratch = new Cartesian3()
const surfaceScratch = new Cartesian3()

// 源仓库算法（getAltitudeCorrectionOffset + Ellipsoid.getOsculatingSphereCenter）：
//   surfacePosition = projectOnSurface(camera)
//   osculatingSphereCenter = surfacePosition - bottomRadius * surfaceNormal
//   return -center
// 加到相机 ECEF 上即把相机平移到"以密切球中心为原点"的局部系，使坐标量级 ≈
// bottomRadius，满足 Bruneton 模型的局部球假设（领域首要风险 R1 的对策）。
// 类型用 Cesium 原生（Cesium world 即 ECEF，故 worldToECEFMatrix 退化为单位矩阵）。
//
// 【法线必须是椭球测地法线，不是径向】T9「贴地抬头山黑 / 相机拉高远处黑 / 红晕」根因：
// 此前用 normalize(surface)（径向）当 surfaceNormal。这在球上成立，但地球是 WGS84 椭球
// （赤道 6378km / 极 6357km，扁率 1/298），椭球测地法线 ≠ 径向，二者夹角最大 ~0.19°，
// 对应密切球中心偏差最大 ~21km。这会让 cameraPos/positionECEF 的 r=length() 系统性偏几
// 到几十 km，GetSunAndSkyIlluminance/GetTransmittance/GetSkyRadianceToPoint 全部查错
// LUT 行 → irradiance/transmittance/inscatter 同时崩（黑 + 红晕 + 透明一起出现）。
// three-geospatial 用真实椭球密切球（getOsculatingSphereCenter），故无此问题。
// 椭球测地法线解析式：normal = normalize(surface / radii²)。
export function getAltitudeCorrectionOffset(
  cameraECEF: Cartesian3,
  bottomRadius: number,
  ellipsoid: Ellipsoid,
  result: Cartesian3
): Cartesian3 {
  const surface = ellipsoid.scaleToGeodeticSurface(cameraECEF, surfaceScratch)
  if (surface == null) {
    return Cartesian3.clone(Cartesian3.ZERO, result)
  }
  // 椭球测地法线（解析式）：g ∇F/|∇F|，F = (x/a)²+(y/b)²+(z/c)²−1 → ∇F ∝ (x/a², y/b², z/c²)。
  // radiiSquare = ellipsoid.radii²（Cesium 已提供）。
  const normal = Cartesian3.divideComponents(
    surface,
    ellipsoid.radiiSquared,
    normalScratch
  )
  // 防御：cameraECEF 极端（NaN/原点）时 normal 退化，normalize 对 0/NaN 抛 DeveloperError。
  const normalMag = Cartesian3.magnitude(normal)
  if (!Number.isFinite(normalMag) || normalMag < 1e-15) {
    return Cartesian3.clone(Cartesian3.ZERO, result)
  }
  Cartesian3.normalize(normal, normal)
  // center = surface - bottomRadius * normal；offset = -center = bottomRadius*normal - surface
  result = Cartesian3.multiplyByScalar(normal, bottomRadius, result)
  result = Cartesian3.subtract(result, surface, result)
  return result
}
