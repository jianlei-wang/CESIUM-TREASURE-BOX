<script setup lang="ts">
import { computed } from 'vue'
import { LayerType } from './types'

const props = withDefaults(defineProps<{ type: LayerType; color?: string; size?: number }>(), {
  color: '#8aa4c8',
  size: 16
})

const ICONS: Record<string, string> = {
  [LayerType.GROUP]:
    '<path d="M3 7.2A2.2 2.2 0 0 1 5.2 5h3.4l1.9 2.2h8.3A2.2 2.2 0 0 1 21 9.4v7.4A2.2 2.2 0 0 1 18.8 19H5.2A2.2 2.2 0 0 1 3 16.8z"/>',
  [LayerType.IMAGERY]:
    '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8.4" cy="9.6" r="1.5"/><path d="M4.5 17l4.4-4.4 3 3 2.6-2.6 4.9 4.9"/>',
  [LayerType.TERRAIN]: '<path d="M3 18.5l5.4-8.8 3.6 4.9 2.7-3.7L21 18.5z"/><path d="M7.6 12.4l.8 1.1 1.5-1.6"/>',
  [LayerType.TILESET]:
    '<path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z"/><path d="M4.5 7.7L12 12l7.5-4.3M12 12v8.5"/>',
  [LayerType.DATASOURCE]:
    '<ellipse cx="12" cy="6.4" rx="7.5" ry="2.9"/><path d="M4.5 6.4v11.2c0 1.6 3.4 2.9 7.5 2.9s7.5-1.3 7.5-2.9V6.4"/><path d="M4.5 12c0 1.6 3.4 2.9 7.5 2.9s7.5-1.3 7.5-2.9"/>',
  [LayerType.ENTITY]:
    '<path d="M12 21c4.2-4.6 6.6-7.9 6.6-11A6.6 6.6 0 0 0 5.4 10c0 3.1 2.4 6.4 6.6 11z"/><circle cx="12" cy="10" r="2.4"/>',
  [LayerType.PRIMITIVE]:
    '<path d="M3.5 19l4-7 4 7z"/><rect x="12.5" y="12" width="8" height="7" rx="1.2"/><path d="M10 8.5l2.4-4 2.4 4z"/>',
  [LayerType.MODEL]: '<path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z"/><path d="M8.4 9.6l3.6 2 3.6-2M12 11.6v4.4"/>',
  [LayerType.PARTICLE]:
    '<circle cx="12" cy="12" r="2.2"/><circle cx="6" cy="7.5" r="1.4"/><circle cx="18" cy="8" r="1.6"/><circle cx="7" cy="17" r="1.5"/><circle cx="17.4" cy="16.6" r="1.3"/>',
  [LayerType.VOXEL]:
    '<path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z"/><path d="M4.5 7.7L12 12l7.5-4.3M12 12v8.5M8.2 5.6v8.6M15.8 5.6v8.6"/>',
  [LayerType.CUSTOM]: '<path d="M12 3.6l2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-4 5.6-.8z"/>'
}

const markup = computed(() => ICONS[props.type] ?? ICONS[LayerType.CUSTOM])
</script>

<template>
  <svg
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    :style="{ color: props.color }"
    v-html="markup"
  />
</template>
