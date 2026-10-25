import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num } from '../types'
import { addCylinder, addGlowPoints, addStageGround, disposeObject, seeded, surface, toRad } from '../helpers'
import { createS10Model, S10_HEIGHT, S10_WIDTH } from '../simulations/s10.model'

function createS10(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 240, { disc: '#1b2620', accent: kit.accent })
  const pole = addCylinder(root, 0.22, 0.3, 26, [-18, 13, 0], surface('#aab4bb', { metalness: 0.6 }), 12)
  pole.name = 'flag-pole'
  const clothGeometry = new THREE.PlaneGeometry(S10_WIDTH, S10_HEIGHT, 24, 14)
  const clothBase = Float32Array.from(clothGeometry.attributes.position.array as Float32Array)
  const cloth = new THREE.Mesh(
    clothGeometry,
    new THREE.MeshStandardMaterial({ color: '#e0613f', roughness: 0.62, side: THREE.DoubleSide, transparent: true, opacity: 0.94 })
  )
  cloth.position.set(-18, 17, 0)
  root.add(cloth)
  const trees: { group: THREE.Group; canopy: THREE.Mesh; phase: number }[] = []
  const random = seeded(7723)
  for (let i = 0; i < 12; i += 1) {
    const x = -90 + random() * 180
    const z = -70 + random() * 140
    if (Math.abs(x) < 28 && Math.abs(z) < 24) continue
    const height = 10 + random() * 12
    const group = new THREE.Group()
    group.position.set(x, 0, z)
    addCylinder(group, 0.5, 0.9, height, [0, height / 2, 0], surface('#6b5439'), 8)
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(4.6, height * 0.8, 12), surface('#4f8a4a', { roughness: 0.9, flatShading: true }))
    canopy.position.y = height + height * 0.25
    group.add(canopy)
    root.add(group)
    trees.push({ group, canopy, phase: random() * Math.PI * 2 })
  }
  const vectors = new THREE.Group()
  root.add(vectors)
  for (let i = 0; i < 22; i += 1) {
    const x = -110 + random() * 220
    const z = -110 + random() * 220
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(14, 0, 0)]),
      new THREE.LineBasicMaterial({ color: '#8fe0ff', transparent: true, opacity: 0.5 })
    )
    line.position.set(x, 1 + random() * 36, z)
    vectors.add(line)
  }
  const leaves = addGlowPoints(root, 140, '#d8ef9f', 1.1, 0.72)
  const leafState: { x: number; y: number; z: number; phase: number }[] = []
  for (let i = 0; i < 140; i += 1) leafState.push({ x: (random() - 0.5) * 220, y: random() * 50, z: (random() - 0.5) * 220, phase: random() * 6 })
  let normalTick = 0
  const model = createS10Model({ wind: 8, direction: 45, gust: 0.35, clothStiffness: 0.55, treeSway: 1 })

  const fixedUpdate = (dt: number, p: ParamValues): void => {
    model.configure({
      wind: num(p, 'wind', 8),
      direction: num(p, 'direction', 45),
      gust: num(p, 'gust', 0.35),
      clothStiffness: num(p, 'clothStiffness', 0.55),
      treeSway: num(p, 'treeSway', 1)
    })
    model.fixedStep(dt)
  }

  const renderSync = (alpha: number, p: ParamValues): void => {
    const dt = 1 / 60
    const showVectors = flag(p, 'vectors', true)
    const showLeaves = flag(p, 'leaves', true)
    const sway = num(p, 'treeSway', 1)
    const state = model.state
    const position = clothGeometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < position.count; i += 1) {
      position.setXYZ(i, state.cloth[i * 3], state.cloth[i * 3 + 1], state.cloth[i * 3 + 2])
    }
    position.needsUpdate = true
    normalTick += 1
    if (normalTick % 2 === 0) clothGeometry.computeVertexNormals()
    cloth.rotation.y = Math.atan2(state.windX, state.windZ)
    for (const tree of trees) {
      const force = state.canopyOffset * 0.012 + state.effectiveWind * sway * 0.009
      tree.group.rotation.z = Math.sin(state.time * (1.1 + sway * 0.3) + tree.phase) * force
      tree.group.rotation.x = Math.cos(state.time * 0.9 + tree.phase) * force * 0.55
      tree.canopy.rotation.z = Math.sin(state.time * 1.9 + tree.phase) * force * 1.4
    }
    vectors.visible = showVectors
    if (showVectors) {
      for (const child of vectors.children) {
        child.rotation.y = Math.atan2(state.windX, state.windZ)
        const scale = 0.4 + state.effectiveWind / 16
        child.scale.set(scale, scale, scale)
      }
    }
    leaves.visible = showLeaves
    if (showLeaves) {
      const leafPositions = leaves.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < leafState.length; i += 1) {
        const leaf = leafState[i]
        leaf.x += state.windX * state.effectiveWind * dt * 0.6
        leaf.z += state.windZ * state.effectiveWind * dt * 0.6
        leaf.y += Math.sin(state.time * 2 + leaf.phase) * dt * 1.2 - dt * 0.4
        if (leaf.x > 120) leaf.x = -120
        if (leaf.x < -120) leaf.x = 120
        if (leaf.z > 120) leaf.z = -120
        if (leaf.z < -120) leaf.z = 120
        if (leaf.y < 0.5) leaf.y = 30 + Math.random() * 20
        leafPositions.setXYZ(i, leaf.x, leaf.y, leaf.z)
      }
      leafPositions.needsUpdate = true
    }
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
    diagnostics: () => model.diagnostics(),
    calibration: () => model.calibration(),
    readouts: () => {
      const state = model.state
      return {
        风速: `${state.effectiveWind.toFixed(1)} m/s`,
        风向: `${state.direction.toFixed(0)}°`,
        旗帜摆幅: `${state.amplitude.toFixed(2)} m`,
        树冠位移: `${state.canopyOffset.toFixed(2)} m`,
        仿真时间: `${state.time.toFixed(1)} s`
      }
    },
    dispose: () => disposeObject(root)
  }
}

