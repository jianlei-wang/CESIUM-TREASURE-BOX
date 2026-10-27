import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { num, text } from '../types'
import { addStageGround, addSphere, disposeObject, surface } from '../helpers'
import { createS25Model, type S25Preset } from '../simulations/s25.model'

const PRESET_COLORS: Record<S25Preset, string> = {
  tower: '#c9a227',
  bridge: '#8fa3b8',
  stone: '#b27a5c',
  mountain: '#c77d3f'
}

function createS25(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 160, { disc: '#1b232b', accent: kit.accent })
  const chunkGeometry = new THREE.BoxGeometry(1, 1, 1)
  const intactMaterial = surface('#c9a227', { roughness: 0.82 })
  const brokenMaterial = surface('#d9c27a', { roughness: 0.7, emissive: '#5c4a12', emissiveIntensity: 0.25 })
  const chunkMeshes: THREE.Mesh[] = []
  let lastSignature = ''
  let chunkCount = 0

  const projectile = addSphere(root, 0.45, [0, 0, 0], surface('#f5f7fa', { metalness: 0.6, roughness: 0.25, emissive: '#485a6b', emissiveIntensity: 0.4 }), 22)
  projectile.name = 'projectile'
  const trail = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.55 })
  )
  const trailPoints: THREE.Vector3[] = []
  trail.geometry.setDrawRange(0, 0)
  root.add(trail)

  const model = createS25Model({
    preset: 'tower',
    speed: 22,
    projectileMass: 60,
    projectileRadius: 0.55,
    fractureRadius: 3.2,
    gravity: 9.81,
    restitution: 0.22,
    damping: 0.35
  })

  const rebuildChunks = (): void => {
    for (const mesh of chunkMeshes) mesh.removeFromParent()
    chunkMeshes.length = 0
    intactMaterial.color.set(PRESET_COLORS[model.state.preset])
    for (const chunk of model.state.chunks) {
      const mesh = new THREE.Mesh(chunkGeometry, intactMaterial)
      mesh.scale.set(chunk.size[0] * 0.94, chunk.size[1] * 0.94, chunk.size[2] * 0.94)
      root.add(mesh)
      chunkMeshes.push(mesh)
    }
    chunkCount = model.state.chunks.length
  }

  const fixedUpdate = (dt: number, p: ParamValues): void => {
    model.configure({
      preset: text(p, 'preset', 'tower') as S25Preset,
      speed: num(p, 'speed', 22),
      projectileMass: num(p, 'projectileMass', 60),
      projectileRadius: num(p, 'projectileRadius', 0.55),
      fractureRadius: num(p, 'fractureRadius', 3.2),
      gravity: num(p, 'gravity', 9.81),
      restitution: num(p, 'restitution', 0.22),
      damping: num(p, 'damping', 0.35)
    })
    model.fixedStep(dt)
  }

  let canvasRadius = 0.55

  const renderSync = (): void => {
    const state = model.state
    const signature = `${state.preset}|${state.chunks.length}`
    if (signature !== lastSignature || state.chunks.length !== chunkCount) {
      rebuildChunks()
      lastSignature = signature
    }
    for (let index = 0; index < state.chunks.length; index += 1) {
      const chunk = state.chunks[index]
      const mesh = chunkMeshes[index]
      if (!mesh) continue
      mesh.position.set(chunk.position[0], chunk.position[1], chunk.position[2])
      mesh.rotation.set(chunk.rotation[0], chunk.rotation[1], chunk.rotation[2])
      mesh.material = chunk.active ? brokenMaterial : intactMaterial
    }
    projectile.position.set(state.projectile.position[0], state.projectile.position[1], state.projectile.position[2])
    projectile.visible = state.projectile.active
    projectile.scale.setScalar(Math.max(0.15, canvasRadius) / 0.45)
    if (!state.projectile.active) {
      trail.geometry.setDrawRange(0, 0)
      return
    }
    trailPoints.push(new THREE.Vector3(state.projectile.position[0], state.projectile.position[1], state.projectile.position[2]))
    if (trailPoints.length > 120) trailPoints.shift()
    const geometry = trail.geometry
    let attribute = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!attribute || attribute.count < trailPoints.length) {
      attribute = new THREE.BufferAttribute(new Float32Array(Math.max(16, trailPoints.length * 2) * 3), 3)
      geometry.setAttribute('position', attribute)
    }
    for (let index = 0; index < trailPoints.length; index += 1) {
      attribute.setXYZ(index, trailPoints[index].x, trailPoints[index].y, trailPoints[index].z)
    }
    attribute.needsUpdate = true
    geometry.setDrawRange(0, trailPoints.length)
  }

  const update = (dt: number, p: ParamValues): void => {
    canvasRadius = num(p, 'projectileRadius', 0.55)
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
      if (key === 'fire') {
        model.fire()
        trailPoints.length = 0
        trail.geometry.setDrawRange(0, 0)
        lastSignature = ''
      }
    },
    diagnostics: () => model.diagnostics(),
    calibration: () => model.calibration(),
    readouts: () => {
      const state = model.state
      return {
        冲击速度: `${state.impactSpeed.toFixed(1)} m/s`,
        撞击次数: state.hits,
        断裂构件: state.destroyed,
        静止构件: state.settled,
        最大抛撒: `${state.scatter.toFixed(1)} m`
      }
    },
    dispose: () => {
      chunkGeometry.dispose()
      intactMaterial.dispose()
      brokenMaterial.dispose()
      disposeObject(root)
    }
  }
}

