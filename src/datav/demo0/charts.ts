/* demo0 图表面板 option 工厂，数据形态对齐参考工程 src/pages/Demo0/panel/chart1..4 */

const colors = ['#ACA891', '#6E918C']

function randomLine(): number[] {
  return Array.from({ length: 50 }, () => Math.round(Math.random() * 1000))
}

export interface Chart1State {
  dates: string[]
  values: number[]
  option: Record<string, unknown>
}

export function makeChart1Option(): Chart1State {
  const dates: string[] = []
  const values: number[] = []
  for (let k = 0; k < 50; k++) {
    dates.push('2025-06-' + `${k}`.padStart(2, '0'))
    values.push(Math.round(Math.random() * 1000))
  }
  const sharedAxis = (gridIndex?: number) => ({
    axisLabel: { color: 'rgba(255,255,255,0.6)' },
    data: dates,
    ...(gridIndex !== undefined ? { gridIndex } : {}),
  })
  const valueAxis = (gridIndex?: number) => ({
    axisLabel: { color: 'rgba(255,255,255,0.6)' },
    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
    ...(gridIndex !== undefined ? { gridIndex } : {}),
  })
  return {
    dates,
    values,
    option: {
      visualMap: [
        { show: false, type: 'continuous', seriesIndex: 0, min: 0, max: 400, color: colors },
        { show: false, type: 'continuous', seriesIndex: 1, dimension: 0, min: 0, max: dates.length - 1, color: colors },
      ],
      title: [
        { left: 'center', text: '全省', textStyle: { color: 'rgba(255,255,255,0.6)' } },
        { top: '50%', left: 'center', text: '成都市', textStyle: { color: 'rgba(255,255,255,0.6)' } },
      ],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        textStyle: { color: '#fff' },
        backgroundColor: 'rgba(110,145,140,0.3)',
        borderColor: colors[1],
        borderWidth: 1,
        borderRadius: 8,
      },
      xAxis: [sharedAxis(), sharedAxis(1)],
      yAxis: [valueAxis(), valueAxis(1)],
      grid: [
        { outerBoundsMode: 'same', top: '10%', left: 16, right: 16, bottom: '60%' },
        { outerBoundsMode: 'same', top: '60%', left: 16, right: 16, bottom: 16 },
      ],
      series: [
        { type: 'line', showSymbol: false, data: values },
        { type: 'line', showSymbol: false, data: values, xAxisIndex: 1, yAxisIndex: 1 },
      ],
    },
  }
}

const rand = (n: number): number => Math.round(n * Math.random())

export function makeChart2Option(): { option: Record<string, unknown> } {
  const x: string[] = []
  const inCount: number[] = []
  const outCount: number[] = []
  for (let i = 0; i < 30; i++) {
    x.push(`${i + 1}`.padStart(2, '0'))
    inCount.push(rand(i * 1000))
    outCount.push(rand(i * 1020))
  }
  const lineStyle = (color: string) => ({
    itemStyle: { color },
    markPoint: { symbol: 'rect', symbolSize: [50, 20], symbolOffset: [0, -10], data: [{ type: 'max', name: '最大值' }] },
  })
  return {
    option: {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        textStyle: { color: '#fff' },
        backgroundColor: 'rgba(110,145,140,0.3)',
        borderColor: colors[1],
        borderWidth: 1,
        borderRadius: 8,
      },
      grid: { top: 16, bottom: 16, left: 16, right: 16, outerBoundsMode: 'same' },
      legend: {
        right: 16,
        top: 0,
        data: ['进口', '出口'].map((name, index) => ({
          name,
          value: 2000,
          icon: 'none',
          textStyle: { color: colors[index] },
        })),
      },
      calculable: true,
      xAxis: {
        type: 'category',
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
        axisLabel: { interval: 0, color: 'rgba(255,255,255,0.6)' },
        splitLine: { show: false },
        axisTick: { show: false },
        data: x,
      },
      yAxis: {
        type: 'value',
        axisLabel: { interval: 0, color: 'rgba(255,255,255,0.6)' },
        splitLine: { show: false },
        axisLine: { show: true, lineStyle: { color: 'rgba(255,255,255,0.1)' } },
      },
      dataZoom: { type: 'slider', show: false, realtime: true, startValue: 0, endValue: 8 },
      series: [
        { name: '进口', type: 'line', symbol: 'none', smooth: true, ...lineStyle(colors[0]), data: inCount },
        { name: '出口', type: 'line', symbol: 'none', smooth: true, ...lineStyle(colors[1]), data: outCount },
      ],
    },
  }
}

export function makeChart3Option(): { option: Record<string, unknown> } {
  const data = [2000, 3000, 4000, 5000]
  return {
    option: {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(110,145,140,0.3)',
        borderColor: colors[1],
        borderWidth: 1,
        borderRadius: 8,
        textStyle: { color: '#fff', fontSize: 13, align: 'left' },
        axisPointer: { type: 'line', lineStyle: { width: 1, type: 'dotted', color: '#6E918C' } },
      },
      grid: { top: '20%', bottom: '5%', left: 10, right: 10, outerBoundsMode: 'same' },
      xAxis: {
        type: 'category',
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
        axisLabel: { interval: 0, color: 'rgba(255,255,255,0.6)' },
        axisTick: { show: false },
        data: ['Q1', 'Q2', 'Q3', 'Q4'],
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
          name: '',
          type: 'bar',
          barWidth: 30,
          label: { show: true, position: 'top', color: '#fff' },
          itemStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: colors.map((color, index) => ({ offset: index, color })),
              global: false,
            },
          },
          data,
        },
      ],
    },
  }
}

export interface TableRow {
  value1: string
  value2: string
  value3: string
  value4: string
}

export function makeTableRows(): TableRow[] {
  return Array.from({ length: 100 }, (_, k) => ({
    value1: `${k + 1}`,
    value2: `类型${k + 1}`,
    value3: (Math.random() * 100).toFixed(2),
    value4: (Math.random() * 1000).toFixed(2),
  }))
}
