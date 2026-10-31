import { onBeforeUnmount, onMounted, ref, shallowRef, type Ref } from 'vue'
import type { Viewer } from 'cesium'
import { createHelperViewer, destroyHelperViewer, type HelperViewerOptions } from './scene'

export type HelperSetupResult = void | (() => void) | Promise<void | (() => void)>

/**
 * 创建 helper 场景并在挂载后执行 setup；组件卸载时先跑 setup 的清理函数，再销毁 viewer。
 * setup 抛错会写入 status，方便案例面板提示。
 */
export function useHelperViewer(
  container: Ref<HTMLElement | null>,
  options: HelperViewerOptions = {},
  setup?: (viewer: Viewer) => HelperSetupResult
) {
  const viewer = shallowRef<Viewer | null>(null)
  const status = ref('正在初始化场景…')
  const ready = ref(false)
  let cleanup: (() => void) | undefined

  onMounted(async () => {
    if (!container.value) return
    try {
      const instance = await createHelperViewer(container.value, {
        ...options,
        onStatus: (message) => {
          status.value = message
          options.onStatus?.(message)
        }
      })
      viewer.value = instance
      if (setup) {
        const result = await setup(instance)
        if (typeof result === 'function') cleanup = result
      }
      ready.value = true
      status.value = ''
    } catch (error) {
      status.value = error instanceof Error ? error.message : String(error)
    }
  })

  onBeforeUnmount(() => {
    try {
      cleanup?.()
    } finally {
      cleanup = undefined
      destroyHelperViewer(viewer.value ?? undefined)
      viewer.value = null
    }
  })

  return { viewer, status, ready }
}
