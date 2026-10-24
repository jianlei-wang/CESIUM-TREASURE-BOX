import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num } from '../types'
import { addBox, addCylinder, addLine, addSphere, addStageGround, damp, disposeObject, seeded, surface } from '../helpers'
import { createS06Model, type S06Obstacle } from '../simulations/s06.model'

interface Building {
  x: number
  z: number
  halfWidth: number
  height: number
}

const clampLocal = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

function createS06(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 260, { disc: '#18232c', accent: kit.accent })
  const city = new THREE.Group()
  const drone = new THREE.Group()
  root.add(city)
  root.add(drone)
  const buildings: Building[] = []
  let path: THREE.Group | null = null
  let lastSignature = ''
  let bank = 0
  const model = createS06Model({ altitude: 70, speed: 14, sensor: 35, wind: 2, avoidance: true, obstacles: [] })

  const body = addBox(drone, [3.2, 0.7, 3.2], [0, 0, 0], surface('#dbe9f2', { metalness: 0.6, roughness: 0.26 }))
  body.name = 'drone-body'
  addBox(drone, [1.3, 0.45, 1.3], [0, 0.42, 0], surface('#2e4b61', { metalness: 0.3 }))
  const rotors: THREE.Mesh[] = []
  for (const x of [-2.3, 2.3]) {
    for (const z of [-2.3, 2.3]) {
      addCylinder(drone, 0.12, 0.12, 3.1, [x, 0, z], surface('#334455', { metalness: 0.55 }))
      const rotor = addCylinder(drone, 1.15, 1.15, 0.06, [x, 0.28, z], surface('#9fd8ef', { transparent: true, opacity: 0.5, emissive: '#4fb3d9', emissiveIntensity: 0.5 }), 20)
      rotors.push(rotor)
    }
  }
  const sensorCone = new THREE.Mesh(
    new THREE.ConeGeometry(9, 26, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: '#67d7ff', transparent: true, opacity: 0.16, side: THREE.DoubleSide })
  )
  sensorCone.rotation.x = Math.PI / 2
  sensorCone.position.set(0, 0, 14)
  drone.add(sensorCone)

  const rebuildCity = (p: ParamValues): void => {
    for (const child of [...city.children]) disposeObject(child)
    city.clear()
    buildings.length = 0
    const count = Math.round(num(p, 'buildings', 14))
    const random = seeded(6613)
    for (let i = 0; i < count; i += 1) {
      const a = random() * Math.PI * 2
      const radius = 35 + random() * 140
      const x = Math.cos(a) * radius
      const z = Math.sin(a) * radius
      const width = 12 + random() * 14
      const height = 22 + random() * 58
      addBox(city, [width, height, width], [x, height / 2, z], surface('#596b7a', { roughness: 0.85, metalness: 0.08 }))
      addBox(city, [width * 0.6, 0.4, width * 0.6], [x, height + 0.2, z], surface('#7fd0e6', { emissive: '#2f90ad', emissiveIntensity: 0.8 }))
      buildings.push({ x, z, halfWidth: width / 2, height })
    }
    const obstacles: S06Obstacle[] = buildings.map((building) => ({ x: building.x, z: building.z, halfWidth: building.halfWidth, height: building.height }))
    model.configure({ obstacles })
  }

  const rebuildPath = (p: ParamValues): void => {
    if (path) disposeObject(path)
    const group = new THREE.Group()
    const altitude = num(p, 'altitude', 70)
    const points: THREE.Vector3[] = []
    for (let i = 0; i <= 120; i += 1) {
      const a = (i / 120) * Math.PI * 2
      points.push(new THREE.Vector3(Math.cos(a) * 105, altitude, Math.sin(a) * 105))
    }
    addLine(group, points, '#7fd0e6', 0.5)
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2
      addSphere(group, 2.2, [Math.cos(a) * 105, altitude, Math.sin(a) * 105], surface('#ffcf80', { emissive: '#c88a2c', emissiveIntensity: 1.1 }), 12)
    }
    path = group
    root.add(group)
  }

  const fixedUpdate = (dt: number, p: ParamValues): void => {
    model.configure({
      altitude: num(p, 'altitude', 70),
      speed: num(p, 'speed', 14),
      sensor: num(p, 'sensor', 35),
      wind: num(p, 'wind', 2),
      avoidance: flag(p, 'avoidance', true)
    })
    model.fixedStep(dt)
  }

  const renderSync = (alpha: number, p: ParamValues): void => {
    const dt = 1 / 60
    const showPath = flag(p, 'path', true)
    const state = model.state
    const x = state.position[0] + state.velocity[0] * alpha * dt
    const y = state.position[1] + state.velocity[1] * alpha * dt
    const z = state.position[2] + state.velocity[2] * alpha * dt
    const targetBank = clampLocal(-state.velocity[2] * 0.012, -0.35, 0.35)
    bank = damp(bank, targetBank, 3, dt)
    drone.position.set(x, y, z)
    drone.rotation.y = -state.angle
    drone.rotation.z = bank
    for (let i = 0; i < rotors.length; i += 1) rotors[i].rotation.y += dt * (25 + i * 1.5) * Math.min(2, Math.hypot(state.velocity[0], state.velocity[2]) / 8 + 0.6)
    if (path) path.visible = showPath
  }

  const update = (dt: number, p: ParamValues): void => {
    fixedUpdate(dt, p)
    renderSync(1, p)
  }

  const sync = (p: ParamValues): void => {
    const signature = `${Math.round(num(p, 'buildings', 14))}`
    if (signature !== lastSignature) {
      lastSignature = signature
      rebuildCity(p)
      rebuildPath(p)
    }
  }

  rebuildCity({ buildings: 14 } as ParamValues)
  rebuildPath({ altitude: 70 } as ParamValues)
  lastSignature = '14'

  return {
    object: root,
    update,
    fixedUpdate,
    renderSync,
    setMode: (mode) => model.setMode(mode),
    sync,
    action: (key, p) => {
      if (key === 'charge') {
        model.recharge()
        rebuildPath(p)
      }
    },
    diagnostics: () => model.diagnostics(),
    calibration: () => model.calibration(),
    readouts: () => {
      const state = model.state
      return {
        飞行高度: `${state.position[1].toFixed(1)} m`,
        当前速度: `${Math.hypot(state.velocity[0], state.velocity[2]).toFixed(1)} m/s`,
        最近障碍: `${state.nearest.toFixed(1)} m`,
        剩余电量: `${state.battery.toFixed(0)}%`,
        仿真时间: `${state.time.toFixed(1)} s`
      }
    },
    dispose: () => disposeObject(root)
  }
}

