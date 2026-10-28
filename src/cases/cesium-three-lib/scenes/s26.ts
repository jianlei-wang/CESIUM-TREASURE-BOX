import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num, text } from '../types'
import { addStageGround, clamp, disposeObject, surface } from '../helpers'
import { createS26Model, describeKind, type RegionSource } from '../simulations/s26.model'
import {
  polygonCentroid,
  TREE_PROFILES,
  terrainHeight,
  type TreePreset
} from '../simulations/vegetation'

const UP = new THREE.Vector3(0, 1, 0)
const TREE_CAPACITY = 2400
const GRASS_CAPACITY = 40000
const FLOWER_CAPACITY = 16000
const ROCK_CAPACITY = 2000

function mergeGeometries(geometries: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  for (const geometry of geometries) {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
    const index = geometry.getIndex()
    const push = (vertex: number): void => {
      positions.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex))
      normals.push(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex))
    }
    if (index) {
      for (let i = 0; i < index.count; i += 1) push(index.getX(i))
    } else {
      for (let i = 0; i < position.count; i += 1) push(i)
    }
    geometry.dispose()
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  merged.computeBoundingSphere()
  return merged
}

function canopyGeometry(preset: TreePreset): THREE.BufferGeometry {
  const layers = preset === 'bush' ? 2 : 3
  const step = preset === 'bush' ? 0.16 : 0.14
  const bottom = preset === 'bush' ? 0.22 : 0.46
  const height = preset === 'bush' ? 0.34 : 0.36
  const radius = preset === 'pine' ? 0.34 : preset === 'bush' ? 0.5 : 0.46
  const taper = preset === 'pine' ? 0.62 : 0.44
  const parts: THREE.BufferGeometry[] = []
  for (let layer = 0; layer < layers; layer += 1) {
    const t = layer / Math.max(1, layers - 1)
    const cone = new THREE.ConeGeometry(radius * (1 - t * taper), height * (1 - t * 0.12), preset === 'pine' ? 9 : 7, 1)
    cone.translate(0, bottom + height * 0.5 + layer * step, 0)
    parts.push(cone)
  }
  return mergeGeometries(parts)
}

