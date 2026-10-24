import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num } from '../types'
import { addBox, addCylinder, addStageGround, disposeObject, surface } from '../helpers'
import { createS19Model, S19_MAX_PARTICLES, type S19Stability } from '../simulations/s19.model'

const MAX_PARTICLES = S19_MAX_PARTICLES

function createS19(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 260, { disc: '#191d21', accent: kit.accent })
  const stacks = new THREE.Group()
  root.add(stacks)
  const model = createS19Model({ sources: 3, stackHeight: 34, emission: 70, windSpeed: 8, windDir: 250, stability: 'neutral' })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(model.state.positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(model.state.colors, 3))
  const particleMaterial = new THREE.PointsMaterial({
    size: 3.6,
    vertexColors: true,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  })
  const plume = new THREE.Points(geometry, particleMaterial)
  plume.frustumCulled = false
  root.add(plume)
  let sourceCount = 3
  let stackHeight = 34
  const stackMaterial = surface('#b6c2cc', { roughness: 0.8, metalness: 0.25 })
  const capMaterial = surface('#ff9d5c', { emissive: '#d96a2a', emissiveIntensity: 0.8, transparent: true, opacity: 0.6 })

  const buildStacks = (count: number, height: number): void => {
    for (const child of [...stacks.children]) disposeObject(child)
    stacks.clear()
    for (let i = 0; i < count; i += 1) {
      const x = (i - (count - 1) / 2) * 22
      addCylinder(stacks, 2.2, 2.8, height, [x, height / 2, 0], stackMaterial, 18)
      addCylinder(stacks, 2.9, 2.9, 1.4, [x, height + 0.7, 0], capMaterial, 18)
      addBox(stacks, [9, 1.2, 7], [x, 1.6, 0], surface('#5c6770'))
    }
  }

  const fixedUpdate = (dt: number, p: ParamValues): void => {
    model.configure({
      sources: Math.round(num(p, 'sources', 3)),
      stackHeight: num(p, 'stackHeight', 34),
      emission: num(p, 'emission', 70),
      windSpeed: num(p, 'windSpeed', 8),
      windDir: num(p, 'windDir', 250),
      stability: String(p['stability'] ?? 'neutral') as S19Stability
    })
    model.fixedStep(dt)
  }

  const renderSync = (_alpha: number, p: ParamValues): void => {
    const showGrid = flag(p, 'grid', true)
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.color.needsUpdate = true
    particleMaterial.visible = showGrid
    particleMaterial.opacity = showGrid ? 0.82 : 0.6
    plume.visible = true
    void p
  }

  const update = (dt: number, p: ParamValues): void => {
    fixedUpdate(dt, p)
    renderSync(1, p)
  }

  const sync = (p: ParamValues): void => {
    const count = Math.round(num(p, 'sources', 3))
    const height = Math.round(num(p, 'stackHeight', 34))
    if (count !== sourceCount || height !== stackHeight) {
      sourceCount = count
      stackHeight = height
      buildStacks(count, height)
      model.clear()
    }
  }

  buildStacks(3, 34)

  return {
    object: root,
    update,
    fixedUpdate,
    renderSync,
    setMode: (mode) => model.setMode(mode),
    sync,
    action: (key) => {
      if (key === 'clear') model.clear()
    },
    diagnostics: () => model.diagnostics(),
    calibration: () => model.calibration(),
    readouts: () => {
      const state = model.state
      return {
        烟羽长度: `${state.plumeLength.toFixed(0)} m`,
        峰值浓度指数: `${state.maxConcentration.toFixed(1)}`,
        边界层高度: `${state.boundaryLayer} m`,
        累计排放: `${state.emitted} 个粒子`,
        风向: `${model.getConfig().windDir.toFixed(0)}°`,
        仿真时间: `${state.time.toFixed(1)} s`
      }
    },
    dispose: () => disposeObject(root)
  }
}

export const S19: ScenarioMeta = {
  id: 's19',
  title: '工业园区大气污染扩散',
  subtitle: '风场输运、稳定度与烟羽形态',
  description:
    '多座烟囱连续排放污染物粒子，风场负责水平输运，大气稳定度决定垂直混合和扩散强度；粒子颜色随龄期从高温橙色过渡到冷色，可直观看稳定层结下的长烟羽与不稳定层结下的快速抬升。',
  tag: 'Cesium + Three.js · 环境扩散',
  updatedAt: '2026-10-23',
  accent: '#ff9d5c',
  anchor: { lon: 114.2, lat: 30.6, height: 26 },
  camera: { range: 340, pitch: -24, heading: 32, targetY: 55 },
  metrics: [
    { key: '烟羽长度', label: '烟羽长度' },
    { key: '峰值浓度指数', label: '峰值浓度指数' },
    { key: '边界层高度', label: '边界层高度' },
    { key: '累计排放', label: '累计排放' }
  ],
  legend: [
    { color: '#ff8a3c', label: '新鲜污染团' },
    { color: '#f4d35e', label: '中期扩散' },
    { color: '#5fa8e6', label: '稀释老化' }
  ],
  hint: '稳定层结下烟羽更细更长 · 风速越大烟羽越平直 · 不稳定层结会显著增强垂直混合',
  info: [
    '污染物采用粒子平流模型，水平速度向风速收敛，垂直方向叠加稳定度控制的湍流扰动和浮力衰减。',
    '浓度指数由中心区域活跃粒子数量归一化，烟羽长度按风速和稳定度经验估算，未求解对流扩散方程。',
    '真实大气扩散需要高斯烟羽或拉格朗日粒子模型、气象场、地形和化学反应过程。'
  ],
  sections: [
    {
      title: '污染源',
      params: [
        { key: 'sources', label: '烟囱数量', type: 'range', min: 1, max: 6, step: 1, value: 3, unit: ' 座' },
        { key: 'stackHeight', label: '烟囱高度', type: 'range', min: 10, max: 80, step: 2, value: 34, unit: ' m' },
        { key: 'emission', label: '排放强度', type: 'range', min: 5, max: 160, step: 5, value: 70, unit: ' 粒子/s' }
      ]
    },
    {
      title: '气象条件',
      params: [
        { key: 'windSpeed', label: '风速', type: 'range', min: 0.5, max: 18, step: 0.5, value: 8, unit: ' m/s' },
        { key: 'windDir', label: '风向', type: 'range', min: 0, max: 360, step: 5, value: 250, unit: '°' },
        { key: 'stability', label: '大气稳定度', type: 'select', value: 'neutral', options: [{ value: 'stable', label: '稳定' }, { value: 'neutral', label: '中性' }, { value: 'unstable', label: '不稳定' }] },
        { key: 'grid', label: '显示粒子', type: 'toggle', value: true }
      ],
      actions: [{ key: 'clear', label: '清空烟羽', style: 'primary' }]
    }
  ],
  create: createS19
}
