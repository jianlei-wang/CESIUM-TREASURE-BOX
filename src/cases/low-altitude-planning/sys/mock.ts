import type {
  AirspaceZone,
  Alarm,
  AreaBounds,
  Device,
  Fence,
  FlightPlan,
  LonLat,
  Obstacle,
  Poi
} from './types'
import { createPrng, circleRing, formatDateTime } from './util'

/** 成都天府广场一带，约 6.2 km × 5.2 km 的低空作业区。 */
export const DEMO_CENTER: LonLat = { lon: 104.0668, lat: 30.5728 }
export const DEMO_BOUNDS: AreaBounds = {
  west: 104.0365,
  east: 104.0971,
  south: 30.5494,
  north: 30.5962
}
export const DEMO_SEED = 20260925
export const AREA_LABEL = '成都天府广场低空作业区'

function ring(points: Array<[number, number]>): LonLat[] {
  return points.map(([lon, lat]) => ({ lon, lat }))
}

export const MOCK_AIRSPACES: AirspaceZone[] = [
  {
    id: 'nf-1',
    name: '重点目标禁飞区',
    type: 'forbid',
    shape: 'circle',
    ring: [],
    center: { lon: 104.0715, lat: 30.5768 },
    radius: 820,
    altMin: 0,
    altMax: 300,
    active: true,
    desc: '政府机关、监管场所上空，全高度禁飞，需飞行活动申请并获得批准。'
  },
  {
    id: 'nf-2',
    name: '机场净空保护区',
    type: 'forbid',
    shape: 'polygon',
    ring: ring([
      [104.0565, 30.5865],
      [104.0695, 30.5885],
      [104.0735, 30.5815],
      [104.0615, 30.5795]
    ]),
    center: { lon: 104.065, lat: 30.584 },
    radius: 0,
    altMin: 0,
    altMax: 180,
    active: true,
    desc: '机场端净空保护区，禁止无人机活动，防止与运输航空冲突。'
  },
  {
    id: 'rs-1',
    name: '限飞区（高度受限）',
    type: 'restrict',
    shape: 'polygon',
    ring: ring([
      [104.0805, 30.5705],
      [104.0955, 30.5725],
      [104.0935, 30.5875],
      [104.0785, 30.5845]
    ]),
    center: { lon: 104.087, lat: 30.578 },
    radius: 0,
    altMin: 0,
    altMax: 120,
    active: true,
    desc: '人口密集与重点设施区，限定真高 120 m 以下飞行，且需提前报备。'
  },
  {
    id: 'fv-1',
    name: '适飞空域（试验区）',
    type: 'free',
    shape: 'polygon',
    ring: ring([
      [104.0385, 30.5515],
      [104.0955, 30.5515],
      [104.0955, 30.5945],
      [104.0385, 30.5945]
    ]),
    center: { lon: 104.067, lat: 30.573 },
    radius: 0,
    altMin: 0,
    altMax: 120,
    active: true,
    desc: '微轻小型无人驾驶航空器适飞空域，例行飞行活动原则上豁免申请。'
  }
]

export function buildFences(): Fence[] {
  return [
    {
      id: 'fence-1',
      name: '机场净空电子围栏',
      alt: 0,
      color: '#22d3ee',
      ring: ring([
        [104.0535, 30.5925],
        [104.0775, 30.5945],
        [104.0805, 30.5855],
        [104.0565, 30.5835]
      ])
    },
    {
      id: 'fence-2',
      name: '重点设施电子围栏',
      alt: 30,
      color: '#f59e0b',
      ring: ring([
        [104.0895, 30.5705],
        [104.0975, 30.5715],
        [104.0965, 30.5815],
        [104.0885, 30.5805]
      ])
    },
    {
      id: 'fence-3',
      name: '临时管制电子围栏',
      alt: 20,
      color: '#facc15',
      ring: circleRing({ lon: 104.0475, lat: 30.5615 }, 620)
    }
  ]
}