export const S25: ScenarioMeta = {
  id: 's25',
  title: '高速撞击下的结构断裂',
  subtitle: '抛射体冲击、局部解体与抛撒堆积',
  description:
    '抛射体以设定速度撞击塔体、桥面、石块或山形体，撞击点附近的预破碎构件获得冲量与旋转，脱离主体后按重力抛撒、落地并逐渐静止；可切换结构、速度、质量与断裂半径。',
  tag: 'Cesium + Three.js · 冲击断裂',
  updatedAt: '2026-10-26',
  accent: '#ffb347',
  anchor: { lon: 116.391, lat: 39.907, height: 44 },
  camera: { range: 85, pitch: -24, heading: 34, targetY: 8 },
  metrics: [
    { key: '冲击速度', label: '冲击速度' },
    { key: '断裂构件', label: '断裂构件' },
    { key: '静止构件', label: '静止构件' },
    { key: '最大抛撒', label: '最大抛撒' }
  ],
  legend: [
    { color: '#c9a227', label: '完整构件' },
    { color: '#d9c27a', label: '断裂构件' },
    { color: '#f5f7fa', label: '抛射体' }
  ],
  hint: '提高速度与质量可扩大破坏范围 · 断裂半径控制局部解体尺度 · 切换结构对比不同构型的响应',
  info: [
    '结构由预破碎构件拼装，抛射体按球体与构件的距离检测接触，冲量按构件质量比例与距离衰减分配。',
    '断裂构件按重力抛撒，落地采用恢复系数与摩擦衰减，速度低于阈值后标记为静止，避免长期抖动。',
    '工程断裂分析需要材料强度、应力波传播与裂纹扩展模型，本案例以预破碎构件近似局部解体过程。'
  ],
  sections: [
    {
      title: '目标结构',
      params: [
        {
          key: 'preset',
          label: '结构类型',
          type: 'select',
          value: 'tower',
          options: [
            { value: 'tower', label: '塔体' },
            { value: 'bridge', label: '桥面与桥墩' },
            { value: 'stone', label: '石块堆' },
            { value: 'mountain', label: '山形体' }
          ]
        }
      ]
    },
    {
      title: '发射参数',
      params: [
        { key: 'speed', label: '撞击速度', type: 'range', min: 5, max: 40, step: 0.5, value: 22, unit: ' m/s' },
        { key: 'projectileMass', label: '抛射体质量', type: 'range', min: 5, max: 200, step: 5, value: 60, unit: ' kg' },
        { key: 'projectileRadius', label: '抛射体半径', type: 'range', min: 0.2, max: 1.4, step: 0.05, value: 0.55, unit: ' m' },
        { key: 'fractureRadius', label: '断裂半径', type: 'range', min: 0.5, max: 6, step: 0.1, value: 3.2, unit: ' m' }
      ]
    },
    {
      title: '环境与操作',
      params: [
        { key: 'gravity', label: '重力加速度', type: 'range', min: 3, max: 20, step: 0.1, value: 9.81, unit: ' m/s²' },
        { key: 'restitution', label: '构件恢复系数', type: 'range', min: 0, max: 0.5, step: 0.01, value: 0.22 },
        { key: 'damping', label: '地面摩擦', type: 'range', min: 0.05, max: 1, step: 0.05, value: 0.35 }
      ],
      actions: [{ key: 'fire', label: '重新发射', style: 'primary' }]
    }
  ],
  create: createS25
}
