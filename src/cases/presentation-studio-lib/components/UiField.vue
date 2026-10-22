<script setup lang="ts">
withDefaults(defineProps<{ label?: string; hint?: string; stacked?: boolean }>(), {
  label: '',
  hint: '',
  stacked: false
})
</script>

<template>
  <div class="ps-field" :class="{ 'is-stacked': stacked }">
    <span v-if="label" class="ps-field__label">{{ label }}</span>
    <span class="ps-field__control">
      <slot />
      <span v-if="hint" class="ps-field__hint">{{ hint }}</span>
    </span>
  </div>
</template>

<style scoped>
.ps-field {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 30px;
}

.ps-field.is-stacked {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}

.ps-field__label {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--ps-text-subtle);
  letter-spacing: 0.02em;
}

.ps-field__control {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.ps-field.is-stacked .ps-field__control {
  flex-direction: column;
  align-items: stretch;
}

.ps-field__hint {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--ps-text-faint);
  white-space: nowrap;
}
</style>
