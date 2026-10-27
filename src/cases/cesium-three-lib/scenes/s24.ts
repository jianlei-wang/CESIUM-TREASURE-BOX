import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { num, text } from '../types'
import { addStageGround, disposeObject, surface } from '../helpers'
import { createS24Model, type S24Shape } from '../simulations/s24.model'

function createS24(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 150, { disc: '#1a242c', accent: kit.accent })

  const particleMaterial = surface('#7fe0c6', { metalness: 0.25, roughness: 0.35, emissive: '#1d6b56', emissiveIntensity: 0.35 })
  const edgeMaterial = new THREE.LineBasicMaterial({ color: '#5abf9f', transparent: true, opacity: 0.35 })
  let particles: THREE.InstancedMesh | null = null
  let edges: THREE.LineSegments | null = null
  let particleCount = 0
  let edgeCount = 0
  const matrix = new THREE.Matrix4()

  const buildVisuals = (count: number, edgePairs: readonly [number, number][]): void => {
    if (particles) {
      particles.geometry.dispose()
      particles.removeFromParent()
    }
    if (edges) {
      edges.geometry.dispose()
      edges.removeFromParent()
    }
    const geometry = new THREE.SphereGeometry(0.3, 10, 8)
    particles = new THREE.InstancedMesh(geometry, particleMaterial, Math.max(1, count))
    particles.frustumCulled = false
    root.add(particles)
    particleCount = count
    const lineGeometry = new THREE.BufferGeometry()
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(2, edgePairs.length * 2) * 3), 3))
    edges = new THREE.LineSegments(lineGeometry, edgeMaterial)
    edges.frustumCulled = false
    root.add(edges)
    edgeCount = edgePairs.length
  }

  const model = createS24Model({
    shape: 'sphere',
    dropHeight: 12,
    softness: 0.55,
    mass: 15,
    gravity: 9.81,
    damping: 0.35,
    resolution: 5,
    restitution: 0.18
  })

  const fixedUpdate = (dt: number, p: ParamValues): void => {
    model.configure({
      shape: text(p, 'shape', 'sphere') as S24Shape,
      dropHeight: num(p, 'dropHeight', 12),
      softness: num(p, 'softness', 0.55),
      mass: num(p, 'mass', 15),
      gravity: num(p, 'gravity', 9.81),
      damping: num(p, 'damping', 0.35),
      resolution: Math.round(num(p, 'resolution', 5)),
      restitution: num(p, 'restitution', 0.18)
    })
    model.fixedStep(dt)
  }

  const renderSync = (): void => {
    const state = model.state
    if (!particles || !edges || state.count !== particleCount || state.edges.length !== edgeCount) {
      buildVisuals(state.count, state.edges)
    }
    if (particles) {
      for (let index = 0; index < state.count; index += 1) {
        const i3 = index * 3
        matrix.makeTranslation(state.positions[i3], state.positions[i3 + 1], state.positions[i3 + 2])
        particles.setMatrixAt(index, matrix)
      }
      particles.instanceMatrix.needsUpdate = true
      particles.count = state.count
    }
    if (edges) {
      const attribute = edges.geometry.getAttribute('position') as THREE.BufferAttribute
      const array = attribute.array as Float32Array
      for (let index = 0; index < state.edges.length; index += 1) {
        const [a, b] = state.edges[index]
        const a3 = a * 3
        const b3 = b * 3
        const o = index * 6
        array[o] = state.positions[a3]
        array[o + 1] = state.positions[a3 + 1]
        array[o + 2] = state.positions[a3 + 2]
        array[o + 3] = state.positions[b3]
        array[o + 4] = state.positions[b3 + 1]
        array[o + 5] = state.positions[b3 + 2]
      }
      attribute.needsUpdate = true
      edges.geometry.setDrawRange(0, state.edges.length * 2)
    }
  }

  const update = (dt: number, p: ParamValues): void => {
    fixedUpdate(dt, p)
    renderSync()
  }

  return {
    object: root,
    update,
    fixedUpdate,
    renderSync,
    setMode: (mode) => model.setMode(mode),
    action: (key) => {
      if (key === 'drop') model.drop()
    },
    diagnostics: () => model.diagnostics(),
    calibration: () => model.calibration(),
    readouts: () => {
      const state = model.state
      return {
        压缩率: `${(state.squash * 100).toFixed(1)}%`,
        峰值压缩: `${(state.maxSquash * 100).toFixed(1)}%`,
        接触质点: state.contacts,
        落地状态: state.landed ? '已接触' : '下落中',
        仿真时间: `${state.time.toFixed(1)} s`
      }
    },
    dispose: () => {
      particles?.geometry.dispose()
      edges?.geometry.dispose()
      particleMaterial.dispose()
      edgeMaterial.dispose()
      disposeObject(root)
    }
  }
}

