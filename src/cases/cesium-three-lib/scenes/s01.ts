import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num, text } from '../types'
import { addStageGround, addLine, disposeObject, seeded, surface, updateLine } from '../helpers'
import { createS01Model } from '../simulations/s01.model'

function makeMesh(kind: string, radius: number, color: string): THREE.Mesh {
  const material = surface(color, { roughness: 0.42, metalness: kind === 'ball' ? 0.65 : 0.15 })
  if (kind === 'crate') {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(radius * 1.7, radius * 1.7, radius * 1.7), material)
    return mesh
  }
  if (kind === 'barrel') {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.78, radius * 0.78, radius * 1.8, 18), material)
    return mesh
  }
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 22, 16), material)
}

function createS01(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 220, { disc: '#15232b', accent: kit.accent })
  const dynamic = new THREE.Group()
  root.add(dynamic)
  const colors = ['#ffb347', '#7fd0e6', '#f2726f', '#9be37a', '#d6a8ff']
  const meshes = new Map<number, THREE.Mesh>()
  const trails = new Map<number, { line: THREE.Line; points: THREE.Vector3[]; clock: number }>()
  let lastSignature = ''
  const model = createS01Model({
    kind: 'ball',
    count: 8,
    height: 80,
    radius: 3,
    gravity: 9.81,
    restitution: 0.45,
    spin: 1
  })

  const paramsOf = (p: ParamValues) => ({
    kind: text(p, 'kind', 'ball') as 'ball' | 'crate' | 'barrel',
    count: Math.round(num(p, 'count', 8)),
    height: num(p, 'height', 80),
    radius: num(p, 'radius', 3),
    gravity: num(p, 'gravity', 9.81),
    restitution: num(p, 'restitution', 0.45),
    spin: num(p, 'spin', 1)
  })

  const spawn = (p: ParamValues): void => {
    for (const mesh of meshes.values()) disposeObject(mesh)
    for (const trail of trails.values()) disposeObject(trail.line)
    meshes.clear()
    trails.clear()
    dynamic.clear()
    const config = paramsOf(p)
    model.reset()
    model.configure(config)
    const kind = config.kind
    const random = seeded(9021)
    for (const body of model.state.bodies) {
      const mesh = makeMesh(kind, config.radius, colors[body.id % colors.length])
      mesh.position.set(body.position[0], body.position[1], body.position[2])
      mesh.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI)
      dynamic.add(mesh)
      meshes.set(body.id, mesh)
      const line = addLine(dynamic, [mesh.position.clone()], '#ffcf80', 0.55)
      trails.set(body.id, { line, points: [mesh.position.clone()], clock: 0 })
    }
    lastSignature = `${kind}|${config.count}|${Math.round(config.radius * 10)}`
  }

  const fixedUpdate = (dt: number, p: ParamValues): void => {
    model.configure(paramsOf(p))
    model.fixedStep(dt)
  }

  const renderSync = (_alpha: number, p: ParamValues): void => {
    const showTrail = flag(p, 'trail', true)
    const spin = num(p, 'spin', 1)
    for (const body of model.state.bodies) {
      const mesh = meshes.get(body.id)
      const trail = trails.get(body.id)
      if (!mesh) continue
      mesh.position.set(body.position[0], body.position[1], body.position[2])
      if (body.active) {
        mesh.rotation.x += body.velocity[2] * 0.016 * 0.28 * spin
        mesh.rotation.z -= body.velocity[0] * 0.016 * 0.28 * spin
      }
      if (!trail) continue
      trail.line.visible = showTrail && body.active
      if (showTrail && body.active) {
        trail.clock += 1 / 60
        if (trail.clock > 0.04) {
          trail.clock = 0
          trail.points.push(mesh.position.clone())
          if (trail.points.length > 90) trail.points.shift()
          updateLine(trail.line, trail.points)
        }
      }
    }
  }

  const sync = (p: ParamValues): void => {
    const signature = `${text(p, 'kind', 'ball')}|${Math.round(num(p, 'count', 8))}|${Math.round(num(p, 'radius', 3) * 10)}`
    if (signature !== lastSignature) spawn(p)
  }

  spawn({ kind: 'ball', count: 8, height: 80, radius: 3, gravity: 9.81, restitution: 0.45, spin: 1 } as ParamValues)

  return {
    object: root,
    update: (dt, p) => {
      fixedUpdate(dt, p)
      renderSync(1, p)
    },
    fixedUpdate,
    renderSync,
    setMode: (mode) => model.setMode(mode),
    sync,
    action: (key, p) => {
      if (key === 'drop') spawn(p)
      if (key === 'clear') {
        for (const mesh of meshes.values()) disposeObject(mesh)
        for (const trail of trails.values()) disposeObject(trail.line)
        meshes.clear()
        trails.clear()
        dynamic.clear()
        model.reset()
      }
    },
    diagnostics: () => model.diagnostics(),
    calibration: () => model.calibration(),
    readouts: () => ({
      仿真时间: `${model.state.time.toFixed(1)} s`,
      累计弹跳: model.state.bounces,
      最大冲击速度: `${model.state.impactPeak.toFixed(1)} m/s`,
      观测最高点: `${model.state.peakHeight.toFixed(1)} m`,
      动态体数量: model.state.bodies.filter((body) => body.active).length
    }),
    dispose: () => disposeObject(root)
  }
}

