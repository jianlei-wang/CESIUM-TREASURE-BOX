import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num, text } from '../types'
import { addBox, addLine, addStageGround, damp, disposeObject, surface } from '../helpers'

function createS07(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 220, { disc: '#1b2429', accent: kit.accent })
  const character = new THREE.Group()
  const arms = new THREE.Group()
  const pathGroup = new THREE.Group()
  root.add(character)
  root.add(pathGroup)
  addBox(root, [24, 0.45, 18], [36, 0.22, 0], surface('#6f7d86'))
  addBox(root, [24, 0.45, 18], [36, 0.67, 0], surface('#7c8a93'))
  addBox(root, [24, 0.45, 18], [36, 1.12, 0], surface('#89979f'))
  addBox(root, [18, 3.2, 2.2], [-40, 1.6, -52], surface('#4d5a64'))
  addBox(root, [18, 3.2, 2.2], [-40, 1.6, 52], surface('#4d5a64'))
  addBox(root, [2.2, 3.2, 45], [-70, 1.6, 0], surface('#4d5a64'))

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 2.4, 8, 16), surface('#47b7d8', { roughness: 0.5, metalness: 0.15 }))
  body.position.y = 2.35
  character.add(body)
  addBox(character, [1.7, 1.55, 0.5], [0, 2.4, 0.8], surface('#2e5470'))
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.92, 18, 14), surface('#f0d6b5', { roughness: 0.65 }))
  head.position.y = 4.15
  character.add(head)
  addBox(character, [0.42, 2.4, 0.42], [-0.72, 1.2, 0], surface('#25445c'))
  addBox(character, [0.42, 2.4, 0.42], [0.72, 1.2, 0], surface('#25445c'))
  addBox(arms, [0.38, 0.38, 2.1], [-0.75, 2.6, 1.35], surface('#f0d6b5'))
  addBox(arms, [0.38, 0.38, 2.1], [0.75, 2.6, 1.35], surface('#f0d6b5'))
  arms.visible = false
  character.add(arms)

  const route: THREE.Vector3[] = [
    new THREE.Vector3(-55, 0, 45),
    new THREE.Vector3(-10, 0, 30),
    new THREE.Vector3(18, 0, 8),
    new THREE.Vector3(30, 0.45, 0),
    new THREE.Vector3(36, 1.35, 0),
    new THREE.Vector3(55, 1.35, -12),
    new THREE.Vector3(55, 0, -55),
    new THREE.Vector3(0, 0, -70),
    new THREE.Vector3(-65, 0, -30)
  ]
  const pathPoints: THREE.Vector3[] = []
  for (let i = 0; i < route.length - 1; i += 1) {
    const from = route[i]
    const to = route[i + 1]
    for (let step = 0; step < 12; step += 1) pathPoints.push(from.clone().lerp(to, step / 12).setY(from.y + (to.y - from.y) * (step / 12) + 0.08))
  }
  addLine(pathGroup, pathPoints, '#8fd6ff', 0.4)
  let segment = 0
  let segmentT = 0
  let jumpY = 0
  let jumpVelocity = 0
  let grounded = true
  let distance = 0
  let simTime = 0
  let cadence = 1.7
  let heading = 0
  let viewMode = 'third'
  let speedState = 3
  let jumpTimer = 2.4
  let cameraRange = 52
  let cameraPitch = -24

  const update = (dt: number, p: ParamValues): void => {
    const speed = num(p, 'moveSpeed', 3)
    const run = flag(p, 'run', false)
    const jumpForce = num(p, 'jumpForce', 4.5)
    const gravity = num(p, 'gravity', 12)
    const showPath = flag(p, 'path', true)
    viewMode = text(p, 'viewMode', 'third')
    simTime += dt
    const actualSpeed = speed * (run ? 1.85 : 1)
    speedState = actualSpeed
    const from = route[segment]
    const to = route[(segment + 1) % route.length]
    const segmentLength = from.distanceTo(to)
    segmentT += (actualSpeed * dt) / Math.max(1, segmentLength)
    distance += actualSpeed * dt
    if (segmentT >= 1) {
      segmentT = 0
      segment = (segment + 1) % route.length
    }
    const currentFrom = route[segment]
    const currentTo = route[(segment + 1) % route.length]
    const position = currentFrom.clone().lerp(currentTo, segmentT)
    jumpTimer -= dt
    if (grounded && jumpTimer <= 0) {
      jumpVelocity = jumpForce
      grounded = false
      jumpTimer = run ? 2.8 : 4.4
    }
    if (!grounded) {
      jumpVelocity -= gravity * dt
      jumpY += jumpVelocity * dt
      if (jumpY <= 0) {
        jumpY = 0
        jumpVelocity = 0
        grounded = true
      }
    }
    character.position.set(position.x, position.y + jumpY, position.z)
    const direction = currentTo.clone().sub(currentFrom)
    const desiredHeading = Math.atan2(direction.x, direction.z)
    let turn = desiredHeading - heading
    turn = ((turn + Math.PI * 3) % (Math.PI * 2)) - Math.PI
    heading += turn * Math.min(1, dt * 6)
    character.rotation.y = heading
    cameraRange = damp(cameraRange, viewMode === 'first' ? 16 : 52, 5, dt)
    cameraPitch = damp(cameraPitch, viewMode === 'first' ? -6 : -24, 5, dt)
    const stride = Math.sin(simTime * (run ? 11 : 6.5)) * (grounded ? 0.5 : 0.1)
    character.position.y += Math.abs(stride) * 0.06
    cadence = run ? 2.9 : 1.7
    arms.visible = viewMode === 'first'
    body.visible = viewMode !== 'first'
    head.visible = viewMode !== 'first'
    pathGroup.visible = showPath
    kit.focus(character.position, {
      range: cameraRange,
      pitch: cameraPitch,
      heading: (heading * 180) / Math.PI
    })
  }

  return {
    object: root,
    update,
    action: (key) => {
      if (key === 'jump' && grounded) {
        jumpVelocity = 5.2
        grounded = false
      }
      if (key === 'reset') {
        segment = 0
        segmentT = 0
        jumpY = 0
        jumpVelocity = 0
        grounded = true
        distance = 0
        jumpTimer = 2.4
      }
    },
    readouts: () => ({
      当前速度: `${speedState.toFixed(1)} m/s`,
      离地高度: `${jumpY.toFixed(2)} m`,
      地面接触: grounded ? '是' : '否',
      步频: `${cadence.toFixed(1)} Hz`,
      步行距离: `${distance.toFixed(0)} m`,
      视角模式: viewMode === 'first' ? '第一人称' : '第三人称'
    }),
    dispose: () => disposeObject(root)
  }
}

