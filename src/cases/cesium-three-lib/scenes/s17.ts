import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num } from '../types'
import { addBox, addStageGround, disposeObject, seeded, surface } from '../helpers'

interface Agent {
  x: number
  z: number
  vx: number
  vz: number
  speed: number
  offset: number
  active: boolean
  evacuated: boolean
}

function createS17(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 250, { disc: '#20201d', accent: kit.accent })
  const walls = new THREE.Group()
  root.add(walls)
  const maxAgents = 400
  const agentGeometry = new THREE.CapsuleGeometry(0.75, 2.2, 5, 8)
  const agentMaterial = new THREE.MeshStandardMaterial({ roughness: 0.75 })
  const crowd = new THREE.InstancedMesh(agentGeometry, agentMaterial, maxAgents)
  crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  root.add(crowd)
  const exitGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: '#7dffb2', transparent: true, opacity: 0.75, side: THREE.DoubleSide })
  )
  exitGlow.rotation.x = -Math.PI / 2
  exitGlow.position.set(0, 0.08, -51)
  root.add(exitGlow)
  const agents: Agent[] = []
  const matrix = new THREE.Matrix4()
  const color = new THREE.Color()
  const random = seeded(2277)
  for (let i = 0; i < maxAgents; i += 1) {
    agents.push({ x: (random() - 0.5) * 100, z: (random() - 0.5) * 84, vx: 0, vz: 0, speed: 0, offset: random() * 4 - 2, active: false, evacuated: false })
  }
  let simTime = 0
  let evacuated = 0
  let maxDensity = 0
  let flowRate = 0
  let lastExit = -1
  let lastWalls = -1
  let panicState = 0.2

  const buildWalls = (exitWidth: number, wallCount: number): void => {
    for (const child of [...walls.children]) disposeObject(child)
    walls.clear()
    const halfWidth = 54
    const gap = Math.max(1, exitWidth) * 1.6
    const left = -halfWidth
    const right = halfWidth
    const leftEnd = -gap / 2
    const rightStart = gap / 2
    addBox(walls, [leftEnd - left, 7, 2.2], [(left + leftEnd) / 2, 3.5, -52], surface('#6d747a'))
    addBox(walls, [right - rightStart, 7, 2.2], [(rightStart + right) / 2, 3.5, -52], surface('#6d747a'))
    addBox(walls, [110, 7, 2.2], [0, 3.5, 52], surface('#5c646b'))
    addBox(walls, [2.2, 7, 104], [-55, 3.5, 0], surface('#5c646b'))
    addBox(walls, [2.2, 7, 104], [55, 3.5, 0], surface('#5c646b'))
    for (let i = 0; i < wallCount; i += 1) {
      const z = -20 + (i % 3) * 22
      const x = i % 2 === 0 ? -22 : 24
      addBox(walls, [2, 5, 18], [x, 2.5, z], surface('#7d848a'))
    }
    exitGlow.scale.set(gap, 1, 1)
    exitGlow.position.set(0, 0.08, -51)
  }

  const resetCrowd = (count: number): void => {
    for (let i = 0; i < maxAgents; i += 1) {
      const agent = agents[i]
      agent.active = i < count
      agent.evacuated = false
      agent.x = (random() - 0.5) * 96
      agent.z = (random() - 0.5) * 88
      agent.vx = 0
      agent.vz = 0
      agent.speed = 1 + random() * 0.8
      agent.offset = random() * 4 - 2
    }
    evacuated = 0
    simTime = 0
    maxDensity = 0
    flowRate = 0
    matrix.makeScale(0, 0, 0)
    for (let i = 0; i < maxAgents; i += 1) crowd.setMatrixAt(i, matrix)
    crowd.instanceMatrix.needsUpdate = true
  }

  const update = (dt: number, p: ParamValues): void => {
    const count = Math.round(num(p, 'crowdSize', 200))
    const panic = num(p, 'panic', 0.25)
    const speed = num(p, 'agentSpeed', 1.6)
    const showDensity = flag(p, 'density', true)
    panicState = panic
    simTime += dt
    for (let i = 0; i < maxAgents; i += 1) {
      const agent = agents[i]
      if (!agent.active || agent.evacuated) continue
      const dx = 0 - agent.x
      const dz = -60 - agent.z
      const distance = Math.max(0.001, Math.sqrt(dx * dx + dz * dz))
      const jitter = Math.sin(simTime * 1.7 + i * 2.7) * panic * 1.9
      const desiredX = (dx / distance) * speed * (1 + panic * 1.2) + Math.cos(simTime + i) * panic
      const desiredZ = (dz / distance) * speed * (1 + panic * 1.2) + Math.sin(simTime * 1.3 + i) * panic
      agent.vx += (desiredX + jitter - agent.vx) * Math.min(1, dt * 3)
      agent.vz += (desiredZ + jitter * 0.4 - agent.vz) * Math.min(1, dt * 3)
      agent.x += agent.vx * dt
      agent.z += agent.vz * dt
      if (agent.x < -52) agent.x = -52
      if (agent.x > 52) agent.x = 52
      if (agent.z > 49) agent.z = 49
      if (Math.abs(agent.x) > 2.6 && agent.z < -48) {
        agent.z = -48
        agent.x += (agent.x > 0 ? 1 : -1) * dt * 4
      }
      if (agent.z < -53 && Math.abs(agent.x) < 7) {
        agent.evacuated = true
        evacuated += 1
        matrix.makeScale(0, 0, 0)
        crowd.setMatrixAt(i, matrix)
        continue
      }
      matrix.makeTranslation(agent.x, 1.4, agent.z)
      crowd.setMatrixAt(i, matrix)
      const densityFactor = showDensity ? Math.min(1, Math.abs(agent.x) / 50 + panic * 0.4) : 0.2
      color.setHSL(0.58 - densityFactor * 0.5, 0.65, 0.52)
      crowd.setColorAt(i, color)
    }
    crowd.instanceMatrix.needsUpdate = true
    if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true
    const area = 110 * 104
    maxDensity = Math.max(maxDensity, (count * (1 - evacuated / Math.max(1, count))) / area * 100)
    flowRate = simTime > 0 ? (evacuated / simTime) * 60 : 0
    const elapsed = simTime
    if (elapsed > 1) {
      exitGlow.material.opacity = 0.4 + 0.3 * Math.sin(simTime * 4)
    }
    agentMaterial.roughness = 0.7
  }

  const sync = (p: ParamValues): void => {
    const exitWidth = Math.round(num(p, 'exitWidth', 4) * 10)
    const wallCount = Math.round(num(p, 'wallCount', 2))
    const signature = exitWidth * 100 + wallCount
    if (signature !== lastWalls) {
      lastWalls = signature
      buildWalls(num(p, 'exitWidth', 4), wallCount)
    }
    const count = Math.round(num(p, 'crowdSize', 200))
    if (count !== lastExit) {
      lastExit = count
      resetCrowd(count)
    }
  }

  buildWalls(4, 2)
  resetCrowd(200)
  lastWalls = 4 * 100 + 2
  lastExit = 200

  return {
    object: root,
    update,
    sync,
    action: (key, p) => {
      if (key === 'reset') {
        resetCrowd(Math.round(num(p, 'crowdSize', 200)))
      }
    },
    readouts: () => ({
      已疏散人数: evacuated,
      出口流率: `${flowRate.toFixed(1)} 人/min`,
      峰值密度: `${maxDensity.toFixed(1)} 人/100m²`,
      人群恐慌度: panicState.toFixed(2),
      仿真时间: `${simTime.toFixed(1)} s`
    }),
    dispose: () => disposeObject(root)
  }
}