export const S24: ScenarioMeta = {
  id: 's24',
  title: '软体体积落体与地面形变',
  subtitle: '体积点阵、距离约束与落地压缩回弹',
  description:
    '球形、块形或长梁形软体由三维质点阵与邻域约束构成，从设定高度下落，触地后发生局部压缩与整体回弹；可调形状、落差、点阵分辨率、刚度、质量与恢复系数。',
  tag: 'Cesium + Three.js · 软体形变',
  updatedAt: '2026-10-26',
  accent: '#7fe0c6',
  anchor: { lon: 116.391, lat: 39.907, height: 44 },
  camera: { range: 55, pitch: -24, heading: 40, targetY: 8 },
  metrics: [
    { key: '压缩率', label: '压缩率' },
    { key: '峰值压缩', label: '峰值压缩' },
    { key: '接触质点', label: '接触质点' },
    { key: '落地状态', label: '落地状态' }
  ],
  legend: [
    { color: '#7fe0c6', label: '软体质点' },
    { color: '#5abf9f', label: '邻域约束' },
  ],
  hint: '降低刚度可看到更明显的落地压缩 · 分辨率和形状改变点阵拓扑 · 提高落差增大冲击形变',
  info: [
    '软体由三维网格质点与轴向、对角邻域距离约束组成，采用位置约束迭代恢复静止长度，质点间逆质量相同。',
    '落地时按恢复系数处理竖直速度，并对水平速度施加摩擦；压缩率由包围盒高度相对静止高度计算。',
    '工程软体常用有限元、形状匹配或 XPBD 体积约束，并加入自碰撞、塑性变形与粘弹性材料模型。'
  ],
  sections: [
    {
      title: '软体形态',
      params: [
        {
          key: 'shape',
          label: '软体形状',
          type: 'select',
          value: 'sphere',
          options: [
            { value: 'sphere', label: '球体' },
            { value: 'box', label: '立方体' },
            { value: 'beam', label: '长梁体' }
          ]
        },
        { key: 'resolution', label: '点阵分辨率', type: 'range', min: 4, max: 6, step: 1, value: 5, unit: ' 级' },
        { key: 'mass', label: '软体质量', type: 'range', min: 1, max: 40, step: 1, value: 15, unit: ' kg' }
      ]
    },
    {
      title: '下落与材料',
      params: [
        { key: 'dropHeight', label: '释放高度', type: 'range', min: 1, max: 26, step: 1, value: 12, unit: ' m' },
        { key: 'softness', label: '材料刚度', type: 'range', min: 0.1, max: 1, step: 0.02, value: 0.55 },
        { key: 'damping', label: '空气阻尼', type: 'range', min: 0.05, max: 1, step: 0.05, value: 0.35 },
        { key: 'restitution', label: '地面恢复系数', type: 'range', min: 0, max: 0.55, step: 0.01, value: 0.18 }
      ]
    },
    {
      title: '环境与操作',
      params: [{ key: 'gravity', label: '重力加速度', type: 'range', min: 3, max: 20, step: 0.1, value: 9.81, unit: ' m/s²' }],
      actions: [{ key: 'drop', label: '重新下落', style: 'primary' }]
    }
  ],
  create: createS24
}
