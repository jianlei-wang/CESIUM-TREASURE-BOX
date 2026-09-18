const colors = ['#3061DB', '#BDCFFF']

export function makeChart1Option(): Record<string, unknown> {
  const pieColors = ['#bdcfff', '#b693e2', '#91cfd4', '#3061DB']
  const trafficWay = [
    { name: '第一季度', value: 20 },
    { name: '第二季度', value: 10 },
    { name: '第三季度', value: 30 },
    { name: '第四季度', value: 40 },
  ]
  const pieData: unknown[] = []
  trafficWay.forEach((cur, i) => {
    pieData.push({
      value: cur.value,
      name: cur.name,
      itemStyle: { borderRadius: 10, shadowBlur: 10, color: pieColors[i], shadowColor: pieColors[i] },
    })
    pieData.push({
      value: 2,
      name: '',
      label: { show: false },
      itemStyle: { color: 'rgba(0,0,0,0)', borderColor: 'rgba(0,0,0,0)', borderWidth: 0 },
    })
  })
  const list = [
    { name: '累计增长率', value: 36 },
    { name: '同比增长率', value: 25 },
  ]
  return {
    grid: { containLabel: true, top: 16, left: 0, bottom: 0 },
    xAxis: { splitLine: { show: false }, axisLabel: { show: false }, axisTick: { show: false }, axisLine: { show: false } },
    yAxis: {
      inverse: true,
      position: 'right',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { margin: 10, fontSize: 14, color: '#fff' },
      data: list.map((i) => i.name),
    },
    series: [
      {
        type: 'bar',
        barWidth: 8,
        silent: true,
        itemStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 1,
            y2: 0,
            colorStops: [
              { offset: 0, color: '#000000' },
              { offset: 1, color: '#3061DB' },
            ],
          },
        },
        data: list,
        z: 1,
      },
      {
        type: 'pictorialBar',
        symbolRepeat: 'fixed',
        symbolMargin: '20%',
        symbol: 'rect',
        symbolSize: 8,
        itemStyle: { color: '#83848d' },
        label: { show: true, position: 'right', distance: 90, color: '#3061DB', fontSize: 14, formatter: '{c}%' },
        data: list.map((i) => i.value),
        z: 0,
      },
    ],
    pie: pieData,
  }
}

export function makeChart1PieOption(): Record<string, unknown> {
  const pieColors = ['#bdcfff', '#b693e2', '#91cfd4', '#3061DB']
  const trafficWay = [
    { name: '第一季度', value: 20 },
    { name: '第二季度', value: 10 },
    { name: '第三季度', value: 30 },
    { name: '第四季度', value: 40 },
  ]
  const data: unknown[] = []
  trafficWay.forEach((cur, i) => {
    data.push({
      value: cur.value,
      name: cur.name,
      itemStyle: { borderRadius: 10, shadowBlur: 10, color: pieColors[i], shadowColor: pieColors[i] },
    })
    data.push({
      value: 2,
      name: '',
      label: { show: false },
      itemStyle: { color: 'rgba(0,0,0,0)', borderColor: 'rgba(0,0,0,0)', borderWidth: 0 },
    })
  })
  return {
    tooltip: { show: false },
    series: [
      {
        type: 'pie',
        center: ['50%', '50%'],
        radius: [35, 45],
        label: {
          alignTo: 'edge',
          formatter: '{name|{b}}\n{val|{c} %}',
          minMargin: 5,
          edgeDistance: 10,
          lineHeight: 15,
          color: 'rgba(255,255,255,0.8)',
          rich: { val: { fontSize: 10, color: '#999' } },
        },
        labelLine: { length: 15, length2: 0, maxSurfaceAngle: 80 },
        data,
      },
    ],
  }
}

export function makeChart2Option(): Record<string, unknown> {
  const days: string[] = []
  const thisYear: number[] = []
  const lastYear: number[] = []
  for (let i = 0; i < 30; i++) {
    days.push(`${i + 1}`.padStart(2, '0'))
    thisYear.push(Math.round(i * Math.random() * 1000))
    lastYear.push(Math.round(i * Math.random() * 1050))
  }
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      textStyle: { color: 'rgba(255,255,255,0.8)' },
      backgroundColor: 'rgba(0,0,0,0.8)',
      borderColor: colors[1],
    },
    grid: { top: 16, bottom: 16, left: 16, right: 16 },
    legend: {
      right: 16,
      top: 0,
      data: [
        { name: '今年', icon: 'none', textStyle: { color: colors[0] } },
        { name: '去年', icon: 'none', textStyle: { color: colors[1] } },
      ],
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
      axisLabel: { color: 'rgba(255,255,255,0.6)' },
      splitLine: { show: false },
      axisTick: { show: false },
      data: days,
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: 'rgba(255,255,255,0.6)' },
      splitLine: { show: false },
      axisLine: { show: true, lineStyle: { color: 'rgba(255,255,255,0.1)' } },
    },
    dataZoom: { type: 'slider', show: false, realtime: true, startValue: 0, endValue: 8 },
    series: [
      {
        name: '今年',
        type: 'line',
        symbol: 'none',
        smooth: true,
        itemStyle: { color: colors[0] },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: colors[0] },
              { offset: 1, color: 'rgba(0,0,0,0.1)' },
            ],
          },
        },
        markPoint: {
          symbol: 'rect',
          symbolSize: [50, 20],
          symbolOffset: [0, -10],
          label: { color: '#ffffff' },
          data: [{ type: 'max', name: '最大值' }],
        },
        data: thisYear,
      },
      {
        name: '去年',
        type: 'line',
        symbol: 'none',
        smooth: true,
        itemStyle: { color: colors[1] },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: colors[1] },
              { offset: 1, color: 'rgba(255,255,255,0.1)' },
            ],
          },
        },
        markPoint: {
          symbol: 'rect',
          symbolSize: [50, 20],
          symbolOffset: [0, -10],
          label: { color: '#ffffff' },
          data: [{ type: 'max', name: '最大值' }],
        },
        data: lastYear,
      },
    ],
  }
}

