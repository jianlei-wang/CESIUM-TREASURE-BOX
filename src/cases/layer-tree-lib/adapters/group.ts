import { LayerType, type ContextMenuItem, type LayerConfig, type LayerTreeNode } from '../types'
import { AbstractAdapter } from './base'

export interface GroupHandle {
  __group: true
  id: string
}

/** 图层组适配器：组本身无 Cesium 对象，显隐由子节点递归处理。 */
export class GroupAdapter extends AbstractAdapter {
  readonly type = LayerType.GROUP
  readonly label = '图层组'
  readonly color = '#f5c542'

  async create(config: LayerConfig): Promise<GroupHandle> {
    return { __group: true, id: config.id ?? config.name }
  }

  destroy(): void {
    /* 组无资源可释放 */
  }

  setVisible(): void {
    /* 子节点显隐由模型递归驱动 */
  }

  getContextMenuItems(_node: LayerTreeNode): ContextMenuItem[] {
    return [
      { id: 'groupAddLayer', label: '新建子图层', icon: 'add' },
      { id: 'groupAddGroup', label: '新建子分组', icon: 'add' },
      { id: 'd-group', divider: true },
      { id: 'groupExpand', label: '全部展开', icon: 'expand' },
      { id: 'groupCollapse', label: '全部收起', icon: 'collapse' },
      { id: 'groupShow', label: '全部显示', icon: 'visible' },
      { id: 'groupHide', label: '全部隐藏', icon: 'hidden' },
      { id: 'd-group2', divider: true },
      { id: 'dissolveGroup', label: '解散分组', icon: 'ungroup' },
      { id: 'export', label: '导出分组', icon: 'export' }
    ]
  }
}
