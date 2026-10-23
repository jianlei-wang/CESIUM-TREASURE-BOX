import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num } from '../types'
import { addBox, addLine, addStageGround, disposeObject, seeded, surface, updateLine } from '../helpers'

interface DeckSegment {
  mesh: THREE.Mesh
  baseY: number
  offset: number
  velocity: number
  x: number
}

interface BridgeVehicle {
  group: THREE.Group
  x: number
  speed: number
  mass: number
}

function createS09(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 280, { disc: '#171f27', accent: kit.accent })
  const bridge = new THREE.Group()
  root.add(bridge)
  const deckLength = 300
  const deckY = 22
  const segments: DeckSegment[] = []
  const vehicles: BridgeVehicle[] = []
  const segmentCount = 30
  const segLength = deckLength / segmentCount
  let simTime = 0
  let midspan = 0
  let naturalFrequency = 1.8
  let lastVehicleCount = -1
  let resonanceRatio = 0
  let modeLine: THREE.Line | null = null
  const modePoints: THREE.Vector3[] = []

  for (let i = 0; i < segmentCount; i += 1) {
    const x = -deckLength / 2 + segLength * (i + 0.5)
    const mesh = addBox(bridge, [segLength * 0.96, 1.1, 16], [x, deckY, 0], surface(i % 2 ? '#68747e' : '#727f89', { roughness: 0.82 }))
    segments.push({ mesh, baseY: deckY, offset: 0, velocity: 0, x })
    modePoints.push(new THREE.Vector3(x, deckY + 2.8, -9))
  }
  addBox(bridge, [deckLength, 0.35, 0.4], [0, deckY + 1.1, -7.8], surface('#d5c07b'))
  addBox(bridge, [deckLength, 0.35, 0.4], [0, deckY + 1.1, 7.8], surface('#d5c07b'))
  for (const x of [-120, -60, 0, 60, 120]) {
    addBox(bridge, [6, deckY, 10], [x, deckY / 2, 0], surface('#5a6570', { roughness: 0.9 }))
  }
  addBox(bridge, [16, 0.8, 20], [-deckLength / 2 + 6, deckY, 0], surface('#434e58'))
  addBox(bridge, [16, 0.8, 20], [deckLength / 2 - 6, deckY, 0], surface('#434e58'))

  const buildVehicle = (): THREE.Group => {
    const group = new THREE.Group()
    addBox(group, [6.2, 1.4, 2.6], [0, 1.1, 0], surface('#4f8fc0', { metalness: 0.35, roughness: 0.45 }))
    addBox(group, [2.8, 1, 2.2], [-0.4, 2.1, 0], surface('#20384d'))
    for (const x of [-2, 2]) {
      for (const z of [-1.3, 1.3]) {
        const wheel = addBox(group, [1.1, 1.1, 0.55], [x, 0.55, z], surface('#0f171d'))
        wheel.rotation.x = Math.PI / 2
      }
    }
    return group
  }

  const rebuildVehicles = (count: number): void => {
    for (const item of vehicles) disposeObject(item.group)
    vehicles.length = 0
    const random = seeded(1818)
    for (let i = 0; i < count; i += 1) {
      const group = buildVehicle()
      bridge.add(group)
      vehicles.push({ group, x: -deckLength / 2 + random() * deckLength, speed: 14 + random() * 8, mass: 5 + random() * 14 })
    }
  }

  const update = (dt: number, p: ParamValues): void => {
    const mass = num(p, 'vehicleMass', 12)
    const speed = num(p, 'vehicleSpeed', 18)
    const stiffness = num(p, 'stiffness', 1)
    const damping = num(p, 'damping', 0.08)
    const amplification = num(p, 'amplification', 4)
    const showMode = flag(p, 'mode', true)
    simTime += dt
    naturalFrequency = 1.15 * Math.sqrt(stiffness)
    resonanceRatio = speed / Math.max(1, naturalFrequency * 10)
    for (const vehicle of vehicles) {
      vehicle.speed = speed * (0.75 + vehicle.mass / 30)
      vehicle.x += vehicle.speed * dt
      if (vehicle.x > deckLength / 2 + 10) vehicle.x = -deckLength / 2 - 10
    }
    let peakDeflection = 0
    for (const segment of segments) {
      let target = 0
      for (const vehicle of vehicles) {
        const distance = Math.abs(segment.x - vehicle.x)
        if (distance < 24) {
          const influence = Math.cos((distance / 24) * Math.PI / 2) * Math.sin(Math.PI * (segment.x + deckLength / 2) / deckLength)
          target -= influence * (mass * 0.05 + vehicle.mass * 0.02) / stiffness
        }
      }
      const stiffnessForce = 24 * stiffness
      const acceleration = (target - segment.offset) * stiffnessForce - segment.velocity * damping * 24
      segment.velocity += acceleration * dt
      segment.offset += segment.velocity * dt
      peakDeflection = Math.max(peakDeflection, Math.abs(segment.offset))
      segment.mesh.position.y = segment.baseY + segment.offset * amplification
    }
    for (const vehicle of vehicles) {
      const slot = Math.min(segmentCount - 1, Math.max(0, Math.floor((vehicle.x + deckLength / 2) / segLength)))
      const local = segments[slot]
      vehicle.group.position.set(vehicle.x, deckY + 0.6 + local.offset * amplification, 3.6)
    }
    midspan = peakDeflection
    if (showMode) {
      for (let i = 0; i < segments.length; i += 1) {
        modePoints[i].y = segments[i].baseY + segments[i].offset * amplification + 2.8
      }
      if (!modeLine) {
        modeLine = addLine(bridge, modePoints, '#ffd666', 0.9)
      } else {
        updateLine(modeLine, modePoints)
      }
    }
    if (modeLine) modeLine.visible = showMode
  }

  const sync = (p: ParamValues): void => {
    const count = Math.round(num(p, 'vehicleCount', 2))
    if (count !== lastVehicleCount) {
      lastVehicleCount = count
      rebuildVehicles(count)
    }
  }

  sync({ vehicleCount: 2 } as ParamValues)

  return {
    object: root,
    update,
    sync,
    action: (key) => {
      if (key === 'restart') {
        simTime = 0
        for (const segment of segments) {
          segment.offset = 0
          segment.velocity = 0
        }
      }
    },
    readouts: () => ({
      跨中挠度: `${(midspan * 1000).toFixed(1)} mm`,
      一阶频率: `${naturalFrequency.toFixed(2)} Hz`,
      共振比: `${resonanceRatio.toFixed(2)}`,
      活载车辆: vehicles.length,
      仿真时间: `${simTime.toFixed(1)} s`
    }),
    dispose: () => {
      if (modeLine) disposeObject(modeLine)
      disposeObject(root)
    }
  }
}

