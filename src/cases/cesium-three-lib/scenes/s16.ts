import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num, text } from '../types'
import { addBox, addLine, addSphere, addStageGround, disposeObject, seeded, surface } from '../helpers'

function createS16(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 250, { disc: '#1a222c', accent: kit.accent })
  const city = new THREE.Group()
  const pathGroup = new THREE.Group()
  const robot = new THREE.Group()
  root.add(city)
  root.add(pathGroup)
  root.add(robot)
  const random = seeded(6121)
  for (let i = 0; i < 16; i += 1) {
    const angle = random() * Math.PI * 2
    const radius = 30 + random() * 110
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    const width = 12 + random() * 12
    const height = 16 + random() * 42
    addBox(city, [width, height, width], [x, height / 2, z], surface('#59697a', { roughness: 0.86 }))
    addBox(city, [width * 0.62, 0.4, width * 0.62], [x, height + 0.2, z], surface('#7fd0e6', { emissive: '#2f90ad', emissiveIntensity: 0.7 }))
  }
  robot.scale.setScalar(1.8)
  addBox(robot, [5.6, 1.4, 4.2], [0, 1.2, 0], surface('#e07a3f', { roughness: 0.5, metalness: 0.2 }))
  addBox(robot, [3.2, 2.2, 2.8], [0, 3, -0.2], surface('#283b4a'))
  addSphere(robot, 0.65, [0, 4.5, 0], surface('#9fd8ef', { emissive: '#4fb3d9', emissiveIntensity: 0.7 }), 12)
  addBox(robot, [0.7, 2.2, 0.7], [-1.8, 1, 0], surface('#33414d'))
  addBox(robot, [0.7, 2.2, 0.7], [1.8, 1, 0], surface('#33414d'))
  const scanner = new THREE.Mesh(
    new THREE.ConeGeometry(7, 24, 18, 1, true),
    new THREE.MeshBasicMaterial({ color: '#67d7ff', transparent: true, opacity: 0.12, side: THREE.DoubleSide })
  )
  scanner.rotation.x = Math.PI / 2
  scanner.position.set(0, 3.6, 12)
  robot.add(scanner)
  let waypoints: THREE.Vector3[] = []
  let route: THREE.Vector3[] = []
  let routeLength = 1
  let progress = 0
  let battery = 100
  let nearest = 999
  let scanned = '—'
  let simTime = 0
  let lastWaypoints = -1
  let speedState = 1.6

  const buildRoute = (count: number): void => {
    for (const child of [...pathGroup.children]) disposeObject(child)
    pathGroup.clear()
    waypoints = []
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2
      const radius = 100
      waypoints.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius))
    }
    route = []
    for (let i = 0; i < waypoints.length; i += 1) {
      const from = waypoints[i]
      const to = waypoints[(i + 1) % waypoints.length]
      for (let step = 0; step < 16; step += 1) route.push(from.clone().lerp(to, step / 16))
    }
    route.push(route[0].clone())
    routeLength = 0
    for (let i = 1; i < route.length; i += 1) routeLength += route[i].distanceTo(route[i - 1])
    addLine(pathGroup, route, '#8fd6ff', 0.5)
    for (const point of waypoints) addSphere(pathGroup, 2.4, [point.x, 2.4, point.z], surface('#ffcf80', { emissive: '#c88a2c', emissiveIntensity: 1 }), 12)
    progress = 0
  }

  const sampleRoute = (distance: number): THREE.Vector3 => {
    let remaining = distance % Math.max(1, routeLength)
    for (let i = 1; i < route.length; i += 1) {
      const segment = route[i].distanceTo(route[i - 1])
      if (remaining <= segment) return route[i - 1].clone().lerp(route[i], remaining / Math.max(0.001, segment))
      remaining -= segment
    }
    return route[0].clone()
  }

  const update = (dt: number, p: ParamValues): void => {
    const speed = num(p, 'speed', 1.6)
    const scanRange = num(p, 'scanRange', 25)
    const avoidance = flag(p, 'avoidance', true)
    const showPath = flag(p, 'path', true)
    const kind = text(p, 'robotType', 'wheeled')
    speedState = speed * (kind === 'quadruped' ? 0.8 : 1)
    simTime += dt
    progress += (speedState * dt) / Math.max(1, routeLength)
    const point = sampleRoute(progress * routeLength)
    const near = sampleRoute((progress * routeLength + 3) % routeLength)
    const heading = Math.atan2(near.x - point.x, near.z - point.z)
    let lateral = 0
    if (avoidance) lateral = Math.sin(progress * Math.PI * 14) * 3.5
    robot.position.set(point.x + Math.cos(heading) * lateral, 0.05, point.z - Math.sin(heading) * lateral)
    robot.rotation.y = heading
    scanner.position.z = 12
    scanner.scale.setScalar(scanRange / 25)
    scanner.visible = true
    nearest = 999
    scanned = '未发现目标'
    let closest: THREE.Vector3 | null = null
    for (const child of city.children) {
      if (!(child instanceof THREE.Mesh)) continue
      const dx = child.position.x - robot.position.x
      const dz = child.position.z - robot.position.z
      const distance = Math.sqrt(dx * dx + dz * dz)
      nearest = Math.min(nearest, distance)
      if (distance < scanRange + 12 && !closest) closest = child.position.clone()
    }
    if (closest) scanned = `建筑 (${closest.x.toFixed(0)}, ${closest.z.toFixed(0)})`
    battery = Math.max(0, battery - dt * (0.03 + speedState * 0.008))
    pathGroup.visible = showPath
  }

  const sync = (p: ParamValues): void => {
    const count = Math.round(num(p, 'waypoints', 6))
    if (count !== lastWaypoints) {
      lastWaypoints = count
      buildRoute(count)
    }
  }

  buildRoute(6)
  lastWaypoints = 6

  return {
    object: root,
    update,
    sync,
    action: (key) => {
      if (key === 'recharge') {
        battery = 100
        progress = 0
      }
    },
    readouts: () => ({
      巡检进度: `${Math.min(100, progress * 100).toFixed(0)}%`,
      剩余电量: `${battery.toFixed(0)}%`,
      最近障碍: `${nearest.toFixed(1)} m`,
      扫描目标: scanned,
      仿真时间: `${simTime.toFixed(1)} s`
    }),
    dispose: () => disposeObject(root)
  }
}

