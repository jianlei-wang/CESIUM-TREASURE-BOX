<script setup lang="ts">
defineProps<{ modelValue: boolean; label: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <div class="helper-row">
    <span class="helper-row-label">{{ label }}</span>
    <button
      class="helper-toggle"
      :class="{ 'is-on': modelValue }"
      type="button"
      role="switch"
      :aria-checked="modelValue"
      :disabled="disabled"
      @click="emit('update:modelValue', !modelValue)"
    >
      <i></i>
    </button>
  </div>
</template>
