import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num } from '../types'
import { addGlowPoints, addPillar, addStageGround, disposeObject, seeded } from '../helpers'
import { createS11Model, S11_CELL, S11_GRID } from '../simulations/s11.model'

function createS11(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 250, { disc: '#231e18', accent: kit.accent })
  const gridSize = S11_GRID
  const cellSize = S11_CELL
  const half = (gridSize * cellSize) / 2
  const cellCount = gridSize * gridSize
  const fuel = new THREE.InstancedMesh(
    new THREE.BoxGeometry(cellSize * 0.86, 0.7, cellSize * 0.86),
    new THREE.MeshStandardMaterial({ roughness: 0.94 }),
    cellCount
  )
  root.add(fuel)
  const matrix = new THREE.Matrix4()
  const color = new THREE.Color()
  const random = seeded(3355)
  for (let i = 0; i < cellCount; i += 1) {
    const gx = i % gridSize
    const gz = Math.floor(i / gridSize)
    matrix.makeTranslation(-half + cellSize / 2 + gx * cellSize, 0.35, -half + cellSize / 2 + gz * cellSize)
    fuel.setMatrixAt(i, matrix)
    color.setHSL(0.25 + random() * 0.05, 0.22, 0.22 + random() * 0.07)
    fuel.setColorAt(i, color)
  }
  fuel.instanceMatrix.needsUpdate = true
  if (fuel.instanceColor) fuel.instanceColor.needsUpdate = true

  const towers: { x: number; z: number; height: number }[] = []
  for (let i = 0; i < 10; i += 1) {
    const angle = random() * Math.PI * 2
    const radius = 80 + random() * 100
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    const height = 26 + random() * 40
    addPillar(root, [x, 0, z], 13 + random() * 8, height, 13, ['#6d6254', '#7b6e5f', '#5c5348'][i % 3], true)
    towers.push({ x, z, height })
  }

  const flameCount = 260
  const smokeCount = 320
  const flames = addGlowPoints(root, flameCount, '#ff8b3d', 2.6, 0.9)
  const smoke = addGlowPoints(root, smokeCount, '#7f8b94', 4.2, 0.22)
  const flameState: { x: number; y: number; z: number; life: number; max: number }[] = []
  const smokeState: { x: number; y: number; z: number; life: number; max: number; size: number }[] = []
  for (let i = 0; i < flameCount; i += 1) flameState.push({ x: 0, y: 0, z: 0, life: random(), max: 0.5 + random() * 0.8 })
  for (let i = 0; i < smokeCount; i += 1) smokeState.push({ x: 0, y: 0, z: 0, life: random(), max: 2 + random() * 4, size: 3 + random() * 6 })

  const model = createS11Model({ fuel: 1, spread: 1, humidity: 35, wind: 6, smoke: 0.7, rain: false })

  const fixedUpdate = (dt: number, p: ParamValues): void => {
    model.configure({
      fuel: num(p, 'fuel', 1),
      spread: num(p, 'spread', 1),
      humidity: num(p, 'humidity', 35),
      wind: num(p, 'wind', 6),
      smoke: num(p, 'smoke', 0.7),
      rain: flag(p, 'rain', false)
    })
    model.fixedStep(dt)
  }

  const renderSync = (alpha: number, p: ParamValues): void => {
    const dt = 1 / 60
    const wind = num(p, 'wind', 6)
    const smokeAmount = num(p, 'smoke', 0.7)
    const state = model.state
    for (let i = 0; i < cellCount; i += 1) {
      if (state.burnt[i]) {
        color.setHSL(0.03, 0.25, 0.12)
        fuel.setColorAt(i, color)
      } else if (state.burning[i]) {
        color.setHSL(0.58 - state.burn[i] * 0.25, 0.8, 0.18 + state.burn[i] * 0.2)
        fuel.setColorAt(i, color)
      }
    }
    if (fuel.instanceColor) fuel.instanceColor.needsUpdate = true
    const burningIndices: number[] = []
    for (let i = 0; i < cellCount; i += 1) if (state.burning[i]) burningIndices.push(i)
    const flameAttribute = flames.geometry.attributes.position as THREE.BufferAttribute
    const smokeAttribute = smoke.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < flameCount; i += 1) {
      const particle = flameState[i]
      particle.life += dt
      if (particle.life > particle.max || particle.y < 0.5) {
        particle.life = 0
        const index = burningIndices.length > 0 ? burningIndices[Math.floor(Math.random() * burningIndices.length)] : Math.floor(Math.random() * cellCount)
        const gx = index % gridSize
        const gz = Math.floor(index / gridSize)
        const active = state.burning[index] ? 1 : Math.random() < 0.04 ? 1 : 0
        particle.x = -half + cellSize / 2 + gx * cellSize + (Math.random() - 0.5) * 5
        particle.z = -half + cellSize / 2 + gz * cellSize + (Math.random() - 0.5) * 5
        particle.y = 0.8 + Math.random() * 1.2
        if (!active) particle.y = -100
      } else {
        particle.y += dt * (6 + Math.random() * 5)
        particle.x += dt * wind * 0.35
        particle.z -= dt * wind * 0.08
      }
      flameAttribute.setXYZ(i, particle.x, particle.y, particle.z)
    }
    flameAttribute.needsUpdate = true
    for (let i = 0; i < smokeCount; i += 1) {
      const particle = smokeState[i]
      particle.life += dt
      if (particle.life > particle.max || particle.y < 0.5) {
        particle.life = 0
        const index = burningIndices.length > 0 ? burningIndices[Math.floor(Math.random() * burningIndices.length)] : Math.floor(Math.random() * cellCount)
        const gx = index % gridSize
        const gz = Math.floor(index / gridSize)
        const active = state.burning[index] ? 1 : Math.random() < 0.03 ? 1 : 0
        particle.x = -half + cellSize / 2 + gx * cellSize + (Math.random() - 0.5) * 6
        particle.z = -half + cellSize / 2 + gz * cellSize + (Math.random() - 0.5) * 6
        particle.y = 2 + Math.random() * 3
        if (!active) particle.y = -100
      } else {
        particle.y += dt * (5 + Math.random() * 4) * (0.5 + smokeAmount)
        particle.x += dt * wind * 1.2
        particle.z += dt * wind * 0.18
      }
      smokeAttribute.setXYZ(i, particle.x, particle.y, particle.z)
    }
    smokeAttribute.needsUpdate = true
    smoke.visible = smokeAmount > 0.08
  }

  const update = (dt: number, p: ParamValues): void => {
    fixedUpdate(dt, p)
    renderSync(1, p)
  }

  return {
    object: root,
    update,
    fixedUpdate,
    renderSync,
    setMode: (mode) => model.setMode(mode),
    action: (key) => {
      if (key === 'ignite') model.ignite()
    },
    diagnostics: () => model.diagnostics(),
    calibration: () => model.calibration(),
    readouts: () => {
      const state = model.state
      return {
        已烧毁网格: `${state.burnedCells} / ${cellCount}`,
        火线扩展速度: `${(state.frontSpeed * 3.6).toFixed(1)} km/h`,
        烟羽高度: `${state.smokeHeight.toFixed(0)} m`,
        风速: `${model.getConfig().wind.toFixed(1)} m/s`,
        仿真时间: `${state.time.toFixed(1)} s`
      }
    },
    dispose: () => disposeObject(root)
  }
}

