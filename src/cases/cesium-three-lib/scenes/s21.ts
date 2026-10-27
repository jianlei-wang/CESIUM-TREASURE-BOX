import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { num } from '../types'
import { addBox, addCylinder, addStageGround, disposeObject, surface } from '../helpers'
import { createS21Model, rampHeight, S21_RAMP } from '../simulations/s21.model'

function createS21(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 230, { disc: '#20242a', accent: kit.accent })

  const road = addBox(root, [130, 0.08, 9], [-8, 0.01, 0], surface('#2b2f36', { roughness: 0.95 }))
  road.name = 'road'
  for (let index = 0; index < 18; index += 1) {
    addBox(root, [2.4, 0.02, 0.16], [-66 + index * 7.2, 0.07, 0], surface('#f2d15c', { emissive: '#8a6d12', emissiveIntensity: 0.5 }))
  }
  for (const z of [-4.2, 4.2]) {
    addBox(root, [130, 0.02, 0.22], [-8, 0.07, z], surface('#d8e3ec', { emissive: '#3d6b86', emissiveIntensity: 0.25 }))
  }

  const rampRun = S21_RAMP.endX - S21_RAMP.startX
  const rampAngle = Math.atan(S21_RAMP.height / rampRun)
  const rampLength = Math.hypot(rampRun, S21_RAMP.height)
  const rampCenterX = (S21_RAMP.startX + S21_RAMP.endX) / 2
  const ramp = addBox(root, [rampLength, 0.14, 9], [rampCenterX, S21_RAMP.height / 2 - 0.07, 0], surface('#39424d', { roughness: 0.9 }), [0, 0, rampAngle])
  ramp.name = 'ramp'
  for (const z of [-4.35, 4.35]) {
    addBox(root, [rampLength, 0.5, 0.18], [rampCenterX, S21_RAMP.height / 2 + 0.18, z], surface('#4f5c69'), [0, 0, rampAngle])
  }

  const wallGroup = new THREE.Group()
  root.add(wallGroup)
  const blockGeometry = new THREE.BoxGeometry(0.72, 0.72, 0.72)
  const blockMaterials = [surface('#c07a52', { roughness: 0.88 }), surface('#a9663f', { roughness: 0.9 })]
  const blockMeshes = new Map<number, THREE.Mesh>()

  const rebuildWallMeshes = (): void => {
    for (const mesh of blockMeshes.values()) mesh.removeFromParent()
    blockMeshes.clear()
    for (const block of model.state.wall) {
      const mesh = new THREE.Mesh(blockGeometry, blockMaterials[block.id % blockMaterials.length])
      mesh.position.set(block.position[0], block.position[1], block.position[2])
      wallGroup.add(mesh)
      blockMeshes.set(block.id, mesh)
    }
  }

  const car = new THREE.Group()
  root.add(car)
  const bodyGroup = new THREE.Group()
  car.add(bodyGroup)
  addBox(bodyGroup, [4.6, 0.7, 2.05], [0, 0.78, 0], surface('#d94f3d', { metalness: 0.45, roughness: 0.4 }))
  addBox(bodyGroup, [2.1, 0.55, 1.75], [-0.25, 1.34, 0], surface('#f0f3f6', { metalness: 0.2, roughness: 0.35 }))
  addBox(bodyGroup, [1.15, 0.32, 1.6], [-0.25, 1.63, 0], surface('#7fd0e6', { emissive: '#2b6c82', emissiveIntensity: 0.45, transparent: true, opacity: 0.9 }))
  addBox(bodyGroup, [0.24, 0.24, 1.9], [2.2, 0.86, 0], surface('#f4d35e', { emissive: '#c9a221', emissiveIntensity: 0.6 }))
  addBox(bodyGroup, [0.26, 0.32, 0.5], [-2.3, 0.9, 0.6], surface('#11161b'))
  addBox(bodyGroup, [0.26, 0.32, 0.5], [-2.3, 0.9, -0.6], surface('#11161b'))
  const wheels: { steer: THREE.Group; spinner: THREE.Group; front: boolean }[] = []
  const wheelMaterial = surface('#15191d', { roughness: 0.9 })
  const hubMaterial = surface('#b9c4cc', { metalness: 0.75, roughness: 0.3 })
  for (const x of [1.5, -1.5]) {
    for (const z of [1.02, -1.02]) {
      const steer = new THREE.Group()
      steer.position.set(x, 0.46, z)
      car.add(steer)
      const spinner = new THREE.Group()
      spinner.rotation.z = Math.PI / 2
      steer.add(spinner)
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.34, 18), wheelMaterial)
      spinner.add(tyre)
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 12), hubMaterial)
      spinner.add(hub)
      wheels.push({ steer, spinner, front: x > 0 })
    }
  }
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(2.6, 28), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.32 }))
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.04
  root.add(shadow)

  let lastWallCount = 0
  const model = createS21Model({
    driveForce: 6200,
    steering: 0,
    friction: 0.035,
    mass: 1400,
    suspension: 34,
    damping: 4800,
    wallRows: 6
  })

  const fixedUpdate = (dt: number, p: ParamValues): void => {
    model.configure({
      driveForce: num(p, 'driveForce', 6200),
      steering: num(p, 'steering', 0),
      friction: num(p, 'friction', 0.035),
      mass: num(p, 'mass', 1400),
      suspension: num(p, 'suspension', 34),
      damping: num(p, 'damping', 4800),
      wallRows: Math.round(num(p, 'wallRows', 6))
    })
    model.fixedStep(dt)
  }

  let lastCollisionCount = 0
  let lastImpactAt = -1

  const renderSync = (): void => {
    const state = model.state
    if (state.collisionCount > lastCollisionCount) {
      lastCollisionCount = state.collisionCount
      lastImpactAt = state.time
    }
    if (lastImpactAt >= 0 && state.time - lastImpactAt > 4) {
      model.restart()
      lastImpactAt = -1
      lastCollisionCount = 0
    }
    if (state.wall.length !== lastWallCount) {
      rebuildWallMeshes()
      lastWallCount = state.wall.length
    }
    for (const block of state.wall) {
      const mesh = blockMeshes.get(block.id)
      if (!mesh) continue
      mesh.position.set(block.position[0], block.position[1], block.position[2])
      mesh.rotation.set(block.rotation[0], block.rotation[1], block.rotation[2])
      mesh.visible = block.position[1] > -4
    }
    car.position.set(state.position[0], state.position[1], state.position[2])
    car.rotation.y = state.heading
    const average = state.suspension.reduce((sum, value) => sum + value, 0) / 4
    bodyGroup.position.y = state.bodyHeave - average * 0.7
    bodyGroup.rotation.z = state.bodyPitch
    bodyGroup.rotation.x = state.bodyRoll
    for (const wheel of wheels) {
      wheel.steer.rotation.y = wheel.front ? state.steeringAngle : 0
      wheel.spinner.children[0].rotation.y = state.wheelSpin
      wheel.spinner.children[1].rotation.y = state.wheelSpin
    }
    const groundY = rampHeight(state.position[0])
    shadow.position.set(state.position[0], groundY + 0.07, state.position[2])
    const altitude = Math.max(0, state.position[1] - groundY)
    shadow.scale.setScalar(1 + altitude * 0.22)
    shadow.material.opacity = 0.34 / (1 + altitude * 0.4)
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
        车速: `${state.speed.toFixed(1)} m/s`,
        里程: `${state.distance.toFixed(0)} m`,
        车身俯仰: `${((state.bodyPitch * 180) / Math.PI).toFixed(1)}°`,
        悬架压缩: `${(Math.max(...state.suspension) * 100).toFixed(1)} cm`,
        腾空高度: `${state.altitude.toFixed(2)} m`,
        碰撞次数: state.collisionCount,
        飞散构件: state.wall.filter((block) => block.active && !block.settled).length
      }
    },
    dispose: () => disposeObject(root)
  }
}