export function buildObstacles(): Obstacle[] {
  const prng = createPrng(DEMO_SEED + 11)
  const obstacles: Obstacle[] = []
  const names = ['国际金融中心', '天府广场', '科技大厦', '西部国际博览城', '省体育馆', '环球中心']
  let id = 0
  for (let i = 0; i < 40; i += 1) {
    const lon = DEMO_BOUNDS.west + (DEMO_BOUNDS.east - DEMO_BOUNDS.west) * prng()
    const lat = DEMO_BOUNDS.south + (DEMO_BOUNDS.north - DEMO_BOUNDS.south) * prng()
    const halfW = 0.00045 + prng() * 0.00065
    const halfH = 0.00045 + prng() * 0.00065
    const height = Math.round(40 + prng() * 190)
    obstacles.push({
      id: `ob-${id}`,
      name: `${names[id % names.length]}·${String(id + 1).padStart(2, '0')}`,
      center: { lon, lat },
      west: lon - halfW,
      east: lon + halfW,
      south: lat - halfH,
      north: lat + halfH,
      height,
      kind: height > 180 ? 'tower' : 'building',
      limit: height
    })
    id += 1
  }
  return obstacles
}

const DEVICE_MODELS = ['M350 RTK', 'M30T', 'Mavic 3E', 'EH216-S', 'FH-98', '经纬 M300']
const DEVICE_TASKS = ['电力巡检', '应急测绘', '交通巡查', '物流配送', '安防巡逻', '环境监测']

export function buildDevices(): Device[] {
  const prng = createPrng(DEMO_SEED + 23)
  const devices: Device[] = []
  for (let i = 0; i < 6; i += 1) {
    const status: Device['status'] = i < 4 ? 'online' : i < 5 ? 'offline' : 'fault'
    devices.push({
      id: `dev-${i}`,
      no: String(100001 + i),
      name: `无人机-${String(i + 1).padStart(2, '0')}`,
      model: DEVICE_MODELS[i % DEVICE_MODELS.length],
      status,
      lon: DEMO_BOUNDS.west + (DEMO_BOUNDS.east - DEMO_BOUNDS.west) * (0.15 + prng() * 0.7),
      lat: DEMO_BOUNDS.south + (DEMO_BOUNDS.north - DEMO_BOUNDS.south) * (0.15 + prng() * 0.7),
      alt: Math.round(60 + prng() * 120),
      speed: Math.round(36 + prng() * 60),
      heading: Math.round(prng() * 360),
      battery: Math.round(35 + prng() * 64),
      signal: Math.round(55 + prng() * 45),
      temperature: Math.round(28 + prng() * 22),
      updatedAt: formatDateTime(new Date()),
      task: DEVICE_TASKS[i % DEVICE_TASKS.length]
    })
  }
  return devices
}

export function buildFlightPlans(): FlightPlan[] {
  const statuses: FlightPlan['status'][] = ['待审批', '待起飞', '飞行中', '已完成', '已取消']
  const applicants = ['张工', '李航', '王测', '赵巡', '陈调']
  const plans: FlightPlan[] = []
  for (let i = 0; i < 9; i += 1) {
    const start = new Date(Date.now() + (i - 3) * 3600_000)
    const end = new Date(start.getTime() + (30 + i * 8) * 60_000)
    plans.push({
      id: `plan-${i}`,
      name: `飞行计划-${String(i + 1).padStart(2, '0')}`,
      deviceNo: String(100001 + (i % 6)),
      routeName: ['航点巡检航线', '面状扫测航线', '环绕侦察航线'][i % 3],
      spaceName: i % 2 === 0 ? '适飞空域（试验区）' : '限飞区（高度受限）',
      startTime: formatDateTime(start),
      endTime: formatDateTime(end),
      alt: 90 + i * 10,
      status: statuses[i % statuses.length],
      applicant: applicants[i % applicants.length]
    })
  }
  return plans
}

