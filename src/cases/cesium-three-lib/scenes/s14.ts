import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num, text } from '../types'
import { addBox, addLine, addStageGround, disposeObject, seeded, surface, updateLine } from '../helpers'
import { createS14Model } from '../simulations/s14.model'

interface Story {
  group: THREE.Group
  baseX: number
  baseY: number
}

function createS14(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 220, { disc: '#1c2128', accent: kit.accent })
  const building = new THREE.Group()
  root.add(building)
  const stories: Story[] = []
  const shapePoints: THREE.Vector3[] = []
  let shapeLine: THREE.Line | null = null
  let lastFloors = -1
  const model = createS14Model({ pga: 0.35, frequency: 2.4, duration: 18, damping: 0.05, floors: 8, mode: 1 })
  const random = seeded(9281)
  for (let i = 0; i < 8; i += 1) {
    const angle = random() * Math.PI * 2
    const radius = 90 + random() * 80
    addBox(root, [16, 18 + random() * 30, 14], [Math.cos(angle) * radius, 9 + random() * 15, Math.sin(angle) * radius], surface('#4f5a64', { roughness: 0.9 }))
  }

  const rebuild = (floors: number): void => {
    for (const story of stories) disposeObject(story.group)
    stories.length = 0
    shapePoints.length = 0
    building.clear()
    const floorHeight = 4.2
    for (let i = 0; i < floors; i += 1) {
      const group = new THREE.Group()
      const width = 18 - i * 0.32
      addBox(group, [width, 0.55, 13], [0, 0, 0], surface(i % 2 ? '#8b9aa5' : '#7b8a95', { roughness: 0.75 }))
      for (const x of [-width / 2 + 1.2, width / 2 - 1.2]) {
        for (const z of [-5.4, 5.4]) {
          addBox(group, [0.6, floorHeight - 0.55, 0.6], [x, -floorHeight / 2, z], surface('#b3c0c8', { metalness: 0.35 }))
        }
      }
      group.position.set(0, floorHeight * (i + 1), 0)
      building.add(group)
      stories.push({ group, baseX: 0, baseY: floorHeight * (i + 1) })
      shapePoints.push(new THREE.Vector3(0, floorHeight * (i + 1), 0))
    }
    addBox(building, [22, 1.4, 17], [0, 0, 0], surface('#59646e'))
  }

  const fixedUpdate = (dt: number, p: ParamValues): void => {
    model.configure({
      pga: num(p, 'pga', 0.35),
      frequency: num(p, 'frequency', 2.4),
      duration: num(p, 'duration', 18),
      damping: num(p, 'damping', 0.05),
      floors: Math.round(num(p, 'floors', 8)),
      mode: parseInt(text(p, 'mode', '1'), 10) || 1
    })
    model.fixedStep(dt)
  }

  const renderSync = (alpha: number, p: ParamValues): void => {
    const showDrift = flag(p, 'drift', true)
    const state = model.state
    const storiesState = state.displacement
    for (let i = 0; i < stories.length; i += 1) {
      const story = stories[i]
      const velocity = state.velocity[i] ?? 0
      story.group.position.x = (storiesState[i] ?? 0) + velocity * alpha * (1 / 60)
    }
    building.position.x = (state.groundAcceleration / 9.81) * 0.25
    building.position.z = Math.cos(state.time * 34) * state.envelope * num(p, 'pga', 0.35) * 0.18
    if (showDrift) {
      for (let i = 0; i < stories.length; i += 1) shapePoints[i].set((storiesState[i] ?? 0) + 9.5, stories[i].baseY, 0)
      if (!shapeLine) shapeLine = addLine(building, shapePoints, '#ffd666', 0.95)
      else updateLine(shapeLine, shapePoints)
    }
    if (shapeLine) shapeLine.visible = showDrift
  }

  const update = (dt: number, p: ParamValues): void => {
    fixedUpdate(dt, p)
    renderSync(1, p)
  }

  const sync = (p: ParamValues): void => {
    const floors = Math.round(num(p, 'floors', 8))
    if (floors !== lastFloors) {
      lastFloors = floors
      rebuild(floors)
    }
  }

  rebuild(8)
  lastFloors = 8

  return {
    object: root,
    update,
    fixedUpdate,
    renderSync,
    setMode: (mode) => model.setMode(mode),
    sync,
    action: (key) => {
      if (key === 'restart') model.rebuild()
    },
    diagnostics: () => model.diagnostics(),
    calibration: () => model.calibration(),
    readouts: () => {
      const state = model.state
      return {
        顶层位移: `${(state.roofDisplacement * 100).toFixed(1)} cm`,
        层间位移角: state.driftRatio > 0 ? `1/${Math.max(1, Math.round(1 / state.driftRatio))}` : '0',
        峰值加速度: `${state.peakAcceleration.toFixed(2)} g`,
        自振周期: `${(1 / Math.max(0.2, state.fundamentalFrequency)).toFixed(2)} s`,
        楼层数: state.displacement.length
      }
    },
    dispose: () => disposeObject(root)
  }
}