export const S11: ScenarioMeta = {
  id: 's11',
  title: '建筑与林地火灾蔓延及烟羽',
  subtitle: '燃料栅格、风驱动传播与火线风险',
  description:
    '在燃料栅格中心点火，火焰按燃料负载、湿度、风速和扑救状态向相邻网格传播，同时生成上升火苗与顺风烟羽；可观察已烧面积、火线扩展速度和烟羽高度。',
  tag: 'Cesium + Three.js · 火灾传播',
  updatedAt: '2026-10-23',
  accent: '#ff8b3d',
  anchor: { lon: 113.5, lat: 22.9, height: 22 },
  camera: { range: 300, pitch: -24, heading: 52, targetY: 24 },
  metrics: [
    { key: '已烧毁网格', label: '已烧毁网格' },
    { key: '火线扩展速度', label: '火线扩展速度' },
    { key: '烟羽高度', label: '烟羽高度' },
    { key: '风速', label: '风速' }
  ],
  legend: [
    { color: '#4f8a4a', label: '未燃燃料' },
    { color: '#ff8b3d', label: '燃烧火线' },
    { color: '#4a4038', label: '烧毁区域' },
    { color: '#7f8b94', label: '烟羽' }
  ],
  hint: '点燃后火线顺风方向扩展更快 · 湿度与降雨会显著抑制传播 · 燃料负载决定燃烧持续时间',
  info: [
    '火灾传播采用元胞自动机近似：每个网格记录燃烧进度，燃烧完成后按湿度、风速和燃料条件向四邻域传播。',
    '烟羽由粒子抬升与水平风漂移构成，只用于表达可视影响范围，不代替 CFD 烟流求解。',
    '真实火场需要可燃物类型、含水率、地形坡向、热辐射和消防资源调度模型。'
  ],
  sections: [
    {
      title: '火源与燃料',
      params: [
        { key: 'fuel', label: '燃料负载', type: 'range', min: 0.2, max: 2, step: 0.05, value: 1 },
        { key: 'spread', label: '传播系数', type: 'range', min: 0.1, max: 3, step: 0.05, value: 1 },
        { key: 'humidity', label: '空气湿度', type: 'range', min: 10, max: 90, step: 1, value: 35, unit: '%' }
      ]
    },
    {
      title: '气象与烟羽',
      params: [
        { key: 'wind', label: '风速', type: 'range', min: 0, max: 15, step: 0.2, value: 6, unit: ' m/s' },
        { key: 'smoke', label: '烟羽强度', type: 'range', min: 0.1, max: 1.5, step: 0.05, value: 0.7 },
        { key: 'rain', label: '人工降雨', type: 'toggle', value: false }
      ],
      actions: [{ key: 'ignite', label: '重新点火', style: 'danger' }]
    }
  ],
  create: createS11
}
