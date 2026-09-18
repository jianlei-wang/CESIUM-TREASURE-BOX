import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const HtmlPopupDemo = defineAsyncComponent(() => import('./HtmlPopupDemo.vue'))
import icon from './icon.webp'

const htmlPopupCase: DemoCard = {
  id: 'html-popup',
  title: '自定义HTML弹窗',
  category: 'draw',
  description: '地图点位绑定 HTML 弹窗，拖动地球弹窗跟随',
  tag: '标注弹窗',
  component: HtmlPopupDemo,
  icon,
  updatedAt: '2026-08-24'
}

export default htmlPopupCase
