<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch, shallowRef } from 'vue'
import {
  PolylineArrowMaterialProperty,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import {
  buildDrawColor,
  kindMeta,
  MilitaryPlottingSession,
  PLOTTING_KIND_META,
  type PlottingKind
} from '../military-plotting-lib'
import {
  PlotEditSession,
  type EditableObject,
  type EditorTool
} from '../military-plotting-lib/plot-edit/session'
import { PLOT_ENTITY_PREFIX } from '../military-plotting-lib/plot-edit/types'
import { AnnotationSession, type AnnotationListItem, type AnnotationTool } from './annotation-session'
import {
  defaultTextFields,
  defaultImageFields,
  defaultModelFields,
  IMAGE_PRESETS,
  MODEL_PRESETS,
  localModelToBlobUri,
  readFileAsDataUrl,
  type AnnotationFields,
  type AnnotationKind,
  type AnnotationObject,
  type ImageFields,
  type ModelFields,
  type TextFields
} from './annotation-types'
import {
  exportSituationGeojson,
  exportSituationShp
} from './export-controller'
import { CRS_LIST, type CRSId } from '../draw-export-lib/geo'

const props = defineProps<{
  title?: string
}>()

type ActiveMode = 'geometry' | 'text' | 'image' | 'model' | 'edit' | 'export'
type EditTab = 'geometry' | 'annotation'

const MODE_META: Array<{ value: ActiveMode; label: string }> = [
  { value: 'geometry', label: '几何标绘' },
  { value: 'text', label: '文本标注' },
  { value: 'image', label: '图片标注' },
  { value: 'model', label: '模型标注' },
  { value: 'edit', label: '编辑标注' },
  { value: 'export', label: '导出' }
]

const GEOMETRY_EDIT_TOOLS: Array<{ value: EditorTool; label: string }> = [
  { value: 'select', label: '选取' },
  { value: 'vertex', label: '顶点' },
  { value: 'move', label: '移动' },
  { value: 'rotate', label: '旋转' },
  { value: 'scale', label: '缩放' }
]

const ANNOTATION_EDIT_TOOLS: Array<{ value: AnnotationTool; label: string }> = [
  { value: 'select', label: '选取' },
  { value: 'move', label: '移动' },
  { value: 'rotate', label: '旋转' },
  { value: 'scale', label: '缩放' }
]

const PREVIEW_COLORS = ['#ff4d4f', '#ff8c00', '#ffd700', '#3dd68c', '#00ced1', '#2f8fff', '#c71585']

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const tipMessage = ref('')

const activeMode = ref<ActiveMode>('geometry')
const activeEditTab = ref<EditTab>('geometry')

const geometryKind = ref<PlottingKind>('free-polygon')
const strokeColor = ref('#ff4d4f')
const strokeAlpha = ref(0.85)
const geometryWidth = ref(8)
const edgeCount = ref(6)
const drawing = ref(false)

const geometryTool = ref<EditorTool>('select')
const annotationTool = ref<AnnotationTool>('select')
const geometryItems = ref<EditableObject[]>([])
const annotationItems = ref<AnnotationListItem[]>([])
const canUndoAnnotation = ref(false)
const canUndoGeometry = ref(false)

const selectedAnnotation = shallowRef<AnnotationObject | null>(null)
const selectedGeometryKey = ref('')
const selectedAnnotationKey = ref('')

const geometryMeta = computed(() => kindMeta(geometryKind.value))
const geometryKindOf = (kind: string): PlottingKind =>
  PLOTTING_KIND_META.some((meta) => meta.kind === (kind as PlottingKind))
    ? (kind as PlottingKind)
    : 'free-polygon'

const textEdit = reactive<TextFields>(defaultTextFields())
const imageEdit = reactive<ImageFields>(defaultImageFields())
const modelEdit = reactive<ModelFields>(defaultModelFields())

const selectedCrs = ref<CRSId>('wgs84')

let viewer: Viewer | undefined
let plotSession: MilitaryPlottingSession | undefined
let editor: PlotEditSession | undefined
let annotationSession: AnnotationSession | undefined
let revokeModelUrls: string[] = []
let suppressSync = false

const imageUploadInput = ref<HTMLInputElement | null>(null)
const modelUploadInput = ref<HTMLInputElement | null>(null)

function setCameraFree(active: boolean): void {
  const controller = viewer?.scene.screenSpaceCameraController
  if (!controller) return
  controller.enableRotate = active
  controller.enableTranslate = active
}

function freezeCameraForEditTools(): void {
  const lock =
    activeMode.value === 'edit' &&
    (activeEditTab.value === 'geometry'
      ? geometryTool.value === 'move' ||
        geometryTool.value === 'rotate' ||
        geometryTool.value === 'scale' ||
        geometryTool.value === 'vertex'
      : annotationTool.value === 'move' ||
        annotationTool.value === 'rotate' ||
        annotationTool.value === 'scale')
  setCameraFree(!lock)
}

function refreshGeometryItems(): void {
  if (!editor) return
  canUndoGeometry.value = !!editor.canUndo
  geometryItems.value = editor.objects
    .filter((o) => o.shape !== 'none')
    .map((o) => o)
  selectedGeometryKey.value = editor.selected()?.key ?? ''
}

function refreshAnnotationItems(): void {
  if (!annotationSession) return
  annotationItems.value = annotationSession.listItems()
  selectedAnnotationKey.value = annotationSession.selected()?.key ?? ''
  canUndoAnnotation.value = annotationSession.canUndo
}

function syncEverything(): void {
  editor?.sync()
  refreshGeometryItems()
  refreshAnnotationItems()
}

function selectGeometryObject(key: string): void {
  if (!editor) return
  editor.select(key)
  if (activeMode.value === 'edit' && activeEditTab.value === 'geometry') {
    const object = editor.objects.find((o) => o.key === key)
    tipMessage.value = object
      ? `已选中 ${object.name}，可通过左侧工具拖拽编辑`
      : ''
  }
  refreshGeometryItems()
}

function selectAnnotationObject(key: string): void {
  if (!annotationSession) return
  annotationSession.select(key)
  refreshAnnotationItems()
}

function removeSelectedGeometry(): void {
  const object = editor?.selected()
  if (!object) {
    tipMessage.value = '请先选中要删除的几何对象'
    return
  }
  editor?.removeObject(object.key)
  refreshGeometryItems()
}

function removeSelectedAnnotation(): void {
  const object = annotationSession?.selected()
  if (!object) {
    tipMessage.value = '请先选中要删除的标注对象'
    return
  }
  annotationSession?.removeObject(object.key)
  refreshAnnotationItems()
}

function clearGeometry(): void {
  if (!viewer || viewer.isDestroyed() || drawing.value) return
  let removed = 0
  const entities = viewer.entities.values.slice()
  for (const entity of entities) {
    const id = (entity as { id?: string }).id
    if (id && id.startsWith(PLOT_ENTITY_PREFIX)) {
      viewer.entities.removeById(id)
      removed += 1
    }
  }
  editor?.select(null)
  editor?.clearUndo()
  syncEverything()
  resultMessage.value = removed > 0 ? `已清除 ${removed} 个几何标绘对象` : '当前没有几何标绘对象'
}

function applyMode(next: ActiveMode): void {
  if (drawing.value) return
  activeMode.value = next
  resultMessage.value = ''
  tipMessage.value = ''

  editor?.setEnabled(false)
  annotationSession?.setPlacing(null)
  annotationSession?.setEditEnabled(false)
  syncEverything()

  if (next === 'geometry') {
    setCameraFree(true)
    tipMessage.value = `当前为「几何标绘」，选择标绘类型后可点击「开始绘制」`
  } else if (next === 'text' || next === 'image' || next === 'model') {
    setCameraFree(true)
    annotationSession?.setPlacing(next)
    tipMessage.value = `当前为「${MODE_META.find((m) => m.value === next)?.label ?? ''}放置模式」，在地图上点击即可放置；可连续放置多个`
  } else if (next === 'edit') {
    annotationSession?.setEditEnabled(true)
    editor?.setEnabled(true)
    syncEverything()
    selectedAnnotation.value = annotationSession?.selected() ?? null
    refreshSelectedPanel()
    activeEditTab.value = 'annotation'
    setAnnotationTool('select')
    tipMessage.value = '已进入编辑模式：可在两类对象之间切换，分别选取、移动、旋转、缩放并修改属性'
  } else {
    setCameraFree(true)
    tipMessage.value = '可选择坐标系并将当前所有几何与标注导出为 GeoJSON / SHP'
  }
}

function setGeometryKind(kind: PlottingKind): void {
  geometryKind.value = kind
  if (activeMode.value === 'geometry') refreshGeometryStyle()
}

function startGeometryDraw(): void {
  if (!viewer || viewer.isDestroyed() || !plotSession || plotSession.isDrawing) return
  if (!editor) editor = new PlotEditSession(viewer, {
    onStatus: (message) => {
      tipMessage.value = message
    },
    onObjectsChange: () => {
      refreshGeometryItems()
    },
    onSelectedChange: () => {
      selectedGeometryKey.value = editor?.selected()?.key ?? ''
    },
    onUndoChanged: () => {
      canUndoGeometry.value = !!editor?.canUndo
    }
  })
  editor.setEnabled(false)
  annotationSession?.setPlacing(null)
  annotationSession?.setEditEnabled(false)
  const color = buildDrawColor(strokeColor.value, strokeAlpha.value)
  const meta = kindMeta(geometryKind.value)
  const started = plotSession.startDraw(
    geometryKind.value,
    {
      color,
      width: meta.hasWidth ? Math.max(geometryWidth.value, 1) : undefined,
      num: meta.hasNum ? edgeCount.value : undefined
    },
    () => {
      drawing.value = false
      refreshGeometryItems()
      resultMessage.value = `已新增一个${meta.name}，可继续绘制或切换其他功能`
      if (!plotSession?.isDrawing) statusMessage.value = ''
    }
  )
  if (started) {
    drawing.value = true
    resultMessage.value = ''
    statusMessage.value = '绘制中…请用鼠标左键操作，右键结束当前标绘'
  }
}

function refreshGeometryStyle(): void {
  if (!viewer || viewer.isDestroyed()) return
  const color = buildDrawColor(strokeColor.value, strokeAlpha.value)
  const width = geometryMeta.value.hasWidth ? Math.max(geometryWidth.value, 1) : undefined
  const entities = viewer.entities.values.slice()
  for (const entity of entities) {
    const id = (entity as { id?: string }).id
    if (!id || !id.startsWith(PLOT_ENTITY_PREFIX)) continue
    const graphics = entity as unknown as {
      polygon?: { material?: unknown; outlineColor?: unknown }
      polyline?: { width?: unknown; material?: unknown }
    }
    if (graphics.polygon) {
      graphics.polygon.material = color
      graphics.polygon.outlineColor = color.withAlpha(1)
    }
    const line = graphics.polyline
    if (line) {
      if (typeof width === 'number' && width > 0) line.width = width
      const material = line.material
      if (material instanceof PolylineArrowMaterialProperty) {
        line.material = new PolylineArrowMaterialProperty(color)
      } else {
        line.material = color
      }
    }
  }
}

watch([strokeColor, strokeAlpha, geometryWidth], () => {
  if (!drawing.value) refreshGeometryStyle()
})

watch(drawing, (value) => {
  if (!value) {
    editor?.setEnabled(activeMode.value === 'edit')
    editor?.sync()
    syncEverything()
  }
})

function setGeometryTool(tool: EditorTool): void {
  geometryTool.value = tool
  editor?.setTool(tool)
  freezeCameraForEditTools()
}

function setAnnotationTool(tool: AnnotationTool): void {
  annotationTool.value = tool
  annotationSession?.setTool(tool)
  freezeCameraForEditTools()
}

function switchEditTab(tab: EditTab): void {
  if (activeEditTab.value === tab) return
  activeEditTab.value = tab
  if (tab === 'geometry') {
    editor?.select(null)
    refreshGeometryItems()
    setGeometryTool(geometryTool.value)
    tipMessage.value = '几何对象编辑：点选对象后可用顶点/移动/旋转/缩放工具整形，支持撤销'
  } else {
    annotationSession?.select(null)
    refreshAnnotationItems()
    setAnnotationTool(annotationTool.value)
    tipMessage.value = '标注对象编辑：点选标注后可用移动/旋转/缩放工具调整，属性面板可修改样式'
  }
}

function annotationEditTools(): Array<{ value: AnnotationTool; label: string; disabled?: boolean }> {
  const selected = selectedAnnotation.value
  return ANNOTATION_EDIT_TOOLS.map((t) => ({
    ...t,
    disabled: t.value === 'rotate' && selected?.kind === 'text'
  }))
}

function loadSelectedFieldsFor(object: AnnotationObject | null): void {
  selectedAnnotation.value = object
  suppressSync = true
  if (!object) {
    Object.assign(textEdit, defaultTextFields())
    Object.assign(imageEdit, defaultImageFields())
    Object.assign(modelEdit, defaultModelFields())
  } else if (object.kind === 'text') {
    Object.assign(textEdit, object.fields as TextFields)
  } else if (object.kind === 'image') {
    Object.assign(imageEdit, object.fields as ImageFields)
  } else {
    Object.assign(modelEdit, object.fields as ModelFields)
  }
  suppressSync = false
}

function refreshSelectedPanel(): void {
  const selected = annotationSession?.selected() ?? null
  loadSelectedFieldsFor(selected)
}

watch([textEdit, imageEdit, modelEdit], () => {
  if (suppressSync) return
  const selected = selectedAnnotation.value
  if (!selected || activeMode.value !== 'edit') return
  if (selected.kind === 'text') {
    annotationSession?.updateSelectedFields({ ...textEdit })
  } else if (selected.kind === 'image') {
    annotationSession?.updateSelectedFields({ ...imageEdit })
  } else {
    annotationSession?.updateSelectedFields({ ...modelEdit })
  }
})

watch(
  () => selectedAnnotation.value,
  () => {
    if (!selectedAnnotation.value && annotationItems.value.length > 0) {
      selectedAnnotationKey.value = ''
    }
  }
)

function currentGeometryExportList(): EditableObject[] {
  return (editor?.objects ?? []).filter((o) => o.shape !== 'none')
}

function exportInfo(): { geometry: number; annotation: number; total: number } {
  const geometry = geometryItems.value.filter((o) => o.shape !== 'none').length
  const annotation = annotationItems.value.length
  return { geometry, annotation, total: geometry + annotation }
}

async function exportGeojsonNow(): Promise<void> {
  if (!editor) {
    resultMessage.value = '尚未初始化场景'
    return
  }
  const geometryObjects = currentGeometryExportList().map((o) => {
    const kind = geometryKindOf(o.kind)
    return {
      id: o.key,
      kind,
      name: o.name,
      geoType: o.geoType,
      shape: o.shape as 'polygon' | 'polyline',
      points: editor?.readPoints(o) ?? []
    }
  })
  const annotations = annotationSession?.objects ?? []
  const summary = await exportSituationGeojson(geometryObjects, annotations, selectedCrs.value)
  resultMessage.value = summary.message
  if (summary.geometryCount !== undefined || summary.annotationCount !== undefined) {
    tipMessage.value = ''
  }
}

async function exportShpNow(): Promise<void> {
  if (!editor) {
    resultMessage.value = '尚未初始化场景'
    return
  }
  const geometryObjects = currentGeometryExportList().map((o) => {
    const kind = geometryKindOf(o.kind)
    return {
      id: o.key,
      kind,
      name: o.name,
      geoType: o.geoType,
      shape: o.shape as 'polygon' | 'polyline',
      points: editor?.readPoints(o) ?? []
    }
  })
  const annotations = annotationSession?.objects ?? []
  const summary = await exportSituationShp(geometryObjects, annotations, selectedCrs.value)
  resultMessage.value = summary.message
}

async function pickAnnotationImage(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const url = await readFileAsDataUrl(file)
    imageEdit.source = url
    annotationSession?.updateSelectedFields({ source: url })
    tipMessage.value = '图片已载入，可直接在地图上放置'
  } catch {
    tipMessage.value = '图片读取失败，请更换图片后重试'
  }
}

