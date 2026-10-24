import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num } from '../types'
import { addBox, addLine, addStageGround, disposeObject, surface, updateLine } from '../helpers'
import { createS08Model } from '../simulations/s08.model'

function createS08(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 260, { disc: '#1a2228', accent: kit.accent })
  const towerHeight = 64
  const tower = new THREE.Group()
  root.add(tower)
  const legMaterial = surface('#c8a247', { metalness: 0.65, roughness: 0.36 })
  for (const x of [-2.2, 2.2]) {
    for (const z of [-2.2, 2.2]) {
      addBox(tower, [0.55, towerHeight, 0.55], [x, towerHeight / 2, z], legMaterial)
    }
  }
  for (let y = 8; y < towerHeight; y += 8) {
    addBox(tower, [4.8, 0.3, 0.3], [0, y, -2.2], legMaterial)
    addBox(tower, [4.8, 0.3, 0.3], [0, y, 2.2], legMaterial)
    addBox(tower, [0.3, 0.3, 4.8], [-2.2, y, 0], legMaterial)
    addBox(tower, [0.3, 0.3, 4.8], [2.2, y, 0], legMaterial)
  }
  addBox(tower, [6.2, 1.2, 6.2], [0, towerHeight, 0], surface('#8f7b3a'))
  addBox(tower, [12, 13, 9], [0, 7, 0], surface('#4f5c66'))

  const slew = new THREE.Group()
  slew.position.y = towerHeight + 1.5
  root.add(slew)
  addBox(slew, [4.2, 1.4, 4.2], [0, 0, 0], surface('#c8a247', { metalness: 0.55 }))
  const jib = new THREE.Group()
  slew.add(jib)
  const jibLength = 82
  addBox(jib, [jibLength, 1.1, 1.1], [jibLength / 2, 0, 0], legMaterial)
  addBox(jib, [78, 0.25, 0.25], [jibLength / 2, 1.0, 0.65], surface('#e0bd62'))
  addBox(jib, [78, 0.25, 0.25], [jibLength / 2, 1.0, -0.65], surface('#e0bd62'))
  addBox(slew, [24, 0.9, 2.2], [-12, 0, 0], legMaterial)
  addBox(slew, [8, 4.2, 5.2], [-24, -1, 0], surface('#687881'))
  addBox(slew, [3.6, 2.4, 3.6], [2.5, -2.4, 0], surface('#38536a'))
  addBox(slew, [0.7, 12, 0.7], [0, 6.5, 0], legMaterial)
  addLine(slew, [new THREE.Vector3(-2.5, 0.8, 0), new THREE.Vector3(8, 18, 0), new THREE.Vector3(jibLength - 2, 0.8, 0)], '#d8c07a', 0.72)
  addLine(slew, [new THREE.Vector3(2.5, 0.8, 0), new THREE.Vector3(8, 18, 0)], '#d8c07a', 0.72)

  const trolley = new THREE.Group()
  jib.add(trolley)
  addBox(trolley, [2.4, 1.1, 3], [0, -0.9, 0], surface('#e0bd62', { metalness: 0.4 }))
  const cable = addLine(trolley, [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -24, 0)], '#e8eef2', 0.95)
  const hook = new THREE.Group()
  addBox(hook, [1.1, 0.7, 1.1], [0, 0, 0], surface('#aab7c0', { metalness: 0.7 }))
  addBox(hook, [3.4, 0.3, 3.4], [0, -0.9, 0], surface('#5f6f7a'))
  const load = addBox(hook, [4.8, 3.2, 4.8], [0, -2, 0], surface('#c85d3f', { roughness: 0.55 }))
  load.name = 'load'
  trolley.add(hook)
  const envelope = new THREE.Mesh(
    new THREE.RingGeometry(18, jibLength, 96),
    new THREE.MeshBasicMaterial({ color: '#ffd666', transparent: true, opacity: 0.08, side: THREE.DoubleSide })
  )
  envelope.rotation.x = -Math.PI / 2
  envelope.position.y = 0.08
  root.add(envelope)

  const cablePoints = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  const model = createS08Model({ loadMass: 6, cableLength: 30, slewSpeed: 0.28, hoistSpeed: 1.5, wind: 3, damping: 0.35 })

  const fixedUpdate = (dt: number, p: ParamValues): void => {
    model.configure({
      loadMass: num(p, 'loadMass', 6),
      cableLength: num(p, 'cableLength', 30),
      slewSpeed: num(p, 'slewSpeed', 0.28),
      hoistSpeed: num(p, 'hoistSpeed', 1.5),
      wind: num(p, 'wind', 3),
      damping: num(p, 'damping', 0.35)
    })
    model.fixedStep(dt)
  }

  const renderSync = (_alpha: number, p: ParamValues): void => {
    const showEnvelope = flag(p, 'envelope', true)
    const state = model.state
    slew.rotation.y = state.slewAngle
    jib.rotation.y = 0
    trolley.position.x = state.trolleyRadius
    cablePoints[0].set(0, 0, 0)
    cablePoints[1].set(state.swingX * 0.5, -state.cableLength * 0.5, state.swingZ * 0.5)
    cablePoints[2].set(state.swingX, -state.cableLength, state.swingZ)
    updateLine(cable, cablePoints)
    hook.position.set(state.swingX, -state.cableLength, state.swingZ)
    hook.rotation.z = -state.swingX * 0.12
    hook.rotation.x = state.swingZ * 0.12
    envelope.visible = showEnvelope
  }

  return {
    object: root,
    update: (dt, p) => {
      fixedUpdate(dt, p)
      renderSync(1, p)
    },
    fixedUpdate,
    renderSync,
    setMode: (mode) => model.setMode(mode),
    action: (key) => {
      if (key === 'steady') model.steady()
    },
    diagnostics: () => model.diagnostics(),
    calibration: () => model.calibration(),
    readouts: () => ({
      工作半径: `${model.state.trolleyRadius.toFixed(1)} m`,
      吊物摆角: `${model.state.swingPeak.toFixed(1)}°`,
      钢缆张力: `${model.state.tension.toFixed(1)} kN`,
      吊索长度: `${model.state.cableLength.toFixed(1)} m`,
      仿真时间: `${model.state.time.toFixed(1)} s`
    }),
    dispose: () => disposeObject(root)
  }
}

