<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Viewer } from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { PlotEditSession, type EditableObject, type EditorTool } from './plot-edit/session'
import {
  buildCollection,
  buildFeature,
  downloadGeoJSON,
  fileTimestamp,
  type ExportObject
} from './plot-edit/exporter'
import { kindName } from './plot-edit/types'
import {
  buildDrawColor,
  kindMeta,
  MilitaryPlottingSession,
  type PlottingKind
} from './index'

const props = defineProps<{
  kind: PlottingKind
  editable?: boolean
}>()

const meta = kindMeta(props.kind)

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const drawing = ref(false)
const strokeColor = ref('#ff4d4f')
const strokeAlpha = ref(0.85)
const strokeWidth = ref(meta.hasWidth ? 8 : 0)
const edgeCount = ref(6)
const resultMessage = ref('')

const editOpen = ref(false)
const editTool = ref<EditorTool>('select')
const editStatus = ref('')
const confirmClose = ref(false)
const objects = ref<Array<EditableObject & { order: number; count: number }>>([])
const activeKey = ref('')
const canUndoEdit = ref(false)

const PREVIEW_COLORS = ['#ff4d4f', '#ff8c00', '#ffd700', '#3dd68c', '#00ced1', '#2f8fff', '#c71585']

let viewer: Viewer | undefined
let session: MilitaryPlottingSession | undefined
let editor: PlotEditSession | undefined
let disposed = false

const TOOL_META: Array<{ value: EditorTool; label: string; tip: string }> = [
  { value: 'select', label: '选取', tip: '单击场景中的对象可选中（面/多边形可点选，线对象请在列表中点击）' },
  { value: 'vertex', label: '顶点', tip: '拖拽图形上的顶点进行整形；结合「增点/删点」按钮修改顶点数' },
  { value: 'move', label: '移动', tip: '按住左键整体平移图形' },
  { value: 'rotate', label: '旋转', tip: '按住左键围绕图形中心旋转' },
  { value: 'scale', label: '缩放', tip: '按住左键围绕图形中心等比缩放' }
]

function startDraw(): void {
  if (!viewer || viewer.isDestroyed() || !session || session.isDrawing) return
  editor?.setEnabled(false)
  editor?.clearUndo()
  const color = buildDrawColor(strokeColor.value, strokeAlpha.value)
  const started = session.startDraw(
    props.kind,
    {
      color,
      width: meta.hasWidth ? Math.max(strokeWidth.value, 1) : undefined,
      num: meta.hasNum ? edgeCount.value : undefined
    },
    () => finishDraw()
  )
  if (started) {
    drawing.value = true
    resultMessage.value = ''
    statusMessage.value = '绘制中…请用鼠标左键操作，右键结束当前标绘'
  }
}

function finishDraw(): void {
  drawing.value = false
  if (session) {
    resultMessage.value = `已绘制 ${session.count} 个${meta.name}`
    if (!session.isDrawing) statusMessage.value = ''
  }
  if (editor) {
    editor.setEnabled(editOpen.value)
    if (props.editable && editOpen.value) {
      editor.sync()
      refreshObjects()
    }
  }
}

function refreshObjects(): void {
  if (!editor) return
  activeKey.value = editor.selected()?.key ?? ''
  objects.value = editor.objects.map((o, index) => ({
    ...o,
    order: index + 1,
    count: editor?.readPoints(o).length ?? 0
  }))
  canUndoEdit.value = canUndoNow()
}

function applyTool(tool: EditorTool): void {
  if (!editor) return
  editor.setTool(tool)
  editTool.value = tool
  freezeCameraForTool(tool)
  const metaOfTool = TOOL_META.find((t) => t.value === tool)
  editStatus.value = metaOfTool ? metaOfTool.tip : ''
}

function freezeCameraForTool(tool: EditorTool): void {
  const controller = viewer?.scene.screenSpaceCameraController
  if (!controller) return
  const lock = tool === 'move' || tool === 'rotate' || tool === 'scale' || tool === 'vertex'
  controller.enableRotate = !lock
  controller.enableTranslate = !lock
}

function requestToggleEdit(): void {
  if (!editor) return
  if (!editOpen.value) {
    openEdit()
    return
  }
  if (canUndoNow()) {
    confirmClose.value = true
    editStatus.value = '存在未保存的编辑步骤，保存定稿后再关闭可保留编辑结果'
    return
  }
  closeEdit()
}

function openEdit(): void {
  editOpen.value = true
  confirmClose.value = false
  editor?.setEnabled(true)
  editor?.sync()
  refreshObjects()
  applyTool('select')
  canUndoEdit.value = canUndoNow()
  editStatus.value = '已进入编辑模式：可增删改所选对象并导出结果'
}

