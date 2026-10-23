import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num } from '../types'
import { addBox, addGlowPoints, addStageGround, disposeObject, surface, toRad } from '../helpers'

function createS15(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 230, { disc: '#25221c', accent: kit.accent })
  const machine = new THREE.Group()
  root.add(machine)
  addBox(machine, [14, 2.2, 7], [0, 1.1, -3.5], surface('#2f3438', { roughness: 0.9 }))
  addBox(machine, [14, 2.2, 7], [0, 1.1, 3.5], surface('#2f3438', { roughness: 0.9 }))
  for (let i = -2; i <= 2; i += 1) {
    addBox(machine, [2.2, 2.6, 18], [i * 3.2, 1.3, 0], surface('#444b50'))
  }
  const house = addBox(machine, [12, 6, 9], [-1, 6, 0], surface('#d8a83d', { roughness: 0.55, metalness: 0.2 }))
  house.name = 'house'
  addBox(machine, [5.5, 5, 4], [4.5, 9.4, 2.5], surface('#24323b', { metalness: 0.4 }))
  addBox(machine, [4.5, 4.5, 0.2], [4.5, 9.4, 4.55], surface('#8fd6ff', { emissive: '#2f90ad', emissiveIntensity: 0.8 }))

  const boomPivot = new THREE.Group()
  boomPivot.position.set(4, 8, 0)
  machine.add(boomPivot)
  addBox(boomPivot, [23, 1.8, 1.6], [11, 0, 0], surface('#d8a83d', { metalness: 0.25, roughness: 0.5 }))
  const stickPivot = new THREE.Group()
  stickPivot.position.set(22, 0, 0)
  boomPivot.add(stickPivot)
  addBox(stickPivot, [18, 1.4, 1.3], [8.6, 0, 0], surface('#c99a32', { metalness: 0.25, roughness: 0.5 }))
  const bucketPivot = new THREE.Group()
  bucketPivot.position.set(17.4, 0, 0)
  stickPivot.add(bucketPivot)
  addBox(bucketPivot, [3.6, 3.2, 4.2], [1.6, -1.4, 0], surface('#6b747b', { roughness: 0.6, metalness: 0.45 }))
  addBox(bucketPivot, [3.4, 0.6, 4.2], [1.6, 0.1, 0], surface('#8b969e'))
  const spoil = new THREE.Mesh(new THREE.ConeGeometry(9, 9, 20), surface('#7b6445', { roughness: 0.98, flatShading: true }))
  spoil.position.set(43, 4.5, 8)
  root.add(spoil)
  const target = addBox(root, [16, 20, 20], [-72, 10, 0], surface('#4d585f', { roughness: 0.92 }))
  target.name = 'truck'
  const dust = addGlowPoints(root, 160, '#d8b98a', 1.4, 0.55)
  const dustState: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number }[] = []
  let simTime = 0
  let bucketLoad = 0
  let lastDump = 0
  let digAngle = 0
  let cycleState = 12
  let dustCursor = 0

  const update = (dt: number, p: ParamValues): void => {
    const boomAngle = num(p, 'boomAngle', 38)
    const stickAngle = num(p, 'stickAngle', -62)
    const bucketAngle = num(p, 'bucketAngle', 55)
    const swingSpeed = num(p, 'swingSpeed', 0.5)
    const density = num(p, 'soilDensity', 1.6)
    const cycleTime = num(p, 'cycleTime', 12)
    const showSpoil = flag(p, 'spoil', true)
    simTime += dt
    cycleState = cycleTime
    const cycle = (simTime % Math.max(2, cycleTime)) / Math.max(2, cycleTime)
    const swing = Math.sin(cycle * Math.PI * 2) * 1.05
    const work = Math.sin(cycle * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5
    digAngle = Math.sin(cycle * Math.PI * 2) * 18
    boomPivot.rotation.z = toRad(boomAngle + work * 16)
    stickPivot.rotation.z = toRad(stickAngle + digAngle * 0.8)
    bucketPivot.rotation.z = toRad(bucketAngle + digAngle)
    machine.rotation.y = swing * swingSpeed * 1.4
    bucketLoad = density * 2.6 * Math.min(1, Math.max(0, Math.sin(cycle * Math.PI)))
    spoil.visible = showSpoil
    dust.visible = showSpoil
    const drop = cycle > 0.55 && cycle < 0.82
    if (drop && simTime - lastDump > 0.12) {
      lastDump = simTime
      for (let i = 0; i < 8; i += 1) {
        if (dustState.length < 160) {
          dustState.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: -1 })
        }
        const slot = dustState[dustCursor % dustState.length]
        dustCursor += 1
        slot.x = -50 + (Math.random() - 0.5) * 12
        slot.y = 16 + Math.random() * 8
        slot.z = (Math.random() - 0.5) * 10
        slot.vx = (Math.random() - 0.5) * 2
        slot.vy = -Math.random() * 5
        slot.vz = (Math.random() - 0.5) * 2
        slot.life = 0
      }
    }
    const dustPosition = dust.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < 160; i += 1) {
      const item = dustState[i]
      if (!item || item.life < 0) {
        dustPosition.setXYZ(i, 0, -100, 0)
        continue
      }
      item.life += dt
      item.x += item.vx * dt
      item.y += item.vy * dt
      item.z += item.vz * dt
      item.vy -= 9.81 * dt
      if (item.life > 2 || item.y < 0.2) {
        item.life = -1
        dustPosition.setXYZ(i, 0, -100, 0)
        continue
      }
      dustPosition.setXYZ(i, item.x, item.y, item.z)
    }
    dustPosition.needsUpdate = true
  }

  return {
    object: root,
    update,
    action: (key) => {
      if (key === 'reset') {
        simTime = 0
        bucketLoad = 0
        for (const item of dustState) item.life = -1
      }
    },
    readouts: () => ({
      铲斗载荷: `${bucketLoad.toFixed(1)} t`,
      循环时间: `${cycleState.toFixed(1)} s`,
      小时产量: `${((3600 / Math.max(2, cycleState)) * bucketLoad).toFixed(0)} t/h`,
      回转角度: `${((machine.rotation.y * 180) / Math.PI).toFixed(0)}°`,
      仿真时间: `${simTime.toFixed(1)} s`
    }),
    dispose: () => disposeObject(root)
  }
}

