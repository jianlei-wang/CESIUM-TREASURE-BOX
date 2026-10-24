export interface DataProvenance {
  mode: 'synthetic' | 'measured' | 'hybrid'
  crs: string
  verticalDatum: string
  units: string
  source: string
  note: string
}

const SYNTHETIC = {
  mode: 'synthetic' as const,
  crs: 'WGS84 经纬度 → 锚点 ENU（米）',
  verticalDatum: '椭球高（演示基准）',
  units: 'SI：m / s / kg / Pa / K',
  source: '内置程序化参数与合成工况',
  note: '用于教学演示，未接入实测数据，不构成工程校核结论'
}

const CASES: Record<string, DataProvenance> = {
  s01: { ...SYNTHETIC, note: '落体高度、恢复系数与半径来自面板默认值，未标定材质实测参数' },
  s02: { ...SYNTHETIC, mode: 'hybrid', note: '楼层/柱距为合成结构，破坏阈值按演示标定，未接入 BIM 构件强度' },
  s03: { ...SYNTHETIC, note: '坡面为解析地形，未接入 DEM；摩擦系数为演示取值' },
  s04: { ...SYNTHETIC, note: '库容-堰流简化模型，未接入实测 DEM、排水管网与雨量雷达' },
  s05: { ...SYNTHETIC, note: 'IDM 参数与道路线形为合成，未接入 OSM/OpenDRIVE' },
  s06: { ...SYNTHETIC, note: '障碍包围盒为场景内合成建筑，风场为解析扰动' },
  s07: { ...SYNTHETIC, note: '路线与台阶高度为演示几何，未接入 3D Tiles 碰撞代理' },
  s08: { ...SYNTHETIC, note: '吊重、索长与风速为演示参数，未接入塔吊起重量曲线' },
  s09: { ...SYNTHETIC, note: '四阶模态参数为教学取值，未接入桥梁有限元或传感器时程' },
  s10: { ...SYNTHETIC, note: '风谱与布料材料参数为合成，未接入实测风速或织物试验' },
  s11: { ...SYNTHETIC, note: '元胞燃料与风偏概率为演示标定，未接入燃料负荷调查' },
  s12: { ...SYNTHETIC, note: '降水强度与不透水率为面板参数，未接入气象雷达' },
  s13: { ...SYNTHETIC, note: 'JONSWAP 谱与船体静水力为简化参数，未接入排水量曲线与海图' },
  s14: { ...SYNTHETIC, mode: 'hybrid', note: '地震动为合成调幅正弦，未接入 PEER 实测加速度时程' },
  s15: { ...SYNTHETIC, note: '土体密度与斗容为演示参数，未接入机械规格表与土工试验' },
  s16: { ...SYNTHETIC, note: '栅格地图与巡检点为合成，未接入 BIM/OSM 路径' },
  s17: { ...SYNTHETIC, note: '人群规模与出口宽度为面板参数，未接入实测人口分布' },
  s18: { ...SYNTHETIC, note: '地层强度与推进参数为演示取值，未接入钻孔柱状图与监测数据' },
  s19: { ...SYNTHETIC, note: '高斯/Lagrangian 参数为教学工况，未接入烟囱实测排放与气象廓线' },
  s20: { ...SYNTHETIC, note: '路网、站点与事件为合成，未接入实时路况与消防资源清单' }
}

export function getProvenance(id: string): DataProvenance {
  return CASES[id] ?? SYNTHETIC
}
