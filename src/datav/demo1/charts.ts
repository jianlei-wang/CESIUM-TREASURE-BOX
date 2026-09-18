import cityData from './cityData'

const colors = ['#fbdf88', '#ea580c']
const citys = Object.keys(cityData)

export function makeChart1Option(): Record<string, unknown> {
  const data = Array.from({ length: 5 }, (_, k) => ({
    name: citys[k],
    value: cityData[citys[k] as keyof typeof cityData].population,
  }))
  return {
    grid: { top: 0, bottom: 0, left: '8%', right: '12%' },
    xAxis: { show: false },
    yAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        fontSize: 14,
        margin: 16,
        color: '#000000',
        formatter: (v: string, i: number) => `{a|NO.${i + 1}} ${v}`,
        rich: { a: { color: 'rgba(0, 0, 0,0.6)' } },
      },
      data: data.map((item) => item.name),
      type: 'category',
      inverse: true,
    },
    series: [
      {
        type: 'bar',
        data: data.map((item) => item.value),
        barWidth: 8,
        itemStyle: {
          borderRadius: 4,
          color: {
            type: 'linear',
            x: 1,
            y: 0,
            x2: 0,
            y2: 0,
            colorStops: colors.map((color, index) => ({ offset: index, color })),
          },
        },
        showBackground: true,
        backgroundStyle: { borderRadius: 4 },
        label: { show: true, color: 'rgba(0, 0, 0,0.8)', fontSize: 16, fontWeight: 'bold' },
      },
      {
        name: 'dot',
        type: 'pictorialBar',
        symbol: 'circle',
        symbolSize: 16,
        z: 12,
        itemStyle: { color: colors[0], shadowColor: colors[0], shadowBlur: 10 },
        data: data.map((item) => ({ value: item.value, symbolPosition: 'end' })),
      },
    ],
  }
}

export function makeChart2Option(): Record<string, unknown> {
  const dates: string[] = []
  const a: number[] = []
  const b: number[] = []
  for (let i = 0; i < 30; i++) {
    dates.push(`${i + 1}`.padStart(2, '0'))
    a.push(Math.round(i * Math.random() * 1000))
    b.push(Math.round(i * Math.random() * 1050))
  }
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      textStyle: { color: 'rgba(0, 0, 0,0.8)' },
      backgroundColor: 'rgba(255, 245, 232,0.8)',
      borderColor: colors[1],
      borderWidth: 1,
      borderRadius: 8,
    },
    grid: { top: 16, bottom: 16, left: 16, right: 16 },
    legend: {
      right: 16,
      top: 0,
      data: [
        { name: '今年同期', icon: 'none', textStyle: { color: colors[0] } },
        { name: '去年同期', icon: 'none', textStyle: { color: colors[1] } },
      ],
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      axisLine: { lineStyle: { color: 'rgba(0, 0, 0, 0.1)' } },
      axisLabel: { interval: 0, color: 'rgba(0, 0, 0, 0.6)' },
      splitLine: { show: false },
      axisTick: { show: false },
      data: dates,
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: 'rgba(0, 0, 0, 0.6)' },
      splitLine: { show: false },
      axisLine: { show: true, lineStyle: { color: 'rgba(0, 0, 0, 0.1)' } },
    },
    dataZoom: { type: 'slider', show: false, realtime: true, startValue: 0, endValue: 8 },
    series: [
      {
        name: '今年同期',
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
              { offset: 1, color: 'rgba(255,255,255,0.1)' },
            ],
          },
        },
        data: a,
      },
      {
        name: '去年同期',
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
        data: b,
      },
    ],
  }
}

export interface PenaltyRow {
  value1: string
  value2: string
  value3: string
  value4: string
  tone: string
}

export function makePenaltyRows(): PenaltyRow[] {
  return citys.map((name) => {
    const value4 = Math.random() * 100
    const tone = value4 > 90 ? '#fbdf88' : value4 > 60 ? '#ffa800' : '#ea580c'
    return {
      value1: name,
      value2: `ZL${Math.round(Math.random() * 10000000)}`,
      value3: (Math.random() * 1000).toLocaleString('zh-CN', { maximumFractionDigits: 2 }),
      value4: value4.toLocaleString('zh-CN', { maximumFractionDigits: 2 }).concat('%'),
      tone,
    }
  })
}

export function makeChart4Option(): Record<string, unknown> {
  const data = [270, 400, 380, 420, 300, 410, 400, 330, 210, 290]
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      textStyle: { color: 'rgba(0, 0, 0,0.8)' },
      backgroundColor: 'rgba(255, 245, 232,0.8)',
      borderColor: colors[1],
      borderWidth: 1,
      borderRadius: 8,
    },
    grid: { top: 16, bottom: 16, left: 16, right: 16 },
    xAxis: { show: false, data, boundaryGap: false },
    yAxis: { show: false, type: 'value' },
    series: {
      name: 'series1',
      type: 'line',
      symbol: 'none',
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
            { offset: 1, color: 'rgba(255,255,255,0.1)' },
          ],
        },
      },
      data,
    },
  }
}

export function makeChart5Option(): Record<string, unknown> {
  const color = ['#fbdf88', '#ffa800', '#ff5b00', '#ff3000']
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
      itemStyle: { borderRadius: 10, shadowBlur: 20, color: color[i], shadowColor: color[i] },
    })
    data.push({
      value: 2,
      name: '',
      itemStyle: { color: 'rgba(0, 0, 0, 0)', borderColor: 'rgba(0, 0, 0, 0)', borderWidth: 0 },
    })
  })
  return {
    tooltip: { show: false },
    legend: {
      icon: 'circle',
      orient: 'vertical',
      data: trafficWay.map((d) => d.name),
      top: 'middle',
      right: '10%',
      textStyle: { color: '#000000' },
      itemGap: 20,
    },
    series: {
      name: '',
      type: 'pie',
      center: ['30%', '50%'],
      radius: [70, 80],
      label: { show: false },
      labelLine: { show: false },
      data,
    },
  }
}

export function makeChart6Option(): Record<string, unknown> {
  const data = [3000, 2000, 4000, 5000, 4500]
  const xData = ['50万以下', '50～100万', '100～500万', '500～1000万', '1000万以上']
  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255, 245, 232,0.8)',
      borderColor: colors[1],
      borderWidth: 1,
      borderRadius: 8,
      textStyle: { color: 'rgba(0, 0, 0,0.8)', fontSize: 13 },
      axisPointer: { type: 'line', lineStyle: { width: 1, type: 'dotted', color: colors[0] } },
    },
    grid: { top: '20%', bottom: '5%', left: 10, right: 10 },
    xAxis: {
      type: 'category',
      axisLine: { lineStyle: { color: 'rgba(0, 0, 0, 0.1)' } },
      axisLabel: { interval: 0, color: 'rgba(0, 0, 0, 0.6)' },
      axisTick: { show: false },
      data: xData,
    },
    yAxis: {
      type: 'value',
      splitLine: { show: false },
      axisLine: { show: false },
      axisLabel: { color: 'rgba(0, 0, 0, 0.6)' },
      axisTick: { show: false },
    },
    series: [
      {
        name: '',
        type: 'bar',
        barWidth: 30,
        label: { show: true, position: 'top', color: 'rgba(0, 0, 0, 0.8)' },
        itemStyle: {
          borderRadius: [15, 15, 0, 0],
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
