<template>
  <div ref="elRef" class="datav-echart" :style="style"></div>
</template>

<script setup lang="ts">
import * as echarts from 'echarts'
import { onBeforeUnmount, onMounted, ref, watch, type StyleValue } from 'vue'

const props = withDefaults(
  defineProps<{
    option?: Record<string, unknown>
    style?: StyleValue
    theme?: string | object
  }>(),
  {}
)

const elRef = ref<HTMLDivElement | null>(null)
let chart: ReturnType<typeof echarts.init> | null = null
let observer: ResizeObserver | null = null

const setOption = (opt: Record<string, unknown>) => {
  if (!chart) return
  chart.setOption(opt as never, { notMerge: false, lazyUpdate: true, replaceMerge: ['series'] })
}

onMounted(() => {
  if (!elRef.value) return
  chart = echarts.init(elRef.value, props.theme ?? undefined)
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(elRef.value)
  if (props.option) setOption(props.option)
})

watch(
  () => props.option,
  (o) => {
    if (o) setOption(o)
  },
  { deep: true }
)

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
})

defineExpose({
  getInstance: () => chart,
  setOption,
})
</script>

<style scoped>
.datav-echart {
  width: 100%;
  height: 100%;
}
</style>
