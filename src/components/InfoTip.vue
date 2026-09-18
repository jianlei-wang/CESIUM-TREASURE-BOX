<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  text: string
  title?: string
  size?: 'sm' | 'md'
}>()

const btnEl = ref<HTMLButtonElement | null>(null)
const tipEl = ref<HTMLDivElement | null>(null)
const visible = ref(false)
const tipStyle = ref<Record<string, string>>({})

const GAP = 8
const MARGIN = 8

function reposition(): void {
  const btn = btnEl.value
  const tip = tipEl.value
  if (!btn || !tip) return
  const rect = btn.getBoundingClientRect()
  const width = tip.offsetWidth
  const height = tip.offsetHeight
  let left = rect.right - width
  if (left < MARGIN) left = MARGIN
  if (left + width > window.innerWidth - MARGIN) {
    left = Math.max(MARGIN, window.innerWidth - MARGIN - width)
  }
  let top = rect.bottom + GAP
  if (top + height > window.innerHeight - MARGIN) {
    top = rect.top - GAP - height
  }
  if (top < MARGIN) top = MARGIN
  tipStyle.value = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
}

function show(): void {
  visible.value = true
  void nextTick(reposition)
}

function hide(): void {
  visible.value = false
}

function onViewportChange(): void {
  if (visible.value) reposition()
}

onMounted(() => {
  window.addEventListener('scroll', onViewportChange, true)
  window.addEventListener('resize', onViewportChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('resize', onViewportChange)
})
</script>

<template>
  <span class="info-tip">
    <button
      ref="btnEl"
      type="button"
      class="info-tip-btn"
      :class="`is-${props.size ?? 'sm'}`"
      :aria-label="props.title ?? '参数说明'"
      @mouseenter="show"
      @mouseleave="hide"
      @focus="show"
      @blur="hide"
    >
      ?
    </button>
    <Teleport to="body">
      <div v-if="visible" ref="tipEl" class="info-tip-body" :style="tipStyle" role="tooltip">
        <b v-if="props.title" class="info-tip-head">{{ props.title }}</b>
        <span class="info-tip-text">{{ props.text }}</span>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.info-tip {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
}

.info-tip-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 13px;
  padding: 0;
  border: 1px solid rgba(150, 200, 225, 0.5);
  border-radius: 50%;
  background: rgba(120, 180, 210, 0.16);
  color: #9fd3e8;
  font-size: 9px;
  line-height: 1;
  font-weight: 700;
  cursor: help;
}

.info-tip-btn.is-md {
  width: 15px;
  height: 15px;
  font-size: 10px;
}

.info-tip-btn:hover,
.info-tip-btn:focus-visible {
  border-color: #7fd8f5;
  background: rgba(120, 200, 235, 0.32);
  color: #e6f8ff;
  outline: none;
}

.info-tip-body {
  position: fixed;
  z-index: 9999;
  max-width: 260px;
  padding: 7px 9px;
  border: 1px solid rgba(137, 210, 233, 0.45);
  border-radius: 7px;
  background: rgba(7, 22, 37, 0.97);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  color: #dcecf5;
  font-size: 10px;
  line-height: 1.55;
  pointer-events: none;
}

.info-tip-head {
  display: block;
  margin-bottom: 3px;
  color: #7fd8f5;
  font-size: 10px;
}

.info-tip-text {
  display: block;
  white-space: normal;
}
</style>
