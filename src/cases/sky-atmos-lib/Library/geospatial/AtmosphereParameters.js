import { Math as CesiumMath } from "cesium";
import { Cartesian3 } from "../internal/MathTypes.js";
const paramKeys = [
  'solarIrradiance',
  'sunAngularRadius',
  'bottomRadius',
  'topRadius',
  'rayleighScattering',
  'mieScattering',
  'miePhaseFunctionG',
  'muSMin',
  'skyRadianceToLuminance',
  'sunRadianceToLuminance',
  'luminousEfficiency'
]

function applyOptions(target, params) {
  if (params == null) {
    return
  }
  for (const key of paramKeys) {
    const value = params[key]
    if (value == null) {
      continue
    }
    if (target[key] instanceof Cartesian3) {
      target[key].copy(value)
    } else {
      target[key] = value
    }
  }
}

export default class AtmosphereParameters {
  static DEFAULT = new AtmosphereParameters()

  constructor(options) {
    this.solarIrradiance = new Cartesian3(1.474, 1.8504, 1.91198)
    this.sunAngularRadius = 0.004675
    this.bottomRadius = 6360000
    this.topRadius = 6420000
    this.rayleighScattering = new Cartesian3(0.005802, 0.013558, 0.0331)
    this.mieScattering = new Cartesian3(0.003996, 0.003996, 0.003996)
    this.miePhaseFunctionG = 0.8
    this.muSMin = Math.cos(CesiumMath.toRadians(120))

    // Radiance to luminance conversion
    this.skyRadianceToLuminance = new Cartesian3(
      114974.916437,
      71305.954816,
      65310.548555
    )
    this.sunRadianceToLuminance = new Cartesian3(
      98242.786222,
      69954.398112,
      66475.012354
    )
    this.luminousEfficiency = new Cartesian3(0.2126, 0.7152, 0.0722)

    this.skyRadianceToRelativeLuminance = new Cartesian3()
    this.sunRadianceToRelativeLuminance = new Cartesian3()

    applyOptions(this, options)

    // 计算 luminance：点乘
    const luminance = Cartesian3.dot(this.luminousEfficiency, this.skyRadianceToLuminance);

    // skyRadianceToRelativeLuminance = skyRadianceToLuminance / luminance
    Cartesian3.divideByScalar(
      this.skyRadianceToLuminance,
      luminance,
      this.skyRadianceToRelativeLuminance
    );

    // sunRadianceToRelativeLuminance = sunRadianceToLuminance / luminance
    Cartesian3.divideByScalar(
      this.sunRadianceToLuminance,
      luminance,
      this.sunRadianceToRelativeLuminance
    );

  }
}
