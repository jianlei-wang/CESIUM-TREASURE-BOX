import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { num } from '../types'
import { addBox, addCylinder, addStageGround, addSphere, disposeObject, surface } from '../helpers'
import { createS23Model } from '../simulations/s23.model'

function createS23(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 180, { disc: '#221f2a', accent: kit.accent })
  addCylinder(root, 0.85, 1.15, 0.45, [0, 0.22, 0], surface('#4a4153', { metalness: 0.35 }), 18)
  addCylinder(root, 0.24, 0.3, 7.5, [0, 3.75, 0], surface('#7a6f8c', { metalness: 0.6, roughness: 0.4 }), 16)

  const arm = new THREE.Group()
  arm.position.y = 7.5
  root.add(arm)
  let armMesh: THREE.Mesh | null = null
  let armLength = 8

  const syncArm = (): void => {
    if (armMesh) {
      const parameters = (armMesh.geometry as THREE.BoxGeometry).parameters
      if (Math.abs(parameters.width - armLength) < 0.01) return
      armMesh.geometry.dispose()
      armMesh.removeFromParent()
    }
    armMesh = new THREE.Mesh(new THREE.BoxGeometry(armLength, 0.32, 0.32), surface('#7a6f8c', { metalness: 0.6, roughness: 0.4 }))
    armMesh.position.set(armLength / 2, 0, 0)
    arm.add(armMesh)
  }

  let ropeLine: THREE.Line | null = null
  let ropeCapacity = 0
  const ropeMaterial = new THREE.LineBasicMaterial({ color: '#cfd8e3', transparent: true, opacity: 0.9 })

  const ensureRope = (count: number): void => {
    if (ropeLine && ropeCapacity === count) return
    if (ropeLine) {
      ropeLine.geometry.dispose()
      ropeLine.removeFromParent()
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    ropeLine = new THREE.Line(geometry, ropeMaterial)
    ropeLine.frustumCulled = false
    ropeCapacity = count
    root.add(ropeLine)
  }

  const ball = addSphere(root, 0.62, [0, 0, 0], surface('#1b1d24', { metalness: 0.55, roughness: 0.35 }), 26)
  ball.name = 'swing-ball'
  const wallGroup = new THREE.Group()
  root.add(wallGroup)
  const brickGeometry = new THREE.BoxGeometry(0.62, 0.62, 0.62)
  const brickMaterials = [surface('#a86f4b', { roughness: 0.9 }), surface('#8f5a3c', { roughness: 0.92 })]
  const brickMeshes = new Map<number, THREE.Mesh>()
  let lastWallCount = 0

  let ballRadius = 0.62
  const model = createS23Model({
    rpm: 26,
    armLength: 8,
    ropeLength: 4.2,
    segments: 10,
    ballMass: 1.2,
    ballRadius: 0.62,
    gravity: 9.81,
    damping: 0.3,
    wallRows: 12
  })

  const fixedUpdate = (dt: number, p: ParamValues): void => {
    armLength = num(p, 'armLength', 8)
    ballRadius = num(p, 'ballRadius', 0.62)
    model.configure({
      rpm: num(p, 'rpm', 26),
      armLength,
      ropeLength: num(p, 'ropeLength', 4.2),
      segments: Math.round(num(p, 'segments', 10)),
      ballMass: num(p, 'ballMass', 1.2),
      ballRadius: num(p, 'ballRadius', 0.62),
      gravity: num(p, 'gravity', 9.81),
      damping: num(p, 'damping', 0.3),
      wallRows: Math.round(num(p, 'wallRows', 12))
    })
    model.fixedStep(dt)
  }

  const renderSync = (): void => {
    const state = model.state
    syncArm()
    arm.rotation.y = state.armAngle
    const count = state.rope.length / 3
    if (count > 0) {
      ensureRope(count)
      if (ropeLine) {
        const attribute = ropeLine.geometry.getAttribute('position') as THREE.BufferAttribute
        attribute.array.set(state.rope)
        attribute.needsUpdate = true
      }
    }
    ball.position.set(state.ballPosition[0], state.ballPosition[1], state.ballPosition[2])
    ball.scale.setScalar(Math.max(0.2, ballRadius) / 0.62)
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
      armLength = num(p, 'armLength', 8)
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
        摆角: `${((state.swing * 180) / Math.PI).toFixed(1)}°`,
        绳张力: `${state.tension.toFixed(0)} N`,
        撞落砖块: state.knocked,
        仿真时间: `${state.time.toFixed(1)} s`
      }
    },
    dispose: () => {
      if (ropeLine) ropeLine.geometry.dispose()
      ropeMaterial.dispose()
      brickGeometry.dispose()
      disposeObject(root)
    }
  }
}

