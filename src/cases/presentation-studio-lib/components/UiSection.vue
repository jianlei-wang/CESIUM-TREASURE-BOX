<script setup lang="ts">
import { ref } from 'vue'
import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{ title: string; icon?: string; collapsible?: boolean; open?: boolean; badge?: string }>(),
  { icon: '', collapsible: false, open: true, badge: '' }
)

const expanded = ref(props.open)
</script>

<template>
  <section class="ps-section" :class="{ 'is-collapsed': collapsible && !expanded }">
    <header class="ps-section__head">
      <button
        v-if="collapsible"
        type="button"
        class="ps-section__toggle"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        <Icon v-if="icon" :name="icon" :size="14" />
        <span class="ps-section__title">{{ title }}</span>
        <span v-if="badge" class="ps-section__badge">{{ badge }}</span>
        <Icon class="ps-section__caret" name="chevronDown" :size="13" />
      </button>
      <div v-else class="ps-section__toggle is-static">
        <Icon v-if="icon" :name="icon" :size="14" />
        <span class="ps-section__title">{{ title }}</span>
        <span v-if="badge" class="ps-section__badge">{{ badge }}</span>
      </div>
      <div class="ps-section__actions">
        <slot name="actions" />
      </div>
    </header>
    <div v-show="!collapsible || expanded" class="ps-section__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.ps-section {
  border-bottom: 1px solid var(--ps-line-soft);
}

.ps-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 10px 12px 6px;
}

.ps-section__toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  border: 0;
  background: none;
  padding: 0;
  color: var(--ps-text);
  cursor: pointer;
  font: inherit;
  min-width: 0;
}

.ps-section__toggle.is-static {
  cursor: default;
}

.ps-section__title {
  font-size: 11.5px;
  font-weight: 650;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ps-text-subtle);
  white-space: nowrap;
}

.ps-section__badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(94, 224, 255, 0.12);
  color: var(--ps-accent);
  font-variant-numeric: tabular-nums;
}

.ps-section__caret {
  margin-left: auto;
  color: var(--ps-text-faint);
  transition: transform 0.18s ease;
}

.ps-section.is-collapsed .ps-section__caret {
  transform: rotate(-90deg);
}

.ps-section__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ps-section__body {
  padding: 4px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