export const S07: ScenarioMeta = {
  id: 's07',
  title: '地理空间第一人称与第三人称漫游',
  subtitle: '角色运动、台阶跨越与相机视角切换',
  description:
    '角色沿园区路线行走，遇到台阶自动抬升，并可跳跃跨越障碍；支持第一/第三人称切换，第一人称隐藏身体只保留双臂，相机会跟随角色朝向移动。',
  tag: 'Cesium + Three.js · 角色控制',
  updatedAt: '2026-10-23',
  accent: '#47b7d8',
  anchor: { lon: 120.1551, lat: 30.2741, height: 16 },
  camera: { range: 90, pitch: -22, heading: 35, targetY: 22 },
  metrics: [
    { key: '当前速度', label: '当前速度' },
    { key: '离地高度', label: '离地高度' },
    { key: '地面接触', label: '地面接触' },
    { key: '步频', label: '步频' }
  ],
  legend: [
    { color: '#47b7d8', label: '角色胶囊体' },
    { color: '#89979f', label: '台阶平台' },
    { color: '#8fd6ff', label: '漫游路线' }
  ],
  hint: '切换第一人称观察视角变化 · 开启奔跑提高移动与步频 · 跳跃时相机跟着角色抬升',
  info: [
    '角色采用胶囊体近似，路线由折线路径点控制；台阶高度直接写入路径采样点，当前版本未接入射线地面检测。',
    '第一人称模式隐藏身体与头部，保留手臂作为视野参照；第三人称模式用较远相机观察角色与场景关系。',
    '生产级角色控制需要 CharacterController、地面法线、坡度限制、台阶阈值和动画状态机。'
  ],
  sections: [
    {
      title: '角色运动',
      params: [
        { key: 'moveSpeed', label: '行走速度', type: 'range', min: 1, max: 8, step: 0.2, value: 3, unit: ' m/s' },
        { key: 'run', label: '奔跑模式', type: 'toggle', value: false },
        { key: 'jumpForce', label: '跳跃初速度', type: 'range', min: 2, max: 9, step: 0.2, value: 4.8, unit: ' m/s' },
        { key: 'gravity', label: '角色重力', type: 'range', min: 9, max: 20, step: 0.2, value: 12, unit: ' m/s²' }
      ]
    },
    {
      title: '视角与显示',
      params: [
        { key: 'viewMode', label: '视角模式', type: 'select', value: 'third', options: [{ value: 'third', label: '第三人称' }, { value: 'first', label: '第一人称' }] },
        { key: 'path', label: '显示路线', type: 'toggle', value: true }
      ],
      actions: [
        { key: 'jump', label: '立即跳跃', style: 'primary' },
        { key: 'reset', label: '回到起点', style: 'accent' }
      ]
    }
  ],
  create: createS07
}
