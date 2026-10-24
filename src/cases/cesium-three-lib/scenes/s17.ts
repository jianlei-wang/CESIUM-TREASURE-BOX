import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num } from '../types'
import { addBox, addStageGround, disposeObject, surface } from '../helpers'
import { createS17Model, S17_MAX_AGENTS, s17Obstacles } from '../simulations/s17.model'

function createS17(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 250, { disc: '#20201d', accent: kit.accent })
  const walls = new THREE.Group()
  root.add(walls)
  const maxAgents = S17_MAX_AGENTS
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
  const matrix = new THREE.Matrix4()
  const color = new THREE.Color()
  let lastExit = -1
  let lastWalls = -1
  const model = createS17Model({ crowdSize: 200, agentSpeed: 1.6, panic: 0.25, exitWidth: 4, wallCount: 2 })

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
    for (const obstacle of s17Obstacles(wallCount)) {
      addBox(walls, [obstacle.halfX * 2, 5, obstacle.halfZ * 2], [obstacle.x, 2.5, obstacle.z], surface('#7d848a'))
    }
    exitGlow.scale.set(gap, 1, 1)
    exitGlow.position.set(0, 0.08, -51)
  }

  const resetCrowd = (): void => {
    model.resetCrowd()
    matrix.makeScale(0, 0, 0)
    for (let i = 0; i < maxAgents; i += 1) crowd.setMatrixAt(i, matrix)
    crowd.instanceMatrix.needsUpdate = true
  }

  const fixedUpdate = (dt: number, p: ParamValues): void => {
    model.configure({
      crowdSize: Math.round(num(p, 'crowdSize', 200)),
      agentSpeed: num(p, 'agentSpeed', 1.6),
      panic: num(p, 'panic', 0.25),
      exitWidth: num(p, 'exitWidth', 4),
      wallCount: Math.round(num(p, 'wallCount', 2))
    })
    model.fixedStep(dt)
  }

  const renderSync = (_alpha: number, p: ParamValues): void => {
    const showDensity = flag(p, 'density', true)
    const panic = num(p, 'panic', 0.25)
    const state = model.state
    for (let i = 0; i < maxAgents; i += 1) {
      const agent = state.agents[i]
      if (!agent || !agent.active || agent.evacuated) {
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
    if (state.time > 1) exitGlow.material.opacity = 0.4 + 0.3 * Math.sin(state.time * 4)
    agentMaterial.roughness = 0.7
  }

  const update = (dt: number, p: ParamValues): void => {
    fixedUpdate(dt, p)
    renderSync(1, p)
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
      resetCrowd()
    }
  }

  buildWalls(4, 2)
  resetCrowd()
  lastWalls = 4 * 100 + 2
  lastExit = 200

  return {
    object: root,
    update,
    fixedUpdate,
    renderSync,
    setMode: (mode) => model.setMode(mode),
    sync,
    action: (key) => {
      if (key === 'reset') resetCrowd()
    },
    diagnostics: () => model.diagnostics(),
    calibration: () => model.calibration(),
    readouts: () => {
      const state = model.state
      return {
        已疏散人数: state.evacuated,
        出口流率: `${state.flowRate.toFixed(1)} 人/min`,
        峰值密度: `${state.maxDensity.toFixed(1)} 人/100m²`,
        人群恐慌度: model.getConfig().panic.toFixed(2),
        仿真时间: `${state.time.toFixed(1)} s`
      }
    },
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