export const S09: ScenarioMeta = {
  id: 's09',
  title: '桥梁车辆荷载与结构振动',
  subtitle: '移动荷载、模态挠度与视觉放大',
  description:
    '多辆车辆按设定速度通过桥面，按影响线与一阶模态近似计算各跨段挠度，桥面随荷载起伏并绘制动态变形曲线；可调车重、车速、桥面刚度、阻尼与视觉放大倍数。',
  tag: 'Cesium + Three.js · 移动荷载',
  updatedAt: '2026-10-23',
  accent: '#9db8ff',
  anchor: { lon: 114.3, lat: 30.5, height: 24 },
  camera: { range: 320, pitch: -20, heading: 8, targetY: 20 },
  metrics: [
    { key: '跨中挠度', label: '跨中挠度' },
    { key: '一阶频率', label: '一阶频率' },
    { key: '共振比', label: '共振比' },
    { key: '活载车辆', label: '活载车辆' }
  ],
  legend: [
    { color: '#68747e', label: '桥面梁段' },
    { color: '#4f8fc0', label: '移动车辆' },
    { color: '#ffd666', label: '挠度放大曲线' }
  ],
  hint: '增大视觉放大倍数更容易观察挠度 · 车速接近结构频率时共振比升高 · 刚度越高跨中挠度越小',
  info: [
    '桥面由等长梁段组成，车辆位置对每个梁段施加余弦影响线荷载，梁段用弹簧-阻尼振子响应荷载变化。',
    '一阶频率按 1.15×√刚度 估算，视觉变形按放大倍数显示，面板中的挠度为未放大数值。',
    '工程应用需要模态叠加或有限元模型，并把车辆-桥面接触与真实刚度、质量、阻尼矩阵耦合。'
  ],
  sections: [
    {
      title: '车辆荷载',
      params: [
        { key: 'vehicleMass', label: '单车荷载', type: 'range', min: 2, max: 40, step: 1, value: 12, unit: ' t' },
        { key: 'vehicleSpeed', label: '通行速度', type: 'range', min: 5, max: 30, step: 0.5, value: 18, unit: ' m/s' },
        { key: 'vehicleCount', label: '车辆数量', type: 'range', min: 1, max: 6, step: 1, value: 2, unit: ' 辆' }
      ]
    },
    {
      title: '桥梁结构',
      params: [
        { key: 'stiffness', label: '桥面刚度', type: 'range', min: 0.2, max: 2.5, step: 0.05, value: 1 },
        { key: 'damping', label: '结构阻尼', type: 'range', min: 0.02, max: 0.3, step: 0.01, value: 0.08 },
        { key: 'amplification', label: '视觉放大', type: 'range', min: 1, max: 60, step: 1, value: 4, unit: '×' }
      ]
    },
    {
      title: '显示与操作',
      params: [{ key: 'mode', label: '变形曲线', type: 'toggle', value: true }],
      actions: [{ key: 'restart', label: '清空振动', style: 'primary' }]
    }
  ],
  create: createS09
}
