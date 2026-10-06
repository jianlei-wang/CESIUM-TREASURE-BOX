import { defineComponent, h, type Component } from 'vue'
import D3CaseShell from './D3CaseShell.vue'
import type { D3CaseSpec } from './types'

/**
 * 由案例描述生成组件：45 个 D3 地理大数据案例共享同一渲染外壳
 * （Cesium 场景、参数面板、图例、状态栏），差异只在各自的 {@link D3CaseSpec}。
 */
export function createD3Case(spec: D3CaseSpec): Component {
  return defineComponent({
    name: `D3Case-${spec.id}`,
    setup() {
      return () => h(D3CaseShell, { spec })
    }
  })
}
