import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num } from '../types'
import { addBox, addCylinder, addSphere, addStageGround, disposeObject, surface } from '../helpers'

function createS18(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 250, { disc: '#1c1b1a', accent: kit.accent })
  const tunnel = new THREE.Group()
  const tbm = new THREE.Group()
  const rings = new THREE.Group()
  root.add(tunnel)
  root.add(rings)
  root.add(tbm)
  const scroll = addCylinder(tbm, 3, 3, 14, [0, 3, 0], surface('#c47a35', { roughness: 0.55, metalness: 0.4 }), 28)
  scroll.rotation.x = Math.PI / 2
  const cutter = new THREE.Group()
  cutter.position.set(0, 3, 8)
  tbm.add(cutter)
  const cutterDisc = addCylinder(cutter, 3.4, 3.4, 0.7, [0, 0, 0], surface('#6c7b86', { metalness: 0.7, roughness: 0.35 }), 32)
  cutterDisc.rotation.x = Math.PI / 2
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2
    addBox(cutter, [0.7, 0.7, 1.8], [Math.cos(angle) * 2.1, Math.sin(angle) * 2.1, 0.7], surface('#a8b7c2', { metalness: 0.8, roughness: 0.3 }))
  }
  addSphere(cutter, 0.7, [0, 0, 1.2], surface('#ffd27a', { emissive: '#e2a13a', emissiveIntensity: 1.4 }), 16)
  const shellMaterial = surface('#8c9aa5', { transparent: true, opacity: 0.38, side: THREE.DoubleSide, roughness: 0.9 })
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 240, 40, 1, true, 0, Math.PI), shellMaterial)
  shell.rotation.x = Math.PI / 2
  shell.position.set(0, 3, 120)
  tunnel.add(shell)
  const ringGeometry = new THREE.TorusGeometry(6.4, 0.34, 8, 32)
  const ringMaterial = surface('#d8a45c', { metalness: 0.45, roughness: 0.45 })
  const ringMesh = new THREE.InstancedMesh(ringGeometry, ringMaterial, 40)
  ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  rings.add(ringMesh)
  const matrix = new THREE.Matrix4()
  const scale = new THREE.Matrix4()
  let tbmZ = 36
  let ringCount = 4
  let rpmState = 0
  let pressure = 0
  let thrustState = 0
  let diameterState = 6
  let spacingState = 6
  let simTime = 0
  let lastSignature = ''

  const rebuild = (diameter: number, spacing: number, showRings: boolean): void => {
    const radius = diameter / 2
    scale.makeScale(radius / 3.1, radius / 3.1, 1)
    tunnel.scale.set(radius / 6.2, radius / 6.2, 1)
    tbm.scale.set(radius / 3.1, radius / 3.1, 1)
    ringMesh.visible = showRings
    spacingState = spacing
    diameterState = diameter
    for (let i = 0; i < 40; i += 1) {
      const z = i * spacing + spacing
      matrix.makeRotationFromEuler(new THREE.Euler(0, 0, 0))
      matrix.setPosition(0, 3, z)
      matrix.multiply(scale)
      ringMesh.setMatrixAt(i, i < ringCount ? matrix : new THREE.Matrix4().makeScale(0, 0, 0))
    }
    ringMesh.instanceMatrix.needsUpdate = true
  }

  const update = (dt: number, p: ParamValues): void => {
    const advance = num(p, 'advance', 0.45)
    const rpm = num(p, 'rpm', 3.2)
    const supportDensity = num(p, 'support', 60)
    const water = flag(p, 'water', true)
    const showRings = flag(p, 'rings', true)
    rpmState = rpm
    thrustState = num(p, 'thrust', 6000)
    simTime += dt
    tbmZ = Math.min(230, tbmZ + advance * dt)
    tbm.position.set(0, 0, tbmZ)
    cutter.rotation.z += rpm * dt * 0.9
    for (let i = 0; i < 40; i += 1) {
      if (i * spacingState + spacingState < tbmZ - 6 && i >= ringCount && ringCount < 40) {
        ringCount = i + 1
      }
    }
    const visibleRings = ringCount
    for (let i = 0; i < 40; i += 1) {
      if (i < visibleRings) {
        const z = i * spacingState + spacingState
        matrix.makeRotationFromEuler(new THREE.Euler(0, 0, 0))
        matrix.setPosition(0, 3, z)
        matrix.multiply(new THREE.Matrix4().makeScale(diameterState / 6.2, diameterState / 6.2, 1))
        ringMesh.setMatrixAt(i, matrix)
      } else {
        ringMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0))
      }
    }
    ringMesh.instanceMatrix.needsUpdate = true
    pressure = water ? (0.08 + (tbmZ / 230) * 0.34) * (1 - supportDensity / 220) : 0.02
    ringMaterial.color.setHSL(0.09, 0.45, 0.32 + (supportDensity / 100) * 0.38)
    ringMesh.visible = showRings
  }

  const sync = (p: ParamValues): void => {
    const diameter = Math.round(num(p, 'diameter', 6) * 2) / 2
    const spacing = Math.round(num(p, 'spacing', 6))
    const showRings = flag(p, 'rings', true)
    const signature = `${diameter}-${spacing}`
    if (signature !== lastSignature) {
      lastSignature = signature
      rebuild(diameter, spacing, showRings)
    } else {
      ringMesh.visible = showRings
    }
  }

  rebuild(6, 6, true)
  tbm.position.set(0, 0, tbmZ)
  lastSignature = '6-6'

  return {
    object: root,
    update,
    sync,
    action: (key) => {
      if (key === 'reset') {
        tbmZ = 0
        ringCount = 0
        tbm.position.set(0, 0, 0)
      }
    },
    readouts: () => ({
      掘进里程: `${tbmZ.toFixed(1)} m`,
      管片环数: `${ringCount} 环`,
      刀盘转速: `${rpmState.toFixed(1)} rpm`,
      掌子面水压: `${pressure.toFixed(2)} MPa`,
      总推力: `${thrustState.toFixed(0)} kN`,
      仿真时间: `${simTime.toFixed(1)} s`
    }),
    dispose: () => disposeObject(root)
  }
}