function pickPresetImage(presetId: string): void {
  const preset = IMAGE_PRESETS.find((p) => p.id === presetId)
  if (!preset) return
  imageEdit.source = preset.url
  annotationSession?.updateSelectedFields({ source: preset.url })
}

async function pickModelFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = input.files
  input.value = ''
  if (!files || files.length === 0) return
  for (const url of revokeModelUrls) URL.revokeObjectURL(url)
  revokeModelUrls = []
  try {
    const result = await localModelToBlobUri(Array.from(files))
    if (!result) {
      tipMessage.value = '未找到 .glb/.gltf 主文件，请重新选择'
      return
    }
    revokeModelUrls = result.revokeUrls
    modelEdit.uri = result.uri
    annotationSession?.updateSelectedFields({ uri: result.uri })
    tipMessage.value = '本地模型已载入，可直接在地图上放置'
  } catch (error) {
    tipMessage.value = `模型解析失败：${error instanceof Error ? error.message : String(error)}`
  }
}

function pickPresetModel(presetId: string): void {
  const preset = MODEL_PRESETS.find((p) => p.id === presetId)
  if (!preset) return
  modelEdit.uri = preset.uri
  annotationSession?.updateSelectedFields({ uri: preset.uri })
}

function revokeLocalModelUrls(): void {
  for (const url of revokeModelUrls) URL.revokeObjectURL(url)
  revokeModelUrls = []
}