export const S08: ScenarioMeta = {
  id: 's08',
  title: '塔吊吊装、钢缆摆动与载荷控制',
  subtitle: '回转、变幅、起升与吊物摆动的耦合演示',
  description:
    '塔吊按设定速度回转，小车沿吊臂变幅，吊钩随索长起升下降；吊物受回转离心力、风载和自身重力形成摆动。可调吊物质量、索长、回转速度、起升速度与阻尼，并显示工作半径和张力估算。',
  tag: 'Cesium + Three.js · 关节与摆动',
  updatedAt: '2026-10-23',
  accent: '#ffd666',
  anchor: { lon: 121.5, lat: 31.2, height: 12 },
  camera: { range: 280, pitch: -24, heading: 42, targetY: 40 },
  metrics: [
    { key: '工作半径', label: '工作半径' },
    { key: '吊物摆角', label: '吊物摆角' },
    { key: '钢缆张力', label: '钢缆张力' },
    { key: '吊索长度', label: '吊索长度' }
  ],
  legend: [
    { color: '#c8a247', label: '塔身与吊臂' },
    { color: '#c85d3f', label: '吊载构件' },
    { color: '#ffd666', label: '额定工作半径' }
  ],
  hint: '回转速度越高吊物摆角越大 · 索长增加会降低摆动频率 · 阻尼和风载共同决定稳定时间',
  info: [
    '吊物摆动采用单摆阻尼振子近似，回转离心力与风载作为外部激励，索长改变时摆动刚度随之变化。',
    '钢缆以两段折线显示并随摆角更新，吊载质量参与张力估算，结果用于展示趋势而非起重机械认证。',
    '真实塔吊需要回转制动、变幅小车、起升机构、风速限制和力矩限制器联合建模。'
  ],
  sections: [
    {
      title: '起重作业',
      params: [
        { key: 'loadMass', label: '吊物质量', type: 'range', min: 1, max: 20, step: 0.5, value: 6, unit: ' t' },
        { key: 'cableLength', label: '目标索长', type: 'range', min: 8, max: 58, step: 1, value: 30, unit: ' m' },
        { key: 'slewSpeed', label: '回转速度', type: 'range', min: 0.05, max: 1.2, step: 0.01, value: 0.28, unit: ' rad/s' },
        { key: 'hoistSpeed', label: '起升速度', type: 'range', min: 0.5, max: 5, step: 0.1, value: 1.5, unit: ' m/s' }
      ]
    },
    {
      title: '环境与阻尼',
      params: [
        { key: 'wind', label: '场地风速', type: 'range', min: 0, max: 12, step: 0.2, value: 3, unit: ' m/s' },
        { key: 'damping', label: '摆动阻尼', type: 'range', min: 0.02, max: 1, step: 0.01, value: 0.35 },
        { key: 'envelope', label: '工作半径圈', type: 'toggle', value: true }
      ],
      actions: [{ key: 'steady', label: '强制平稳', style: 'primary' }]
    }
  ],
  create: createS08
}