export const S18: ScenarioMeta = {
  id: 's18',
  title: '盾构隧道掘进与管片支护',
  subtitle: '刀盘切削、推进速度与水压风险',
  description:
    '盾构机沿隧道轴线推进，刀盘按设定转速旋转，已开挖区段逐步安装管片环；随埋深增加掌子面水压上升，可调直径、推进速度、管片间距与总推力观察支护节奏。',
  tag: 'Cesium + Three.js · 隧道工程',
  updatedAt: '2026-10-23',
  accent: '#d8a45c',
  anchor: { lon: 121.5, lat: 31.2, height: 18 },
  camera: { range: 210, pitch: -20, heading: 18, targetY: 22 },
  metrics: [
    { key: '掘进里程', label: '掘进里程' },
    { key: '管片环数', label: '管片环数' },
    { key: '掌子面水压', label: '掌子面水压' },
    { key: '总推力', label: '总推力' }
  ],
  legend: [
    { color: '#c47a35', label: '盾构机' },
    { color: '#d8a45c', label: '管片环' },
    { color: '#8c9aa5', label: '隧道衬砌' }
  ],
  hint: '推进速度过快时管片安装会滞后 · 直径增大后相同推力下单位面积压力下降 · 水压随掘进里程线性上升',
  info: [
    '盾构机按推进速度沿 z 轴前进，管片环按间距在刀盘后方依次激活，水压按里程比例线性增长。',
    '刀盘旋转只做视觉表现，切削功率和扭矩未参与力学计算，管片环为简化圆环几何。',
    '真实盾构施工需要土压平衡、同步注浆、姿态控制、刀盘扭矩和地表沉降监测。'
  ],
  sections: [
    {
      title: '掘进参数',
      params: [
        { key: 'advance', label: '推进速度', type: 'range', min: 0.1, max: 1.5, step: 0.05, value: 0.45, unit: ' m/min' },
        { key: 'rpm', label: '刀盘转速', type: 'range', min: 0.5, max: 8, step: 0.1, value: 3.2, unit: ' rpm' },
        { key: 'thrust', label: '总推力', type: 'range', min: 2000, max: 20000, step: 500, value: 6000, unit: ' kN' },
        { key: 'diameter', label: '开挖直径', type: 'range', min: 4, max: 9, step: 0.5, value: 6, unit: ' m' }
      ]
    },
    {
      title: '支护与风险',
      params: [
        { key: 'spacing', label: '管片间距', type: 'range', min: 3, max: 12, step: 1, value: 6, unit: ' m' },
        { key: 'support', label: '支护强度', type: 'range', min: 0, max: 100, step: 5, value: 60, unit: '%' },
        { key: 'water', label: '地下水压', type: 'toggle', value: true },
        { key: 'rings', label: '显示管片', type: 'toggle', value: true }
      ],
      actions: [{ key: 'reset', label: '重新掘进', style: 'primary' }]
    }
  ],
  create: createS18
}
