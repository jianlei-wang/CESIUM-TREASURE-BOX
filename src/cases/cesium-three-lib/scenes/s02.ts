import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { num } from '../types'
import { addStageGround, basic, disposeObject, surface } from '../helpers'
import { createS02Model } from '../simulations/s02.model'

interface DustPuff {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  max: number
}

const DUST_COUNT = 420

function createS02(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 230, { disc: '#1b2026', accent: kit.accent })
  const building = new THREE.Group()
  root.add(building)
  const meshes = new Map<number, THREE.Mesh>()
  const colors = ['#9aa8b5', '#b9c4cd', '#8595a3', '#c9d2d9']
  const dustGeometry = new THREE.BufferGeometry()
  const dustPositions = new Float32Array(DUST_COUNT * 3)
  dustPositions.fill(-1000)
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
  const dustMaterial = new THREE.PointsMaterial({
    color: '#c9b9a4',
    size: 4.2,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    sizeAttenuation: true
  })
  const dust = new THREE.Points(dustGeometry, dustMaterial)
  dust.frustumCulled = false
  root.add(dust)
  const dustState: DustPuff[] = Array.from({ length: DUST_COUNT }, () => ({ x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, life: -1, max: 0 }))
  let dustCursor = 0
  let dustEmit = 0
  const dustRing = new THREE.Mesh(new THREE.RingGeometry(1, 1.45, 72), basic('#d8c6ad', 0))
  dustRing.rotation.x = -Math.PI / 2
  dustRing.position.y = 0.08
  dustRing.visible = false
  root.add(dustRing)
  let ringAge = 99
  let lastSignature = ''
  const model = createS02Model({ floors: 12, columns: 5, impulse: 5, delay: 0, gravity: 20, damping: 0.02 })

  const build = (p: ParamValues): void => {
    for (const mesh of meshes.values()) disposeObject(mesh)
    meshes.clear()
    building.clear()
    model.configure({
      floors: Math.round(num(p, 'floors', 12)),
      columns: Math.round(num(p, 'columns', 5)),
      impulse: num(p, 'impulse', 5),
      delay: num(p, 'delay', 0),
      gravity: num(p, 'gravity', 20),
      damping: num(p, 'damping', 0.02)
    })
    model.rebuild()
    for (const block of model.state.blocks) {
      const material = surface(colors[block.id % colors.length], { roughness: 0.82, metalness: 0.06 })
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(block.size, block.size * 0.62, block.size), material)
      mesh.position.set(block.position[0], block.position[1], block.position[2])
      building.add(mesh)
      meshes.set(block.id, mesh)
    }
    ringAge = 99
    dustRing.visible = false
    dustRing.material.opacity = 0
    dustEmit = 0
    for (const puff of dustState) {
      puff.life = -1
      puff.y = -100
    }
    for (let i = 0; i < DUST_COUNT; i += 1) dustPositions[i * 3 + 1] = -100
    dustGeometry.attributes.position.needsUpdate = true
  }

  const fixedUpdate = (dt: number, p: ParamValues): void => {
    model.configure({
      floors: Math.round(num(p, 'floors', 12)),
      columns: Math.round(num(p, 'columns', 5)),
      impulse: num(p, 'impulse', 5),
      delay: num(p, 'delay', 0),
      gravity: num(p, 'gravity', 20),
      damping: num(p, 'damping', 0.02)
    })
    const wasTriggered = model.state.triggered
    model.fixedStep(dt)
    if (!wasTriggered && model.state.triggered) {
      ringAge = 0
      dustRing.visible = true
    }
  }

  const renderSync = (alpha: number, _p: ParamValues): void => {
    const dt = 1 / 60
    for (const block of model.state.blocks) {
      const mesh = meshes.get(block.id)
      if (!mesh) continue
      mesh.position.set(
        block.position[0] + block.velocity[0] * alpha * dt,
        block.position[1] + block.velocity[1] * alpha * dt,
        block.position[2] + block.velocity[2] * alpha * dt
      )
      mesh.rotation.set(block.rotation[0], block.rotation[1], block.rotation[2])
    }
    if (model.state.triggered && model.state.time < 6) {
      ringAge += dt
      dustRing.visible = ringAge < 2.2
      dustRing.scale.setScalar(7 + ringAge * 42)
      dustRing.material.opacity = Math.max(0, 0.52 * (1 - ringAge / 2.2))
      dustEmit += dt * 220
      while (dustEmit >= 1 && model.state.blocks.length > 0) {
        dustEmit -= 1
        const source = model.state.blocks[Math.floor(Math.random() * model.state.blocks.length)]
        const puff = dustState[dustCursor % DUST_COUNT]
        dustCursor += 1
        const angle = Math.random() * Math.PI * 2
        const speed = 4 + Math.random() * 12
        puff.x = source.position[0] * 0.92 + (Math.random() - 0.5) * 8
        puff.y = Math.max(1, source.position[1] * 0.85) + Math.random() * 5
        puff.z = source.position[2] * 0.92 + (Math.random() - 0.5) * 8
        puff.vx = Math.cos(angle) * speed
        puff.vz = Math.sin(angle) * speed
        puff.vy = 1.6 + Math.random() * 4.2
        puff.life = 0
        puff.max = 1.6 + Math.random() * 2.4
      }
    }
    for (let i = 0; i < DUST_COUNT; i += 1) {
      const puff = dustState[i]
      if (puff.life < 0) {
        dustPositions[i * 3 + 1] = -100
        continue
      }
      puff.life += dt
      if (puff.life > puff.max) {
        puff.life = -1
        dustPositions[i * 3 + 1] = -100
        continue
      }
      const drag = Math.max(0, 1 - dt * 1.4)
      puff.vx *= drag
      puff.vz *= drag
      puff.vy = puff.vy * drag + dt * 0.5
      puff.x += puff.vx * dt
      puff.y += puff.vy * dt
      puff.z += puff.vz * dt
      dustPositions[i * 3] = puff.x
      dustPositions[i * 3 + 1] = puff.y
      dustPositions[i * 3 + 2] = puff.z
    }
    dustGeometry.attributes.position.needsUpdate = true
  }

  const sync = (p: ParamValues): void => {
    const signature = `${Math.round(num(p, 'floors', 12))}|${Math.round(num(p, 'columns', 5))}`
    if (signature !== lastSignature) {
      lastSignature = signature
      build(p)
    }
  }

  build({ floors: 12, columns: 5, impulse: 5, delay: 0, gravity: 20, damping: 0.02 } as ParamValues)
  lastSignature = '12|5'

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
      if (key === 'blast') {
        model.configure({ impulse: num(p, 'impulse', 5) })
        model.blast()
      }
      if (key === 'rebuild') build(p)
    },
    diagnostics: () => model.diagnostics(),
    calibration: () => model.calibration(),
    readouts: () => {
      const active = model.state.blocks.filter((item) => item.active && !item.settled).length
      const settled = model.state.blocks.filter((item) => item.settled).length
      const intact = model.state.blocks.length ? Math.max(0, 100 - Math.round((active + settled) * 100 / model.state.blocks.length)) : 100
      return {
        结构完整率: `${intact}%`,
        活跃碎块: active,
        停稳碎块: settled,
        起爆冲量: model.state.peakImpulse,
        仿真时间: `${model.state.time.toFixed(1)} s`
      }
    },
    dispose: () => disposeObject(root)
  }
}

