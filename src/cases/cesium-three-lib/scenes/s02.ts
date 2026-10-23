import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { num } from '../types'
import { addStageGround, basic, disposeObject, seeded, surface } from '../helpers'

interface Block {
  mesh: THREE.Mesh
  home: THREE.Vector3
  velocity: THREE.Vector3
  spin: THREE.Vector3
  size: number
  delay: number
  active: boolean
  settled: boolean
}

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
  const blocks: Block[] = []
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
  let triggered = false
  let countdown = 1.2
  let simTime = 0
  let peakImpulse = 0
  let lastSignature = ''

  const build = (p: ParamValues): void => {
    for (const block of blocks) disposeObject(block.mesh)
    blocks.length = 0
    building.clear()
    const floors = Math.round(num(p, 'floors', 6))
    const columns = Math.round(num(p, 'columns', 3))
    const blockSize = 7
    const gap = 0.35
    const random = seeded(3141)
    for (let floor = 0; floor < floors; floor += 1) {
      for (let cx = 0; cx < columns; cx += 1) {
        for (let cz = 0; cz < columns; cz += 1) {
          const x = (cx - (columns - 1) / 2) * (blockSize + gap)
          const z = (cz - (columns - 1) / 2) * (blockSize + gap)
          const y = floor * (blockSize * 0.62 + gap) + blockSize * 0.31
          const material = surface(colors[(floor + cx + cz) % colors.length], {
            roughness: 0.82,
            metalness: 0.06,
            emissive: floor < 2 ? '#3a1c0c' : undefined,
            emissiveIntensity: 0.25
          })
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(blockSize, blockSize * 0.62, blockSize), material)
          mesh.position.set(x, y, z)
          mesh.rotation.y = (random() - 0.5) * 0.035
          building.add(mesh)
          blocks.push({
            mesh,
            home: mesh.position.clone(),
            velocity: new THREE.Vector3(),
            spin: new THREE.Vector3(),
            size: blockSize,
            delay: 0,
            active: false,
            settled: false
          })
        }
      }
    }
    triggered = false
    countdown = num(p, 'delay', 1.2)
    simTime = 0
    peakImpulse = 0
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

  const blast = (p: ParamValues): void => {
    if (triggered) return
    triggered = true
    const impulse = num(p, 'impulse', 30)
    peakImpulse = impulse
    ringAge = 0
    dustRing.visible = true
    for (const block of blocks) {
      const fromCenter = new THREE.Vector3(block.mesh.position.x, 0, block.mesh.position.z)
      const distance = Math.max(6, fromCenter.length())
      const direction = fromCenter.normalize()
      const tangent = new THREE.Vector3(-direction.z, 0, direction.x)
      const heightFactor = 0.35 + block.mesh.position.y / 40
      const strength = impulse * (0.45 + 18 / distance) * (0.45 + heightFactor * 0.55)
      block.velocity.set(direction.x * strength, strength * (0.38 + Math.random() * 0.14), direction.z * strength)
      block.velocity.addScaledVector(tangent, (Math.random() - 0.5) * strength * 0.35)
      block.spin.set((Math.random() - 0.5) * 1.8, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.8)
      block.delay = 0.08 + distance * 0.012 + block.mesh.position.y * 0.006 + Math.random() * 0.08
      block.active = false
    }
  }

  const update = (dt: number, p: ParamValues): void => {
    const gravity = num(p, 'gravity', 9.81)
    const damping = num(p, 'damping', 0.12)
    simTime += dt
    if (!triggered) {
      countdown -= dt
      if (countdown <= 0) blast(p)
    }
    if (triggered) {
      ringAge += dt
      dustRing.visible = ringAge < 2.2
      dustRing.scale.setScalar(7 + ringAge * 42)
      dustRing.material.opacity = Math.max(0, 0.52 * (1 - ringAge / 2.2))
      dustEmit += dt * 220
      while (dustEmit >= 1 && blocks.length > 0) {
        dustEmit -= 1
        const source = blocks[Math.floor(Math.random() * blocks.length)]
        const puff = dustState[dustCursor % DUST_COUNT]
        dustCursor += 1
        const angle = Math.random() * Math.PI * 2
        const speed = 4 + Math.random() * 12
        puff.x = source.mesh.position.x * 0.92 + (Math.random() - 0.5) * 8
        puff.y = Math.max(1, source.mesh.position.y * 0.85) + Math.random() * 5
        puff.z = source.mesh.position.z * 0.92 + (Math.random() - 0.5) * 8
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

    for (const block of blocks) {
      if (triggered && !block.active && !block.settled) {
        block.delay -= dt
        if (block.delay <= 0) block.active = true
      }
      if (!block.active || block.settled) continue
      block.velocity.y -= gravity * dt
      const ground = block.size * 0.31
      block.mesh.position.addScaledVector(block.velocity, dt)
      block.mesh.rotation.x += block.spin.x * dt
      block.mesh.rotation.y += block.spin.y * dt
      block.mesh.rotation.z += block.spin.z * dt
      if (block.mesh.position.y < ground) {
        block.mesh.position.y = ground
        if (Math.abs(block.velocity.y) > 1.3) {
          block.velocity.y = Math.abs(block.velocity.y) * 0.18
        } else {
          block.velocity.y = 0
        }
        const friction = Math.min(0.92, (0.65 + damping * 9) * dt)
        block.velocity.x *= 1 - friction
        block.velocity.z *= 1 - friction
        block.spin.multiplyScalar(Math.max(0, 1 - dt * 3.2))
        if (block.velocity.length() < 0.32 && block.spin.length() < 0.45) {
          block.velocity.set(0, 0, 0)
          block.spin.set(0, 0, 0)
          block.settled = true
        }
      }
    }
  }

  const sync = (p: ParamValues): void => {
    const signature = `${Math.round(num(p, 'floors', 6))}|${Math.round(num(p, 'columns', 3))}`
    if (signature !== lastSignature) {
      lastSignature = signature
      build(p)
    }
  }

  build({ floors: 12, columns: 5, delay: 0 } as ParamValues)
  lastSignature = '12|5'

  return {
    object: root,
    update,
    sync,
    action: (key, p) => {
      if (key === 'blast') blast(p)
      if (key === 'rebuild') build(p)
    },
    readouts: () => {
      const active = blocks.filter((item) => item.active && !item.settled).length
      const settled = blocks.filter((item) => item.settled).length
      const intact = blocks.length ? Math.max(0, 100 - Math.round((active + settled) * 100 / blocks.length)) : 100
      return {
        结构完整率: `${intact}%`,
        活跃碎块: active,
        停稳碎块: settled,
        起爆冲量: peakImpulse,
        仿真时间: `${simTime.toFixed(1)} s`
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