function disposeAll(): void {
  drawing.value = false
  editor?.destroy()
  editor = undefined
  annotationSession?.destroy()
  annotationSession = undefined
  plotSession = undefined
  revokeLocalModelUrls()
  destroyScene(viewer)
  viewer = undefined
}

function geometryListDisplay(): Array<EditableObject & { order: number; pointCount: number }> {
  return geometryItems.value.map((o, index) => ({
    ...o,
    order: index + 1,
    pointCount: editor?.readPoints(o).length ?? 0
  }))
}

function isPlacingAnnotation(): boolean {
  return activeMode.value === 'text' || activeMode.value === 'image' || activeMode.value === 'model'
}

function currentModeTitle(): string {
  return MODE_META.find((m) => m.value === activeMode.value)?.label ?? ''
}

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
    plotSession = new MilitaryPlottingSession(viewer)
    editor = new PlotEditSession(viewer, {
      onStatus: (message) => {
        tipMessage.value = message
      },
      onObjectsChange: () => {
        refreshGeometryItems()
      },
      onSelectedChange: () => {
        selectedGeometryKey.value = editor?.selected()?.key ?? ''
      },
      onUndoChanged: () => {
        canUndoGeometry.value = !!editor?.canUndo
      }
    })
    annotationSession = new AnnotationSession(viewer, {
      onStatus: (message) => {
        tipMessage.value = message
      },
      onObjectsChange: () => {
        refreshAnnotationItems()
      },
      onSelectedChange: () => {
        refreshSelectedPanel()
        refreshAnnotationItems()
      },
      onUndoChanged: () => {
        canUndoAnnotation.value = !!annotationSession?.canUndo
      },
      getPlacementFields: (kind: AnnotationKind): AnnotationFields | null => {
        if (kind === 'text') {
          if (!textEdit.content.trim()) {
            tipMessage.value = '请先填写文本内容'
            return null
          }
          return { ...textEdit }
        }
        if (kind === 'image') {
          if (!imageEdit.source) {
            tipMessage.value = '请先选择或上传图片'
            return null
          }
          return { ...imageEdit }
        }
        if (!modelEdit.uri) {
          tipMessage.value = '请先选择或上传模型'
          return null
        }
        return { ...modelEdit }
      }
    })
    applyMode('geometry')
    tipMessage.value = '已就绪：选择标绘类型后点击「开始绘制」，或用三类标注在地图上点选放置'
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposeAll()
})
</script>

