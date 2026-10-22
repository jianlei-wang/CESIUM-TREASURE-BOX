<script setup lang="ts">
const props = withDefaults(defineProps<{ modelValue: boolean; disabled?: boolean; label?: string }>(), {
  disabled: false,
  label: ''
})
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function toggle(): void {
  if (props.disabled) return
  emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button
    type="button"
    class="ps-switch"
    :class="{ 'is-on': modelValue, 'is-disabled': disabled }"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    @click="toggle"
  >
    <span class="ps-switch__thumb" />
  </button>
</template>

<style scoped>
.ps-switch {
  position: relative;
  width: 34px;
  height: 19px;
  flex: 0 0 auto;
  border-radius: 999px;
  border: 1px solid rgba(126, 168, 210, 0.28);
  background: rgba(10, 22, 36, 0.9);
  padding: 0;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
}

.ps-switch__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #7d93ab;
  transition: transform 0.18s ease, background 0.18s ease;
}

.ps-switch.is-on {
  background: rgba(32, 132, 178, 0.92);
  border-color: rgba(120, 224, 255, 0.6);
}

.ps-switch.is-on .ps-switch__thumb {
  transform: translateX(15px);
  background: #f2fbff;
}

.ps-switch.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
