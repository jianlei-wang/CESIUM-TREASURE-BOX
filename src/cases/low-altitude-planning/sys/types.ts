/** 低空规划系统 DEMO 公共类型定义。 */

export type LonLat = { lon: number; lat: number }

export type AreaBounds = { west: number; south: number; east: number; north: number }

export type GridState = 'free' | 'used' | 'forbid' | 'restrict'

export type GridCell = {
  id: string
  code: string
  level: number
  row: number
  col: number
  west: number
  south: number
  east: number
  north: number
  centerLon: number
  centerLat: number
  state: GridState
  altMin: number
  altMax: number
  density: number
  value: number
}

export type AirspaceType = 'forbid' | 'restrict' | 'free'

export type AirspaceZone = {
  id: string
  name: string
  type: AirspaceType
  shape: 'polygon' | 'circle'
  ring: LonLat[]
  center: LonLat
  radius: number
  altMin: number
  altMax: number
  active: boolean
  desc: string
}

export type Obstacle = {
  id: string
  name: string
  center: LonLat
  west: number
  south: number
  east: number
  north: number
  height: number
  kind: 'building' | 'tower'
  limit: number
}

/** 电子围栏：独立于空域的用户自定义管控边界。 */
export type Fence = {
  id: string
  name: string
  ring: LonLat[]
  alt: number
  color: string
}

/** 作业区地表高程模型（规则网格采样 + 双线性插值）。 */
export type ElevationModel = {
  west: number
  south: number
  east: number
  north: number
  nx: number
  ny: number
  /** 行主序：index = iy * nx + ix，iy 自南向北、ix 自西向东。 */
  heights: number[]
}

export type RouteType = 'waypoint' | 'area' | 'surround'

export type Waypoint = { lon: number; lat: number; alt: number; name?: string }

export type RoutePlan = {
  id: string
  name: string
  type: RouteType
  points: Waypoint[]
  length: number
  duration: number
  energy: number
  risk: number
  score: number
  status: 'candidate' | 'selected'
  color: string
  createdAt: string
  notes: string[]
}

export type DeviceStatus = 'online' | 'offline' | 'fault'

export type Device = {
  id: string
  no: string
  name: string
  model: string
  status: DeviceStatus
  lon: number
  lat: number
  alt: number
  speed: number
  heading: number
  battery: number
  signal: number
  temperature: number
  updatedAt: string
  task: string
}

export type AlarmLevel = 'urgent' | 'warn' | 'info'

export type AlarmType = '越界' | '冲突' | '偏离' | '低电量' | '信号弱' | '禁飞'

export type Alarm = {
  id: string
  type: AlarmType
  level: AlarmLevel
  content: string
  deviceNo: string
  lon: number
  lat: number
  alt: number
  time: string
  status: 'pending' | 'handled'
}

export type FlightPlan = {
  id: string
  name: string
  deviceNo: string
  routeName: string
  spaceName: string
  startTime: string
  endTime: string
  alt: number
  status: '待审批' | '待起飞' | '飞行中' | '已完成' | '已取消'
  applicant: string
}

export type TrackPoint = Waypoint & { t: number; speed: number; heading: number }

export type Track = { deviceNo: string; color: string; points: TrackPoint[] }

export type Poi = { id: string; name: string; kind: string; lon: number; lat: number }

export type RenderMode = 'single' | 'graduated' | 'pointCloud' | 'heatmap' | 'trajectory'

export type LayerKey =
  | 'grid'
  | 'forbid'
  | 'restrict'
  | 'free'
  | 'model'
  | 'obstacle'
  | 'route'
  | 'track'
  | 'device'
  | 'fence'
  | 'poi'

export type LayerFlags = Record<LayerKey, boolean>

/** 三类空域图层的独立显隐开关。 */
export type AirspaceVisibility = Record<AirspaceType, boolean>

export type SystemModuleId =
  | 'scene'
  | 'route'
  | 'flight'
  | 'monitor'
  | 'airspace'
  | 'data'
  | 'system'

export type PickPayload =
  | { kind: 'grid'; cell: GridCell }
  | { kind: 'airspace'; zone: AirspaceZone }
  | { kind: 'obstacle'; obstacle: Obstacle }
  | { kind: 'fence'; fence: Fence }
  | { kind: 'route'; route: RoutePlan }
  | { kind: 'device'; device: Device }