export const S23: ScenarioMeta = {
  id: 's23',
  title: '旋转横臂悬吊球体摆荡',
  subtitle: '绳索软约束、球体摆动与墙体碰撞',
  description:
    '横臂绕竖轴旋转，软绳一端连接横臂末端、另一端悬挂刚性球体；球体在离心与重力作用下摆荡并逐步抬升，扫掠砖墙时按碰撞速度撞落构件。',
  tag: 'Cesium + Three.js · 绳索与摆动',
  updatedAt: '2026-10-26',
  accent: '#9d8cff',
  anchor: { lon: 116.391, lat: 39.907, height: 44 },
  camera: { range: 70, pitch: -26, heading: 46, targetY: 8 },
  metrics: [
    { key: '转速', label: '转速' },
    { key: '摆角', label: '摆角' },
    { key: '绳张力', label: '绳张力' },
    { key: '撞落砖块', label: '撞落砖块' }
  ],
  legend: [
    { color: '#cfd8e3', label: '软绳' },
    { color: '#1b1d24', label: '悬吊球体' },
    { color: '#a86f4b', label: '砖墙' }
  ],
  hint: '提高转速会让球体摆角与外张增大 · 绳长改变摆动周期 · 球体质量影响碰撞后的墙体响应',
  info: [
    '绳索建模为等距离约束的质点链，顶端随横臂旋转，末端与球体绑定；质量差异通过逆质量分配约束修正量。',
    '摆角由绳轴与竖直方向夹角给出，张力按重力分量与向心项估算；球体与砖墙接触时按速度分配冲量并衰减反弹。',
    '工程绳索还需考虑弯曲刚度、扭转、磨损与安全系数，旋转吊装场景需要校核离心载荷与共振。'
  ],
  sections: [
    {
      title: '旋转机构',
      params: [
        { key: 'rpm', label: '横臂转速', type: 'range', min: 0, max: 90, step: 1, value: 26, unit: ' rpm' },
        { key: 'armLength', label: '横臂长度', type: 'range', min: 4, max: 13, step: 0.5, value: 8, unit: ' m' }
      ]
    },
    {
      title: '绳索与球体',
      params: [
        { key: 'ropeLength', label: '绳长', type: 'range', min: 2, max: 8, step: 0.2, value: 4.2, unit: ' m' },
        { key: 'segments', label: '绳段数量', type: 'range', min: 5, max: 20, step: 1, value: 10, unit: ' 段' },
        { key: 'ballMass', label: '球体质量', type: 'range', min: 0.3, max: 4, step: 0.1, value: 1.2, unit: ' kg' },
        { key: 'ballRadius', label: '球体半径', type: 'range', min: 0.2, max: 1.2, step: 0.05, value: 0.62, unit: ' m' }
      ]
    },
    {
      title: '环境与墙体',
      params: [
        { key: 'gravity', label: '重力加速度', type: 'range', min: 3, max: 20, step: 0.1, value: 9.81, unit: ' m/s²' },
        { key: 'damping', label: '空气阻尼', type: 'range', min: 0.05, max: 1, step: 0.05, value: 0.3 },
        { key: 'wallRows', label: '墙体层数', type: 'range', min: 1, max: 14, step: 1, value: 12, unit: ' 层' }
      ],
      actions: [{ key: 'restart', label: '重新开始', style: 'primary' }]
    }
  ],
  create: createS23
}
