import { defineAsyncComponent } from 'vue'
import icon from './icon.svg'
import type { DemoCard } from '../types'

const PresentationEditorDemo = defineAsyncComponent(() => import('./PresentationEditorDemo.vue'))

const caseItem: DemoCard = {
  id: 'presentation-editor',
  title: '三维场景演示漫游制作系统',
  category: 'system',
  description:
    '对标 Skyline Presentation 的 Cesium 演示编排系统：以 Step + Action 结构化编辑演示脚本，支持定点飞行、航线录制、图层显隐、建设时序、字幕弹窗与场景效果，内置播放/单步调试/进度跳转/倍速回放、工程保存导入导出，以及 1080P/2K/4K 视频导出。',
  tag: '演示漫游',
  icon,
  component: PresentationEditorDemo,
  updatedAt: '2026-10-21'
}

export default caseItem