function createS26(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 190, { disc: '#141d18', accent: kit.accent, grid: '#26382c' })

  const terrainGeometry = new THREE.PlaneGeometry(240, 240, 64, 64)
  terrainGeometry.rotateX(-Math.PI / 2)
  const terrainPositions = terrainGeometry.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < terrainPositions.count; index += 1) {
    const x = terrainPositions.getX(index)
    const z = terrainPositions.getZ(index)
    terrainPositions.setY(index, terrainHeight(x, z))
  }
  terrainGeometry.computeVertexNormals()
  const terrain = new THREE.Mesh(terrainGeometry, surface('#33402f', { roughness: 0.96, flatShading: true }))
  terrain.position.y = 0.01
  root.add(terrain)

  const groundPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    surface('#2c3629', { roughness: 0.98 })
  )
  groundPlane.rotation.x = -Math.PI / 2
  groundPlane.position.y = 0.005
  root.add(groundPlane)

  const trunkGeometry = new THREE.CylinderGeometry(0.22, 0.34, 1, 6, 1)
  trunkGeometry.translate(0, 0.5, 0)
  const trunkMaterial = surface('#6b5034', { roughness: 0.94 })
  const canopyMaterial = surface(TREE_PROFILES.mixed.canopy, { roughness: 0.8, flatShading: true })
  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, TREE_CAPACITY)
  const canopyMesh = new THREE.InstancedMesh(canopyGeometry('mixed'), canopyMaterial, TREE_CAPACITY)
  const treeMeshes = [trunkMesh, canopyMesh]
  for (const mesh of treeMeshes) {
    mesh.frustumCulled = false
    mesh.count = 0
    root.add(mesh)
  }

  const grassGeometry = new THREE.ConeGeometry(0.32, 1.1, 4, 1)
  grassGeometry.translate(0, 0.55, 0)
  const grassMaterial = surface('#6d9b58', { roughness: 0.86, flatShading: true })
  const grassMesh = new THREE.InstancedMesh(grassGeometry, grassMaterial, GRASS_CAPACITY)
  grassMesh.frustumCulled = false
  grassMesh.count = 0
  root.add(grassMesh)

  const flowerGeometry = new THREE.IcosahedronGeometry(0.24, 0)
  const flowerMaterial = surface('#e6c968', { roughness: 0.68, flatShading: true, emissive: '#5a4a12', emissiveIntensity: 0.2 })
  const flowerMesh = new THREE.InstancedMesh(flowerGeometry, flowerMaterial, FLOWER_CAPACITY)
  flowerMesh.frustumCulled = false
  flowerMesh.count = 0
  root.add(flowerMesh)

  const rockGeometry = new THREE.DodecahedronGeometry(0.9, 0)
  const rockMaterial = surface('#7a7d76', { roughness: 0.92, flatShading: true })
  const rockMesh = new THREE.InstancedMesh(rockGeometry, rockMaterial, ROCK_CAPACITY)
  rockMesh.frustumCulled = false
  rockMesh.count = 0
  root.add(rockMesh)

  const outlineGroup = new THREE.Group()
  root.add(outlineGroup)

  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const tilt = new THREE.Quaternion()
  const swayAxis = new THREE.Vector3(1, 0, 0.35).normalize()
  const position = new THREE.Vector3()
  const localScale = new THREE.Vector3()

  const model = createS26Model({
    source: 'forest',
    seed: 12,
    treePreset: 'mixed',
    tree: true,
    grass: true,
    flower: true,
    rock: true,
    treeDensity: 120,
    grassDensity: 3200,
    flowerDensity: 900,
    rockDensity: 40,
    treeScale: 0.58,
    grassScale: 1,
    clampToTerrain: true,
    terrain: true,
    shapeRotation: 24,
    shapeSize: 96,
    gridRows: 18,
    gridCols: 18,
    gridInterval: 8,
    windStrength: 1.1,
    windFrequency: 0.8,
    maximumLeafDistance: 320,
    maximumGrassDistance: 150,
    maximumRockDistance: 200,
    cleared: false
  })

  let lastOutlineKey = ''
  let lastPreset: TreePreset = 'mixed'

  const rebuildOutline = (params: ParamValues): void => {
    const state = model.state
    const region = state.region
    const key = [
      state.source,
      region.outer.length,
      region.points.length,
      region.holes.reduce((sum, hole) => sum + hole.length, 0),
      num(params, 'shapeRotation', 24).toFixed(1),
      num(params, 'shapeSize', 96).toFixed(1)
    ].join('|')
    if (key === lastOutlineKey) return
    lastOutlineKey = key
    for (const child of [...outlineGroup.children]) {
      disposeObject(child)
      child.removeFromParent()
    }
    outlineGroup.clear()
    const lift = (x: number, z: number): number => terrainHeight(x, z) + 0.4
    const loops: Array<Array<[number, number]>> = []
    if (region.outer.length >= 3) loops.push(region.outer)
    for (const hole of region.holes) if (hole.length >= 3) loops.push(hole)
    for (const loop of loops) {
      const points = loop.map(([x, z]) => new THREE.Vector3(x, lift(x, z), z))
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: '#8fd6a8', transparent: true, opacity: 0.9 })
      )
      outlineGroup.add(line)
    }
    if (region.points.length > 0) {
      const positions = new Float32Array(region.points.length * 3)
      for (let index = 0; index < region.points.length; index += 1) {
        const [x, z] = region.points[index]
        positions[index * 3] = x
        positions[index * 3 + 1] = lift(x, z)
        positions[index * 3 + 2] = z
      }
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const dots = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({ color: '#ffd27f', size: 1.4, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false })
      )
      outlineGroup.add(dots)
    }
  }

  const fixedUpdate = (dt: number, p: ParamValues): void => {
    model.configure({
      source: text(p, 'source', 'forest') as RegionSource,
      seed: num(p, 'seed', 12),
      treePreset: text(p, 'treePreset', 'mixed') as TreePreset,
      tree: flag(p, 'tree', true),
      grass: flag(p, 'grass', true),
      flower: flag(p, 'flower', true),
      rock: flag(p, 'rock', true),
      treeDensity: num(p, 'treeDensity', 120),
      grassDensity: num(p, 'grassDensity', 3200),
      flowerDensity: num(p, 'flowerDensity', 900),
      rockDensity: num(p, 'rockDensity', 40),
      treeScale: num(p, 'treeScale', 0.58),
      grassScale: num(p, 'grassScale', 1),
      clampToTerrain: flag(p, 'clampToTerrain', true),
      terrain: flag(p, 'terrain', true),
      shapeRotation: num(p, 'shapeRotation', 24),
      shapeSize: num(p, 'shapeSize', 96),
      gridRows: num(p, 'gridRows', 18),
      gridCols: num(p, 'gridCols', 18),
      gridInterval: num(p, 'gridInterval', 8),
      windStrength: num(p, 'windStrength', 1.1),
      windFrequency: num(p, 'windFrequency', 0.8),
      maximumLeafDistance: num(p, 'maximumLeafDistance', 320),
      maximumGrassDistance: num(p, 'maximumGrassDistance', 150),
      maximumRockDistance: num(p, 'maximumRockDistance', 200)
    })
    model.fixedStep(dt)
  }

  const renderSync = (_alpha: number, p: ParamValues): void => {
    const state = model.state
    const preset = text(p, 'treePreset', 'mixed') as TreePreset
    if (preset !== lastPreset) {
      lastPreset = preset
      const profile = TREE_PROFILES[preset] ?? TREE_PROFILES.mixed
      canopyMesh.geometry.dispose()
      canopyMesh.geometry = canopyGeometry(preset)
      canopyMaterial.color.set(profile.canopy)
      trunkMaterial.color.set(profile.bark)
    }
    const terrainOn = flag(p, 'terrain', true)
    const clampOn = flag(p, 'clampToTerrain', true)
    terrain.visible = terrainOn
    groundPlane.visible = !terrainOn
    const windStrength = clamp(num(p, 'windStrength', 1.1), 0, 3)
    const sway = Math.sin(state.windPhase) * windStrength * 0.05
    const gust = Math.sin(state.windPhase * 2.3 + 1.1) * windStrength * 0.03
    tilt.setFromAxisAngle(swayAxis, sway + gust * 0.6)

    rebuildOutline(p)

    const treeHeight = TREE_PROFILES[preset]?.height ?? 12
    let trunkCount = 0
    let canopyCount = 0
    let grassCount = 0
    let flowerCount = 0
    let rockCount = 0
    const centre = polygonCentroid(state.region.outer.length >= 3 ? state.region.outer : state.region.points)
    const allowTree = flag(p, 'tree', true) && (state.region.outer.length >= 3 || state.region.points.length > 0)
    const leafLimit = num(p, 'maximumLeafDistance', 320)
    const grassLimit = num(p, 'maximumGrassDistance', 150)
    const rockLimit = num(p, 'maximumRockDistance', 200)

    for (const instance of state.instances) {
      const distance = Math.hypot(instance.position[0] - centre[0], instance.position[2] - centre[1])
      const x = instance.position[0]
      const z = instance.position[2]
      const y = clampOn && terrainOn ? terrainHeight(x, z) : 0
      if (instance.kind === 'tree') {
        if (!allowTree || distance > leafLimit || trunkCount >= TREE_CAPACITY) continue
        const height = treeHeight * instance.scale
        const lean = sway * (0.6 + instance.variant * 0.18)
        const trunkHeight = height * 0.46
        position.set(x, y, z)
        quaternion.setFromAxisAngle(UP, instance.rotation)
        localScale.set(height * 0.06, trunkHeight, height * 0.06)
        matrix.compose(position, quaternion, localScale)
        trunkMesh.setMatrixAt(trunkCount, matrix)
        quaternion.setFromAxisAngle(UP, instance.rotation).multiply(tilt)
        position.set(x + lean * height * 0.02, y, z + gust * height * 0.02)
        localScale.set(height * 0.88, height * 1.06, height * 0.88)
        matrix.compose(position, quaternion, localScale)
        canopyMesh.setMatrixAt(canopyCount, matrix)
        trunkCount += 1
        canopyCount += 1
        continue
      }
      if (instance.kind === 'grass') {
        if (!flag(p, 'grass', true) || distance > grassLimit || grassCount >= GRASS_CAPACITY) continue
        const height = 0.55 * instance.scale
        position.set(x, y, z)
        quaternion.setFromAxisAngle(UP, instance.rotation).multiply(tilt)
        localScale.set(instance.scale * 0.8, height, instance.scale * 0.8)
        matrix.compose(position, quaternion, localScale)
        grassMesh.setMatrixAt(grassCount, matrix)
        grassCount += 1
        continue
      }
      if (instance.kind === 'flower') {
        if (!flag(p, 'flower', true) || distance > grassLimit || flowerCount >= FLOWER_CAPACITY) continue
        position.set(x, y + 0.35 * instance.scale, z)
        quaternion.setFromAxisAngle(UP, instance.rotation).multiply(tilt)
        localScale.setScalar(instance.scale * 1.1)
        matrix.compose(position, quaternion, localScale)
        flowerMesh.setMatrixAt(flowerCount, matrix)
        flowerCount += 1
        continue
      }
      if (distance > rockLimit || rockCount >= ROCK_CAPACITY) continue
      if (!flag(p, 'rock', true)) continue
      position.set(x, y + 0.4 * instance.scale, z)
      quaternion.setFromAxisAngle(UP, instance.rotation)
      localScale.set(instance.scale * 1.2, instance.scale * 0.8, instance.scale * 1.2)
      matrix.compose(position, quaternion, localScale)
      rockMesh.setMatrixAt(rockCount, matrix)
      rockCount += 1
    }

    trunkMesh.count = trunkCount
    canopyMesh.count = canopyCount
    grassMesh.count = grassCount
    flowerMesh.count = flowerCount
    rockMesh.count = rockCount
    trunkMesh.instanceMatrix.needsUpdate = true
    canopyMesh.instanceMatrix.needsUpdate = true
    grassMesh.instanceMatrix.needsUpdate = true
    flowerMesh.instanceMatrix.needsUpdate = true
    rockMesh.instanceMatrix.needsUpdate = true
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
    action: (key, p) => {
      void p
      if (key === 'regenerate') model.restart()
      if (key === 'clear') model.clear()
      if (key === 'focus') {
        const region = model.state.region
        const [cx, cz] = polygonCentroid(region.outer.length >= 3 ? region.outer : region.points)
        kit.focus(new THREE.Vector3(cx, terrainHeight(cx, cz), cz), {
          range: 190,
          pitch: -34,
          heading: 38
        })
      }
    },
    diagnostics: () => model.diagnostics(),
    calibration: () => model.calibration(),
    readouts: () => {
      const state = model.state
      const rows = model.transport()
      return {
        实例总数: state.instances.length,
        树木: state.counts.tree,
        草本: state.counts.grass,
        花朵: state.counts.flower,
        岩石: state.counts.rock,
        区域面积: `${state.areaHa.toFixed(2)} ha`,
        可见树木: state.visible.tree,
        渲染通道: rows.map((row) => `${describeKind(row.kind)} ${row.visible}`).join(' · ')
      }
    },
    dispose: () => {
      trunkGeometry.dispose()
      grassGeometry.dispose()
      flowerGeometry.dispose()
      rockGeometry.dispose()
      for (const mesh of [...treeMeshes, grassMesh, flowerMesh, rockMesh]) mesh.dispose()
      trunkMaterial.dispose()
      canopyMaterial.dispose()
      grassMaterial.dispose()
      flowerMaterial.dispose()
      rockMaterial.dispose()
      terrainGeometry.dispose()
      groundPlane.geometry.dispose()
      disposeObject(outlineGroup)
      disposeObject(root)
    }
  }
}

