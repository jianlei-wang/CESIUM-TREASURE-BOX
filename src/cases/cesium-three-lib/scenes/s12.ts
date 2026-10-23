import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num, text } from '../types'
import { addBox, addCylinder, addPillar, addStageGround, disposeObject, seeded, surface } from '../helpers'

function createS12(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 240, { disc: '#1b2428', accent: kit.accent })
  const random = seeded(5107)
  for (let i = 0; i < 7; i += 1) {
    const x = -110 + random() * 220
    const z = -100 + random() * 200
    addPillar(root, [x, 0, z], 12 + random() * 12, 18 + random() * 46, 12 + random() * 8, i % 2 ? '#66737e' : '#77848f', true)
  }
  addCylinder(root, 0.35, 0.5, 12, [85, 6, 55], surface('#a5b2bb', { metalness: 0.6 }), 12)
  addBox(root, [3, 0.2, 3], [85, 12.2, 55], surface('#e0bd62'))

  const maxParticles = 1500
  const positions = new Float32Array(maxParticles * 3)
  const states: { x: number; y: number; z: number; speed: number; drift: number }[] = []
  for (let i = 0; i < maxParticles; i += 1) {
    const x = (random() - 0.5) * 260
    const y = random() * 160
    const z = (random() - 0.5) * 260
    positions[i * 3] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z
    states.push({ x, y, z, speed: 0, drift: random() * Math.PI * 2 })
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({ color: '#9bd8f0', size: 1.5, transparent: true, opacity: 0.75, depthWrite: false })
  const particles = new THREE.Points(geometry, material)
  root.add(particles)

  const puddle = new THREE.Mesh(
    new THREE.CircleGeometry(130, 64),
    new THREE.MeshPhysicalMaterial({ color: '#3b8fc4', transparent: true, opacity: 0.36, roughness: 0.2, metalness: 0.1, side: THREE.DoubleSide })
  )
  puddle.rotation.x = -Math.PI / 2
  puddle.position.y = 0.04
  root.add(puddle)
  const puddleRing = new THREE.Mesh(
    new THREE.RingGeometry(129, 132, 96),
    new THREE.MeshBasicMaterial({ color: '#8fe0ff', transparent: true, opacity: 0.4, side: THREE.DoubleSide })
  )
  puddleRing.rotation.x = -Math.PI / 2
  puddleRing.position.y = 0.06
  root.add(puddleRing)
  let simTime = 0
  let accumulated = 0
  let intensityState = 45
  let tempState = 4
  let visibility = 24
  let lastKind = 'rain'

  const resetParticles = (kind: string): void => {
    const position = geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < maxParticles; i += 1) {
      const state = states[i]
      state.x = (Math.random() - 0.5) * 260
      state.y = Math.random() * 170
      state.z = (Math.random() - 0.5) * 260
      state.speed = kind === 'snow' ? 3 + Math.random() * 4 : kind === 'hail' ? 28 + Math.random() * 16 : 18 + Math.random() * 12
      position.setXYZ(i, state.x, state.y, state.z)
    }
    position.needsUpdate = true
  }

  const update = (dt: number, p: ParamValues): void => {
    const kind = text(p, 'kind', 'rain')
    const intensity = num(p, 'intensity', 45)
    const wind = num(p, 'wind', 4)
    const gravity = num(p, 'gravity', 9.81)
    const growth = num(p, 'growth', 0.6)
    const temperature = num(p, 'temperature', 4)
    const accumulation = flag(p, 'accumulation', true)
    intensityState = intensity
    tempState = temperature
    simTime += dt
    const activeCount = Math.max(80, Math.floor((maxParticles * intensity) / 100))
    const position = geometry.attributes.position as THREE.BufferAttribute
    const speedScale = kind === 'snow' ? 0.16 : kind === 'hail' ? 1.3 : 0.8
    for (let i = 0; i < maxParticles; i += 1) {
      const state = states[i]
      if (i > activeCount) {
        position.setXYZ(i, 0, -1000, 0)
        continue
      }
      state.y -= (state.speed * speedScale + gravity * 0.3) * dt
      if (kind === 'snow') {
        state.x += Math.sin(simTime * 0.8 + state.drift) * dt * 4 + wind * dt
        state.z += Math.cos(simTime * 0.6 + state.drift) * dt * 3
      } else {
        state.x += wind * dt * (kind === 'hail' ? 0.7 : 1)
        state.z += dt * 0.8
      }
      if (state.y < 0.3) {
        state.y = 150 + Math.random() * 30
        state.x = (Math.random() - 0.5) * 260
        state.z = (Math.random() - 0.5) * 260
      }
      position.setXYZ(i, state.x, state.y, state.z)
    }
    position.needsUpdate = true
    material.color.set(kind === 'snow' ? '#e8f4ff' : kind === 'hail' ? '#b9ecff' : '#89c9e8')
    material.size = kind === 'snow' ? 1.9 : kind === 'hail' ? 2.5 : 1.2
    accumulated += (intensity / 3600) * dt * 8
    const depth = Math.min(2.4, accumulated * 0.04 * (0.3 + growth))
    puddle.scale.setScalar(Math.max(0.2, Math.min(1.2, 0.35 + depth * 0.25 + growth * 0.4)))
    puddle.visible = accumulation
    puddleRing.visible = accumulation
    const puddleMaterial = puddle.material as THREE.MeshPhysicalMaterial
    puddleMaterial.color.set(temperature < 0 ? '#bfe6f3' : '#3b8fc4')
    puddleMaterial.opacity = temperature < 0 ? 0.52 : 0.36
    visibility = Math.max(2, 30 - intensity * 0.22 - (kind === 'snow' ? 8 : kind === 'hail' ? 4 : 0))
  }

  resetParticles('rain')

  const sync = (p: ParamValues): void => {
    const kind = text(p, 'kind', 'rain')
    if (kind !== lastKind) {
      lastKind = kind
      resetParticles(kind)
    }
  }

  return {
    sync,
    object: root,
    update,
    action: (key, p) => {
      if (key === 'reset') {
        simTime = 0
        accumulated = 0
        resetParticles(text(p, 'kind', 'rain'))
      }
    },
    readouts: () => ({
      降水强度: `${intensityState.toFixed(0)} mm/h`,
      累计降水: `${accumulated.toFixed(2)} mm`,
      积水深度: `${Math.min(2.4, accumulated * 0.04).toFixed(2)} m`,
      能见度: `${visibility.toFixed(0)} m`,
      气温: `${tempState.toFixed(0)} °C`
    }),
    dispose: () => disposeObject(root)
  }
}