export function buildSeedAlarms(): Alarm[] {
  const now = Date.now()
  const base: Array<Omit<Alarm, 'id' | 'time'>> = [
    {
      type: '禁飞',
      level: 'urgent',
      content: '无人机进入重点目标禁飞区，立即处置',
      deviceNo: '100003',
      lon: 104.0715,
      lat: 30.5768,
      alt: 96,
      status: 'pending'
    },
    {
      type: '冲突',
      level: 'urgent',
      content: '两架无人机水平间距小于 50 m，存在冲突风险',
      deviceNo: '100005',
      lon: 104.0602,
      lat: 30.5681,
      alt: 108,
      status: 'pending'
    },
    {
      type: '偏离',
      level: 'warn',
      content: '实际航迹偏离规划航线 42 m，超过阈值 30 m',
      deviceNo: '100002',
      lon: 104.0489,
      lat: 30.5609,
      alt: 88,
      status: 'pending'
    },
    {
      type: '信号弱',
      level: 'info',
      content: '图传信号强度低于 60%，建议调整链路',
      deviceNo: '100004',
      lon: 104.0856,
      lat: 30.5823,
      alt: 112,
      status: 'handled'
    },
    {
      type: '低电量',
      level: 'info',
      content: '剩余电量低于 30%，请安排返航',
      deviceNo: '100001',
      lon: 104.0901,
      lat: 30.5666,
      alt: 76,
      status: 'handled'
    }
  ]
  return base.map((item, index) => ({
    ...item,
    id: `alarm-${index}`,
    time: formatDateTime(new Date(now - index * 1000 * 60 * 7))
  }))
}

export const MOCK_POI: Poi[] = [
  { id: 'poi-1', name: '天府广场', kind: '地标', lon: 104.0657, lat: 30.5729 },
  { id: 'poi-2', name: '省人民医院', kind: '医院', lon: 104.0567, lat: 30.5607 },
  { id: 'poi-3', name: '市第三中学', kind: '学校', lon: 104.0801, lat: 30.5642 },
  { id: 'poi-4', name: '火车南站', kind: '交通枢纽', lon: 104.0443, lat: 30.5556 },
  { id: 'poi-5', name: '科技馆', kind: '场馆', lon: 104.0879, lat: 30.5572 },
  { id: 'poi-6', name: '应急指挥中心', kind: '应急', lon: 104.0731, lat: 30.5691 }
]

export type UserRow = { id: string; account: string; name: string; role: string; org: string; phone: string }
export const MOCK_USERS: UserRow[] = [
  { id: 'u-1', account: 'admin', name: '系统管理员', role: '超级管理员', org: '低空服务中心', phone: '138****0001' },
  { id: 'u-2', account: 'planner', name: '张规划', role: '航线规划员', org: '空域管理科', phone: '138****0002' },
  { id: 'u-3', account: 'operator', name: '刘飞手', role: '飞行操作员', org: '任务调度科', phone: '138****0003' },
  { id: 'u-4', account: 'auditor', name: '王审计', role: '安全审计员', org: '监管科', phone: '138****0004' }
]

export type RoleRow = { id: string; name: string; perms: string; users: number }
export const MOCK_ROLES: RoleRow[] = [
  { id: 'r-1', name: '超级管理员', perms: '全部菜单与按钮权限', users: 1 },
  { id: 'r-2', name: '航线规划员', perms: '场景可视、航线规划、空域申请', users: 3 },
  { id: 'r-3', name: '飞行操作员', perms: '模拟飞行、实时监控、任务调度', users: 5 },
  { id: 'r-4', name: '安全审计员', perms: '日志审计、告警处置、报表查看', users: 2 }
]

export type LogRow = { id: string; operator: string; action: string; detail: string; time: string }
export function buildLogs(): LogRow[] {
  const actions = ['登录系统', '生成航线', '提交空域申请', '启动模拟飞行', '处置告警', '导出报表', '修改参数']
  const now = Date.now()
  return actions.map((action, index) => ({
    id: `log-${index}`,
    operator: MOCK_USERS[index % MOCK_USERS.length].name,
    action,
    detail: ['操作成功', '已完成', '已提交审批', '已启动', '已处理并关闭', '已导出', '已保存'][index],
    time: formatDateTime(new Date(now - index * 1000 * 60 * 13))
  }))
}

/** 由设备实时状态汇总统计。 */
export function deviceStats(devices: Device[]): { online: number; offline: number; fault: number } {
  return {
    online: devices.filter((d) => d.status === 'online').length,
    offline: devices.filter((d) => d.status === 'offline').length,
    fault: devices.filter((d) => d.status === 'fault').length
  }
}

export function circleZoneRing(center: LonLat, radius: number): LonLat[] {
  return circleRing(center, radius)
}
