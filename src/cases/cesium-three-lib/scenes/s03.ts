import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num } from '../types'
import { addBox, addLine, addStageGround, disposeObject, surface, toRad, updateLine } from '../helpers'
import { createS03Model, S03_GROUND } from '../simulations/s03.model'

interface BoulderVisual {
  mesh: THREE.Mesh
  trail: THREE.Line
  points: THREE.Vector3[]
  clock: number
}

function createS03(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 250, { disc: '#1a241f', accent: kit.accent })
  const terrain = new THREE.Group()
  const dynamic = new THREE.Group()
  root.add(terrain)
  root.add(dynamic)

  const boulders: BoulderVisual[] = []
  const model = createS03Model({ slope: 28, gravity: 9.81, friction: 0.45, wet: false, count: 18, radius: 1.8, barrier: 0.7 })
  let barrier: THREE.Mesh | null = null
  let lastSignature = ''
  const colors = ['#8f8a78', '#a39a80', '#776f5d', '#b0a88f']

  const groundY = (x: number, slope: number): number => S03_GROUND(x, slope)

  const buildTerrain = (p: ParamValues): void => {
    for (const child of [...terrain.children]) disposeObject(child)
    terrain.clear()
    const slope = num(p, 'slope', 28)
    const segX = 48
    const segZ = 20
    const minX = -180
    const maxX = 40
    const minZ = -110
    const maxZ = 110
    const positions: number[] = []
    const indices: number[] = []
    const colorAttribute: number[] = []
    for (let ix = 0; ix <= segX; ix += 1) {
      const x = minX + ((maxX - minX) * ix) / segX
      for (let iz = 0; iz <= segZ; iz += 1) {
        const z = minZ + ((maxZ - minZ) * iz) / segZ
        const ripple = Math.sin(x * 0.055) * 1.2 + Math.cos(z * 0.08) * 0.8
        positions.push(x, groundY(x, slope) + ripple, z)
        const tone = 0.26 + Math.min(0.4, groundY(x, slope) / 120)
        colorAttribute.push(tone * 0.62, tone * 0.78, tone * 0.55)
      }
    }
    for (let ix = 0; ix < segX; ix += 1) {
      for (let iz = 0; iz < segZ; iz += 1) {
        const a = ix * (segZ + 1) + iz
        const b = a + 1
        const c = a + (segZ + 1)
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorAttribute, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, side: THREE.DoubleSide }))
    terrain.add(mesh)

    addBox(terrain, [150, 0.5, 76], [95, 0.25, 0], surface('#303943', { roughness: 0.82 }))
    addBox(terrain, [150, 0.04, 0.5], [95, 0.54, -12], surface('#e0c26a', { emissive: '#8a6a14', emissiveIntensity: 0.5 }))
    addBox(terrain, [150, 0.04, 0.5], [95, 0.54, 12], surface('#e0c26a', { emissive: '#8a6a14', emissiveIntensity: 0.5 }))
    const wallHeight = 1 + num(p, 'barrier', 0.7) * 10
    barrier = addBox(terrain, [2.4, wallHeight, 74], [8, wallHeight / 2, 0], surface('#c7a96b', { roughness: 0.7, metalness: 0.2 }))
    for (let i = -2; i <= 2; i += 1) {
      addBox(terrain, [3.4, wallHeight * 1.08, 1.1], [8, wallHeight * 0.54, i * 15], surface('#8d7a4d'))
    }
    addLine(
      terrain,
      [new THREE.Vector3(-160, groundY(-160, slope) + 1, -70), new THREE.Vector3(40, 1, -70), new THREE.Vector3(40, 1, 70), new THREE.Vector3(-160, groundY(-160, slope) + 1, 70)],
      '#8fd6a9',
      0.28
    )
  }

  const release = (p: ParamValues): void => {
    for (const item of boulders) {
      disposeObject(item.mesh)
      disposeObject(item.trail)
    }
    dynamic.clear()
    boulders.length = 0
    model.configure({
      slope: num(p, 'slope', 28),
      gravity: num(p, 'gravity', 9.81),
      friction: num(p, 'friction', 0.45),
      wet: flag(p, 'wet', false),
      count: Math.round(num(p, 'count', 18)),
      radius: num(p, 'radius', 1.8),
      barrier: num(p, 'barrier', 0.7)
    })
    model.release()
    for (const boulder of model.state.boulders) {
      const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(boulder.radius, 0), surface(colors[boulder.id % colors.length], { roughness: 0.92, flatShading: true }))
      mesh.position.set(boulder.x, boulder.y, boulder.z)
      mesh.rotation.set(boulder.id * 1.7, boulder.id * 0.9, boulder.id * 2.1)
      dynamic.add(mesh)
      const trail = addLine(dynamic, [mesh.position.clone()], '#ff9d6b', 0.55)
      boulders.push({ mesh, trail, points: [mesh.position.clone()], clock: 0 })
    }
  }

  const fixedUpdate = (dt: number, p: ParamValues): void => {
    model.configure({
      slope: num(p, 'slope', 28),
      gravity: num(p, 'gravity', 9.81),
      friction: num(p, 'friction', 0.45),
      wet: flag(p, 'wet', false),
      count: Math.round(num(p, 'count', 18)),
      radius: num(p, 'radius', 1.8),
      barrier: num(p, 'barrier', 0.7)
    })
    model.fixedStep(dt)
  }

  const renderSync = (alpha: number, p: ParamValues): void => {
    const dt = 1 / 60
    const showTrail = flag(p, 'trail', true)
    for (const boulder of model.state.boulders) {
      const visual = boulders[boulder.id]
      if (!visual) continue
      visual.mesh.position.set(boulder.x + boulder.vx * alpha * dt, boulder.y, boulder.z + boulder.vz * alpha * dt)
      visual.mesh.rotation.z -= (boulder.vx * dt) / Math.max(0.4, boulder.radius)
      visual.mesh.rotation.x -= (boulder.vz * dt) / Math.max(0.4, boulder.radius)
      if (showTrail) {
        visual.clock += dt
        if (visual.clock > 0.045) {
          visual.clock = 0
          visual.points.push(visual.mesh.position.clone())
          if (visual.points.length > 140) visual.points.shift()
          updateLine(visual.trail, visual.points)
        }
      }
      visual.trail.visible = showTrail
    }
  }

  const update = (dt: number, p: ParamValues): void => {
    fixedUpdate(dt, p)
    renderSync(1, p)
  }

  const sync = (p: ParamValues): void => {
    const signature = `${Math.round(num(p, 'slope', 28))}|${Math.round(num(p, 'count', 18))}|${Math.round(num(p, 'radius', 1.8) * 10)}`
    if (signature !== lastSignature) {
      lastSignature = signature
      buildTerrain(p)
      release(p)
    }
    if (barrier) {
      const height = 1 + num(p, 'barrier', 0.7) * 10
      barrier.scale.y = height / (barrier.geometry as THREE.BoxGeometry).parameters.height
      barrier.position.y = height / 2
    }
  }

  buildTerrain({ slope: 28 } as ParamValues)
  release({ count: 18, radius: 1.8, slope: 28 } as ParamValues)
  lastSignature = '28|18|18'

  return {
    object: root,
    update,
    fixedUpdate,
    renderSync,
    setMode: (mode) => model.setMode(mode),
    sync,
    action: (key, p) => {
      if (key === 'release') release(p)
    },
    diagnostics: () => model.diagnostics(),
    calibration: () => model.calibration(),
    readouts: () => {
      const state = model.state
      return {
        释放岩块: state.released,
        最大速度: `${state.maxSpeed.toFixed(1)} m/s`,
        拦截率: `${state.released ? Math.round((state.intercepted / state.released) * 100) : 0}%`,
        最远滚距: `${Math.max(0, state.runout + 150).toFixed(0)} m`,
        仿真时间: `${state.time.toFixed(1)} s`
      }
    },
    dispose: () => disposeObject(root)
  }
}

