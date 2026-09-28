<script setup lang="ts">
/**
 * Volume Engine —— 通用外壳
 *
 * 提供体渲染案例统一版式：Cesium 场景槽、右下控制面板（可折叠）、左下剖切预览与图例、
 * 体素拾取浮层。案例通过 scene / controls / actions 槽注入自身内容，版式与样式全局共用。
 */
import type { PickedView, StatItem } from './types'

const props = defineProps<{
  title: string
  status: string
  panelOpen: boolean
  legendCss?: string
  legendMin?: string
  legendMax?: string
  stats?: StatItem[]
  clipRows?: StatItem[]
  showClipPanel?: boolean
  hasSlice?: boolean
  sliceSize?: number
  picked?: PickedView | null
}>()

const emit = defineEmits<{
  (e: 'toggle-panel'): void
  (e: 'download-slice'): void
}>()

const okStatus = () => props.status.startsWith('✓')
</script>

<template>
  <div class="vol-shell">
    <slot name="scene"></slot>

    <div class="vol-left">
      <div v-if="props.showClipPanel !== false" class="vol-panel vol-clip">
        <div class="vol-panel-title">剖切面预览</div>
        <div class="vol-slice-wrap">
          <slot name="slice"></slot>
          <div v-if="!props.hasSlice" class="vol-slice-empty">暂无切面</div>
        </div>
        <div class="vol-meta">
          <div v-for="row in props.clipRows" :key="row.label" class="vol-meta-row">
            <span>{{ row.label }}</span><b>{{ row.value }}</b>
          </div>
        </div>
        <button class="vol-download" :disabled="!props.hasSlice" @click="emit('download-slice')">下载 PNG</button>
      </div>

      <div class="vol-panel vol-legend">
        <div class="vol-panel-title">图例 / 数据说明</div>
        <div v-if="props.legendCss" class="vol-legend-bar" :style="{ background: props.legendCss }"></div>
        <div v-if="props.legendCss" class="vol-legend-caption">
          <span>{{ props.legendMin }}</span><span>{{ props.legendMax }}</span>
        </div>
        <slot name="legend"></slot>
        <div v-for="row in props.stats" :key="row.label" class="vol-stat">
          <span>{{ row.label }}</span><b>{{ row.value }}</b>
        </div>
      </div>
    </div>

    <div class="vol-panel vol-controls" :class="{ 'is-collapsed': !props.panelOpen }">
      <div class="vol-head">
        <span class="vol-title">{{ props.title }}</span>
        <button class="vol-toggle" title="收起控制面板" @click="emit('toggle-panel')">›</button>
      </div>
      <p class="vol-status" :class="{ ok: okStatus() }">{{ props.status }}</p>
      <slot name="controls"></slot>
      <div class="vol-actions">
        <slot name="actions"></slot>
      </div>
    </div>

    <button v-if="!props.panelOpen" class="vol-restore" title="展开控制面板" @click="emit('toggle-panel')">
      控制面板
    </button>

    <div v-if="props.picked" class="vol-pick">
      <div class="vol-pick-title">{{ props.picked.title }}</div>
      <template v-if="props.picked.rows.length">
        <div v-for="row in props.picked.rows" :key="row.label" class="vol-pick-row">
          <span>{{ row.label }}</span><b>{{ row.value }}</b>
        </div>
      </template>
      <div v-else class="vol-pick-empty">{{ props.picked.empty || '无数据' }}</div>
    </div>
  </div>
</template>

<style>
.vol-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  border-radius: 8px;
  background: #152b4c;
}
.vol-cesium {
  width: 100%;
  height: 100%;
}

.vol-panel {
  position: absolute;
  z-index: 10;
  padding: 10px 12px;
  box-sizing: border-box;
  border: 1px solid rgba(157, 188, 224, 0.28);
  border-radius: 9px;
  background: rgba(10, 26, 52, 0.88);
  backdrop-filter: blur(6px);
  color: #dce8f5;
}
.vol-controls {
  top: 12px;
  right: 12px;
  width: min(276px, calc(100% - 24px));
  max-height: calc(100% - 24px);
  overflow-y: auto;
  transition: transform 0.28s ease, opacity 0.2s ease;
}
.vol-controls.is-collapsed {
  transform: translateX(calc(100% + 24px));
  opacity: 0;
  pointer-events: none;
}
.vol-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.vol-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.vol-toggle {
  flex: 0 0 auto;
  width: 24px;
  height: 20px;
  border: 1px solid rgba(157, 188, 224, 0.45);
  border-radius: 5px;
  background: rgba(23, 48, 88, 0.6);
  color: #cfe5ff;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.vol-toggle:hover {
  background: rgba(47, 128, 237, 0.3);
  color: #fff;
}
.vol-restore {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 11;
  padding: 7px 12px;
  border: 1px solid rgba(101, 211, 235, 0.45);
  border-radius: 8px;
  background: rgba(8, 24, 48, 0.9);
  color: #9fd8ff;
  font-size: 11px;
  cursor: pointer;
}
.vol-restore:hover {
  background: rgba(47, 128, 237, 0.32);
  color: #fff;
}
.vol-status {
  margin: 5px 0 0;
  font-size: 10px;
  line-height: 1.5;
  color: #9fd8ff;
}
.vol-status.ok {
  color: #66ff99;
}

