import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num } from '../types'
import { addBox, addCylinder, addLine, addSphere, addStageGround, disposeObject, seeded, surface } from '../helpers'

interface Building {
  x: number
  z: number
  halfWidth: number
  height: number
}

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
  let angle = 0
  let altitudeState = 70
  let battery = 100
  let nearest = 999
  let speedState = 14
  let simTime = 0

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

  const update = (dt: number, p: ParamValues): void => {
    const altitude = num(p, 'altitude', 70)
    const speed = num(p, 'speed', 14)
    const sensor = num(p, 'sensor', 35)
    const wind = num(p, 'wind', 2)
    const avoidance = flag(p, 'avoidance', true)
    speedState = speed
    const showPath = flag(p, 'path', true)
    altitudeState += (altitude - altitudeState) * Math.min(1, dt * 1.5)
    simTime += dt
    angle += (speed * dt) / 105
    let x = Math.cos(angle) * 105
    let z = Math.sin(angle) * 105
    let y = altitudeState + Math.sin(simTime * 0.8) * 0.8
    let closest = 999
    if (avoidance) {
      for (const building of buildings) {
        const dx = x - building.x
        const dz = z - building.z
        const horizontal = Math.sqrt(dx * dx + dz * dz)
        if (horizontal < building.halfWidth + sensor) {
          closest = Math.min(closest, horizontal)
          if (y < building.height + 12) {
            y = Math.max(y, building.height + 12)
            const push = (building.halfWidth + sensor - horizontal) / Math.max(1, sensor)
            x += (dx / Math.max(1, horizontal)) * push * 16
            z += (dz / Math.max(1, horizontal)) * push * 16
          }
        }
      }
    } else {
      for (const building of buildings) {
        const dx = x - building.x
        const dz = z - building.z
        closest = Math.min(closest, Math.sqrt(dx * dx + dz * dz))
      }
    }
    nearest = closest
    const windDrift = Math.sin(simTime * 1.3 + angle) * wind * 0.35
    drone.position.set(x + windDrift, y, z)
    drone.rotation.y = -angle
    for (let i = 0; i < rotors.length; i += 1) rotors[i].rotation.y += dt * (25 + i * 1.5) * Math.min(2, speed / 8 + 0.6)
    battery = Math.max(0, battery - dt * (0.07 + speed * 0.0035))
    if (path) path.visible = showPath
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
    sync,
    action: (key, p) => {
      if (key === 'charge') {
        battery = 100
        angle = 0
        rebuildPath(p)
      }
    },
    readouts: () => ({
      飞行高度: `${drone.position.y.toFixed(1)} m`,
      当前速度: `${speedState.toFixed(1)} m/s`,
      最近障碍: `${nearest.toFixed(1)} m`,
      剩余电量: `${battery.toFixed(0)}%`,
      仿真时间: `${simTime.toFixed(1)} s`
    }),
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