<template>
  <div class="situation-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">{{ props.title ?? '综合态势标绘控件' }}</div>

      <div class="mode-row">
        <button
          v-for="m in MODE_META"
          :key="m.value"
          class="mode-chip"
          :class="{ active: activeMode === m.value }"
          :disabled="drawing"
          @click="applyMode(m.value)"
        >
          {{ m.label }}
        </button>
      </div>

      <template v-if="activeMode === 'geometry'">
        <div class="section-title">标绘类型</div>
        <div class="select-wrap">
          <select v-model="geometryKind" class="kind-select" @change="setGeometryKind(geometryKind)">
            <option v-for="meta in PLOTTING_KIND_META" :key="meta.kind" :value="meta.kind">
              {{ meta.name }}
            </option>
          </select>
        </div>
        <div class="mini-actions">
          <button
            class="mini-button primary"
            :class="{ disabled: drawing }"
            :disabled="drawing"
            @click="startGeometryDraw"
          >
            {{ drawing ? '绘制中…' : '开始绘制' }}
          </button>
          <button class="mini-button danger-text" :disabled="drawing" @click="clearGeometry">
            清除几何
          </button>
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
        <div v-if="geometryMeta.hasWidth" class="control-row">
          <span class="row-label">线宽</span>
          <input v-model.number="geometryWidth" type="range" min="1" max="30" step="1" />
          <span class="row-value">{{ geometryWidth }}</span>
        </div>
        <div v-if="geometryMeta.hasNum" class="control-row">
          <span class="row-label">边数</span>
          <input v-model.number="edgeCount" type="range" min="3" max="12" step="1" />
          <span class="row-value">{{ edgeCount }}</span>
        </div>
      </template>

      <template v-else-if="activeMode === 'text'">
        <div class="section-title">文本标注内容</div>
        <textarea v-model="textEdit.content" class="content-input" rows="2" maxlength="120"></textarea>
        <div class="control-row">
          <span class="row-label">字号</span>
          <input v-model.number="textEdit.fontSize" type="range" min="8" max="96" step="1" />
          <span class="row-value">{{ textEdit.fontSize }}</span>
        </div>
        <div class="control-row">
          <span class="row-label">文字颜色</span>
          <div class="swatch-group">
            <button
              v-for="c in ['#ffffff', '#0b0f1a', '#ffd700', '#3dd68c', '#2f8fff']"
              :key="c"
              class="swatch"
              :style="{ background: c }"
              :class="{ active: c === textEdit.color }"
              @click="textEdit.color = c"
            ></button>
            <input v-model="textEdit.color" type="color" class="color-input" />
          </div>
        </div>
        <div class="control-row">
          <span class="row-label">文字描边</span>
          <input v-model.number="textEdit.outlineWidth" type="range" min="0" max="5" step="1" />
          <span class="row-value">{{ textEdit.outlineWidth }}</span>
        </div>
        <div class="control-row">
          <span class="row-label">底色背景</span>
          <input v-model="textEdit.showBackground" type="checkbox" class="checkbox-input" />
          <input
            v-if="textEdit.showBackground"
            v-model="textEdit.backgroundColor"
            type="color"
            class="color-input"
          />
        </div>
        <div class="control-row">
          <span class="row-label">偏移X</span>
          <input v-model.number="textEdit.pixelOffsetX" type="range" min="-120" max="120" step="1" />
          <span class="row-value">{{ textEdit.pixelOffsetX }}</span>
        </div>
        <div class="control-row">
          <span class="row-label">偏移Y</span>
          <input v-model.number="textEdit.pixelOffsetY" type="range" min="-120" max="120" step="1" />
          <span class="row-value">{{ textEdit.pixelOffsetY }}</span>
        </div>
      </template>

      <template v-else-if="activeMode === 'image'">
        <div class="section-title">预设图标</div>
        <div class="preset-grid">
          <button
            v-for="preset in IMAGE_PRESETS"
            :key="preset.id"
            class="preset-item"
            :class="{ active: imageEdit.source === preset.url }"
            @click="pickPresetImage(preset.id)"
          >
            <img :src="preset.url" alt="" class="preset-thumb" />
            <span>{{ preset.name }}</span>
          </button>
        </div>
        <div class="section-title">图片来源（URL / 本地上传）</div>
        <input v-model="imageEdit.source" type="url" class="text-input" placeholder="输入图片 URL" />
        <div class="mini-actions">
          <button class="mini-button" @click="imageUploadInput?.click()">本地上传图片</button>
        </div>
        <div class="control-row">
          <span class="row-label">缩放</span>
          <input v-model.number="imageEdit.scale" type="range" min="0.1" max="10" step="0.1" />
          <span class="row-value">{{ imageEdit.scale.toFixed(1) }}</span>
        </div>
        <div class="control-row">
          <span class="row-label">旋转</span>
          <input v-model.number="imageEdit.rotation" type="range" min="0" max="360" step="1" />
          <span class="row-value">{{ imageEdit.rotation }}</span>
        </div>
        <div class="control-row">
          <span class="row-label">透明度</span>
          <input v-model.number="imageEdit.opacity" type="range" min="0.1" max="1" step="0.05" />
          <span class="row-value">{{ imageEdit.opacity.toFixed(2) }}</span>
        </div>
      </template>

      <template v-else-if="activeMode === 'model'">
        <div class="section-title">内置模型</div>
        <div class="preset-grid">
          <button
            v-for="preset in MODEL_PRESETS"
            :key="preset.id"
            class="preset-item"
            :class="{ active: modelEdit.uri === preset.uri }"
            @click="pickPresetModel(preset.id)"
          >
            <span>{{ preset.name }}</span>
          </button>
        </div>
        <div class="section-title">模型来源（URL / 本地 .glb/.gltf）</div>
        <input v-model="modelEdit.uri" type="url" class="text-input" placeholder="输入 glTF 模型 URL" />
        <div class="mini-actions">
          <button class="mini-button" @click="modelUploadInput?.click()">本地上传模型</button>
        </div>
        <div class="hint">GLTF 若引用外部纹理/缓冲，请与主文件一并选中（多文件）。</div>
        <div class="control-row">
          <span class="row-label">缩放</span>
          <input v-model.number="modelEdit.scale" type="range" min="0.1" max="50" step="0.1" />
          <span class="row-value">{{ modelEdit.scale.toFixed(1) }}</span>
        </div>
        <div class="control-row">
          <span class="row-label">离地高度</span>
          <input v-model.number="modelEdit.height" type="range" min="0" max="2000" step="10" />
          <span class="row-value">{{ modelEdit.height }}</span>
        </div>
        <div class="control-row">
          <span class="row-label">朝向</span>
          <input v-model.number="modelEdit.heading" type="range" min="0" max="360" step="1" />
          <span class="row-value">{{ modelEdit.heading }}</span>
        </div>
      </template>

      <template v-else-if="activeMode === 'edit'">
        <div class="seg-row">
          <button
            class="seg-chip"
            :class="{ active: activeEditTab === 'geometry' }"
            @click="switchEditTab('geometry')"
          >
            几何对象
          </button>
          <button
            class="seg-chip"
            :class="{ active: activeEditTab === 'annotation' }"
            @click="switchEditTab('annotation')"
          >
            标注对象
          </button>
        </div>

        <template v-if="activeEditTab === 'geometry'">
          <div class="section-title sub">编辑工具</div>
          <div class="tool-chip-row">
            <button
              v-for="tool in GEOMETRY_EDIT_TOOLS"
              :key="tool.value"
              class="tool-chip"
              :class="{ active: geometryTool === tool.value }"
              @click="setGeometryTool(tool.value)"
            >
              {{ tool.label }}
            </button>
          </div>
          <div class="section-title sub">对象列表（点击选中）</div>
          <div v-if="geometryItems.length === 0" class="empty-tip">暂无已绘几何对象</div>
          <div v-else class="object-list">
            <div
              v-for="item in geometryListDisplay()"
              :key="item.key"
              class="object-row"
              :class="{ active: selectedGeometryKey === item.key }"
              @click="selectGeometryObject(item.key)"
            >
              <span class="object-index">{{ item.order }}</span>
              <span class="object-name">{{ item.name }}</span>
              <span class="object-count">{{ item.pointCount }}</span>
            </div>
          </div>
          <div class="mini-actions">
            <button
              class="mini-button danger-text"
              :disabled="!selectedGeometryKey"
              @click="removeSelectedGeometry"
            >
              删除选中
            </button>
            <button class="mini-button undo" :disabled="!canUndoGeometry" @click="editor?.undo(); refreshGeometryItems()">
              撤销
            </button>
          </div>
        </template>

        <template v-else>
          <div class="section-title sub">编辑工具</div>
          <div class="tool-chip-row">
            <button
              v-for="tool in annotationEditTools()"
              :key="tool.value"
              class="tool-chip"
              :class="{ active: annotationTool === tool.value }"
              :disabled="tool.disabled"
              @click="setAnnotationTool(tool.value)"
            >
              {{ tool.label }}
            </button>
          </div>
          <div class="section-title sub">标注列表（点击选中）</div>
          <div v-if="annotationItems.length === 0" class="empty-tip">暂无已放置标注</div>
          <div v-else class="object-list">
            <div
              v-for="item in annotationItems"
              :key="item.key"
              class="object-row"
              :class="{ active: selectedAnnotationKey === item.key }"
              @click="selectAnnotationObject(item.key)"
            >
              <span class="object-index">{{ item.kindLabel.slice(0, 1) }}</span>
              <span class="object-name">{{ item.name }}</span>
              <span class="object-count">{{ item.positionLabel }}</span>
            </div>
          </div>
          <div class="mini-actions">
            <button
              class="mini-button danger-text"
              :disabled="!selectedAnnotationKey"
              @click="removeSelectedAnnotation"
            >
              删除选中
            </button>
            <button class="mini-button undo" :disabled="!canUndoAnnotation" @click="annotationSession?.undo(); refreshAnnotationItems()">
              撤销
            </button>
          </div>

          <template v-if="selectedAnnotation">
            <div class="section-title sub">属性面板（实时生效）</div>
            <template v-if="selectedAnnotation.kind === 'text'">
              <textarea v-model="textEdit.content" class="content-input" rows="2" maxlength="120"></textarea>
              <div class="control-row">
                <span class="row-label">字号</span>
                <input v-model.number="textEdit.fontSize" type="range" min="8" max="96" step="1" />
                <span class="row-value">{{ textEdit.fontSize }}</span>
              </div>
              <div class="control-row">
                <span class="row-label">文字颜色</span>
                <input v-model="textEdit.color" type="color" class="color-input" />
              </div>
              <div class="control-row">
                <span class="row-label">描边宽度</span>
                <input v-model.number="textEdit.outlineWidth" type="range" min="0" max="5" step="1" />
                <span class="row-value">{{ textEdit.outlineWidth }}</span>
              </div>
              <div class="control-row">
                <span class="row-label">底色背景</span>
                <input v-model="textEdit.showBackground" type="checkbox" class="checkbox-input" />
                <input
                  v-if="textEdit.showBackground"
                  v-model="textEdit.backgroundColor"
                  type="color"
                  class="color-input"
                />
              </div>
              <div class="control-row">
                <span class="row-label">偏移X</span>
                <input v-model.number="textEdit.pixelOffsetX" type="range" min="-120" max="120" step="1" />
                <span class="row-value">{{ textEdit.pixelOffsetX }}</span>
              </div>
              <div class="control-row">
                <span class="row-label">偏移Y</span>
                <input v-model.number="textEdit.pixelOffsetY" type="range" min="-120" max="120" step="1" />
                <span class="row-value">{{ textEdit.pixelOffsetY }}</span>
              </div>
            </template>
            <template v-else-if="selectedAnnotation.kind === 'image'">
              <div class="control-row">
                <span class="row-label">缩放</span>
                <input v-model.number="imageEdit.scale" type="range" min="0.05" max="30" step="0.05" />
                <span class="row-value">{{ imageEdit.scale.toFixed(2) }}</span>
              </div>
              <div class="control-row">
                <span class="row-label">旋转</span>
                <input v-model.number="imageEdit.rotation" type="range" min="0" max="360" step="1" />
                <span class="row-value">{{ imageEdit.rotation }}</span>
              </div>
              <div class="control-row">
                <span class="row-label">透明度</span>
                <input v-model.number="imageEdit.opacity" type="range" min="0.1" max="1" step="0.05" />
                <span class="row-value">{{ imageEdit.opacity.toFixed(2) }}</span>
              </div>
            </template>
            <template v-else>
              <div class="control-row">
                <span class="row-label">缩放</span>
                <input v-model.number="modelEdit.scale" type="range" min="0.01" max="1000" step="0.01" />
                <span class="row-value">{{ modelEdit.scale }}</span>
              </div>
              <div class="control-row">
                <span class="row-label">离地高度</span>
                <input v-model.number="modelEdit.height" type="range" min="0" max="2000" step="10" />
                <span class="row-value">{{ modelEdit.height }}</span>
              </div>
              <div class="control-row">
                <span class="row-label">朝向</span>
                <input v-model.number="modelEdit.heading" type="range" min="0" max="360" step="1" />
                <span class="row-value">{{ modelEdit.heading }}</span>
              </div>
            </template>
          </template>
        </template>
      </template>

      <template v-else-if="activeMode === 'export'">
        <div class="section-title">导出坐标系</div>
        <div class="select-wrap">
          <select v-model="selectedCrs" class="kind-select">
            <option v-for="crs in CRS_LIST" :key="crs.id" :value="crs.id">
              {{ crs.label }}
            </option>
          </select>
        </div>
        <div class="control-row">
          <span class="row-label">对象统计</span>
          <span class="row-value wide">
            几何 {{ exportInfo().geometry }} / 标注 {{ exportInfo().annotation }}
          </span>
        </div>
        <div class="mini-actions">
          <button
            class="mini-button export"
            :disabled="exportInfo().total === 0"
            @click="exportGeojsonNow"
          >
            导出 GeoJSON
          </button>
          <button
            class="mini-button export"
            :disabled="exportInfo().total === 0"
            @click="exportShpNow"
          >
            导出 SHP
          </button>
        </div>
        <div class="hint">几何对象将输出为面/线要素，标注对象输出为点要素（含名称、类型、样式等属性字段）。</div>
      </template>

      <div v-if="tipMessage" class="hint">{{ tipMessage }}</div>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
      <div v-if="drawing" class="drawing-tip">当前绘制进行中，请在场景中操作</div>
      <div v-if="isPlacingAnnotation()" class="drawing-tip">
        当前为「{{ currentModeTitle() }}放置」状态，请在地图上点击放置
      </div>
    </div>

    <input
      ref="imageUploadInput"
      type="file"
      accept="image/*"
      style="display: none"
      @change="pickAnnotationImage"
    />
    <input
      ref="modelUploadInput"
      type="file"
      accept=".glb,.gltf,model/gltf-binary"
      multiple
      style="display: none"
      @change="pickModelFile"
    />

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.situation-shell {
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
  width: 292px;
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
.mode-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 6px;
}
.mode-chip {
  height: 24px;
  padding: 0 8px;
  border: 1px solid rgba(157, 188, 224, 0.32);
  border-radius: 4px;
  background: rgba(46, 74, 112, 0.4);
  color: #c3d5e8;
  cursor: pointer;
  font-size: 11px;
}
.mode-chip.active {
  background: #2f80ed;
  border-color: #2f80ed;
  color: #eef4ff;
}
.mode-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.seg-row {
  display: flex;
  gap: 6px;
}
.seg-chip {
  flex: 1;
  height: 26px;
  border: 1px solid rgba(157, 188, 224, 0.32);
  border-radius: 4px;
  background: rgba(46, 74, 112, 0.4);
  color: #c3d5e8;
  cursor: pointer;
  font-size: 11px;
}
.seg-chip.active {
  background: #2f80ed;
  border-color: #2f80ed;
  color: #eef4ff;
}
.section-title {
  margin-top: 8px;
  margin-bottom: 4px;
  font-size: 11px;
  color: #8ea5c2;
}
.section-title.sub {
  margin-top: 6px;
  margin-bottom: 2px;
}
.select-wrap {
  margin: 2px 0 6px;
}
.kind-select {
  width: 100%;
  height: 26px;
  padding: 0 6px;
  border: 1px solid rgba(157, 188, 224, 0.32);
  border-radius: 4px;
  background: rgba(18, 38, 68, 0.92);
  color: #dce8f5;
  font-size: 11px;
}
.text-input {
  width: 100%;
  height: 26px;
  padding: 0 6px;
  border: 1px solid rgba(157, 188, 224, 0.32);
  border-radius: 4px;
  background: rgba(18, 38, 68, 0.92);
  color: #dce8f5;
  font-size: 11px;
  box-sizing: border-box;
}
.content-input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 6px;
  border: 1px solid rgba(157, 188, 224, 0.32);
  border-radius: 4px;
  background: rgba(18, 38, 68, 0.92);
  color: #dce8f5;
  font-size: 11px;
  line-height: 1.5;
  resize: vertical;
  font-family: inherit;
}
.checkbox-input {
  width: 16px;
  height: 16px;
  accent-color: #2f80ed;
}
.tool-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.tool-chip {
  min-width: 40px;
  height: 24px;
  padding: 0 7px;
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
  opacity: 0.45;
  cursor: not-allowed;
}
.preset-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
  margin-bottom: 2px;
}
.preset-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 5px 2px;
  border: 1px solid rgba(157, 188, 224, 0.3);
  border-radius: 5px;
  background: rgba(46, 74, 112, 0.3);
  color: #c3d5e8;
  cursor: pointer;
  font-size: 10px;
}
.preset-item.active {
  border-color: #2f80ed;
  background: rgba(47, 128, 237, 0.35);
  color: #eef4ff;
}
.preset-thumb {
  width: 26px;
  height: 26px;
  object-fit: contain;
}
.object-list {
  max-height: 140px;
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
.mini-button.primary {
  border-color: rgba(47, 128, 237, 0.6);
  background: rgba(47, 128, 237, 0.35);
  color: #dceeff;
}
.mini-button.primary.disabled {
  opacity: 0.6;
}
.mini-button.export {
  border-color: rgba(61, 214, 140, 0.4);
  color: #8be0b2;
}
.mini-button.danger-text {
  border-color: rgba(217, 96, 96, 0.4);
  color: #f2a1a1;
}
.mini-button.undo {
  border-color: rgba(127, 177, 255, 0.45);
  color: #a9c9f5;
  background: rgba(38, 70, 116, 0.35);
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
.row-value.wide {
  flex: 0 0 auto;
  max-width: 120px;
  text-align: right;
  white-space: nowrap;
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