export const S26: ScenarioMeta = {
  id: 's26',
  title: '场景植被批量布设与绘制来源',
  subtitle: '面状区域、手绘图形、点要素与网格点位的植被生成',
  description:
    '植被按区域面积与每公顷密度撒点，树木、草本、花朵与岩石分别独立开关与缩放；布设来源可切换为含孔洞的林地多边形、手绘矩形与圆形、沿路散点或等间距网格点位，生成后可随风摆动并按最大视距裁剪。',
  tag: 'Cesium + Three.js · 植被布设',
  updatedAt: '2026-10-27',
  accent: '#86d39a',
  anchor: { lon: 118.858, lat: 32.07, height: 140 },
  camera: { range: 300, pitch: -30, heading: 40, targetY: 6 },
  metrics: [
    { key: '实例总数', label: '实例总数' },
    { key: '树木', label: '树木' },
    { key: '区域面积', label: '区域面积' },
    { key: '可见树木', label: '可见树木' }
  ],
  legend: [
    { color: '#578f57', label: '树木' },
    { color: '#6d9b58', label: '草本' },
    { color: '#e6c968', label: '花朵' },
    { color: '#7a7d76', label: '岩石' }
  ],
  hint: '切换布设来源可看到面状围合、散点与网格的差异 · 密度按公顷换算实例数，面积越大株数越多 · 收紧裁剪半径会裁掉远离区域中心的植被',
  info: [
    '撒点在区域包围盒内做拒绝采样：先判定点是否落在多边形内部并避开孔洞，树木与岩石再做最小间距剔除。',
    '实例数量由区域面积乘以每公顷密度得到，并受各类型上限约束；树木与草本各自使用一套实例缓冲，按类型独立开关。',
    '树木实例由主干与锥形树冠两批组成，共用一个变换矩阵的缩放与旋转；风场按相位驱动树冠与草叶侧向偏移。'
  ],
  sections: [
    {
      title: '场景与布设来源',
      params: [
        {
          key: 'source',
          label: '布设来源',
          type: 'select',
          value: 'forest',
          options: [
            { value: 'forest', label: '林地多边形（含孔洞）' },
            { value: 'rectangle', label: '手绘矩形' },
            { value: 'circle', label: '手绘圆形' },
            { value: 'roadside', label: '沿路散点' },
            { value: 'grid', label: '等间距网格' }
          ]
        },
        { key: 'terrain', label: '地形起伏', type: 'toggle', value: true },
        { key: 'shapeSize', label: '图形尺寸', type: 'range', min: 20, max: 180, step: 2, value: 96, unit: ' m' },
        { key: 'shapeRotation', label: '图形旋转', type: 'range', min: 0, max: 180, step: 5, value: 24, unit: '°' }
      ]
    },
    {
      title: '植被分布',
      params: [
        { key: 'tree', label: '树木', type: 'toggle', value: true },
        { key: 'grass', label: '草本', type: 'toggle', value: true },
        { key: 'flower', label: '花朵', type: 'toggle', value: true },
        { key: 'rock', label: '岩石', type: 'toggle', value: true },
        {
          key: 'treePreset',
          label: '树种',
          type: 'select',
          value: 'mixed',
          options: [
            { value: 'mixed', label: '混交林' },
            { value: 'oak', label: '阔叶乔木' },
            { value: 'pine', label: '针叶乔木' },
            { value: 'aspen', label: '落叶小乔木' },
            { value: 'bush', label: '灌丛' }
          ]
        },
        { key: 'seed', label: '随机种子', type: 'range', min: 1, max: 60, step: 1, value: 12 },
        { key: 'treeDensity', label: '树木密度', type: 'range', min: 0, max: 400, step: 5, value: 120, unit: ' 株/ha' },
        { key: 'grassDensity', label: '草本密度', type: 'range', min: 0, max: 9000, step: 100, value: 3200, unit: ' 丛/ha' },
        { key: 'flowerDensity', label: '花朵密度', type: 'range', min: 0, max: 3000, step: 50, value: 900, unit: ' 丛/ha' },
        { key: 'rockDensity', label: '岩石密度', type: 'range', min: 0, max: 200, step: 2, value: 40, unit: ' 块/ha' },
        { key: 'treeScale', label: '树木缩放', type: 'range', min: 0.2, max: 1.6, step: 0.02, value: 0.58 },
        { key: 'grassScale', label: '草本缩放', type: 'range', min: 0.3, max: 2, step: 0.05, value: 1 },
        { key: 'clampToTerrain', label: '树木贴合地形', type: 'toggle', value: true }
      ]
    },
    {
      title: '点位与操作',
      params: [
        { key: 'gridRows', label: '网格行数', type: 'range', min: 2, max: 60, step: 1, value: 18, unit: ' 行' },
        { key: 'gridCols', label: '网格列数', type: 'range', min: 2, max: 60, step: 1, value: 18, unit: ' 列' },
        { key: 'gridInterval', label: '点位间隔', type: 'range', min: 2, max: 40, step: 1, value: 8, unit: ' m' }
      ],
      actions: [
        { key: 'regenerate', label: '重新生成植被', style: 'primary' },
        { key: 'focus', label: '飞到图形', style: 'accent' },
        { key: 'clear', label: '清除全部', style: 'danger' }
      ]
    },
    {
      title: '风场与视距',
      params: [
        { key: 'windStrength', label: '风力强度', type: 'range', min: 0, max: 3, step: 0.05, value: 1.1 },
        { key: 'windFrequency', label: '风力频率', type: 'range', min: 0, max: 3, step: 0.05, value: 0.8 },
        { key: 'maximumLeafDistance', label: '树木裁剪半径', type: 'range', min: 60, max: 400, step: 10, value: 320, unit: ' m' },
        { key: 'maximumGrassDistance', label: '草本花朵裁剪半径', type: 'range', min: 30, max: 260, step: 10, value: 150, unit: ' m' },
        { key: 'maximumRockDistance', label: '岩石裁剪半径', type: 'range', min: 40, max: 320, step: 10, value: 200, unit: ' m' }
      ]
    }
  ],
  create: createS26
}