export const S21: ScenarioMeta = {
  id: 's21',
  title: '轮式车辆悬架与撞击墙体',
  subtitle: '驾驶动力学、四轮悬架与可撞碎砖墙',
  description:
    '车辆在坡道与直道上加速行驶，四轮悬架按质量、刚度与阻尼产生压缩、俯仰和侧倾；驶入砖墙时按车速与质量转化冲量，墙体构件被撞散、抛落并逐渐静止。',
  tag: 'Cesium + Three.js · 车辆动力学',
  updatedAt: '2026-10-26',
  accent: '#ff8a5b',
  anchor: { lon: 116.391, lat: 39.907, height: 44 },
  camera: { range: 88, pitch: -28, heading: 38, targetY: 8 },
  metrics: [
    { key: '车速', label: '车速' },
    { key: '里程', label: '里程' },
    { key: '车身俯仰', label: '车身俯仰' },
    { key: '悬架压缩', label: '悬架压缩' },
    { key: '腾空高度', label: '腾空高度' }
  ],
  legend: [
    { color: '#d94f3d', label: '车辆与悬架' },
    { color: '#c07a52', label: '可撞碎砖墙' },
    { color: '#39424d', label: '坡道与路面' }
  ],
  hint: '提高驱动与降低悬架刚度可观察俯仰变化 · 增大质量或车速撞击时墙体抛散更远 · 转向角影响行进轨迹',
  info: [
    '车辆以单轨模型近似横摆与航向，驱动力、滚阻与空气阻力合成纵向加速度，悬架按弹簧-阻尼系统响应加减速与坡度。',
    '墙体为预置砖块集合，碰撞时按车速与车重计算冲量，并把能量按横向距离衰减分配给附近砖块。',
    '工程车辆动力学还需要轮胎侧偏力、路面附着椭圆、差速器与传动系统，本案例保留可交互的核心量。'
  ],
  sections: [
    {
      title: '驾驶工况',
      params: [
        { key: 'driveForce', label: '驱动合力', type: 'range', min: 2000, max: 12000, step: 100, value: 6200, unit: ' N' },
        { key: 'steering', label: '前轮转角', type: 'range', min: -20, max: 20, step: 1, value: 0, unit: '°' },
        { key: 'friction', label: '滚动阻力系数', type: 'range', min: 0.01, max: 0.09, step: 0.005, value: 0.035 },
        { key: 'mass', label: '整车质量', type: 'range', min: 800, max: 2400, step: 50, value: 1400, unit: ' kg' }
      ]
    },
    {
      title: '悬架参数',
      params: [
        { key: 'suspension', label: '悬架刚度', type: 'range', min: 12, max: 60, step: 1, value: 34, unit: ' kN/m' },
        { key: 'damping', label: '悬架阻尼', type: 'range', min: 1200, max: 9000, step: 100, value: 4800, unit: ' N·s/m' }
      ]
    },
    {
      title: '墙体与操作',
      params: [{ key: 'wallRows', label: '墙体层数', type: 'range', min: 1, max: 10, step: 1, value: 6, unit: ' 层' }],
      actions: [{ key: 'restart', label: '重新出发', style: 'primary' }]
    }
  ],
  create: createS21
}
