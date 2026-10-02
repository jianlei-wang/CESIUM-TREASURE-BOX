<script setup lang="ts">
/**
 * Volume Engine —— 参数提示图标
 *
 * 在参数标签后放置一个问号图标，鼠标悬停 / 聚焦时展示参数说明。
 * Tooltip 通过 Teleport 挂到 body 并使用 fixed 定位，避免被控制面板 overflow 裁剪；
 * 根据图标位置自动选择向左或向右展开，轻量且不引入额外依赖。
 */
import { ref } from 'vue'

defineProps<{ text: string }>()

const show = ref(false)
const tipStyle = ref<Record<string, string>>({})

function place(target: EventTarget | null): void {
  const el = target as HTMLElement | null
  if (!el) return
  const r = el.getBoundingClientRect()
  const toRight = r.left < 250
  tipStyle.value = toRight
    ? { top: `${r.top + r.height / 2}px`, left: `${r.right + 8}px`, transform: 'translate(0, -50%)' }
    : { top: `${r.top + r.height / 2}px`, left: `${r.left - 8}px`, transform: 'translate(-100%, -50%)' }
}

function open(event: Event): void {
  place(event.currentTarget)
  show.value = true
}

function close(): void {
  show.value = false
}
</script>

<template>
  <span
    class="param-hint"
    tabindex="0"
    aria-label="参数说明"
    @mouseenter="open"
    @mouseleave="close"
    @focus="open"
    @blur="close"
    >?</span
  >
  <Teleport to="body">
    <span v-if="show" class="param-hint-tip" :style="tipStyle">{{ text }}</span>
  </Teleport>
</template>

<style scoped>
.param-hint {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 13px;
  box-sizing: border-box;
  border: 1px solid rgba(157, 188, 224, 0.5);
  border-radius: 50%;
  color: #9fd8ff;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  cursor: help;
  user-select: none;
}
.param-hint:hover,
.param-hint:focus {
  border-color: #65d3eb;
  background: rgba(47, 128, 237, 0.32);
  color: #fff;
  outline: none;
}
.param-hint-tip {
  position: fixed;
  z-index: 9999;
  max-width: 210px;
  padding: 5px 8px;
  box-sizing: border-box;
  border: 1px solid rgba(101, 211, 235, 0.35);
  border-radius: 6px;
  background: rgba(8, 20, 40, 0.96);
  color: #dce8f5;
  font-size: 10px;
  line-height: 1.55;
  pointer-events: none;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
}
</style>
