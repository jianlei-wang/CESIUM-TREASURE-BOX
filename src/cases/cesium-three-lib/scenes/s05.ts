import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num, text } from '../types'
import { addBox, addLine, addStageGround, addCylinder, disposeObject, seeded, surface, toRad } from '../helpers'

interface Vehicle {
  group: THREE.Group
  wheels: THREE.Mesh[]
  speed: number
  t: number
  lane: number
}

function makeCar(color: string): { group: THREE.Group; wheels: THREE.Mesh[] } {
  const group = new THREE.Group()
  const body = addBox(group, [5.4, 1.25, 2.5], [0, 1.1, 0], surface(color, { roughness: 0.28, metalness: 0.55 }))
  body.name = 'body'
  addBox(group, [2.6, 0.9, 2.1], [-0.35, 2.0, 0], surface('#1b2a35', { roughness: 0.12, metalness: 0.3 }))
  const wheels: THREE.Mesh[] = []
  for (const x of [-1.75, 1.75]) {
    for (const z of [-1.25, 1.25]) {
      const wheel = addCylinder(group, 0.62, 0.62, 0.5, [x, 0.62, z], surface('#101820', { roughness: 0.9 }), 16)
      wheel.rotation.x = Math.PI / 2
      wheels.push(wheel)
    }
  }
  addBox(group, [0.16, 0.35, 1.8], [2.72, 1.15, 0], surface('#c8f3ff', { emissive: '#67c8e8', emissiveIntensity: 1.4 }))
  return { group, wheels }
}

function createS05(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 280, { disc: '#172129', accent: kit.accent })
  const roadGroup = new THREE.Group()
  root.add(roadGroup)
  const curvePoints: THREE.Vector3[] = []
  for (let i = 0; i <= 24; i += 1) {
    const x = -180 + (360 * i) / 24
    curvePoints.push(new THREE.Vector3(x, 0, Math.sin(i * 0.42) * 52 + Math.cos(i * 0.21) * 18))
  }
  const curve = new THREE.CatmullRomCurve3(curvePoints, false, 'catmullrom', 0.3)
  const length = curve.getLength()
  const car = makeCar('#e8734a')
  root.add(car.group)
  const traffic: Vehicle[] = []
  const trailPoints: THREE.Vector3[] = []
  const trail = addLine(root, [new THREE.Vector3(0, 0.8, 0)], '#ffd27a', 0.65)
  let simTime = 0
  let distance = 0
  let speed = 0
  let targetT = 0
  let lastTraffic = -1
  let slopeState = 3

  const buildRoad = (): void => {
    for (const child of [...roadGroup.children]) disposeObject(child)
    roadGroup.clear()
    const samples = curve.getPoints(180)
    const positions: number[] = []
    const indices: number[] = []
    const width = 16
    for (let i = 0; i < samples.length; i += 1) {
      const point = samples[i]
      const next = samples[Math.min(samples.length - 1, i + 1)]
      const prev = samples[Math.max(0, i - 1)]
      const tangent = next.clone().sub(prev).normalize()
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x)
      const left = point.clone().addScaledVector(normal, width / 2)
      const right = point.clone().addScaledVector(normal, -width / 2)
      positions.push(left.x, 0.06, left.z, right.x, 0.06, right.z)
      if (i < samples.length - 1) {
        const base = i * 2
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const road = new THREE.Mesh(geometry, surface('#2d3740', { roughness: 0.88, side: THREE.DoubleSide }))
    roadGroup.add(road)
    for (const offset of [-1, 1]) {
      const linePoints: THREE.Vector3[] = []
      for (const point of samples) {
        const index = samples.indexOf(point)
        const next = samples[Math.min(samples.length - 1, index + 1)]
        const prev = samples[Math.max(0, index - 1)]
        const tangent = next.clone().sub(prev).normalize()
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x)
        linePoints.push(point.clone().addScaledVector(normal, 2.8 * offset).setY(0.1))
      }
      addLine(roadGroup, linePoints, '#e3d07b', 0.75)
    }
    const markerRandom = seeded(999)
    for (let i = 0; i < 12; i += 1) {
      const t = i / 12
      const point = curve.getPointAt(t)
      const tangent = curve.getTangentAt(t)
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x)
      addBox(roadGroup, [1.6, 1.8, 0.2], [point.x + normal.x * 11, 0.9, point.z + normal.z * 11], surface('#4fa8d8', { emissive: '#2b749f', emissiveIntensity: 0.8 }))
      markerRandom()
    }
  }

  const rebuildTraffic = (count: number): void => {
    for (const item of traffic) disposeObject(item.group)
    traffic.length = 0
    const random = seeded(10991)
    for (let i = 0; i < count; i += 1) {
      const model = makeCar(['#7fa9d8', '#c3d6e8', '#d8b45f', '#91d2a0'][i % 4])
      root.add(model.group)
      traffic.push({
        group: model.group,
        wheels: model.wheels,
        speed: 6 + random() * 8,
        t: random(),
        lane: random() > 0.5 ? 3.2 : -3.2
      })
    }
  }

  const placeVehicle = (item: Vehicle, t: number, lane: number, mirror: boolean): void => {
    const point = curve.getPointAt(((t % 1) + 1) % 1)
    const tangent = curve.getTangentAt(((t % 1) + 1) % 1)
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x)
    item.group.position.copy(point).addScaledVector(normal, lane)
    item.group.position.y = 0.08
    item.group.rotation.y = (mirror ? -1 : 1) * Math.atan2(tangent.x, tangent.z) + (mirror ? Math.PI : 0)
  }

  const update = (dt: number, p: ParamValues): void => {
    const target = num(p, 'targetSpeed', 18)
    const friction = num(p, 'friction', 0.7)
    const slope = num(p, 'slope', 3)
    const mode = text(p, 'mode', 'auto')
    const showTrail = flag(p, 'trail', true)
    simTime += dt
    slopeState = slope
    const grade = -Math.sin(toRad(slope)) * 2.6
    speed += (target - speed) * Math.min(1, dt * 1.2 * friction) + grade * dt
    speed = Math.max(1, speed)
    distance += speed * dt
    targetT = (targetT + (speed * dt) / length) % 1
    if (mode === 'manual') {
      car.group.position.y = 0.08 + Math.abs(Math.sin(simTime * 3.4)) * 0.03
    }
    const swayLane = mode === 'manual' ? Math.sin(simTime * 1.2) * 4.6 : 0
    const point = curve.getPointAt(targetT)
    const tangent = curve.getTangentAt(targetT)
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x)
    car.group.position.copy(point).addScaledVector(normal, swayLane)
    car.group.position.y = 0.08
    const heading = (Math.atan2(tangent.x, tangent.z) * 180) / Math.PI
    car.group.rotation.y = Math.atan2(tangent.x, tangent.z)
    for (const wheel of car.wheels) wheel.rotation.y += dt * speed * 2
    for (const item of traffic) {
      item.t = (item.t + (item.speed * dt) / length) % 1
      placeVehicle(item, item.t, item.lane, item.speed > 0)
      for (const wheel of item.wheels) wheel.rotation.y += dt * item.speed * 2
    }
    if (showTrail) {
      trailPoints.push(new THREE.Vector3(point.x, 0.3, point.z))
      if (trailPoints.length > 200) trailPoints.shift()
      trail.geometry.dispose()
      trail.geometry = new THREE.BufferGeometry().setFromPoints(trailPoints)
    }
    trail.visible = showTrail
    car.group.userData.heading = heading
  }

  const sync = (p: ParamValues): void => {
    const count = Math.round(num(p, 'traffic', 3))
    if (count !== lastTraffic) {
      lastTraffic = count
      rebuildTraffic(count)
    }
  }

  buildRoad()
  sync({ traffic: 3 } as ParamValues)

  return {
    object: root,
    update,
    sync,
    action: (key) => {
      if (key === 'restart') {
        targetT = 0
        speed = 0
        distance = 0
        trailPoints.length = 0
      }
    },
    readouts: () => ({
      当前车速: `${speed.toFixed(1)} m/s`,
      累计里程: `${distance.toFixed(0)} m`,
      道路纵坡: `${slopeState.toFixed(1)}°`,
      跟车数量: traffic.length,
      仿真时间: `${simTime.toFixed(1)} s`
    }),
    dispose: () => disposeObject(root)
  }
}