export const S16: ScenarioMeta = {
  id: 's16',
  title: '机器人巡检导航与目标感知',
  subtitle: '路径跟随、局部绕行与扫描目标识别',
  description:
    '巡检机器人沿园区航点路线循环运动，遇障碍时按横向偏移绕行，前向感知锥随扫描距离缩放并识别最近建筑目标；可调速度、感知范围、航点数量与机器人类型。',
  tag: 'Cesium + Three.js · 机器人导航',
  updatedAt: '2026-10-23',
  accent: '#e07a3f',
  anchor: { lon: 118.8, lat: 32.0, height: 22 },
  camera: { range: 240, pitch: -26, heading: 78, targetY: 18 },
  metrics: [
    { key: '巡检进度', label: '巡检进度' },
    { key: '剩余电量', label: '剩余电量' },
    { key: '最近障碍', label: '最近障碍' },
    { key: '扫描目标', label: '扫描目标' }
  ],
  legend: [
    { color: '#e07a3f', label: '巡检机器人' },
    { color: '#8fd6ff', label: '巡检路线' },
    { color: '#67d7ff', label: '感知锥' }
  ],
  hint: '增加航点会改变巡检路线长度 · 感知范围扩大后更容易发现远处目标 · 电量耗尽前可点击重新充电',
  info: [
    '机器人沿折线航点路线按里程参数前进，横向偏移模拟局部避障动作，扫描范围由前向圆锥可视化。',
    '建筑目标识别以距离阈值判断，只显示最近目标坐标，不包含相机视场遮挡和语义识别。',
    '真实巡检机器人需要栅格/拓扑地图、定位与建图、路径规划、避障传感器和任务调度。'
  ],
  sections: [
    {
      title: '巡检任务',
      params: [
        { key: 'speed', label: '巡检速度', type: 'range', min: 0.5, max: 5, step: 0.1, value: 1.6, unit: ' m/s' },
        { key: 'waypoints', label: '航点数量', type: 'range', min: 3, max: 10, step: 1, value: 6, unit: ' 个' },
        { key: 'robotType', label: '机器人类型', type: 'select', value: 'wheeled', options: [{ value: 'wheeled', label: '轮式巡检车' }, { value: 'quadruped', label: '四足机器人' }] }
      ]
    },
    {
      title: '感知与避障',
      params: [
        { key: 'scanRange', label: '感知范围', type: 'range', min: 5, max: 50, step: 1, value: 25, unit: ' m' },
        { key: 'avoidance', label: '局部绕行', type: 'toggle', value: true },
        { key: 'path', label: '显示路线', type: 'toggle', value: true }
      ],
      actions: [{ key: 'recharge', label: '充电并重新出发', style: 'primary' }]
    }
  ],
  create: createS16
}