export const S02: ScenarioMeta = {
  id: 's02',
  title: '建筑预破碎与局部坍塌',
  subtitle: '楼层块体在冲量作用下的解体、抛撒与堆积',
  description:
    '以参数化楼体块阵表示预破碎构件，触发后按距离衰减的冲量把楼层块体转为动态刚体，展示倾覆、抛射、落地与堆存；可调层数、柱网、冲量、延迟、阻尼和重建模式。',
  tag: 'Cesium + Three.js · 多刚体断裂',
  updatedAt: '2026-10-23',
  accent: '#e0613f',
  anchor: { lon: 121.4737, lat: 31.2304, height: 8 },
  camera: { range: 175, pitch: -24, heading: 34, targetY: 26 },
  metrics: [
    { key: '结构完整率', label: '结构完整率' },
    { key: '活跃碎块', label: '活跃碎块' },
    { key: '停稳碎块', label: '停稳碎块' },
    { key: '起爆冲量', label: '起爆冲量' }
  ],
  legend: [
    { color: '#b9c4cd', label: '完整楼层块' },
    { color: '#9aa8b5', label: '解体碎块' },
    { color: '#e0613f', label: '起爆核心' }
  ],
  hint: '点击“触发坍塌”观察冲量传播 · 调高冲量可扩大飞散范围 · “重建楼体”恢复预破碎状态',
  info: [
    '本案例不把视觉碰撞结果当作结构安全鉴定，而是演示多刚体在突发冲量下的运动与堆积形态。',
    '每块楼板独立计算重力、碰撞与阻尼；块体落地后速度低于阈值即进入休眠，以控制动态体数量。',
    '预破碎块阵是碰撞代理，真实工程需要根据构件尺寸、连接关系和材料参数建立结构模型。'
  ],
  sections: [
    {
      title: '楼体结构',
      params: [
        { key: 'floors', label: '楼层数', type: 'range', min: 3, max: 12, step: 1, value: 12, unit: ' 层' },
        { key: 'columns', label: '柱网跨度', type: 'range', min: 2, max: 5, step: 1, value: 5, unit: ' 跨' }
      ]
    },
    {
      title: '起爆与碎块',
      params: [
        { key: 'impulse', label: '起爆冲量', type: 'range', min: 5, max: 90, step: 1, value: 5 },
        { key: 'delay', label: '起爆延迟', type: 'range', min: 0, max: 6, step: 0.1, value: 0, unit: ' s' },
        { key: 'gravity', label: '重力加速度', type: 'range', min: 5, max: 20, step: 0.1, value: 20, unit: ' m/s²' },
        { key: 'damping', label: '碎块阻尼', type: 'range', min: 0.02, max: 0.6, step: 0.01, value: 0.02 }
      ]
    },
    {
      title: '操作',
      actions: [
        { key: 'blast', label: '触发坍塌', style: 'primary' },
        { key: 'rebuild', label: '重建楼体', style: 'danger' }
      ]
    }
  ],
  create: createS02
}