function closeEdit(): void {
  editOpen.value = false
  confirmClose.value = false
  if (editor) {
    editor.select(null)
    editor.clearUndo()
    editor.setEnabled(false)
  }
  canUndoEdit.value = false
  freezeCameraForTool('select')
  refreshObjects()
  editStatus.value = ''
}

function cancelCloseEdit(): void {
  confirmClose.value = false
  editStatus.value = '已取消，可继续编辑'
}

function discardEditAndClose(): void {
  closeEdit()
  resultMessage.value = '未保存的编辑步骤已放弃，编辑已关闭，地图可正常拖拽'
}

function selectObject(key: string): void {
  if (!editor) return
  const object = editor.objects.find((o) => o.key === key)
  if (!object) return
  editor.select(object.key)
  refreshObjects()
  if (editTool.value === 'select' || editTool.value === 'vertex') {
    editStatus.value = `已选中 ${object.name}，共 ${editor.readPoints(object).length} 个点`
  } else {
    editStatus.value = `已选中 ${object.name}，可使用当前「${TOOL_META.find((t) => t.value === editTool.value)?.label ?? ''}」工具在场景中拖拽`
  }
}

function removeObject(): void {
  const selected = editor?.selected()
  if (!selected) {
    editStatus.value = '请先在对象列表中点击选中一个对象'
    return
  }
  editor?.removeObject(selected.key)
  refreshObjects()
}

function insertVertex(): void {
  const selected = editor?.selected()
  if (!selected) {
    editStatus.value = '请先选中对象后再插入顶点'
    return
  }
  const idx = editor?.activeIndex ?? -1
  const pick = editor?.lastPickPoint ?? null
  editor?.insertVertex(selected, idx, pick ?? undefined)
  refreshObjects()
}

function deleteVertex(): void {
  const selected = editor?.selected()
  if (!selected) {
    editStatus.value = '请先选中对象后再删除顶点'
    return
  }
  const idx = editor?.activeIndex ?? -1
  editor?.removeVertex(selected, idx)
  refreshObjects()
}

function clearAll(): void {
  if (!viewer || viewer.isDestroyed() || !session || session.isDrawing) return
  session.clear()
  if (editor) {
    editor.select(null)
    editor.clearUndo()
    editor.sync()
    refreshObjects()
  }
  resultMessage.value = '已清除全部标绘'
  statusMessage.value = ''
  editStatus.value = ''
}

function refreshStyle(): void {
  if (!session || !viewer || viewer.isDestroyed()) return
  const color = buildDrawColor(strokeColor.value, strokeAlpha.value)
  session.restyle(color, meta.hasWidth ? Math.max(strokeWidth.value, 1) : undefined)
}

function currentExportObjects(): ExportObject[] {
  const source = editor?.objects ?? []
  return source
    .filter((o) => o.shape !== 'none')
    .map((o) => ({
      id: o.key,
      kind: props.kind,
      name: o.name,
      geoType: o.geoType,
      shape: o.shape as ExportObject['shape'],
      points: editor?.readPoints(o) ?? []
    }))
    .filter((o) => o.points.length > 0)
}

function exportSelected(): void {
  const selected = editor?.selected()
  if (!selected) {
    editStatus.value = '请先点击选中要导出的对象'
    return
  }
  const points = editor?.readPoints(selected) ?? []
  if (points.length === 0) {
    editStatus.value = '所选对象没有可导出的顶点'
    return
  }
  if (selected.shape === 'none') {
    editStatus.value = '该对象无可导出的几何'
    return
  }
  const feature = buildFeature({
    id: selected.key,
    kind: props.kind,
    name: selected.name,
    geoType: selected.geoType,
    shape: selected.shape,
    points
  })
  downloadGeoJSON(`${kindName(props.kind)}-单对象-${fileTimestamp()}`, feature)
  editStatus.value = `已导出单对象 GeoJSON（${points.length} 个顶点）`
}

function exportAll(): void {
  const list = currentExportObjects()
  if (list.length === 0) {
    editStatus.value = '当前没有可导出的标绘对象'
    return
  }
  const total = list.reduce((sum, o) => sum + o.points.length, 0)
  downloadGeoJSON(`${kindName(props.kind)}-全部-${fileTimestamp()}`, buildCollection(list))
  editStatus.value = `已导出 ${list.length} 个对象的 GeoJSON（共 ${total} 个顶点）`
}

function canUndoNow(): boolean {
  return !!editor && !!editor.canUndo && editOpen.value && !drawing.value
}

