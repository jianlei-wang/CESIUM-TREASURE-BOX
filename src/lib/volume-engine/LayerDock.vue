<script setup lang="ts">
/**
 * Volume Engine —— 图层控制悬浮 Dock
 *
 * 版式与「林火蔓延」案例的图层 Dock 对齐：标题 + 启用数量徽标 + 折叠箭头，
 * 可选顶部模式选择，逐图层「色块 + 名称 + 开关」，底部「全部显示 / 全部隐藏」。
 * 组件仅负责展示与交互，图层状态与副作用由调用方维护。
 */
import { ref } from 'vue'
import type { LayerDockItem } from './types'

const props = withDefaults(
  defineProps<{
    items: LayerDockItem[]
    title?: string
    modeLabel?: string
    mode?: string
    modeOptions?: { value: string; label: string }[]
  }>(),
  { title: '图层控制' }
)

const emit = defineEmits<{
  (e: 'toggle', key: string): void
  (e: 'toggle-all'): void
  (e: 'update:mode', value: string): void
}>()

const open = ref(true)

function onMode(event: Event): void {
  emit('update:mode', (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <div class="vdock" :class="{ collapsed: !open }">
    <button class="vdock-head" @click="open = !open">
      <span class="vdock-title">{{ props.title }}</span>
      <span class="vdock-count">{{ props.items.filter((item) => item.on).length }}/{{ props.items.length }}</span>
      <i class="vdock-caret"></i>
    </button>
    <div v-show="open" class="vdock-body">
      <div v-if="props.modeOptions && props.modeOptions.length" class="vdock-mode">
        <span class="vdock-mode-label">{{ props.modeLabel || '模式' }}</span>
        <select class="vdock-mode-select" :value="props.mode" @change="onMode">
          <option v-for="option in props.modeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </div>
      <button
        v-for="item in props.items"
        :key="item.key"
        class="vdock-item"
        :class="{ on: item.on }"
        :title="item.hint"
        @click="emit('toggle', item.key)"
      >
        <span class="vdock-swatch" :style="{ background: item.color }"></span>
        <span class="vdock-label">{{ item.label }}</span>
        <span class="vdock-switch"><i></i></span>
      </button>
      <button class="vdock-all" @click="emit('toggle-all')">
        {{ props.items.some((item) => !item.on) ? '全部显示' : '全部隐藏' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.vdock {
  width: 196px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(120, 170, 220, 0.24);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(10, 22, 36, 0.92), rgba(8, 16, 28, 0.88));
  box-shadow: 0 10px 26px rgba(2, 8, 16, 0.5);
  backdrop-filter: blur(6px);
  transition: width 0.18s ease;
}
.vdock.collapsed {
  width: 164px;
}
.vdock-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  background: linear-gradient(180deg, rgba(38, 74, 116, 0.5), rgba(18, 38, 62, 0.2));
  color: #e6f0fb;
  font-size: 12px;
  letter-spacing: 0.5px;
  cursor: pointer;
}
.vdock-title {
  flex: 1;
  text-align: left;
  font-weight: 600;
  white-space: nowrap;
}
.vdock-count {
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(101, 211, 235, 0.18);
  color: #9fe8f7;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.vdock-caret {
  width: 7px;
  height: 7px;
  border-right: 1.5px solid #9dbce0;
  border-bottom: 1.5px solid #9dbce0;
  transform: rotate(45deg);
  transition: transform 0.18s ease;
}
.vdock.collapsed .vdock-caret {
  transform: rotate(-45deg);
}
.vdock-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  overflow-y: auto;
}
.vdock-mode {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 5px 7px;
  margin-bottom: 3px;
  border-bottom: 1px dashed rgba(157, 188, 224, 0.18);
}
.vdock-mode-label {
  flex: 0 0 auto;
  font-size: 11px;
  color: #93a8bd;
}
.vdock-mode-select {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 4px;
  border: 1px solid rgba(157, 188, 224, 0.26);
  border-radius: 5px;
  background: rgba(12, 24, 40, 0.9);
  color: #dbe7f4;
  font-size: 11px;
  cursor: pointer;
}
.vdock-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 7px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: #93a8bd;
  font-size: 11.5px;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}
.vdock-item:hover {
  background: rgba(88, 140, 196, 0.12);
  color: #d6e6f6;
}
.vdock-item.on {
  border-color: rgba(101, 211, 235, 0.32);
  background: rgba(47, 128, 237, 0.12);
  color: #eaf6ff;
}
.vdock-swatch {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  border-radius: 4px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18) inset;
  opacity: 0.45;
  transition: opacity 0.14s ease, transform 0.14s ease;
}
.vdock-item.on .vdock-swatch {
  opacity: 1;
  transform: scale(1.06);
}
.vdock-label {
  flex: 1;
  text-align: left;
}
.vdock-switch {
  position: relative;
  flex: 0 0 auto;
  width: 28px;
  height: 15px;
  border-radius: 999px;
  background: rgba(120, 138, 158, 0.35);
  transition: background 0.16s ease;
}
.vdock-switch i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #c3d2e2;
  transition: transform 0.16s ease, background 0.16s ease;
}
.vdock-item.on .vdock-switch {
  background: rgba(47, 128, 237, 0.6);
}
.vdock-item.on .vdock-switch i {
  transform: translateX(13px);
  background: #dceeff;
}
.vdock-all {
  margin-top: 2px;
  padding: 6px;
  border: 1px dashed rgba(120, 170, 220, 0.28);
  border-radius: 7px;
  background: transparent;
  color: #8fb4d8;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.vdock-all:hover {
  background: rgba(88, 140, 196, 0.14);
  color: #cfe2f4;
}
</style>