export const S14: ScenarioMeta = {
  id: 's14',
  title: '地震作用与建筑动力响应',
  subtitle: '多阶模态、层间位移与峰值加速度',
  description:
    '输入地面峰值加速度、频率和持续时间，楼层按模态形状做正弦响应并叠加衰减包络，展示顶层位移、层间位移角和峰值加速度；可切换一至三阶振型并观察变形曲线。',
  tag: 'Cesium + Three.js · 结构动力',
  updatedAt: '2026-10-23',
  accent: '#ffcf80',
  anchor: { lon: 104.0, lat: 30.6, height: 520 },
  camera: { range: 240, pitch: -20, heading: 30, targetY: 30 },
  metrics: [
    { key: '顶层位移', label: '顶层位移' },
    { key: '层间位移角', label: '层间位移角' },
    { key: '峰值加速度', label: '峰值加速度' },
    { key: '自振周期', label: '自振周期' }
  ],
  legend: [
    { color: '#8b9aa5', label: '楼板与楼层' },
    { color: '#b3c0c8', label: '竖向构件' },
    { color: '#ffd666', label: '楼层变形曲线' }
  ],
  hint: '提高 PGA 会放大顶层位移 · 高阶振型出现反向鼓形变形 · 阻尼越大衰减越快',
  info: [
    '楼层响应由给定频率与模态形状直接生成，阻尼通过时间衰减包络体现，用于对比不同工况的变形形态。',
    '层间位移角取相邻楼层相对位移与层高之比，峰值加速度按简谐运动关系估算。',
    '真实的建筑地震响应需要加速度时程输入、质量刚度阻尼矩阵和逐步积分求解。'
  ],
  sections: [
    {
      title: '地震输入',
      params: [
        { key: 'pga', label: '峰值加速度', type: 'range', min: 0.05, max: 1.2, step: 0.01, value: 0.35, unit: ' g' },
        { key: 'frequency', label: '主频', type: 'range', min: 0.5, max: 8, step: 0.1, value: 2.4, unit: ' Hz' },
        { key: 'duration', label: '强震持时', type: 'range', min: 5, max: 40, step: 1, value: 18, unit: ' s' },
        { key: 'damping', label: '阻尼比', type: 'range', min: 0.01, max: 0.2, step: 0.005, value: 0.05 }
      ]
    },
    {
      title: '结构模型',
      params: [
        { key: 'floors', label: '楼层数', type: 'range', min: 4, max: 16, step: 1, value: 8, unit: ' 层' },
        { key: 'mode', label: '振型阶数', type: 'select', value: '1', options: [{ value: '1', label: '一阶平动' }, { value: '2', label: '二阶鼓形' }, { value: '3', label: '三阶高阶' }] },
        { key: 'drift', label: '变形曲线', type: 'toggle', value: true }
      ],
      actions: [{ key: 'restart', label: '重新加载', style: 'primary' }]
    }
  ],
  create: createS14
}
