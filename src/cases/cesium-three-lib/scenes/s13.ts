import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num } from '../types'
import { addBox, addCylinder, addSphere, addStageGround, disposeObject, surface, toRad } from '../helpers'

function createS13(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 270, { disc: '#122430', accent: kit.accent })
  const geometry = new THREE.PlaneGeometry(360, 360, 42, 42)
  geometry.rotateX(-Math.PI / 2)
  const base = Float32Array.from(geometry.attributes.position.array as Float32Array)
  const water = new THREE.Mesh(
    geometry,
    new THREE.MeshPhysicalMaterial({
      color: '#1f6490',
      transparent: true,
      opacity: 0.78,
      roughness: 0.12,
      metalness: 0.25,
      side: THREE.DoubleSide,
      clearcoat: 0.8
    })
  )
  water.position.y = 0.2
  root.add(water)

  const ship = new THREE.Group()
  addBox(ship, [12, 4, 30], [0, 1.2, 0], surface('#d7e2e9', { roughness: 0.4, metalness: 0.2 }))
  addBox(ship, [10, 6, 12], [0, 5, -3], surface('#eef4f7', { roughness: 0.35 }))
  addBox(ship, [8, 2.2, 6], [0, 8.8, -3], surface('#4c6573'))
  addCylinder(ship, 0.35, 0.35, 16, [0, 14, -3], surface('#aab7c0', { metalness: 0.7 }), 10)
  addBox(ship, [12.6, 0.5, 30.6], [0, -0.9, 0], surface('#b23b32'))
  root.add(ship)

  const buoys: { group: THREE.Group; x: number; z: number; phase: number }[] = []
  const random = (() => {
    let state = 8761
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0
      return state / 4294967296
    }
  })()
  let simTime = 0
  let normalTick = 0
  let waveAmplitude = 0
  let roll = 0
  let pitch = 0
  let buoyancy = 0
  let lastBuoys = -1

  const waveAt = (x: number, z: number, height: number, period: number, direction: number): number => {
    const dir = toRad(direction)
    const dx = Math.sin(dir)
    const dz = -Math.cos(dir)
    const k = 0.035
    const omega = (Math.PI * 2) / Math.max(1, period)
    const phase = dx * x + dz * z
    return (
      height * 0.62 * Math.sin(phase * k - omega * simTime) +
      height * 0.26 * Math.sin(phase * k * 1.9 + (x - z) * 0.02 - omega * 1.35 * simTime) +
      height * 0.14 * Math.cos(z * 0.06 + omega * 1.8 * simTime)
    )
  }

  const rebuildBuoys = (count: number): void => {
    for (const item of buoys) disposeObject(item.group)
    buoys.length = 0
    for (let i = 0; i < count; i += 1) {
      const group = new THREE.Group()
      addCylinder(group, 1.2, 1.6, 3.2, [0, 0, 0], surface('#e4b64a', { roughness: 0.6, metalness: 0.2 }), 14)
      addSphere(group, 0.7, [0, 2.2, 0], surface('#ffcf80', { emissive: '#b67820', emissiveIntensity: 0.8 }), 10)
      addCylinder(group, 0.08, 0.08, 7, [0, 5, 0], surface('#dce9f2'), 8)
      root.add(group)
      const angle = (i / Math.max(1, count)) * Math.PI * 2
      const radius = 70 + random() * 75
      buoys.push({ group, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, phase: random() * Math.PI * 2 })
    }
  }

  const update = (dt: number, p: ParamValues): void => {
    const height = num(p, 'waveHeight', 1.6)
    const period = num(p, 'period', 8)
    const direction = num(p, 'direction', 35)
    const wind = num(p, 'wind', 8)
    const draft = num(p, 'draft', 1.2)
    const showWire = flag(p, 'wire', false)
    simTime += dt
    const position = geometry.attributes.position as THREE.BufferAttribute
    waveAmplitude = 0
    for (let i = 0; i < position.count; i += 1) {
      const x = base[i * 3]
      const z = base[i * 3 + 2]
      const y = waveAt(x, z, height, period, direction) + Math.sin(x * 0.32 + simTime * 2.6) * wind * 0.015
      position.setY(i, y)
      waveAmplitude = Math.max(waveAmplitude, Math.abs(y))
    }
    position.needsUpdate = true
    normalTick += 1
    if (normalTick % 2 === 0) geometry.computeVertexNormals()
    const shipWave = waveAt(0, 0, height, period, direction)
    ship.position.set(0, shipWave - draft, 0)
    roll = Math.sin(simTime * 1.2) * height * 0.12 + Math.sin(simTime * 2.1) * wind * 0.012
    pitch = Math.cos(simTime * 0.9) * height * 0.08
    ship.rotation.z = roll
    ship.rotation.x = pitch
    buoyancy = Math.max(0, height * 0.7 - draft * 0.4)
    for (const item of buoys) {
      const bob = waveAt(item.x, item.z, height, period, direction)
      item.group.position.set(item.x, bob - 1, item.z)
      item.group.rotation.z = Math.sin(simTime * 1.3 + item.phase) * height * 0.24
      item.group.rotation.x = Math.cos(simTime * 1.05 + item.phase) * height * 0.16
    }
    const waterMaterial = water.material as THREE.MeshPhysicalMaterial
    waterMaterial.opacity = 0.66 + Math.min(0.22, height * 0.03)
    water.visible = true
    waterMaterial.wireframe = showWire
  }

  const sync = (p: ParamValues): void => {
    const count = Math.round(num(p, 'buoys', 6))
    if (count !== lastBuoys) {
      lastBuoys = count
      rebuildBuoys(count)
    }
  }

  rebuildBuoys(6)
  lastBuoys = 6

  return {
    object: root,
    update,
    sync,
    action: (key) => {
      if (key === 'calm') simTime = 0
    },
    readouts: () => ({
      有效波高: `${(waveAmplitude * 2).toFixed(2)} m`,
      横摇角: `${((roll * 180) / Math.PI).toFixed(1)}°`,
      纵摇角: `${((pitch * 180) / Math.PI).toFixed(1)}°`,
      浮力储备: `${(buoyancy * 100).toFixed(0)}%`,
      仿真时间: `${simTime.toFixed(1)} s`
    }),
    dispose: () => disposeObject(root)
  }
}

