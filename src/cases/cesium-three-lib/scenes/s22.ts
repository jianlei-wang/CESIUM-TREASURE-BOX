import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { num } from '../types'
import { addBox, addCylinder, addStageGround, disposeObject, surface } from '../helpers'
import { createS22Model } from '../simulations/s22.model'

function createS22(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 190, { disc: '#1c2724', accent: kit.accent })
  addCylinder(root, 0.9, 1.2, 0.5, [0, 0.25, 0], surface('#3d4b48', { metalness: 0.4 }), 20)
  const pylon = addCylinder(root, 0.26, 0.34, 6.6, [0, 3.3, 0], surface('#c9b458', { metalness: 0.55, roughness: 0.4 }), 18)
  pylon.name = 'flag-pylon'
  const arm = new THREE.Group()
  arm.position.y = 6.6
  root.add(arm)

  const clothGroup = new THREE.Group()
  root.add(clothGroup)
  const clothMaterial = new THREE.MeshStandardMaterial({
    color: '#e26a48',
    roughness: 0.68,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95
  })
  let clothMesh: THREE.Mesh | null = null
  let clothSignature = ''

  const buildCloth = (segX: number, segY: number): void => {
    if (clothMesh) {
      clothMesh.geometry.dispose()
      clothMesh.removeFromParent()
    }
    const geometry = new THREE.PlaneGeometry(1, 1, segX, segY)
    clothMesh = new THREE.Mesh(geometry, clothMaterial)
    clothMesh.frustumCulled = false
    clothGroup.add(clothMesh)
    clothSignature = `${segX}|${segY}`
  }

  const wallGroup = new THREE.Group()
  root.add(wallGroup)
  const brickGeometry = new THREE.BoxGeometry(0.62, 0.62, 0.62)
  const brickMaterials = [surface('#b58552', { roughness: 0.88 }), surface('#9c6f45', { roughness: 0.9 })]
  const brickMeshes = new Map<number, THREE.Mesh>()
  let lastWallCount = 0

  let armMesh: THREE.Mesh | null = null
  let armLength = 12

  const syncArm = (): void => {
    if (armMesh && Math.abs((armMesh.geometry as THREE.BoxGeometry).parameters.width - armLength) < 0.01) return
    if (armMesh) {
      armMesh.geometry.dispose()
      armMesh.removeFromParent()
    }
    const geometry = new THREE.BoxGeometry(armLength, 0.34, 0.34)
    armMesh = new THREE.Mesh(geometry, surface('#c9b458', { metalness: 0.55, roughness: 0.4 }))
    armMesh.position.set(armLength / 2, 0, 0)
    arm.add(armMesh)
  }

  const model = createS22Model({
    rpm: 24,
    armLength: 12,
    clothWidth: 3.8,
    clothHeight: 3.2,
    stiffness: 0.62,
    segments: 16,
    gravity: 9.81,
    damping: 0.35,
    wallRows: 12
  })

  const fixedUpdate = (dt: number, p: ParamValues): void => {
    armLength = num(p, 'armLength', 12)
    model.configure({
      rpm: num(p, 'rpm', 24),
      armLength: num(p, 'armLength', 12),
      clothWidth: num(p, 'clothWidth', 3.8),
      clothHeight: num(p, 'clothHeight', 3.2),
      stiffness: num(p, 'stiffness', 0.62),
      segments: Math.round(num(p, 'segments', 16)),
      gravity: num(p, 'gravity', 9.81),
      damping: num(p, 'damping', 0.35),
      wallRows: Math.round(num(p, 'wallRows', 12))
    })
    model.fixedStep(dt)
  }

  const renderSync = (): void => {
    const state = model.state
    syncArm()
    arm.rotation.y = state.armAngle
    const key = `${state.segX}|${state.segY}`
    if (key !== clothSignature && state.segX > 0) buildCloth(state.segX, state.segY)
    if (clothMesh && state.cloth.length > 0) {
      const attribute = clothMesh.geometry.getAttribute('position') as THREE.BufferAttribute
      attribute.array.set(state.cloth)
      attribute.needsUpdate = true
      clothMesh.geometry.computeVertexNormals()
    }
    if (state.wall.length !== lastWallCount) {
      for (const mesh of brickMeshes.values()) mesh.removeFromParent()
      brickMeshes.clear()
      for (const brick of state.wall) {
        const mesh = new THREE.Mesh(brickGeometry, brickMaterials[brick.id % brickMaterials.length])
        wallGroup.add(mesh)
        brickMeshes.set(brick.id, mesh)
      }
      lastWallCount = state.wall.length
    }
    for (const brick of state.wall) {
      const mesh = brickMeshes.get(brick.id)
      if (!mesh) continue
      mesh.position.set(brick.position[0], brick.position[1], brick.position[2])
      mesh.rotation.set(brick.rotation[0], brick.rotation[1], brick.rotation[2])
    }
  }

  const update = (dt: number, p: ParamValues): void => {
    fixedUpdate(dt, p)
    renderSync()
  }

  syncArm()

  return {
    object: root,
    update,
    fixedUpdate,
    renderSync,
    setMode: (mode) => model.setMode(mode),
    sync: (p) => {
      armLength = num(p, 'armLength', 12)
      syncArm()
    },
    action: (key) => {
      if (key === 'restart') {
        model.restart()
        lastWallCount = 0
      }
    },
    diagnostics: () => model.diagnostics(),
    calibration: () => model.calibration(),
    readouts: () => {
      const state = model.state
      return {
        转速: `${((state.angularSpeed * 60) / (Math.PI * 2)).toFixed(0)} rpm`,
        布料外张: `${state.flare.toFixed(2)} m`,
        布料摆幅: `${state.flutter.toFixed(2)} m`,
        撞落砖块: state.knocked,
        仿真时间: `${state.time.toFixed(1)} s`
      }
    },
    dispose: () => {
      if (clothMesh) clothMesh.geometry.dispose()
      clothMaterial.dispose()
      brickGeometry.dispose()
      disposeObject(root)
    }
  }
}

