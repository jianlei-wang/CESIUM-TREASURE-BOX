import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LightHemisphereDemo = defineAsyncComponent(() => import('./LightHemisphereDemo.vue'))

const lightHemisphereCase: DemoCard = {
  id: 'light-hemisphere',
  title: '环境光-半球光',
  category: 'lighting',
  description:
    '半球环境光模拟天空光（上）与地面反射光（下）的渐变：天空色、地面色与强度实时可调，按片元法线与当地向上方向的夹角在天地色之间插值，为场景提供方向性环境照明，常作为局部光源的补充',
  tag: '光照效果',
  icon,
  component: LightHemisphereDemo,
  updatedAt: '2026-09-12'
}

export default lightHemisphereCase
