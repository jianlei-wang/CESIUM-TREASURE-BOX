import * as THREE from 'three'
import type { ParamValues, ScenarioMeta, ScenarioRuntime } from '../types'
import { flag, num } from '../types'
import { addLine, addPillar, addStageGround, disposeObject, seeded } from '../helpers'

function createS04(kit: import('../types').SceneKit): ScenarioRuntime {
  const root = new THREE.Group()
  addStageGround(root, 260, { disc: '#18242b', accent: kit.accent })
  const city = new THREE.Group()
  const waterGroup = new THREE.Group()
  root.add(city)
  root.add(waterGroup)
  let water: THREE.Mesh | null = null
  let flowGroup: THREE.Group | null = null
  let simTime = 0
  let normalTick = 0
  let level = 0
  let peakFlow = 0
  let lastSignature = ''
  const buildingColors = ['#738696', '#8da0ad', '#647685', '#a2b2bb']

  const geometry = new THREE.PlaneGeometry(340, 340, 44, 44)
  geometry.rotateX(-Math.PI / 2)
  const basePositions = Float32Array.from(geometry.attributes.position.array as Float32Array)

  const buildCity = (p: ParamValues): void => {
    for (const child of [...city.children]) disposeObject(child)
    city.clear()
    const count = Math.round(num(p, 'buildings', 12))
    const random = seeded(44117)
    for (let i = 0; i < count; i += 1) {
      const angle = random() * Math.PI * 2
      const radius = 30 + random() * 150
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const height = 12 + random() * 52
      const width = 12 + random() * 10
      addPillar(city, [x, 0, z], width, height, width * (0.7 + random() * 0.5), buildingColors[i % buildingColors.length], true)
    }
  }

  const buildWater = (): void => {
    for (const child of [...waterGroup.children]) disposeObject(child)
    waterGroup.clear()
    water = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: '#2c82c9',
        transparent: true,
        opacity: 0.5,
        roughness: 0.18,
        metalness: 0.15,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    water.position.y = 0.3
    waterGroup.add(water)
    const grid = new THREE.Mesh(
      new THREE.RingGeometry(30, 170, 72),
      new THREE.MeshBasicMaterial({ color: '#8ce0ff', transparent: true, opacity: 0.12, side: THREE.DoubleSide })
    )
    grid.rotation.x = -Math.PI / 2
    grid.position.y = 0.35
    waterGroup.add(grid)
    flowGroup = new THREE.Group()
    const random = seeded(1212)
    for (let i = 0; i < 26; i += 1) {
      const angle = random() * Math.PI * 2
      const radius = 20 + random() * 150
      const start = new THREE.Vector3(Math.cos(angle) * radius, 0.6, Math.sin(angle) * radius)
      const line = addLine(flowGroup, [start, start.clone().add(new THREE.Vector3(7, 0, 3))], '#b8efff', 0.52)
      line.userData.phase = random() * Math.PI * 2
      line.userData.radius = radius
      line.userData.angle = angle
    }
    waterGroup.add(flowGroup)
  }

  const update = (dt: number, p: ParamValues): void => {
    const inflow = num(p, 'inflow', 120)
    const maxDepth = num(p, 'maxDepth', 5)
    const duration = num(p, 'duration', 60)
    const roughness = num(p, 'roughness', 0.04)
    const showDepth = flag(p, 'depth', true)
    const showFlow = flag(p, 'flow', true)
    simTime += dt
    const cycle = simTime % (duration + 4)
    const phase = cycle / duration
    const wave = phase < 1 ? Math.sin(Math.PI * Math.min(1, phase)) : 0
    level = maxDepth * wave
    peakFlow = Math.max(peakFlow, inflow * Math.min(1.4, wave * 1.35))
    if (water) {
      water.position.y = 0.25 + level * 0.38
      water.visible = true
      const material = water.material as THREE.MeshStandardMaterial
      material.opacity = showDepth ? 0.28 + Math.min(0.5, level / Math.max(1, maxDepth) * 0.45) : 0.2
      material.color.setHSL(0.56, 0.58, 0.42 + Math.min(0.18, level / 80))
      const position = geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < position.count; i += 1) {
        const x = basePositions[i * 3]
        const z = basePositions[i * 3 + 2]
        const ripple = Math.sin(x * 0.09 + simTime * 1.2) * 0.22 + Math.cos(z * 0.11 - simTime * 0.9) * 0.18
        position.setY(i, ripple * (0.4 + roughness * 9))
      }
      position.needsUpdate = true
      normalTick += 1
      if (normalTick % 2 === 0) geometry.computeVertexNormals()
    }
    if (flowGroup) {
      flowGroup.visible = showFlow
      for (const child of flowGroup.children) {
        const line = child as THREE.Line
        const phaseValue = (line.userData.phase as number) + simTime * 0.35
        const radius = line.userData.radius as number
        const angle = line.userData.angle as number
        const x = Math.cos(angle) * radius
        const z = Math.sin(angle) * radius
        line.position.set(Math.sin(phaseValue) * 8, 0.65, Math.cos(phaseValue) * 8)
        line.userData.x = x
        line.userData.z = z
      }
    }
  }

  const sync = (p: ParamValues): void => {
    const signature = `${Math.round(num(p, 'buildings', 12))}`
    if (signature !== lastSignature) {
      lastSignature = signature
      buildCity(p)
    }
  }

  buildCity({ buildings: 12 } as ParamValues)
  buildWater()
  lastSignature = '12'

  return {
    object: root,
    update,
    sync,
    action: (key, p) => {
      if (key === 'reflow') {
        simTime = 0
        peakFlow = 0
        buildCity(p)
      }
    },
    readouts: () => ({
      当前水位: `${level.toFixed(2)} m`,
      淹没深度: `${Math.max(0, level * 0.38).toFixed(2)} m`,
      峰值入流: `${peakFlow.toFixed(0)} m³/s`,
      风险等级: level > 4 ? '橙色预警' : level > 2 ? '黄色关注' : '蓝色常态',
      仿真时间: `${simTime.toFixed(0)} s`
    }),
    dispose: () => {
      geometry.dispose()
      disposeObject(root)
    }
  }
}