export const S22: ScenarioMeta = {
  id: 's22',
  title: '旋转横臂驱动旗帜布料',
  subtitle: '绕竖轴旋转的横臂与受约束布料扫掠',
  description:
    '竖直立柱上的横臂绕轴旋转，布料上缘固定在横臂外段，受重力、离心与空气阻力作用向外张开并产生行波；横扫经过砖墙时按布料接触速度撞落构件。',
  tag: 'Cesium + Three.js · 旋转布料',
  updatedAt: '2026-10-26',
  accent: '#e26a48',
  anchor: { lon: 116.391, lat: 39.907, height: 44 },
  camera: { range: 75, pitch: -26, heading: 52, targetY: 8 },
  metrics: [
    { key: '转速', label: '转速' },
    { key: '布料外张', label: '布料外张' },
    { key: '布料摆幅', label: '布料摆幅' },
    { key: '撞落砖块', label: '撞落砖块' }
  ],
  legend: [
    { color: '#e26a48', label: '布料网格' },
    { color: '#c9b458', label: '立柱与横臂' },
    { color: '#b58552', label: '砖墙' }
  ],
  hint: '提高转速可增强布料外张与扫掠力度 · 降低刚度会让布料更柔软 · 横臂长度改变扫掠半径',
  info: [
    '布料为规则网格质点，上缘固定在旋转横臂上，内部通过结构、剪切与弯曲距离约束维持形态，采用位置约束迭代求解。',
    '旋转参考系中的离心项与相对空气速度阻力共同驱动外张，接触砖墙时按质点速度与质量分配冲量。',
    '工程布料通常使用 PBD/XPBD 并加入自碰撞与摩擦，旋转机械还需考虑驱动扭矩、轴承与结构振动。'
  ],
  sections: [
    {
      title: '旋转机构',
      params: [
        { key: 'rpm', label: '横臂转速', type: 'range', min: 0, max: 80, step: 1, value: 24, unit: ' rpm' },
        { key: 'armLength', label: '横臂长度', type: 'range', min: 6, max: 15, step: 0.5, value: 12, unit: ' m' }
      ]
    },
    {
      title: '布料参数',
      params: [
        { key: 'clothWidth', label: '布料宽度', type: 'range', min: 2, max: 6, step: 0.1, value: 3.8, unit: ' m' },
        { key: 'clothHeight', label: '布料高度', type: 'range', min: 2, max: 5, step: 0.1, value: 3.2, unit: ' m' },
        { key: 'stiffness', label: '约束刚度', type: 'range', min: 0.1, max: 1, step: 0.02, value: 0.62 },
        { key: 'segments', label: '横向分段', type: 'range', min: 8, max: 24, step: 1, value: 16, unit: ' 段' }
      ]
    },
    {
      title: '环境与墙体',
      params: [
        { key: 'gravity', label: '重力加速度', type: 'range', min: 3, max: 20, step: 0.1, value: 9.81, unit: ' m/s²' },
        { key: 'damping', label: '阻尼系数', type: 'range', min: 0.05, max: 1.2, step: 0.05, value: 0.35 },
        { key: 'wallRows', label: '墙体层数', type: 'range', min: 1, max: 14, step: 1, value: 12, unit: ' 层' }
      ],
      actions: [{ key: 'restart', label: '重新开始', style: 'primary' }]
    }
  ],
  create: createS22
}
