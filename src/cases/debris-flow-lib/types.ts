// 泥石流地形侵蚀模拟 —— 公共类型与锁定参数（对应设计文档 v2.0 §5 / §9.2）

export type DebrisFlowParameters = {
  // 物理常量
  gravity: number
  waterDensity: number
  sedimentDensity: number
  // HBP 本构
  yieldStress: number
  consistencyK: number
  flowIndexN: number
  papanastasiouM: number
  // 侵蚀沉积
  erosionCoeff: number
  depositionCoeff: number
  criticalShear: number
  maxConcentration: number
  // 数值
  cflNumber: number
  minDepth: number
  maxSubsteps: number
  // 渲染
  erosionVertexScale: number
}

export const DEFAULT_PARAMETERS: DebrisFlowParameters = {
  gravity: 9.81,
  waterDensity: 1000,
  sedimentDensity: 2650,
  yieldStress: 500,
  consistencyK: 10,
  flowIndexN: 0.5,
  papanastasiouM: 1000,
  erosionCoeff: 5e-5,
  depositionCoeff: 0.05,
  criticalShear: 15,
  maxConcentration: 0.6,
  cflNumber: 0.4,
  minDepth: 0.001,
  maxSubsteps: 10,
  erosionVertexScale: 1.0
}

export const PARAMETER_HINTS: Record<keyof DebrisFlowParameters, string> = {
  gravity: '重力加速度 g，控制水沙运动的重力驱动强度。',
  waterDensity: '清水密度 ρw，参与混合密度与剪切应力计算。',
  sedimentDensity: '泥沙颗粒密度 ρs，越大侵蚀/沉积换算的体积变化越剧烈。',
  yieldStress: 'HBP 屈服应力 τy，越大泥石流越不易起动、停积更快。',
  consistencyK: 'HBP 稠度系数 K，黏性阻力项，越大流动越迟缓。',
  flowIndexN: 'HBP 流动指数 n，n<1 呈剪切稀化，越小流动性越强。',
  papanastasiouM: 'Papanastasiou 正则参数 m，越大越接近理想宾汉流体。',
  erosionCoeff: '侵蚀系数 Er，超额剪切应力转化为下切速率，越大沟床下切越快。',
  depositionCoeff: '沉积系数 Dr，浓度不足以克服临界应力时泥沙落淤的速率。',
  criticalShear: '临界起动剪应力 τc，床面剪切应力超过该值才发生侵蚀。',
  maxConcentration: '最大体积浓度 Cmax，限制水沙混合物的输沙上限。',
  cflNumber: 'CFL 数，控制单步时间步长，越小越稳定但计算量越大。',
  minDepth: '最小水深阈值，低于该值视为干床、不参与通量与侵蚀。',
  maxSubsteps: '每帧最大子步数，限制单帧计算量以维持帧率。',
  erosionVertexScale: '侵蚀显示倍率，仅放大覆盖层地形起伏的可视化，不改变物理。'
}

export type VisualMode = 0 | 1 | 2 | 3

export const VISUAL_MODE_LABELS: Array<{ id: VisualMode; label: string }> = [
  { id: 0, label: '复合' },
  { id: 1, label: '水深' },
  { id: 2, label: '流速' },
  { id: 3, label: '侵蚀淤积' }
]

export type SimStats = {
  frame: number
  simTime: number
  substeps: number
  maxDepth: number
  maxSpeed: number
  erodedVolume: number
  depositedVolume: number
  wetCells: number
  fps: number
}

export type BrushKind = 'water' | 'sediment' | 'breach' | 'rain' | 'obstacle' | 'erase'

export const BRUSH_LABELS: Array<{ id: BrushKind; label: string; hint: string }> = [
  { id: 'water', label: '水源', hint: '左键拖拽注入清水，形成径流并驱动侵蚀' },
  { id: 'sediment', label: '物源', hint: '左键拖拽注入水沙混合物（附带少量水），形成高浓度泥石流' },
  { id: 'breach', label: '溃坝', hint: '单击瞬间释放大量水沙，模拟堰塞湖溃决' },
  { id: 'rain', label: '降雨', hint: '单击开关全域降雨，强度由下方滑杆控制' },
  { id: 'obstacle', label: '障碍', hint: '左键拖拽标记不可侵蚀区，覆盖层显示为品红色' },
  { id: 'erase', label: '清除', hint: '清除注水/物源与障碍标记，恢复初始地形' }
]

export type BrushSettings = {
  radius: number
  strength: number
}

export type DomainOptions = {
  centerLon: number
  centerLat: number
  widthMeters: number
  heightMeters: number
  gridResX: number
  gridResY: number
}

export type SnapshotData = {
  terrain: Float32Array
  flux: Float32Array
  sediment: Float32Array
  width: number
  height: number
}
