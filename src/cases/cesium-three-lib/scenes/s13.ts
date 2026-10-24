import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num } from '../types'
import { addBox, addCylinder, addSphere, addStageGround, disposeObject, surface } from '../helpers'
import { createS13Model } from '../simulations/s13.model'

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
  let normalTick = 0
  let lastBuoys = -1
  const model = createS13Model({ waveHeight: 1.6, period: 8, direction: 35, wind: 8, draft: 1.2, buoys: 6 })

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

  const fixedUpdate = (dt: number, p: ParamValues): void => {
    model.configure({
      waveHeight: num(p, 'waveHeight', 1.6),
      period: num(p, 'period', 8),
      direction: num(p, 'direction', 35),
      wind: num(p, 'wind', 8),
      draft: num(p, 'draft', 1.2),
      buoys: Math.round(num(p, 'buoys', 6))
    })
    model.fixedStep(dt)
  }

  const renderSync = (_alpha: number, p: ParamValues): void => {
    const showWire = flag(p, 'wire', false)
    const position = geometry.attributes.position as THREE.BufferAttribute
    const state = model.state
    for (let i = 0; i < position.count; i += 1) {
      const x = base[i * 3]
      const z = base[i * 3 + 2]
      const y = model.waveAt(x, z) + Math.sin(x * 0.32 + state.time * 2.6) * num(p, 'wind', 8) * 0.015
      position.setY(i, y)
    }
    position.needsUpdate = true
    normalTick += 1
    if (normalTick % 2 === 0) geometry.computeVertexNormals()
    const draft = num(p, 'draft', 1.2)
    ship.position.set(0, state.heave - draft, 0)
    ship.rotation.z = state.roll
    ship.rotation.x = state.pitch
    for (const item of buoys) {
      item.group.position.set(item.x, model.waveAt(item.x, item.z) - 1, item.z)
      const [slopeX, slopeZ] = model.waveSlope(item.x, item.z)
      item.group.rotation.z = Math.atan(slopeX) * 0.8 + Math.sin(state.time * 1.3 + item.phase) * 0.04
      item.group.rotation.x = -Math.atan(slopeZ) * 0.8 + Math.cos(state.time * 1.05 + item.phase) * 0.03
    }
    const waterMaterial = water.material as THREE.MeshPhysicalMaterial
    waterMaterial.opacity = 0.66 + Math.min(0.22, num(p, 'waveHeight', 1.6) * 0.03)
    water.visible = true
    waterMaterial.wireframe = showWire
  }

  const update = (dt: number, p: ParamValues): void => {
    fixedUpdate(dt, p)
    renderSync(1, p)
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
    fixedUpdate,
    renderSync,
    setMode: (mode) => model.setMode(mode),
    sync,
    action: (key) => {
      if (key === 'calm') model.reset()
    },
    diagnostics: () => model.diagnostics(),
    calibration: () => model.calibration(),
    readouts: () => {
      const state = model.state
      return {
        有效波高: `${(state.waveAmplitude * 2).toFixed(2)} m`,
        横摇角: `${((state.roll * 180) / Math.PI).toFixed(1)}°`,
        纵摇角: `${((state.pitch * 180) / Math.PI).toFixed(1)}°`,
        浮力储备: `${(state.buoyancy * 100).toFixed(0)}%`,
        仿真时间: `${state.time.toFixed(1)} s`
      }
    },
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