export const S12: ScenarioMeta = {
  id: 's12',
  title: '雨雪冰雹与地表积水',
  subtitle: '降水类型、粒径速度与积水累积',
  description:
    '在地理场景中模拟降雨、降雪和冰雹：粒子按类型改变下落速度、颜色和漂移，累计降水驱动地表积水范围与深度；可调降水强度、风速、重力、气温和积水增长系数。',
  tag: 'Cesium + Three.js · 降水粒子',
  updatedAt: '2026-10-23',
  accent: '#9bd8f0',
  anchor: { lon: 126.6, lat: 45.8, height: 150 },
  camera: { range: 270, pitch: -22, heading: 24, targetY: 40 },
  metrics: [
    { key: '降水强度', label: '降水强度' },
    { key: '累计降水', label: '累计降水' },
    { key: '积水深度', label: '积水深度' },
    { key: '能见度', label: '能见度' }
  ],
  legend: [
    { color: '#89c9e8', label: '降雨粒子' },
    { color: '#e8f4ff', label: '降雪粒子' },
    { color: '#3b8fc4', label: '地表积水' }
  ],
  hint: '切换降水类型观察粒径与速度差异 · 气温低于零度时积水变为冰面 · 风速增大使粒子轨迹倾斜',
  info: [
    '降水粒子采用独立速度与漂移模型，雪片有横向摆动，冰雹下落速度最高，雨滴介于两者之间。',
    '累计降水量按强度积分，积水深度与覆盖范围用于可视化，未与地形汇流和排水管网耦合。',
    '真实降水模拟需要气象时序、雨滴谱、风廓线和地表下渗参数。'
  ],
  sections: [
    {
      title: '降水类型',
      params: [
        { key: 'kind', label: '降水类型', type: 'select', value: 'rain', options: [{ value: 'rain', label: '降雨' }, { value: 'snow', label: '降雪' }, { value: 'hail', label: '冰雹' }] },
        { key: 'intensity', label: '降水强度', type: 'range', min: 1, max: 100, step: 1, value: 45, unit: ' mm/h' }
      ]
    },
    {
      title: '气象条件',
      params: [
        { key: 'wind', label: '水平风速', type: 'range', min: 0, max: 12, step: 0.2, value: 4, unit: ' m/s' },
        { key: 'gravity', label: '重力加速度', type: 'range', min: 5, max: 20, step: 0.1, value: 9.81, unit: ' m/s²' },
        { key: 'temperature', label: '地表气温', type: 'range', min: -20, max: 20, step: 1, value: 4, unit: ' °C' }
      ]
    },
    {
      title: '积水与操作',
      params: [
        { key: 'growth', label: '积水增长', type: 'range', min: 0, max: 1, step: 0.05, value: 0.6 },
        { key: 'accumulation', label: '显示积水', type: 'toggle', value: true }
      ],
      actions: [{ key: 'reset', label: '重置降水', style: 'primary' }]
    }
  ],
  create: createS12
}
