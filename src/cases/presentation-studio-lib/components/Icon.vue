<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: string; size?: number | string }>(), {
  size: 18
})

const icons: Record<string, string> = {
  brand: '<circle cx="12" cy="12" r="8.2"/><path d="M12 2.5 14.7 9.3 21.5 12l-6.8 2.7L12 21.5 9.3 14.7 2.5 12l6.8-2.7Z"/><circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none"/>',
  play: '<path d="M8 5.5v13l11-6.5Z" fill="currentColor" stroke="none"/><path d="M8 5.5v13l11-6.5Z"/>',
  pause: '<path d="M9 5v14M15 5v14" stroke-width="2.4"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/><rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  replay: '<path d="M4 10a8 8 0 1 1 2.3 6.7"/><path d="M4 4.5V10h5.5"/>',
  prev: '<path d="M18 5.5v13l-9-6.5Z" fill="currentColor" stroke="none"/><path d="M18 5.5v13l-9-6.5Z"/><path d="M6 5v14" stroke-width="2.2"/>',
  next: '<path d="M6 5.5v13l9-6.5Z" fill="currentColor" stroke="none"/><path d="M6 5.5v13l9-6.5Z"/><path d="M18 5v14" stroke-width="2.2"/>',
  playStep: '<path d="M4 6.5v11l8-5.5Z" fill="currentColor" stroke="none"/><path d="M12 6.5v11l8-5.5Z" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke-width="2"/>',
  minus: '<path d="M5 12h14" stroke-width="2"/>',
  trash: '<path d="M4.5 7h15M9 7V4.8h6V7M6.8 7l.9 12.2h8.6L17.2 7M10.2 10.5v5.5M13.8 10.5v5.5"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  grip: '<circle cx="9" cy="7" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="7" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1.3" fill="currentColor" stroke="none"/>',
  camera: '<path d="M4 8.5h3l1.6-2.2h6.8L17 8.5h3v10H4Z"/><circle cx="12" cy="13" r="3.4"/>',
  route: '<circle cx="5.5" cy="18" r="2"/><circle cx="18.5" cy="6" r="2"/><path d="M7.2 17.2c4.8-1 2.4-9.4 9.4-10.4" stroke-dasharray="2.4 3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m4 12 8 4.5 8-4.5M4 16l8 4.5 8-4.5"/>',
  clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7v5.3l3.4 2"/>',
  text: '<path d="M5 6h14M12 6v13M8.5 19h7" stroke-width="2"/>',
  popup: '<path d="M4 5.5h16v11H9l-5 4Z"/><path d="M8 9h8M8 12.5h5"/>',
  sparkle: '<path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7Z"/><path d="m18.5 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M7.5 5v14M16.5 5v14M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4"/>',
  save: '<path d="M5 4.5h11L19.5 8v11.5h-15Z"/><path d="M8 4.5v5.5h7V4.5M8 19.5V14h8v5.5"/>',
  folder: '<path d="M3.5 6.5h6l2 2h9v11h-17Z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
  more: '<circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
  chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
  chevronLeft: '<path d="m14.5 6-6 6 6 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.2 2.2-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-3.1v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-2.2-2.2.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H4.9v-3.1h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.2-2.2.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h3.1v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.2 2.2-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v3.1h-.2a1.7 1.7 0 0 0-1.6 1Z"/>',
  record: '<circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="8.5" opacity=".45"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  eye: '<path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6Z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff: '<path d="m4 4 16 16"/><path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c5.8 0 9.2 6 9.2 6a17 17 0 0 1-3.1 3.6M6.5 7.6C4.2 9.4 2.8 12 2.8 12s3.4 6 9.2 6c1.2 0 2.3-.2 3.3-.6"/><path d="M9.8 9.8a3 3 0 0 0 4.4 4.4"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  keyboard: '<rect x="3" y="6.5" width="18" height="11" rx="2.4"/><path d="M6.5 10h.1M10 10h.1M13.5 10h.1M17 10h.1M6.5 13h.1M10 13h.1M13.5 13h.1M17 13h.1M8.5 16h7"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 10.5V17M12 7.4h.01" stroke-width="2.2"/>',
  warning: '<path d="M12 3.6 21 20H3Z"/><path d="M12 9v5.2M12 17.4h.01" stroke-width="2"/>',
  globe: '<circle cx="12" cy="12" r="8.6"/><path d="M3.8 9.5h16.4M3.8 14.5h16.4M12 3.4c2.3 2.4 3.5 5.3 3.5 8.6S14.3 18.2 12 20.6C9.7 18.2 8.5 15.3 8.5 12S9.7 5.8 12 3.4Z"/>',
  mountain: '<path d="m3 19 6-10 4 6 2.5-3.5L21 19Z"/><path d="m7.8 12.2 1.2-2 1.5 2.2"/>',
  building: '<path d="M5 20V9l7-4 7 4v11"/><path d="M9 20v-5h6v5M9 10.5h.1M15 10.5h.1M9 13h.1M15 13h.1"/>',
  pin: '<path d="M12 21s6.5-6.2 6.5-11A6.5 6.5 0 0 0 5.5 10c0 4.8 6.5 11 6.5 11Z"/><circle cx="12" cy="10" r="2.4"/>',
  beam: '<path d="M12 3v18" stroke-width="2"/><path d="M5 21h14"/><path d="m7 17-2 4M17 17l2 4" opacity=".5"/><circle cx="12" cy="6" r="3.2"/>',
  shadow: '<ellipse cx="9" cy="15.5" rx="5.5" ry="2.4"/><circle cx="14" cy="9" r="4"/><path d="M10.5 19.5h7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/>',
  fog: '<path d="M4 8.5h16M6.5 12h11M3.5 15.5h17M7 19h10"/>',
  sky: '<path d="M3.5 12.5a8.5 8.5 0 0 1 17 0"/><path d="M2.5 16h19M6 19.5h12"/><circle cx="12" cy="7.5" r="2.4"/>',
  contour: '<path d="M3 17c3-5 5 2 8-2.5S16 8 21 10"/><path d="M3 20c4-3 6 1 9-1.5s4-2.5 9-1.5" opacity=".55"/><path d="M3 13c2.5-3 4.5 1 7-1.5S16 7 21 8" opacity=".35"/>',
  slope: '<path d="m3 20 18-9v9Z"/><path d="m7 20 14-7M12 20l9-4.5M3 12l6-3" opacity=".55"/>',
  step: '<path d="M4 19h5v-5h5V9h5V4"/><circle cx="4" cy="19" r="1.4" fill="currentColor" stroke="none"/><circle cx="20" cy="4" r="1.4" fill="currentColor" stroke="none"/>',
  action: '<path d="M5 6h4v4H5zM15 14h4v4h-4z"/><path d="M9 8h4a2 2 0 0 1 2 2v4M15 14h-4a2 2 0 0 1-2-2V8"/>',
  reset: '<path d="M4.5 10A8 8 0 1 1 5 15"/><path d="M4 4v6h6"/>',
  undo: '<path d="M9 7 4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6v1"/>',
  redo: '<path d="m15 7 5 5-5 5"/><path d="M20 12h-9a6 6 0 0 0-6 6v1"/>',
  expand: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  speed: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="m12 13 4-4"/><circle cx="12" cy="13" r="1.5" fill="currentColor" stroke="none"/>',
  link: '<path d="M9.5 14.5 14.5 9.5"/><path d="M7 17a3.5 3.5 0 0 1 0-5l2-2a3.5 3.5 0 0 1 5 0"/><path d="M17 7a3.5 3.5 0 0 1 0 5l-2 2a3.5 3.5 0 0 1-5 0"/>',
  cursor: '<path d="m5 3 14 9-6 1.5L10 20Z"/>',
  scene: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="m4 16 5-5 4 4 3-2.5 4 4"/><circle cx="16" cy="8.5" r="1.3"/>',
  dot: '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
  arrowRight: '<path d="M4 12h15M14 7l5 5-5 5"/>',
  saveAs: '<path d="M4.5 7.5h9l3 3v8h-9Z"/><path d="M7.5 7.5v4h6v-4M7.5 18.5V15h5v3.5"/><path d="M17 4.5h3v3M20 4.5l-4 4"/>',
  duplicate: '<rect x="4" y="4" width="11" height="11" rx="2"/><path d="M9 20h11V9" opacity=".55"/>'
}

const body = computed(() => icons[props.name] ?? icons.dot)
const size = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size))
</script>

<template>
  <svg
    class="ps-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    :style="{ width: size, height: size }"
    v-html="body"
  />
</template>

<style scoped>
.ps-icon {
  display: block;
  flex: 0 0 auto;
  overflow: visible;
}
</style>