export const S04: ScenarioMeta = {
  id: 's04',
  title: '城市洪涝淹没与动态水流',
  subtitle: '入流过程、水位涨落与城区风险分区',
  description:
    '按入流过程线抬升城区水位，建筑首层逐步被淹没，水面叠加波纹与流动矢量；可调入流峰值、最大水深、涨落时长、地表糙率与建筑密度，并输出风险等级。',
  tag: 'Cesium + Three.js · 浅水演示',
  updatedAt: '2026-10-23',
  accent: '#3fa7e0',
  anchor: { lon: 113.2644, lat: 23.1291, height: 12 },
  camera: { range: 300, pitch: -32, heading: 18, targetY: 20 },
  metrics: [
    { key: '当前水位', label: '当前水位' },
    { key: '淹没深度', label: '淹没深度' },
    { key: '峰值入流', label: '峰值入流' },
    { key: '风险等级', label: '风险等级' }
  ],
  legend: [
    { color: '#2c82c9', label: '淹没水面' },
    { color: '#8ce0ff', label: '水面流动矢量' },
    { color: '#8da0ad', label: '城市建筑' }
  ],
  hint: '水位随入流过程线周期性涨落 · 建筑密度越高风险资产越多 · “重新推演”从零时刻开始',
  info: [
    '演示采用简化水文过程线驱动水位，水面波纹仅用于视觉表达，不代替二维浅水方程或水动力模型结果。',
    '淹没深度由水位与地面高程差值估算，实际工程需要接入高精度 DEM、河道边界与建筑障碍。',
    '流动矢量表示表层水流方向，真实流速场应在规则网格上求解守恒方程并进行基准算例验证。'
  ],
  sections: [
    {
      title: '入流过程',
      params: [
        { key: 'inflow', label: '峰值入流', type: 'range', min: 20, max: 300, step: 5, value: 120, unit: ' m³/s' },
        { key: 'maxDepth', label: '最大水深', type: 'range', min: 1, max: 12, step: 0.2, value: 5, unit: ' m' },
        { key: 'duration', label: '涨落时长', type: 'range', min: 20, max: 180, step: 5, value: 60, unit: ' s' }
      ]
    },
    {
      title: '城区与地表',
      params: [
        { key: 'buildings', label: '建筑数量', type: 'range', min: 4, max: 24, step: 1, value: 12, unit: ' 栋' },
        { key: 'roughness', label: '地表糙率', type: 'range', min: 0.01, max: 0.1, step: 0.005, value: 0.04 }
      ]
    },
    {
      title: '显示与推演',
      params: [
        { key: 'depth', label: '深度着色', type: 'toggle', value: true },
        { key: 'flow', label: '流动矢量', type: 'toggle', value: true }
      ],
      actions: [{ key: 'reflow', label: '重新推演', style: 'primary' }]
    }
  ],
  create: createS04
}