function undoEdit(): void {
  if (!canUndoNow()) return
  const ok = editor?.undo()
  if (!ok) return
  refreshObjects()
  const label = TOOL_META.find((t) => t.value === editTool.value)?.label ?? ''
  editStatus.value = `已撤销最近一次编辑${label ? `（当前工具：${label}）` : ''}`
}

function finalizeSave(): void {
  if (!editor || !session) return
  if (session.isDrawing || drawing.value) {
    editStatus.value = '请先结束当前绘制再定稿'
    return
  }
  const count = editor.objects.filter((o) => o.shape !== 'none').length
  const hadPending = canUndoNow()
  closeEdit()
  refreshObjects()
  if (count > 0) {
    resultMessage.value = hadPending
      ? `已保存定稿：${count} 个对象已按编辑后的顶点定格（无下载），编辑已关闭，地图可正常拖拽`
      : `已保存定稿：${count} 个对象（无下载），编辑已关闭，地图可正常拖拽`
  } else {
    resultMessage.value = '已保存：当前场景没有标绘对象，编辑已关闭，地图可正常拖拽'
  }
}

watch([strokeColor, strokeAlpha, strokeWidth], () => refreshStyle())
watch(drawing, (value) => {
  editor?.setEnabled(!value && editOpen.value)
})

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => {
      statusMessage.value = message
    },
    onBasemapReady: () => {
      statusMessage.value = ''
    }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    session = new MilitaryPlottingSession(viewer)
    editor = new PlotEditSession(viewer, {
      onStatus: (message) => {
        editStatus.value = message
      },
      onObjectsChange: () => refreshObjects(),
      onSelectedChange: () => {
        activeKey.value = editor?.selected()?.key ?? ''
      },
      onUndoChanged: () => {
        canUndoEdit.value = canUndoNow()
      }
    })
    if (props.editable) {
      editOpen.value = true
      editor.setEnabled(true)
      applyTool('select')
      editStatus.value = '绘制完成后可进入「编辑功能」对对象进行增删改与导出'
    }
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  drawing.value = false
  editor?.destroy()
  editor = undefined
  session = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="plotting-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="control-panel">
      <div class="panel-title">{{ meta.title }}</div>
      <div class="button-row">
        <button class="action-button primary" :class="{ disabled: drawing }" @click="startDraw">
          {{ drawing ? '绘制中…' : '开始绘制' }}
        </button>
        <button class="action-button danger" :disabled="drawing" @click="clearAll">清除全部</button>
      </div>
      <div class="section-title">样式参数</div>
      <div class="control-row">
        <span class="row-label">标绘颜色</span>
        <div class="swatch-group">
          <button
            v-for="c in PREVIEW_COLORS"
            :key="c"
            class="swatch"
            :style="{ background: c }"
            :class="{ active: c === strokeColor }"
            @click="strokeColor = c"
          ></button>
          <input v-model="strokeColor" type="color" class="color-input" />
        </div>
      </div>
      <div class="control-row">
        <span class="row-label">不透明度</span>
        <input v-model.number="strokeAlpha" type="range" min="0.1" max="1" step="0.05" />
        <span class="row-value">{{ strokeAlpha.toFixed(2) }}</span>
      </div>
      <div v-if="meta.hasWidth" class="control-row">
        <span class="row-label">线宽</span>
        <input v-model.number="strokeWidth" type="range" min="1" max="30" step="1" />
        <span class="row-value">{{ strokeWidth }}</span>
      </div>
      <div v-if="meta.hasNum" class="control-row">
        <span class="row-label">边数</span>
        <input v-model.number="edgeCount" type="range" min="3" max="12" step="1" />
        <span class="row-value">{{ edgeCount }}</span>
      </div>

      <template v-if="props.editable">
        <div class="section-title edit-title">
          <span>编辑功能</span>
          <button class="toggle-button" @click="requestToggleEdit">
            {{ editOpen ? '关闭编辑' : '开启编辑' }}
          </button>
        </div>
        <template v-if="editOpen">
          <div v-if="confirmClose" class="close-confirm">
            <div class="close-confirm-msg">存在未保存的编辑步骤，是否先保存定稿再关闭编辑？</div>
            <div class="mini-actions">
              <button class="mini-button save" :disabled="drawing" @click="finalizeSave">
                保存并关闭
              </button>
              <button class="mini-button danger-text" :disabled="drawing" @click="discardEditAndClose">
                不保存关闭
              </button>
              <button class="mini-button" @click="cancelCloseEdit">取消</button>
            </div>
          </div>
          <div class="tool-chip-row">
            <button
              v-for="tool in TOOL_META"
              :key="tool.value"
              class="tool-chip"
              :class="{ active: editTool === tool.value }"
              :disabled="drawing"
              @click="applyTool(tool.value)"
            >
              {{ tool.label }}
            </button>
          </div>
          <div v-if="editStatus" class="edit-status">{{ editStatus }}</div>
          <div class="section-title sub">对象列表（点击选中）</div>
          <div v-if="objects.length === 0" class="empty-tip">暂无已绘对象</div>
          <div v-else class="object-list">
            <div
              v-for="obj in objects"
              :key="obj.key"
              class="object-row"
              :class="{ active: obj.key === activeKey }"
              @click="selectObject(obj.key)"
            >
              <span class="object-index">{{ obj.order }}</span>
              <span class="object-name">{{ obj.name }}</span>
              <span class="object-count">{{ obj.count }}</span>
            </div>
          </div>
          <div class="mini-actions">
            <button class="mini-button" :disabled="drawing || !activeKey" @click="insertVertex">
              增点
            </button>
            <button class="mini-button" :disabled="drawing || !activeKey" @click="deleteVertex">
              删点
            </button>
            <button
              class="mini-button danger-text"
              :disabled="drawing || !activeKey"
              @click="removeObject"
            >
              删除对象
            </button>
          </div>
          <div class="section-title sub">导出 GeoJSON</div>
          <div class="mini-actions">
            <button
              class="mini-button export"
              :disabled="drawing || !activeKey"
              @click="exportSelected"
            >
              导出选中对象
            </button>
            <button
              class="mini-button export"
              :disabled="drawing || objects.length === 0"
              @click="exportAll"
            >
              导出全部
            </button>
          </div>
          <div class="section-title sub">定稿与撤销</div>
          <div class="mini-actions">
            <button
              class="mini-button save"
              :disabled="drawing || objects.length === 0"
              @click="finalizeSave"
            >
              保存定稿
            </button>
            <button
              class="mini-button undo"
              :disabled="drawing || !canUndoEdit"
              @click="undoEdit"
            >
              撤销
            </button>
          </div>
        </template>
      </template>

      <div class="hint">
        <template v-if="props.editable">
          ① 点击「开始绘制」进入绘制状态，左键落点、右键结束；
          ② 绘制完成后在右侧列表点选对象，切换「顶点/移动/旋转/缩放」工具编辑；
          ③ 「顶点」工具下节点可拖拽整形：拖住橙色节点移动，白色中点表示边中间位置，点击即可在该处增加节点，并可用「增点/删点」微调；
          ④ 编辑完成后「保存定稿」将结果定格在场景中（不下载文件）并自动关闭编辑、恢复地图拖拽；「撤销」可回退最近一步编辑；
          ⑤ 点击「关闭编辑」时若有未保存的编辑步骤会提示是否先保存；导出选中/全部对象为 GeoJSON 不依赖定稿。
        </template>
        <template v-else>
          ① 点击「开始绘制」后进入绘制状态；
          ② 用鼠标左键在地图上落点/拖拽成形；
          ③ 点击右键结束本笔，可连续多笔叠加；
          ④ 调整颜色/不透明度/线宽等参数会实时刷新已绘对象。
        </template>
      </div>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
      <div v-if="drawing" class="drawing-tip">当前绘制进行中，请在场景中操作</div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.plotting-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  border-radius: 8px;
  background: #152b4c;
}
.cesium-container {
  width: 100%;
  height: 100%;
}
.control-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  width: 280px;
  max-height: calc(100% - 24px);
  padding: 12px;
  border: 1px solid rgba(157, 188, 224, 0.28);
  border-radius: 9px;
  background: rgba(10, 26, 52, 0.84);
  backdrop-filter: blur(6px);
  color: #dce8f5;
  overflow-y: auto;
}
.panel-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
}
.section-title {
  margin-top: 8px;
  margin-bottom: 4px;
  font-size: 11px;
  color: #8ea5c2;
}
.edit-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid rgba(157, 188, 224, 0.22);
  padding-top: 6px;
}
.section-title.sub {
  margin-top: 6px;
  margin-bottom: 2px;
}
.toggle-button {
  padding: 0;
  border: 0;
  background: transparent;
  color: #7fb1ff;
  cursor: pointer;
  font-size: 11px;
}
.tool-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.tool-chip {
  min-width: 44px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid rgba(157, 188, 224, 0.32);
  border-radius: 4px;
  background: rgba(46, 74, 112, 0.4);
  color: #c3d5e8;
  cursor: pointer;
  font-size: 11px;
}
.tool-chip.active {
  background: #2f80ed;
  border-color: #2f80ed;
  color: #eef4ff;
}
.tool-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.edit-status {
  margin-top: 6px;
  padding: 5px 7px;
  border-radius: 5px;
  background: rgba(47, 128, 237, 0.14);
  color: #a9c9f5;
  font-size: 11px;
  line-height: 1.5;
}
.close-confirm {
  margin-top: 6px;
  padding: 7px 8px;
  border: 1px solid rgba(255, 215, 106, 0.42);
  border-radius: 6px;
  background: rgba(120, 96, 26, 0.22);
}
.close-confirm-msg {
  font-size: 11px;
  line-height: 1.5;
  color: #ffd76a;
}
.object-list {
  max-height: 132px;
  overflow-y: auto;
  border: 1px solid rgba(157, 188, 224, 0.2);
  border-radius: 6px;
}
.object-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 8px;
  cursor: pointer;
  border-bottom: 1px solid rgba(157, 188, 224, 0.1);
}
.object-row:last-child {
  border-bottom: 0;
}
.object-row.active {
  background: rgba(47, 128, 237, 0.3);
}
.object-index {
  flex: 0 0 16px;
  color: #7f96b3;
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.object-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #dce8f5;
}
.object-count {
  flex: 0 0 auto;
  font-size: 10px;
  color: #9fb8d4;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.empty-tip {
  padding: 6px 0;
  color: #7f96b3;
  font-size: 11px;
}
.mini-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}
.mini-button {
  flex: 1;
  min-width: 60px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid rgba(157, 188, 224, 0.32);
  border-radius: 4px;
  background: rgba(46, 74, 112, 0.4);
  color: #c3d5e8;
  cursor: pointer;
  font-size: 11px;
}
.mini-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.mini-button.export {
  border-color: rgba(61, 214, 140, 0.4);
  color: #8be0b2;
}
.mini-button.danger-text {
  border-color: rgba(217, 96, 96, 0.4);
  color: #f2a1a1;
}
.mini-button.save {
  border-color: rgba(255, 215, 106, 0.5);
  color: #ffd76a;
  background: rgba(120, 96, 26, 0.3);
}
.mini-button.undo {
  border-color: rgba(127, 177, 255, 0.45);
  color: #a9c9f5;
  background: rgba(38, 70, 116, 0.35);
}
.mini-button.clear-text {
  flex: 0 0 auto;
  border-color: rgba(157, 188, 224, 0.22);
  color: #7f96b3;
}
.edit-status.subtle {
  margin-top: 6px;
  padding: 5px 7px;
  border-radius: 5px;
  background: rgba(255, 215, 106, 0.1);
  color: #cdb26b;
  font-size: 10px;
  line-height: 1.5;
}
.control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 3px 0;
}
.row-label {
  flex: 0 0 auto;
  color: #c3d5e8;
  font-size: 11px;
}
.row-value {
  flex: 0 0 34px;
  text-align: right;
  color: #9fb8d4;
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.control-row input[type='range'] {
  flex: 1;
  min-width: 0;
  accent-color: #2f80ed;
}
.control-row input[type='color'] {
  width: 40px;
  height: 24px;
  padding: 0;
  border: 1px solid rgba(157, 188, 224, 0.24);
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
}
.swatch-group {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}
.swatch {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
}
.swatch.active {
  border-color: #fff;
}
.button-row {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.action-button {
  flex: 1;
  height: 28px;
  border: 0;
  border-radius: 5px;
  cursor: pointer;
  font-size: 11px;
}
.action-button.primary {
  background: #2f80ed;
  color: #eef4ff;
}
.action-button.primary.disabled {
  opacity: 0.7;
  cursor: default;
}
.action-button.danger {
  background: #7a3b4a;
  color: #ffe3ea;
}
.action-button.danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.hint {
  margin-top: 8px;
  font-size: 11px;
  color: #7f96b3;
  line-height: 1.6;
}
.result-message {
  margin-top: 6px;
  font-size: 11px;
  color: #8be0b2;
  line-height: 1.5;
}
.drawing-tip {
  margin-top: 6px;
  font-size: 11px;
  color: #ffd76a;
  line-height: 1.5;
}
.status-mask {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9;
  width: max-content;
  max-width: 380px;
  padding: 8px 14px;
  border: 1px solid rgba(137, 210, 233, 0.4);
  border-radius: 7px;
  color: #e8f4fa;
  background: rgba(8, 21, 40, 0.88);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35);
  font-size: 12px;
  pointer-events: none;
  text-align: center;
  line-height: 1.5;
}
</style>