export function makeChart3Option(): Record<string, unknown> {
  const data = [3000, 2000, 4000, 5000, 4500]
  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0,0,0,0.8)',
      borderColor: colors[1],
      textStyle: { color: 'rgba(255,255,255,0.8)' },
      axisPointer: { type: 'line', lineStyle: { width: 1, type: 'dotted', color: colors[0] } },
    },
    grid: { top: '20%', bottom: '5%', left: 10, right: 10 },
    xAxis: {
      type: 'category',
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
      axisLabel: { interval: 0, color: 'rgba(255,255,255,0.6)' },
      axisTick: { show: false },
      data: ['50', '50～100', '100～500', '500～1000', '1000'],
    },
    yAxis: {
      type: 'value',
      splitLine: { show: false },
      axisLine: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.6)' },
      axisTick: { show: false },
    },
    series: [
      {
        type: 'bar',
        barWidth: 30,
        label: { show: true, position: 'top', color: 'rgba(255,255,255,0.8)' },
        itemStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: colors.map((color, index) => ({ offset: index, color })),
          },
        },
        data,
      },
    ],
  }
}

export function makeChart5Option(): Record<string, unknown> {
  const data = [582, 421.2, 622.1, 625.3, 265]
  const indicator = [
    { name: '成都市', max: 1000 },
    { name: '德阳市', max: 1000 },
    { name: '绵阳市', max: 1000 },
    { name: '宜宾市', max: 1000 },
    { name: '达州市', max: 1000 },
  ]
  const layers = [1000, 900, 800, 700, 600, 400]
  const opacities = [0.06, 0.12, 0.18, 0.19, 0.17, 0.13]
  return {
    radar: {
      center: ['50%', '50%'],
      radius: '70%',
      axisName: { color: '#BCDCFF' },
      axisNameGap: 6,
      indicator,
      splitLine: { show: false },
      splitArea: { show: false },
      axisLine: { show: false },
    },
    series: [
      {
        type: 'radar',
        data: [data],
        label: { show: true, formatter: '{c}', color: '#bdcfff', align: 'right' },
        symbolSize: [6, 6],
        lineStyle: { width: 0 },
        areaStyle: { color: '#bdcfff', opacity: 0.6 },
      },
      ...layers.map((v, i) => ({
        type: 'radar',
        data: [Array(5).fill(v)],
        symbol: 'none',
        lineStyle: { width: 0 },
        itemStyle: { color: '#3061DB' },
        areaStyle: { color: '#3061DB', opacity: opacities[i] },
      })),
    ],
  }
}

export interface DeviceStat {
  label: string
  value: number
  unit: string
  label2: string
  value2: number
  unit2: string
}

export function makeDeviceStats(): DeviceStat[] {
  return [
    { label: '线路', value: 120, unit: '回', label2: '长度', value2: 1220, unit2: 'KM' },
    { label: '变电站', value: 48, unit: '座', label2: '功率', value2: 1820, unit2: 'MVA' },
    { label: '电缆', value: 140, unit: '回', label2: '长度', value2: 1520, unit2: 'KM' },
    { label: '换流站', value: 52, unit: '座', label2: '功率', value2: 1120, unit2: 'MVA' },
  ]
}

export interface FaultRow {
  value1: number
  value2: string
  value3: number
  value4: number
  status: string
  tone: string
}

export function makeFaultRows(): FaultRow[] {
  return Array.from({ length: 20 }, (_, k) => {
    const n = k + 1
    const done = n % 2 !== 0
    return {
      value1: n,
      value2: `故障${n}`,
      value3: Math.round(Math.random() * 1000),
      value4: Math.round(Math.random() * 100),
      status: done ? '已处理' : '处理中',
      tone: done ? '#ea580c' : '#ffa800',
    }
  })
}