.vol-section {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  margin-bottom: 6px;
  font-size: 11px;
  color: #8ea5c2;
}
.vol-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 3px 0;
}
.vol-label {
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #c3d5e8;
  font-size: 11px;
}
.vol-value {
  flex: 0 0 62px;
  text-align: right;
  color: #9fb8d4;
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.vol-row input[type='range'] {
  flex: 0 0 84px;
  min-width: 0;
  accent-color: #2f80ed;
}
.vol-switch {
  position: relative;
  flex: 0 0 auto;
  width: 34px;
  height: 18px;
  border: 0;
  border-radius: 9px;
  background: #40506b;
  cursor: pointer;
  transition: background 0.2s;
}
.vol-switch.is-on {
  background: #2f80ed;
}
.vol-switch span {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #eef4ff;
  transition: transform 0.2s;
}
.vol-switch.is-on span {
  transform: translateX(16px);
}

.vol-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}
.vol-chip {
  flex: 1 1 30%;
  padding: 4px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.06);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.vol-chip:hover {
  border-color: #5eacf5;
  color: #fff;
}
.vol-chip.active {
  border-color: #2f80ed;
  background: #2f80ed;
  color: #fff;
  font-weight: 600;
}
.vol-mini {
  display: flex;
  gap: 4px;
}
.vol-mini button {
  min-width: 30px;
  height: 20px;
  padding: 0 5px;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.06);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.vol-mini button.active {
  border-color: #2f80ed;
  background: #2f80ed;
  color: #fff;
  font-weight: 600;
}
.vol-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.vol-action {
  flex: 1 1 calc(50% - 3px);
  height: 26px;
  border: 0;
  border-radius: 5px;
  cursor: pointer;
  font-size: 11px;
  background: #2f80ed;
  color: #eef4ff;
}
.vol-action:hover {
  background: #3f8ef5;
}
.vol-action.ghost {
  background: rgba(47, 128, 237, 0.18);
  border: 1px solid rgba(47, 128, 237, 0.7);
  color: #9fd8ff;
}

.vol-left {
  position: absolute;
  top: 12px;
  left: 12px;
  bottom: 12px;
  z-index: 10;
  width: min(224px, calc(100% - 24px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-x: hidden;
  overflow-y: auto;
  pointer-events: none;
  scrollbar-width: thin;
}
.vol-left > * {
  pointer-events: auto;
}
.vol-clip {
  position: relative;
  flex: 0 0 auto;
  width: 100%;
}
.vol-panel-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  margin-bottom: 7px;
  color: #65d3eb;
}
.vol-slice-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  box-sizing: border-box;
  border-radius: 6px;
  border: 1px solid rgba(157, 188, 224, 0.35);
  overflow: hidden;
  background-color: #0b1f3a;
  background-image: linear-gradient(45deg, rgba(255, 255, 255, 0.07) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255, 255, 255, 0.07) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.07) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.07) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
.vol-slice-wrap canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.vol-slice-wrap canvas.hidden {
  display: none;
}
.vol-slice-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #7f96b3;
  font-size: 11px;
}
.vol-meta {
  margin-top: 8px;
}
.vol-meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 3px;
  font-size: 10px;
}
.vol-meta-row span {
  color: #9fb8d4;
}
.vol-meta-row b {
  color: #dce8f5;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.vol-download {
  width: 100%;
  height: 24px;
  margin-top: 8px;
  border: 1px solid rgba(47, 128, 237, 0.7);
  border-radius: 5px;
  background: rgba(47, 128, 237, 0.18);
  color: #9fd8ff;
  font-size: 11px;
  cursor: pointer;
}
.vol-download:hover:not(:disabled) {
  background: rgba(47, 128, 237, 0.32);
  color: #eaf6ff;
}
.vol-download:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.vol-legend {
  position: relative;
  flex: 1 1 auto;
  min-height: 150px;
  overflow-y: auto;
  width: 100%;
}
.vol-legend-bar {
  height: 10px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.25);
}
.vol-legend-caption {
  display: flex;
  justify-content: space-between;
  margin: 3px 0 6px;
  font-size: 10px;
  color: #9fc8e8;
}
.vol-stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 3px;
  font-size: 11px;
}
.vol-stat span {
  color: #c3d5e8;
}
.vol-stat b {
  color: #65d3eb;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.vol-pick {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  min-width: 210px;
  padding: 9px 13px;
  box-sizing: border-box;
  border: 1px solid rgba(101, 211, 235, 0.4);
  border-radius: 8px;
  background: rgba(8, 24, 48, 0.9);
  backdrop-filter: blur(6px);
  font-size: 11px;
  color: #dce8f5;
}
.vol-pick-title {
  font-size: 12px;
  font-weight: 700;
  color: #65d3eb;
  letter-spacing: 0.04em;
  margin-bottom: 4px;
}
.vol-pick-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 5px;
}
.vol-pick-row span {
  color: #c3d5e8;
}
.vol-pick-row b {
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.vol-pick-empty {
  color: #9fc8e8;
  line-height: 1.5;
}

@media (max-width: 560px) {
  .vol-controls {
    left: 12px;
    right: 12px;
    width: auto;
    max-height: 66%;
  }
  .vol-pick {
    bottom: auto;
    top: 50%;
    transform: translate(-50%, -50%);
    min-width: 0;
    max-width: calc(100% - 24px);
  }
}
</style>
