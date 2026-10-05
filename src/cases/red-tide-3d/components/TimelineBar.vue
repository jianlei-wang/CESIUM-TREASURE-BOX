<script setup lang="ts">
import { computed } from 'vue'
import { useRedTideStore } from '@rt/stores/red-tide'

const emit = defineEmits<{
  play: []
  reset: []
  seek: [value: number]
}>()

const store = useRedTideStore()
const maxSeconds = 48 * 3600
const progress = computed(() => (store.elapsedSeconds / maxSeconds) * 100)
const timeText = computed(() => {
  const h = Math.floor(store.elapsedSeconds / 3600)
  const m = Math.floor((store.elapsedSeconds % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
})

function onSeek(event: Event): void {
  const input = event.target as HTMLInputElement
  emit('seek', Number(input.value))
}
</script>

<template>
  <footer class="timeline glass-panel">
    <button class="play-button" type="button" @click="emit('play')">{{ store.playing ? 'Ⅱ' : '▶' }}</button>
    <button class="reset-button" type="button" @click="emit('reset')">重置</button>
    <div class="timeline-main">
      <div class="timeline-head">
        <span>2026-06-15</span>
        <strong>{{ timeText }}</strong>
        <span>未来 +48h</span>
      </div>
      <input
        class="timeline-input"
        type="range"
        min="0"
        :max="maxSeconds"
        step="60"
        :value="store.elapsedSeconds"
        :style="{ '--progress': `${progress}%` }"
        @input="onSeek"
      />
      <div class="timeline-marks"><span>监测起点</span><span>+12h</span><span>+24h</span><span>+36h</span><span>+48h</span></div>
    </div>
    <div class="speed-group">
      <span>速度</span>
      <button v-for="item in [0.5, 1, 5, 10, 20]" :key="item" :class="{ active: store.speed === item }" @click="store.speed = item">{{ item }}×</button>
    </div>
  </footer>
</template>