export const S01: ScenarioMeta = {
  id: 's01',
  title: '地理空间自由落体与地形反弹',
  subtitle: 'Cesium 地球坐标下的刚体下落、碰撞与轨迹',
  description:
    '在选定地理锚点的 ENU 局部坐标中投放球体、木箱或桶体，按重力加速、地面碰撞恢复系数反弹并绘制三维轨迹；可切换几何体、数量、释放高度与材质弹性。',
  tag: 'Cesium + Three.js · 刚体动力学',
  updatedAt: '2026-10-23',
  accent: '#ffb347',
  anchor: { lon: 116.391, lat: 39.907, height: 44 },
  camera: { range: 210, pitch: -28, heading: 22, targetY: 36 },
  metrics: [
    { key: '仿真时间', label: '仿真时间' },
    { key: '累计弹跳', label: '累计弹跳' },
    { key: '最大冲击速度', label: '最大冲击速度' },
    { key: '观测最高点', label: '观测最高点' }
  ],
  legend: [
    { color: '#ffb347', label: '球体 / 木箱 / 桶体' },
    { color: '#ffcf80', label: '运动轨迹' },
    { color: '#4fb3d9', label: '地理锚点地面' }
  ],
  hint: '左键拖动地球 · 滚轮缩放 · 打开“轨迹”观察落体路径 · 改变材质弹性对比反弹高度',
  info: [
    '案例把 WGS84 锚点转换为东-北-天（ENU）局部坐标，Three.js 对象与物理计算都在以锚点为原点的米制坐标中进行。',
    '重力沿 ENU 的 Up 轴负方向作用；触地时按恢复系数反转竖直速度，水平速度按摩擦衰减。',
    '轨迹线保留最近 70 个采样点，用于观察不同恢复系数与释放高度下的弹跳形态。'
  ],
  sections: [
    {
      title: '落体工况',
      params: [
        { key: 'kind', label: '刚体类型', type: 'select', value: 'ball', options: [{ value: 'ball', label: '金属球' }, { value: 'crate', label: '木箱' }, { value: 'barrel', label: '橡胶桶' }] },
        { key: 'count', label: '投放数量', type: 'range', min: 1, max: 30, step: 1, value: 8, unit: ' 个' },
        { key: 'height', label: '释放高度', type: 'range', min: 20, max: 180, step: 5, value: 80, unit: ' m' },
        { key: 'radius', label: '刚体半径', type: 'range', min: 1, max: 6, step: 0.2, value: 3, unit: ' m' }
      ]
    },
    {
      title: '物理材质',
      params: [
        { key: 'gravity', label: '重力加速度', type: 'range', min: 3, max: 25, step: 0.1, value: 9.81, unit: ' m/s²' },
        { key: 'restitution', label: '恢复系数', type: 'range', min: 0.05, max: 0.92, step: 0.01, value: 0.45 },
        { key: 'spin', label: '翻转强度', type: 'range', min: 0, max: 3, step: 0.1, value: 1 }
      ]
    },
    {
      title: '显示与投放',
      params: [{ key: 'trail', label: '绘制运动轨迹', type: 'toggle', value: true }],
      actions: [
        { key: 'drop', label: '重新投放', style: 'primary' },
        { key: 'clear', label: '清空场景', style: 'danger' }
      ]
    }
  ],
  create: createS01
}