export const S13: ScenarioMeta = {
  id: 's13',
  title: '波浪、船舶与浮力响应',
  subtitle: '多频波面、船体纵横摇与浮标跟随',
  description:
    '海面由多频正弦波叠加生成动态波面，船体按采样波高与斜率产生升沉、横摇和纵摇，浮标随波起伏；可调波高、周期、浪向、风速、吃水和浮标数量。',
  tag: 'Cesium + Three.js · 波浪与浮力',
  updatedAt: '2026-10-23',
  accent: '#3fa7e0',
  anchor: { lon: 110.3, lat: 20.0, height: 2 },
  camera: { range: 300, pitch: -21, heading: 28, targetY: 24 },
  metrics: [
    { key: '有效波高', label: '有效波高' },
    { key: '横摇角', label: '横摇角' },
    { key: '纵摇角', label: '纵摇角' },
    { key: '浮力储备', label: '浮力储备' }
  ],
  legend: [
    { color: '#1f6490', label: '动态波面' },
    { color: '#d7e2e9', label: '船舶船体' },
    { color: '#e4b64a', label: '浮标与航标' }
  ],
  hint: '波高增大时船体横摇明显 · 周期越长波浪越平缓 · 吃水加深会降低干舷与浮力储备',
  info: [
    '波面使用三组不同波长、频率和方向的解析波叠加，船体姿态由波面采样与相位近似得到。',
    '浮力储备根据波高与吃水的相对关系估算，用于展示趋势，未求解船体排水量与稳性曲线。',
    '真实船舶运动需要船体几何、质量惯性矩、附加质量、兴波阻力和六自由度耐波性模型。'
  ],
  sections: [
    {
      title: '海况参数',
      params: [
        { key: 'waveHeight', label: '有效波高', type: 'range', min: 0.2, max: 5, step: 0.1, value: 1.6, unit: ' m' },
        { key: 'period', label: '波浪周期', type: 'range', min: 3, max: 15, step: 0.5, value: 8, unit: ' s' },
        { key: 'direction', label: '浪向', type: 'range', min: 0, max: 360, step: 5, value: 35, unit: '°' },
        { key: 'wind', label: '海面风速', type: 'range', min: 0, max: 20, step: 0.5, value: 8, unit: ' m/s' }
      ]
    },
    {
      title: '船舶与浮标',
      params: [
        { key: 'draft', label: '船舶吃水', type: 'range', min: 0, max: 3, step: 0.1, value: 1.2, unit: ' m' },
        { key: 'buoys', label: '浮标数量', type: 'range', min: 2, max: 12, step: 1, value: 6, unit: ' 个' },
        { key: 'wire', label: '网格线框', type: 'toggle', value: false }
      ],
      actions: [{ key: 'calm', label: '重置波时', style: 'primary' }]
    }
  ],
  create: createS13
}