export const S03: ScenarioMeta = {
  id: 's03',
  title: '山地滑坡、滚石与防护拦截',
  subtitle: '坡面重力驱动、滚石运动与挡墙拦截评估',
  description:
    '在倾斜坡面上释放不同粒径的岩块，受重力沿坡加速、摩擦减速并冲击防护挡墙；实时统计最大速度、滚落距离和拦截率，支持干湿坡面与挡墙高度对比。',
  tag: 'Cesium + Three.js · 坡面接触',
  updatedAt: '2026-10-23',
  accent: '#e5b45b',
  anchor: { lon: 103.12, lat: 30.65, height: 820 },
  camera: { range: 260, pitch: -24, heading: 58, targetY: 18 },
  metrics: [
    { key: '释放岩块', label: '释放岩块' },
    { key: '最大速度', label: '最大速度' },
    { key: '拦截率', label: '拦截率' },
    { key: '最远滚距', label: '最远滚距' }
  ],
  legend: [
    { color: '#a39a80', label: '滚落岩块' },
    { color: '#c7a96b', label: '防护挡墙' },
    { color: '#303943', label: '坡脚道路' }
  ],
  hint: '调整坡度观察滚石加速 · 降低挡墙高度可见部分岩块越过 · 湿坡模式摩擦更低、滚得更远',
  info: [
    '地形由参数化坡面网格生成，坡面高度随锚点东向距离线性下降，坡脚连接道路平台。',
    '岩块沿坡向受重力分量与摩擦阻力共同作用，进入道路后只保留惯性滑行，挡墙按高度进行拦截判定。',
    '这是滚石运动学演示，真实滑坡还需要考虑岩土流变、块体破碎与地表侵蚀。'
  ],
  sections: [
    {
      title: '边坡与地形',
      params: [
        { key: 'slope', label: '坡面角度', type: 'range', min: 12, max: 45, step: 1, value: 28, unit: '°' },
        { key: 'friction', label: '坡面摩擦', type: 'range', min: 0.1, max: 0.9, step: 0.01, value: 0.45 },
        { key: 'gravity', label: '重力加速度', type: 'range', min: 5, max: 20, step: 0.1, value: 9.81, unit: ' m/s²' }
      ]
    },
    {
      title: '岩块释放',
      params: [
        { key: 'count', label: '岩块数量', type: 'range', min: 4, max: 40, step: 1, value: 18, unit: ' 块' },
        { key: 'radius', label: '平均粒径', type: 'range', min: 0.8, max: 4, step: 0.1, value: 1.8, unit: ' m' },
        { key: 'wet', label: '湿滑坡面', type: 'toggle', value: false },
        { key: 'trail', label: '滚石轨迹', type: 'toggle', value: true }
      ]
    },
    {
      title: '防护结构',
      params: [{ key: 'barrier', label: '挡墙高度', type: 'range', min: 0, max: 1, step: 0.05, value: 0.7 }],
      actions: [
        { key: 'release', label: '释放滚石', style: 'primary' }
      ]
    }
  ],
  create: createS03
}
