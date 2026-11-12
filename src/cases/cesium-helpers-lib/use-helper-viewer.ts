import { onMounted, onUnmounted, ref, shallowRef, type Ref } from 'vue'
import type { Viewer } from 'cesium'
import { HELPER_VIEWER_CANCELLED, createHelperViewer, destroyHelperViewer, type HelperViewerOptions } from './scene'

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
  let disposed = false

  function teardown(instance?: Viewer | null): void {
    try {
      cleanup?.()
    } catch {
      // setup cleanup can touch a Viewer that is already gone
    } finally {
      cleanup = undefined
      destroyHelperViewer(instance ?? viewer.value ?? undefined)
      viewer.value = null
      ready.value = false
    }
  }

  onMounted(async () => {
    if (!container.value) return
    try {
      const instance = await createHelperViewer(container.value, {
        ...options,
        onStatus: (message) => {
          if (disposed) return
          status.value = message
          options.onStatus?.(message)
        }
      })
      if (disposed) {
        destroyHelperViewer(instance)
        return
      }
      viewer.value = instance
      if (setup) {
        const result = await setup(instance)
        if (typeof result === 'function') cleanup = result
      }
      if (disposed) {
        teardown(instance)
        return
      }
      ready.value = true
      status.value = ''
    } catch (error) {
      if (disposed) {
        teardown()
        return
      }
      if (error instanceof Error && error.message === HELPER_VIEWER_CANCELLED) return
      status.value = error instanceof Error ? error.message : String(error)
    }
  })

  onUnmounted(() => {
    disposed = true
    teardown()
  })

  return { viewer, status, ready }
}