export const S17: ScenarioMeta = {
  id: 's17',
  title: '城市人群疏散与出口流量',
  subtitle: '个体驱动、出口宽度与拥挤风险',
  description:
    '人群从广场内向出口汇集，个体速度、恐慌扰动、出口宽度和内部障碍共同影响疏散过程；实时统计已疏散人数、出口流率、峰值密度和仿真时间，可观察出口变窄后的拥堵。',
  tag: 'Cesium + Three.js · 人群仿真',
  updatedAt: '2026-10-23',
  accent: '#7dffb2',
  anchor: { lon: 116.4, lat: 39.9, height: 44 },
  camera: { range: 260, pitch: -34, heading: 8, targetY: 12 },
  metrics: [
    { key: '已疏散人数', label: '已疏散人数' },
    { key: '出口流率', label: '出口流率' },
    { key: '峰值密度', label: '峰值密度' },
    { key: '人群恐慌度', label: '人群恐慌度' }
  ],
  legend: [
    { color: '#5fd6a0', label: '低密度人群' },
    { color: '#e6b34a', label: '高密度人群' },
    { color: '#7dffb2', label: '疏散出口' }
  ],
  hint: '缩窄出口会降低流率并提高局部密度 · 恐慌扰动增加会导致路径摆动 · 内部障碍越多绕行越明显',
  info: [
    '每个行人按目标点方向驱动，叠加恐慌扰动和速度收敛，出口宽度决定可通行的水平区间。',
    '密度按剩余人数与广场面积估算，出口流率取已疏散人数除以仿真时间，用于对比不同出口设计。',
    '真实疏散需要社会力模型、行人碰撞、视野、引导信息和多出口选择行为。'
  ],
  sections: [
    {
      title: '人群规模',
      params: [
        { key: 'crowdSize', label: '人群数量', type: 'range', min: 30, max: 400, step: 10, value: 200, unit: ' 人' },
        { key: 'agentSpeed', label: '平均速度', type: 'range', min: 0.8, max: 3, step: 0.1, value: 1.6, unit: ' m/s' },
        { key: 'panic', label: '恐慌扰动', type: 'range', min: 0, max: 1, step: 0.05, value: 0.25 }
      ]
    },
    {
      title: '出口与障碍',
      params: [
        { key: 'exitWidth', label: '出口宽度', type: 'range', min: 1, max: 8, step: 0.5, value: 4, unit: ' m' },
        { key: 'wallCount', label: '内部障碍', type: 'range', min: 0, max: 6, step: 1, value: 2, unit: ' 处' },
        { key: 'density', label: '密度着色', type: 'toggle', value: true }
      ],
      actions: [{ key: 'reset', label: '重新疏散', style: 'primary' }]
    }
  ],
  create: createS17
}
