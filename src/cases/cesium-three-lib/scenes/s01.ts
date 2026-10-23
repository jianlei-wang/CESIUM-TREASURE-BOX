import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num, text } from '../types'
import { addStageGround, addLine, disposeObject, seeded, surface } from '../helpers'

interface DroppedBody {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  radius: number
  bounces: number
  trail: THREE.Line
  positions: THREE.Vector3[]
  trailClock: number
}

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
  const bodies: DroppedBody[] = []
  let simTime = 0
  let bounces = 0
  let impactPeak = 0
  let peakHeight = 0
  let lastSignature = ''

  const spawn = (p: ParamValues): void => {
    for (const body of bodies) disposeObject(body.mesh)
    bodies.length = 0
    dynamic.clear()
    const kind = text(p, 'kind', 'ball')
    const count = Math.round(num(p, 'count', 8))
    const height = num(p, 'height', 80)
    const radius = num(p, 'radius', 3)
    const random = seeded(9021)
    simTime = 0
    bounces = 0
    impactPeak = 0
    peakHeight = height
    for (let i = 0; i < count; i += 1) {
      const spread = 46
      const mesh = makeMesh(kind, radius, colors[i % colors.length])
      const entryRadius = kind === 'crate' ? radius * 1.2 : radius
      mesh.position.set((random() - 0.5) * spread, height + (random() - 0.5) * 8, (random() - 0.5) * spread)
      mesh.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI)
      dynamic.add(mesh)
      const trail = addLine(dynamic, [mesh.position.clone()], '#ffcf80', 0.55)
      bodies.push({
        mesh,
        velocity: new THREE.Vector3((random() - 0.5) * 2.4, 0, (random() - 0.5) * 2.4),
        radius: entryRadius,
        bounces: 0,
        trail,
        positions: [mesh.position.clone()],
        trailClock: 0
      })
    }
  }

  const update = (dt: number, p: ParamValues): void => {
    const gravity = num(p, 'gravity', 9.81)
    const restitution = num(p, 'restitution', 0.45)
    const spin = num(p, 'spin', 1)
    const showTrail = flag(p, 'trail', true)
    simTime += dt
    for (const body of bodies) {
      body.velocity.y -= gravity * dt
      body.mesh.position.addScaledVector(body.velocity, dt)
      if (body.mesh.position.y < body.radius) {
        body.mesh.position.y = body.radius
        const impact = Math.abs(body.velocity.y)
        impactPeak = Math.max(impactPeak, impact)
        if (impact > 1.2) {
          body.velocity.y = impact * restitution
          body.bounces += 1
          bounces += 1
        } else {
          body.velocity.y = 0
          body.velocity.x *= 0.92
          body.velocity.z *= 0.92
        }
      }
      peakHeight = Math.max(peakHeight, body.mesh.position.y)
      body.mesh.rotation.x += body.velocity.z * dt * 0.28 * spin
      body.mesh.rotation.z -= body.velocity.x * dt * 0.28 * spin
      body.trail.visible = showTrail
      body.trailClock += dt
      if (showTrail && body.trailClock > 0.075) {
        body.trailClock = 0
        body.positions.push(body.mesh.position.clone())
        if (body.positions.length > 70) body.positions.shift()
        body.trail.geometry.dispose()
        body.trail.geometry = new THREE.BufferGeometry().setFromPoints(body.positions)
      }
    }
  }

  const sync = (p: ParamValues): void => {
    const signature = `${text(p, 'kind', 'ball')}|${Math.round(num(p, 'count', 8))}|${Math.round(num(p, 'radius', 3) * 10)}`
    if (signature !== lastSignature) {
      lastSignature = signature
      spawn(p)
    }
  }

  const p0 = { kind: 'ball', count: 8, height: 80, radius: 3 } as ParamValues
  spawn(p0)
  lastSignature = 'ball|8|30'

  return {
    object: root,
    update,
    sync,
    action: (key, p) => {
      if (key === 'drop') spawn(p)
      if (key === 'clear') {
        for (const body of bodies) disposeObject(body.mesh)
        bodies.length = 0
        dynamic.clear()
        bounces = 0
        impactPeak = 0
      }
    },
    readouts: () => ({
      仿真时间: `${simTime.toFixed(1)} s`,
      累计弹跳: bounces,
      最大冲击速度: `${impactPeak.toFixed(1)} m/s`,
      观测最高点: `${peakHeight.toFixed(1)} m`,
      动态体数量: bodies.length
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