export const S10: ScenarioMeta = {
  id: 's10',
  title: '城市风场、旗帜布料与植被摇摆',
  subtitle: '风矢量驱动、布料网格变形与树冠响应',
  description:
    '风向风速连续变化，旗帜布料按顶点正弦约束产生行波，树冠随阵风摆动，地面漂浮物沿风向输运；可调风速、风向、阵风强度、布料刚度与植被响应幅度。',
  tag: 'Cesium + Three.js · 风场与布料',
  updatedAt: '2026-10-23',
  accent: '#8fe0ff',
  anchor: { lon: 117.2, lat: 39.1, height: 8 },
  camera: { range: 240, pitch: -22, heading: 48, targetY: 30 },
  metrics: [
    { key: '风速', label: '风速' },
    { key: '风向', label: '风向' },
    { key: '旗帜摆幅', label: '旗帜摆幅' },
    { key: '树冠位移', label: '树冠位移' }
  ],
  legend: [
    { color: '#e0613f', label: '布料旗帜' },
    { color: '#4f8a4a', label: '树冠' },
    { color: '#8fe0ff', label: '风矢量与漂浮物' }
  ],
  hint: '风向改变旗帜朝向 · 阵风增强时布料振幅和树冠位移同步增大 · 刚度越低布料越柔软',
  info: [
    '布料网格采用多频正弦叠加的顶点位移，边缘固定在旗杆一侧，当前实现为视觉布料而非完整 PBD/XPBD 约束求解。',
    '风向同时驱动布料朝向、树木旋转和漂浮物输运，气象风向与动力学风向在代码中统一为指向。',
    '工程布料需要位置约束、拉伸/弯曲刚度、碰撞与自碰撞，风载还要考虑迎风面积和阻力系数。'
  ],
  sections: [
    {
      title: '风场条件',
      params: [
        { key: 'wind', label: '平均风速', type: 'range', min: 0, max: 25, step: 0.5, value: 8, unit: ' m/s' },
        { key: 'direction', label: '风向', type: 'range', min: 0, max: 360, step: 5, value: 45, unit: '°' },
        { key: 'gust', label: '阵风强度', type: 'range', min: 0, max: 1, step: 0.05, value: 0.35 }
      ]
    },
    {
      title: '对象响应',
      params: [
        { key: 'clothStiffness', label: '布料刚度', type: 'range', min: 0.1, max: 1, step: 0.05, value: 0.55 },
        { key: 'treeSway', label: '植被摆幅', type: 'range', min: 0, max: 2, step: 0.05, value: 1 }
      ]
    },
    {
      title: '显示开关',
      params: [
        { key: 'vectors', label: '风矢量', type: 'toggle', value: true },
        { key: 'leaves', label: '漂浮物', type: 'toggle', value: true }
      ]
    }
  ],
  create: createS10
}