export const S15: ScenarioMeta = {
  id: 's15',
  title: '挖掘机作业循环与物料装卸',
  subtitle: '多关节臂架、铲斗载荷与土方产量',
  description:
    '挖掘机按作业循环完成回转、下探、挖掘、提升和卸料，动臂、斗杆与铲斗按预设角度联动，铲斗载荷随土体密度变化，卸料时生成颗粒状土屑；面板实时给出产量与回转角度。',
  tag: 'Cesium + Three.js · 关节机械',
  updatedAt: '2026-10-23',
  accent: '#d8a83d',
  anchor: { lon: 108.9, lat: 34.3, height: 430 },
  camera: { range: 250, pitch: -24, heading: 46, targetY: 18 },
  metrics: [
    { key: '铲斗载荷', label: '铲斗载荷' },
    { key: '循环时间', label: '循环时间' },
    { key: '小时产量', label: '小时产量' },
    { key: '回转角度', label: '回转角度' }
  ],
  legend: [
    { color: '#d8a83d', label: '动臂与机身' },
    { color: '#6b747b', label: '铲斗' },
    { color: '#7b6445', label: '土方料堆' }
  ],
  hint: '调整动臂与斗杆角度改变作业姿态 · 土体密度越大铲斗载荷越高 · 缩短循环时间可提高理论产量',
  info: [
    '臂架由动臂、斗杆和铲斗三个旋转关节串联，按作业循环驱动角度变化，未进行逆运动学约束求解。',
    '铲斗载荷由土体密度与循环相位近似计算，小时产量按循环时间线性折算，用于对比参数影响。',
    '真实挖掘机需要液压执行器、负载敏感、土壤切削阻力和整机稳定性模型。'
  ],
  sections: [
    {
      title: '臂架姿态',
      params: [
        { key: 'boomAngle', label: '动臂仰角', type: 'range', min: 10, max: 80, step: 1, value: 38, unit: '°' },
        { key: 'stickAngle', label: '斗杆夹角', type: 'range', min: -120, max: -20, step: 1, value: -62, unit: '°' },
        { key: 'bucketAngle', label: '铲斗转角', type: 'range', min: 0, max: 160, step: 1, value: 55, unit: '°' }
      ]
    },
    {
      title: '作业参数',
      params: [
        { key: 'swingSpeed', label: '回转速度', type: 'range', min: 0.1, max: 1.5, step: 0.05, value: 0.5 },
        { key: 'soilDensity', label: '土体密度', type: 'range', min: 1, max: 2.5, step: 0.05, value: 1.6, unit: ' t/m³' },
        { key: 'cycleTime', label: '循环时间', type: 'range', min: 5, max: 20, step: 0.5, value: 12, unit: ' s' },
        { key: 'spoil', label: '卸料颗粒', type: 'toggle', value: true }
      ],
      actions: [{ key: 'reset', label: '回到起始相位', style: 'primary' }]
    }
  ],
  create: createS15
}
