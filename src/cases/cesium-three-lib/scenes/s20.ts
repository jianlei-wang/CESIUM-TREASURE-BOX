import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num } from '../types'
import { addBox, addCylinder, addLine, addSphere, addStageGround, disposeObject, surface } from '../helpers'

function createS20(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 260, { disc: '#1b1c21', accent: kit.accent })
  const city = new THREE.Group()
  const routes = new THREE.Group()
  const vehicles = new THREE.Group()
  const incidentGroup = new THREE.Group()
  root.add(city)
  root.add(routes)
  root.add(vehicles)
  root.add(incidentGroup)
  const incident = new THREE.Vector3(0, 0, 0)
  const stations = [
    new THREE.Vector3(-110, 0, 70),
    new THREE.Vector3(110, 0, 60),
    new THREE.Vector3(-100, 0, -70),
    new THREE.Vector3(100, 0, -80)
  ]
  const paths = stations.map((station) => {
    const corner = new THREE.Vector3(station.x, 0, incident.z)
    return [station, corner, incident]
  })
  const trucks = stations.map((station, index) => {
    const group = new THREE.Group()
    addBox(group, [7, 3.2, 3.2], [0, 2.2, 0], surface('#c8453c', { roughness: 0.55 }))
    addBox(group, [2.4, 2.4, 3], [2, 4.6, 0], surface('#e2e8ec'))
    addBox(group, [0.8, 0.8, 3.4], [-2.2, 1.2, 0], surface('#2b3238'))
    addBox(group, [0.8, 0.8, 3.4], [2.2, 1.2, 0], surface('#2b3238'))
    addBox(group, [0.5, 0.5, 0.5], [0, 5.9, 0], surface('#4fd6ff', { emissive: '#2f9fc4', emissiveIntensity: 1.4 }))
    vehicles.add(group)
    return { group, progress: 0, arrived: false, index }
  })
  const drone = new THREE.Group()
  addBox(drone, [4.6, 0.8, 4.6], [0, 0, 0], surface('#39434c'))
  for (const [x, z] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) {
    addCylinder(drone, 0.18, 0.18, 0.7, [x, 0, z], surface('#6f7d88'), 10)
    const rotor = addCylinder(drone, 1.5, 1.5, 0.12, [x, 0.45, z], surface('#89d8ff', { transparent: true, opacity: 0.55 }), 30)
    rotor.name = 'rotor'
  }
  addSphere(drone, 0.5, [0, -0.7, 0], surface('#ff8d6b', { emissive: '#e25434', emissiveIntensity: 1.2 }), 14)
  vehicles.add(drone)
  const fire = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: '#ff7a36', transparent: true, opacity: 0.6 })
  )
  fire.position.set(incident.x, 6, incident.z)
  incidentGroup.add(fire)
  const smoke = new THREE.Group()
  incidentGroup.add(smoke)
  for (let i = 0; i < 12; i += 1) {
    const puff = addSphere(smoke, 3 + Math.random() * 3, [(Math.random() - 0.5) * 8, 10 + Math.random() * 14, (Math.random() - 0.5) * 8], new THREE.MeshBasicMaterial({ color: '#7a8790', transparent: true, opacity: 0.22 }), 10)
    puff.name = `puff-${i}`
  }
  const buildingMaterial = surface('#4d5a66', { roughness: 0.9 })
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2
    const radius = 60 + (i % 3) * 26
    const height = 14 + (i % 5) * 9
    addBox(city, [14, height, 14], [Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius], buildingMaterial)
  }
  for (let i = 0; i < 4; i += 1) {
    const line = addLine(routes, [stations[i].clone(), new THREE.Vector3(stations[i].x, 0.4, incident.z), new THREE.Vector3(incident.x, 0.4, incident.z)], '#9fd8ef', 0.42)
    line.name = `route-${i}`
  }
  const dronePath = addLine(routes, [new THREE.Vector3(90, 0.4, 90), new THREE.Vector3(0, 0.4, 0)], '#ffd27a', 0.55)
  dronePath.name = 'drone-route'
  let simTime = 0
  let firstArrival = -1
  let droneEta = 0
  let dispatched = 0
  let droneProgress = 0
  let droneAltitude = 70
  let severity = 0.5
  let speedState = 22
  let teamCount = 2
  let coverage = 0
  let lastTeams = -1
  let showRoutes = true
  const droneOrigin = new THREE.Vector3(90, 0, 90)
  const clock = new THREE.Clock()
  clock.start()

  const reset = (count: number): void => {
    for (let i = 0; i < trucks.length; i += 1) {
      trucks[i].progress = 0
      trucks[i].arrived = false
      trucks[i].group.visible = i < count
      trucks[i].group.position.copy(stations[i])
    }
    droneProgress = 0
    simTime = 0
    firstArrival = -1
    dispatched = count
    drone.visible = true
  }

  const positionOnPath = (index: number, t: number): THREE.Vector3 => {
    const path = paths[index]
    if (t <= 0.5) return path[0].clone().lerp(path[1], t / 0.5)
    return path[1].clone().lerp(path[2], (t - 0.5) / 0.5)
  }

  const update = (dt: number, p: ParamValues): void => {
    speedState = num(p, 'speed', 22)
    severity = num(p, 'severity', 0.5)
    droneAltitude = num(p, 'altitude', 70)
    const coordination = flag(p, 'coordination', true)
    showRoutes = flag(p, 'routes', true)
    simTime += dt
    dispatched = teamCount
    const effectiveSpeed = speedState * (coordination ? 1.12 : 0.86)
    for (let i = 0; i < trucks.length; i += 1) {
      const truck = trucks[i]
      if (!truck.group.visible) continue
      if (!truck.arrived) {
        const distance = stations[i].distanceTo(incident) * 1.15
        truck.progress = Math.min(1, truck.progress + (effectiveSpeed * dt) / distance)
        const point = positionOnPath(i, truck.progress)
        truck.group.position.set(point.x, 0, point.z)
        const ahead = positionOnPath(i, Math.min(1, truck.progress + 0.02))
        truck.group.rotation.y = Math.atan2(ahead.x - point.x, ahead.z - point.z)
        if (truck.progress >= 1) {
          truck.arrived = true
          truck.group.position.set(40 + i * 8, 0, 30)
          if (firstArrival < 0) firstArrival = simTime
        }
      }
    }
    droneProgress = Math.min(1, droneProgress + (effectiveSpeed * 1.8 * dt) / 200)
    const dronePoint = droneOrigin.clone().lerp(incident, droneProgress)
    dronePoint.y = 12 + Math.sin(droneProgress * Math.PI) * droneAltitude
    drone.position.copy(dronePoint)
    drone.rotation.y += dt * 0.6
    for (const child of drone.children) {
      if (child.name === 'rotor') child.rotation.y += dt * 40
    }
    droneEta = Math.max(0, 200 * (1 - droneProgress) / (effectiveSpeed * 1.8))
    const pulse = 1 + Math.sin(simTime * 5) * 0.08 + severity * 0.4
    fire.scale.setScalar(pulse * (4 + severity * 8))
    for (const puff of smoke.children) {
      puff.position.y += dt * (2 + severity * 3)
      puff.position.x += Math.sin(simTime + puff.position.y) * dt * 0.6
      if (puff.position.y > 40) puff.position.y = 8
    }
    coverage = (5 + severity * 22) * (coordination ? 1.2 : 1)
    fire.material.opacity = 0.45 + Math.sin(simTime * 7) * 0.12
    routes.visible = showRoutes
  }

  const sync = (p: ParamValues): void => {
    const count = Math.round(num(p, 'teams', 2))
    if (count !== lastTeams) {
      lastTeams = count
      teamCount = count
      reset(count)
    }
  }

  reset(2)
  lastTeams = 2

  return {
    object: root,
    update,
    sync,
    action: (key, p) => {
      if (key === 'dispatch') reset(Math.round(num(p, 'teams', 2)))
    },
    readouts: () => ({
      首批到场: firstArrival < 0 ? '待抵达' : `${firstArrival.toFixed(1)} s`,
      出动车辆: `${dispatched} 辆`,
      无人机到达: `${droneEta.toFixed(0)} s`,
      覆盖半径: `${coverage.toFixed(0)} m`,
      事故等级: severity.toFixed(2),
      仿真时间: `${simTime.toFixed(1)} s`
    }),
    dispose: () => disposeObject(root)
  }
}

