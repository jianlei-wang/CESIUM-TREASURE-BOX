/**
 * 海水密度计算 —— EOS-80 (UNESCO 1983) 标准大气压下密度
 *
 * 返回位密度异常 σt = ρ(T,S,0) − 1000，单位 kg/m³，参考压力 0 dbar。
 * 该量为层结分析的正确量（潜在密度），与默认样本生成脚本使用同一公式，
 * 保证展示数值与预处理一致。真实 TEOS-10 / GSW 结果可在预处理阶段替换。
 */

const A0 = 999.842594
const A1 = 6.793952e-2
const A2 = -9.09529e-3
const A3 = 1.001685e-4
const A4 = -1.120083e-6
const A5 = 6.536332e-9
const B0 = 8.24493e-1
const B1 = -4.0899e-3
const B2 = 7.6438e-5
const B3 = -8.2467e-7
const B4 = 5.3875e-9
const C0 = -5.72466e-3
const C1 = 1.0227e-4
const C2 = -1.6546e-6
const D0 = 4.8314e-4

/** σt：由温度（°C）与盐度（PSU）计算位密度异常（kg/m³） */
export function sigmaT(temperatureC: number, salinity: number): number {
  const t = temperatureC
  const s = salinity
  const rhoW = A0 + A1 * t + A2 * t * t + A3 * t ** 3 + A4 * t ** 4 + A5 * t ** 5
  const rho =
    rhoW +
    (B0 + B1 * t + B2 * t * t + B3 * t ** 3 + B4 * t ** 4) * s +
    (C0 + C1 * t + C2 * t * t) * s * Math.sqrt(s) +
    D0 * s * s
  return rho - 1000
}

/** 密度计算方法说明，供界面与导出元数据使用 */
export const DENSITY_METHOD_NOTE = 'EOS-80 (UNESCO 1983) σt，参考压力 0 dbar，由数据块 T/S 实时计算'