export const S06: ScenarioMeta = {
  id: 's06',
  title: '无人机航线飞行与建筑避障',
  subtitle: '航点循环、局部避障、遥测与电量模型',
  description:
    '无人机沿环形航点自动巡航，依据建筑包围盒与传感器范围抬升高度并侧向绕行；可调巡航高度、速度、感知距离、建筑密度与风漂移，实时显示最近障碍距离和剩余电量。',
  tag: 'Cesium + Three.js · 飞行与避障',
  updatedAt: '2026-10-23',
  accent: '#67d7ff',
  anchor: { lon: 116.397, lat: 39.908, height: 38 },
  camera: { range: 300, pitch: -30, heading: 26, targetY: 52 },
  metrics: [
    { key: '飞行高度', label: '飞行高度' },
    { key: '当前速度', label: '当前速度' },
    { key: '最近障碍', label: '最近障碍' },
    { key: '剩余电量', label: '剩余电量' }
  ],
  legend: [
    { color: '#dbe9f2', label: '无人机机体' },
    { color: '#7fd0e6', label: '航点路径' },
    { color: '#596b7a', label: '城市建筑' }
  ],
  hint: '降低巡航高度会触发避障抬升 · 增大感知范围可提前绕行 · 关闭避障可观察穿越风险',
  info: [
    '无人机采用简化 6DoF 运动学：位置由环形航线和速度积分，姿态只同步航向，悬停与升降为平滑跟随。',
    '避障使用建筑水平距离与高度包围盒判定，触发时同时抬升高度和侧向推离，属于局部规则避障。',
    '航点高度使用局部 ENU 高度，真实飞行需要区分 AGL、椭球高与正高，并接入禁飞区与飞控限制。'
  ],
  sections: [
    {
      title: '飞行参数',
      params: [
        { key: 'altitude', label: '巡航高度', type: 'range', min: 20, max: 160, step: 2, value: 70, unit: ' m' },
        { key: 'speed', label: '巡航速度', type: 'range', min: 5, max: 30, step: 0.5, value: 14, unit: ' m/s' },
        { key: 'sensor', label: '感知距离', type: 'range', min: 10, max: 80, step: 1, value: 35, unit: ' m' },
        { key: 'wind', label: '侧风漂移', type: 'range', min: 0, max: 12, step: 0.2, value: 2, unit: ' m/s' }
      ]
    },
    {
      title: '城市障碍',
      params: [
        { key: 'buildings', label: '建筑数量', type: 'range', min: 6, max: 24, step: 1, value: 14, unit: ' 栋' },
        { key: 'avoidance', label: '自动避障', type: 'toggle', value: true },
        { key: 'path', label: '显示航线', type: 'toggle', value: true }
      ]
    },
    {
      title: '任务操作',
      actions: [{ key: 'charge', label: '更换电池并返航', style: 'primary' }]
    }
  ],
  create: createS06
}