export const S20: ScenarioMeta = {
  id: 's20',
  title: '城市应急联动与救援调度',
  subtitle: '车辆路径、无人机侦察与协同响应',
  description:
    '火灾事故触发应急调度，多支地面救援队从不同站点沿道路驶向事故点，无人机从空中基地同步起飞侦察；协同开启后整体响应速度提升，实时显示首批到场时间、无人机 ETA 与现场覆盖半径。',
  tag: 'Cesium + Three.js · 应急联动',
  updatedAt: '2026-10-23',
  accent: '#ff8d6b',
  anchor: { lon: 113.3, lat: 23.1, height: 34 },
  camera: { range: 330, pitch: -30, heading: 42, targetY: 26 },
  metrics: [
    { key: '首批到场', label: '首批到场' },
    { key: '出动车辆', label: '出动车辆' },
    { key: '无人机到达', label: '无人机到达' },
    { key: '覆盖半径', label: '覆盖半径' }
  ],
  legend: [
    { color: '#c8453c', label: '地面救援车' },
    { color: '#ffd27a', label: '无人机航线' },
    { color: '#ff7a36', label: '事故热区' }
  ],
  hint: '开启协同会提升有效速度 · 事故等级越高火场和覆盖半径越大 · 无人机高度影响飞行弧线但不改变水平 ETA',
  info: [
    '救援车辆沿折线道路按里程进度行驶，抵达后停靠在事故点外围；无人机沿起点到事故点的水平连线飞行，并叠加正弦高度剖面。',
    '首批到场时间记录第一辆车完成路径的时刻，覆盖半径按事故等级和协同状态估算，用于横向比较调度方案。',
    '真实应急联动需要实时路况、交通信号优先、资源选址、多目标调度和通信指挥系统。'
  ],
  sections: [
    {
      title: '事故与力量',
      params: [
        { key: 'severity', label: '事故等级', type: 'range', min: 0.1, max: 1, step: 0.05, value: 0.5 },
        { key: 'teams', label: '出动队伍', type: 'range', min: 1, max: 4, step: 1, value: 2, unit: ' 支' },
        { key: 'speed', label: '行驶速度', type: 'range', min: 8, max: 40, step: 1, value: 22, unit: ' m/s' }
      ]
    },
    {
      title: '空中侦察',
      params: [
        { key: 'altitude', label: '无人机高度', type: 'range', min: 30, max: 140, step: 5, value: 70, unit: ' m' },
        { key: 'coordination', label: '空地协同', type: 'toggle', value: true },
        { key: 'routes', label: '显示航线', type: 'toggle', value: true }
      ],
      actions: [{ key: 'dispatch', label: '重新调度', style: 'primary' }]
    }
  ],
  create: createS20
}
