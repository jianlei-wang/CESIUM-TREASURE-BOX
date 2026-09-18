import { defineAsyncComponent } from "vue"
import type { DemoCard } from "../types"
import icon from "./icon.webp"
const Demo = defineAsyncComponent(() => import("./Demo.vue"))

const caseItem: DemoCard = {
  id: "staging-area-edit",
  title: "集结地-编辑版",
  category: "draw",
  description: "绘制集结地后可点选已绘对象，进入顶点模式拖拽整形并增删顶点，支持整体移动/旋转/缩放，可将选中或全部对象导出为 GeoJSON（编辑结果与绘制一致）。",
  tag: "标绘编辑",
  icon,
  component: Demo,
  updatedAt: "2026-09-06"
}

export default caseItem
