/**
 * 太阳位置计算。
 *
 * 采用 NOAA Solar Calculator 所依据的天文算法（Meeus《Astronomical Algorithms》）：
 * 先由儒略世纪数 T 求太阳几何平黄经、平近点角、中心差与真黄经，得到赤纬角与均时差；
 * 再把当地标准时间换算为真太阳时，最后用球面三角公式求高度角与方位角。
 * 计算精度约 ±0.01°，满足日照分析需求。
 */

export const DEG2RAD = Math.PI / 180
export const RAD2DEG = 180 / Math.PI

export type SunContext = {
  /** 观测点经度（度，东经为正） */
  longitude: number
  /** 观测点纬度（度，北纬为正） */
  latitude: number
  /** 当地标准时间相对 UTC 的时区偏移（小时，北京为 8） */
  timezoneOffset: number
}

export type SunPosition = {
  /** 太阳高度角（度），小于等于 0 表示位于地平线以下 */
  altitude: number
  /** 太阳方位角（度），自正北起顺时针，90=东、180=南、270=西 */
  azimuth: number
  /** 太阳赤纬角（度） */
  declination: number
  /** 时角（度），正午为 0，下午为正 */
  hourAngle: number
  /** 均时差（分钟） */
  equationOfTime: number
  /** 真太阳时（小时，0—24） */
  trueSolarTime: number
  /** 指向太阳的单位方向向量（局部 ENU：东、北、天） */
  direction: { east: number; north: number; up: number }
}

function julianDayFromUtcMs(utcMs: number): number {
  const date = new Date(utcMs)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  const dayFraction = (date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600) / 24
  let y = year
  let m = month
  if (m <= 2) {
    y -= 1
    m += 12
  }
  const a = Math.floor(y / 100)
  const b = 2 - a + Math.floor(a / 4)
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5 + dayFraction
}

/**
 * 由“当地标准时间”计算太阳位置。
 * @param localDate 当地标准时间的 Date（按其年月日时分读取）
 * @param ctx 经度、纬度、时区偏移
 */
export function computeSunPosition(localDate: Date, ctx: SunContext): SunPosition {
  const year = localDate.getFullYear()
  const month = localDate.getMonth() + 1
  const day = localDate.getDate()
  const minutesOfDay = localDate.getHours() * 60 + localDate.getMinutes() + localDate.getSeconds() / 60
  const utcMs = Date.UTC(year, month - 1, day, 0, 0, 0) + (minutesOfDay - ctx.timezoneOffset * 60) * 60000
  const jd = julianDayFromUtcMs(utcMs)

  const t = (jd - 2451545.0) / 36525.0

  const l0 = 280.46646 + t * (36000.76983 + t * 0.0003032)
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t)
  const mRad = m * DEG2RAD

  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)

  const sunCenter =
    Math.sin(mRad) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * mRad) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * mRad) * 0.000289

  const trueLongitude = l0 + sunCenter
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * t) * DEG2RAD)

  const meanObliquity =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const obliquity = meanObliquity + 0.00256 * Math.cos((125.04 - 1934.136 * t) * DEG2RAD)

  const declination =
    Math.asin(Math.sin(obliquity * DEG2RAD) * Math.sin(apparentLongitude * DEG2RAD)) * RAD2DEG

  const y = Math.tan((obliquity * DEG2RAD) / 2) ** 2
  const l0Rad = (l0 % 360) * DEG2RAD
  const equationOfTime =
    4 *
    (y * Math.sin(2 * l0Rad) -
      2 * eccentricity * Math.sin(mRad) +
      4 * eccentricity * y * Math.sin(mRad) * Math.cos(2 * l0Rad) -
      0.5 * y * y * Math.sin(4 * l0Rad) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * mRad)) *
    RAD2DEG

  const trueSolarMinutes =
    minutesOfDay + 4 * (ctx.longitude - ctx.timezoneOffset * 15) + equationOfTime
  const trueSolarTime = ((trueSolarMinutes / 60) % 24 + 24) % 24
  const hourAngle = (trueSolarTime - 12) * 15

  const latRad = ctx.latitude * DEG2RAD
  const declRad = declination * DEG2RAD
  const hourRad = hourAngle * DEG2RAD

  const sinAltitude =
    Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourRad)
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAltitude))) * RAD2DEG

  const cosAzimuth =
    (Math.sin(declRad) - Math.sin(altitude * DEG2RAD) * Math.sin(latRad)) /
    (Math.cos(altitude * DEG2RAD) * Math.cos(latRad) || 1e-9)
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAzimuth))) * RAD2DEG
  if (hourAngle > 0) azimuth = 360 - azimuth

  const altRad = altitude * DEG2RAD
  const azRad = azimuth * DEG2RAD
  const direction = {
    east: Math.cos(altRad) * Math.sin(azRad),
    north: Math.cos(altRad) * Math.cos(azRad),
    up: Math.sin(altRad)
  }

  return {
    altitude,
    azimuth,
    declination,
    hourAngle,
    equationOfTime,
    trueSolarTime,
    direction
  }
}

/** 判断给定日期是否在地平线以上（用于绘制太阳轨迹时的分段） */
export function isDaylight(date: Date, ctx: SunContext): boolean {
  return computeSunPosition(date, ctx).altitude > 0
}

/** 把“分钟数（自当日 0 点起）”格式化为 HH:mm */
export function formatMinutes(minutesOfDay: number): string {
  const normalized = ((Math.round(minutesOfDay) % 1440) + 1440) % 1440
  const hour = Math.floor(normalized / 60)
  const minute = normalized % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** 把小时数格式化为 X.XX h */
export function formatHours(hours: number, digits = 2): string {
  return `${hours.toFixed(digits)} h`
}
