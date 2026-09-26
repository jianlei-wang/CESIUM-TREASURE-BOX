import { defineComponent, h, type Component } from 'vue'
import DggsCaseShell from './DggsCaseShell.vue'

/**
 * 为某个离散全球网格系统生成案例组件。8 个案例共享同一外壳，
 * 仅传入各自的 {@link DggsSystem} id。
 */
export function createDggsCase(systemId: string): Component {
  return defineComponent({
    name: `DggsCase-${systemId}`,
    setup() {
      return () => h(DggsCaseShell, { systemId })
    }
  })
}
