<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    subtitle?: string
    width?: string
    busy?: boolean
    persistent?: boolean
    hideFooter?: boolean
    confirmText?: string
    cancelText?: string
    danger?: boolean
  }>(),
  {
    subtitle: '',
    width: '520px',
    busy: false,
    persistent: false,
    hideFooter: false,
    confirmText: '确认',
    cancelText: '取消',
    danger: false
  }
)

const emit = defineEmits<{ close: []; confirm: [] }>()

function requestClose(): void {
  if (props.busy || props.persistent) return
  emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.stopPropagation()
    requestClose()
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown, true)
    else window.removeEventListener('keydown', onKeydown, true)
  },
  { immediate: true }
)

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <Transition name="ps-modal">
      <div v-if="open" class="ps-modal-layer" @click.self="requestClose">
        <div class="ps-modal" :style="{ width }" role="dialog" aria-modal="true">
          <header class="ps-modal__head">
            <div>
              <h2 class="ps-modal__title">{{ title }}</h2>
              <p v-if="subtitle" class="ps-modal__subtitle">{{ subtitle }}</p>
            </div>
            <button type="button" class="ps-icon-btn" aria-label="关闭" :disabled="busy" @click="requestClose">
              <Icon name="close" :size="16" />
            </button>
          </header>
          <div class="ps-modal__body">
            <slot />
          </div>
          <footer v-if="!hideFooter" class="ps-modal__foot">
            <slot name="footer">
              <button type="button" class="ps-btn" :disabled="busy" @click="requestClose">{{ cancelText }}</button>
              <button
                type="button"
                class="ps-btn is-primary"
                :class="{ 'is-danger': danger }"
                :disabled="busy"
                @click="emit('confirm')"
              >
                <span v-if="busy" class="ps-spinner" />
                {{ confirmText }}
              </button>
            </slot>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ps-modal-layer {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(1, 5, 10, 0.66);
  backdrop-filter: blur(7px);
}

.ps-modal {
  --ps-text: #e8f2fc;
  --ps-text-subtle: #8ba4bc;
  --ps-text-faint: #5d7387;
  --ps-accent: #5ee0ff;
  --ps-line: rgba(116, 170, 220, 0.18);
  --ps-line-soft: rgba(116, 170, 220, 0.09);
  max-width: 100%;
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  border: 1px solid rgba(120, 190, 240, 0.2);
  background: linear-gradient(180deg, #101d2c 0%, #0a1420 100%);
  box-shadow: 0 28px 70px rgba(0, 0, 0, 0.62), 0 0 0 1px rgba(255, 255, 255, 0.03) inset;
  color: var(--ps-text);
}

.ps-modal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px 12px;
}

.ps-modal__title {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: 0.01em;
}

.ps-modal__subtitle {
  margin: 5px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ps-text-subtle);
}

.ps-modal__body {
  padding: 6px 22px 8px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ps-modal__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 22px 20px;
}

.ps-spinner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.24);
  border-top-color: currentColor;
  animation: ps-modal-spin 0.7s linear infinite;
}

@keyframes ps-modal-spin {
  to {
    transform: rotate(360deg);
  }
}

.ps-modal-enter-active,
.ps-modal-leave-active {
  transition: opacity 0.18s ease;
}

.ps-modal-enter-active .ps-modal,
.ps-modal-leave-active .ps-modal {
  transition: transform 0.18s ease, opacity 0.18s ease;
}

.ps-modal-enter-from,
.ps-modal-leave-to {
  opacity: 0;
}

.ps-modal-enter-from .ps-modal,
.ps-modal-leave-to .ps-modal {
  transform: translateY(12px) scale(0.985);
  opacity: 0;
}
</style>