export const S05: ScenarioMeta = {
  id: 's05',
  title: '城市车辆驾驶与道路跟随',
  subtitle: '沿地理道路中心线的速度控制、转向与交通流',
  description:
    '车辆沿参数化道路中心线行驶，按目标速度、坡度与摩擦逐步收敛；对向与同向车辆按车道偏移运动，实时显示航向、里程和跟车数量，可切换自动巡航与手动摆动。',
  tag: 'Cesium + Three.js · 车辆运动',
  updatedAt: '2026-10-23',
  accent: '#e8734a',
  anchor: { lon: 114.0579, lat: 22.5431, height: 22 },
  camera: { range: 300, pitch: -28, heading: 33, targetY: 12 },
  metrics: [
    { key: '当前车速', label: '当前车速' },
    { key: '累计里程', label: '累计里程' },
    { key: '道路纵坡', label: '道路纵坡' },
    { key: '跟车数量', label: '跟车数量' }
  ],
  legend: [
    { color: '#2d3740', label: '道路面' },
    { color: '#e3d07b', label: '车道标线' },
    { color: '#e8734a', label: '主车' }
  ],
  hint: '提高目标速度观察加速过程 · 坡度增大时车辆速度会自然下降 · 手动模式产生车道摆动',
  info: [
    '道路由 CatmullRomCurve3 中心线生成左右边线，并三角化为带状路面；车辆位姿由曲线切线与法线计算。',
    '速度采用一阶收敛模型，坡度作为附加纵向阻力；本案例不包含轮胎侧偏、悬架和制动系统完整模型。',
    '真实自动驾驶还需要车道拓扑、交通规则、感知目标和车辆动力学约束。'
  ],
  sections: [
    {
      title: '驾驶控制',
      params: [
        { key: 'targetSpeed', label: '目标车速', type: 'range', min: 5, max: 40, step: 1, value: 18, unit: ' m/s' },
        { key: 'mode', label: '驾驶模式', type: 'select', value: 'auto', options: [{ value: 'auto', label: '自动巡航' }, { value: 'manual', label: '手动摆动' }] },
        { key: 'friction', label: '路面附着', type: 'range', min: 0.3, max: 1, step: 0.01, value: 0.7 }
      ]
    },
    {
      title: '道路环境',
      params: [
        { key: 'slope', label: '道路纵坡', type: 'range', min: 0, max: 15, step: 0.5, value: 3, unit: '°' },
        { key: 'traffic', label: '交通车辆', type: 'range', min: 0, max: 8, step: 1, value: 3, unit: ' 辆' },
        { key: 'trail', label: '行驶轨迹', type: 'toggle', value: true }
      ]
    },
    {
      title: '操作',
      actions: [{ key: 'restart', label: '回到起点', style: 'primary' }]
    }
  ],
  create: createS05
}
