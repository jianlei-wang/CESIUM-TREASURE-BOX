<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Cartesian2, Cartesian3, Color, type Viewer } from 'cesium'
import { LayerTreeControl } from './layer-tree-control'
import type { FlatRow } from './layer-tree-model'
import type { ContextMenuItem, LayerAddPreset, LayerConfig, LayerTreeOptions, LayerTreeNode, StyleField } from './types'
import { LayerType } from './types'
import LayerTypeIcon from './LayerTypeIcon.vue'

const props = withDefaults(
  defineProps<{
    viewer?: Viewer | null
    title?: string
    options?: LayerTreeOptions
    presets?: LayerAddPreset[]
    defaultCollapsed?: boolean
  }>(),
  {
    viewer: null,
    title: '图层管理',
    options: () => ({}),
    presets: () => [],
    defaultCollapsed: false
  }
)

const emit = defineEmits<{ ready: [control: LayerTreeControl] }>()

const control = shallowRef<LayerTreeControl | null>(null)
const revision = ref(0)
const keyword = ref('')
const collapsed = ref(props.defaultCollapsed)
const hoverId = ref('')
const activeOpacityId = ref('')
const editingId = ref('')
const editingName = ref('')
const renameInput = ref<HTMLInputElement | null>(null)
const rootEl = ref<HTMLElement | null>(null)

interface MenuState {
  x: number
  y: number
  node: LayerTreeNode
  items: ContextMenuItem[]
}
const contextMenu = ref<MenuState | null>(null)

interface DropState {
  id: string
  position: 'before' | 'after' | 'inside'
}
const dragId = ref('')
const dropTarget = ref<DropState | null>(null)

const settingsOpen = ref(false)
const usageOpen = ref(false)

const addParentId = ref<string | null>(null)
const pickerOpen = ref(false)

const formOpen = ref(false)
const formType = ref<LayerType | ''>('')
const formValue = ref<Record<string, any>>({})
const formError = ref('')

const styleNode = ref<LayerTreeNode | null>(null)
const styleFields = ref<StyleField[]>([])
const styleValues = ref<Record<string, any>>({})

interface InfoDialog {
  title: string
  subtitle?: string
  entries: Array<{ label: string; value: string }>
}
const infoDialog = ref<InfoDialog | null>(null)

const confirmNode = ref<LayerTreeNode | null>(null)
const exaggerationOpen = ref(false)
const exaggeration = ref(1)

const themeClass = computed(() => `lt-theme-${props.options.theme ?? 'dark'}`)

const model = computed(() => control.value?.model ?? null)

const flatRows = computed<FlatRow[]>(() => {
  revision.value
  return control.value ? control.value.model.getFlatRows() : []
})

const rows = computed<FlatRow[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  const list = flatRows.value
  if (!kw) return list
  const current = control.value?.model
  const keep = new Set<string>()
  for (const row of list) {
    if (row.node.name.toLowerCase().includes(kw)) {
      keep.add(row.node.id)
      let parent = row.node.parentId
      while (parent && current) {
        keep.add(parent)
        parent = current.findNode(parent)?.parentId ?? null
      }
    }
  }
  return list.filter((row) => keep.has(row.node.id))
})

const stats = computed(() => {
  revision.value
  return control.value?.getStats() ?? { total: 0, visible: 0, selected: 0, loading: 0 }
})

const allExpanded = computed(() => {
  revision.value
  const groups = model.value?.findByType(LayerType.GROUP) ?? []
  return groups.length > 0 && groups.every((node) => node.expanded)
})

const quickPresets = computed<LayerAddPreset[]>(() => props.presets)

interface FormFieldDef {
  key: string
  label: string
  kind: 'text' | 'number' | 'color' | 'select'
  options?: Array<{ label: string; value: string }>
}
interface AddTypeDef {
  type: LayerType
  label: string
  hint: string
  fields: FormFieldDef[]
}

const ADD_TYPE_DEFS: AddTypeDef[] = [
  {
    type: LayerType.IMAGERY,
    label: '影像图层',
    hint: 'ImageryProvider',
    fields: [
      {
        key: 'providerType',
        label: '服务类型',
        kind: 'select',
        options: [
          { label: 'UrlTemplate', value: 'UrlTemplate' },
          { label: 'WMS', value: 'WMS' },
          { label: 'WMTS', value: 'WMTS' },
          { label: 'TMS', value: 'TMS' },
          { label: 'OSM', value: 'OSM' },
          { label: 'ArcGIS', value: 'ArcGisMapServer' },
          { label: 'SingleTile', value: 'SingleTile' },
          { label: 'Grid', value: 'Grid' },
          { label: 'Ion 资产', value: 'Ion' }
        ]
      },
      { key: 'url', label: '服务地址 URL', kind: 'text' },
      { key: 'assetId', label: 'Ion 资产 ID', kind: 'number' }
    ]
  },
  {
    type: LayerType.TERRAIN,
    label: '地形图层',
    hint: 'TerrainProvider',
    fields: [
      {
        key: 'providerType',
        label: '地形类型',
        kind: 'select',
        options: [
          { label: '全球地形 (Cesium World)', value: 'world' },
          { label: '椭球体 (Ellipsoid)', value: 'ellipsoid' },
          { label: 'Cesium Terrain', value: 'cesium' },
          { label: 'ArcGIS Terrain', value: 'arcgis' }
        ]
      },
      { key: 'url', label: '地形服务 URL', kind: 'text' }
    ]
  },
  {
    type: LayerType.TILESET,
    label: '3D Tiles',
    hint: 'Cesium3DTileset',
    fields: [
      { key: 'url', label: 'tileset.json URL', kind: 'text' },
      { key: 'ionAssetId', label: 'Ion 资产 ID', kind: 'number' },
      { key: 'maximumScreenSpaceError', label: '屏幕空间误差', kind: 'number' }
    ]
  },
  {
    type: LayerType.DATASOURCE,
    label: '数据源',
    hint: 'GeoJSON / KML / CZML',
    fields: [
      {
        key: 'format',
        label: '数据格式',
        kind: 'select',
        options: [
          { label: 'GeoJSON', value: 'geojson' },
          { label: 'KML', value: 'kml' },
          { label: 'CZML', value: 'czml' },
          { label: '自定义', value: 'custom' }
        ]
      },
      { key: 'url', label: '数据地址 URL', kind: 'text' }
    ]
  },
  {
    type: LayerType.ENTITY,
    label: '实体',
    hint: 'Entity',
    fields: [
      { key: 'lon', label: '经度', kind: 'number' },
      { key: 'lat', label: '纬度', kind: 'number' },
      { key: 'height', label: '高度 (米)', kind: 'number' },
      { key: 'color', label: '点颜色', kind: 'color' },
      { key: 'labelText', label: '标签文本', kind: 'text' }
    ]
  },
  {
    type: LayerType.PRIMITIVE,
    label: '图元',
    hint: 'Primitive',
    fields: [
      {
        key: 'primitiveType',
        label: '图元类型',
        kind: 'select',
        options: [
          { label: '点', value: 'point' },
          { label: '标签', value: 'label' },
          { label: '广告牌', value: 'billboard' },
          { label: '墙', value: 'wall' }
        ]
      },
      { key: 'lon', label: '经度', kind: 'number' },
      { key: 'lat', label: '纬度', kind: 'number' },
      { key: 'height', label: '高度 (米)', kind: 'number' },
      { key: 'color', label: '颜色', kind: 'color' },
      { key: 'text', label: '文本', kind: 'text' },
      { key: 'pixelSize', label: '点大小', kind: 'number' }
    ]
  },
  {
    type: LayerType.MODEL,
    label: '模型',
    hint: 'glTF / GLB',
    fields: [
      { key: 'url', label: '模型 URL', kind: 'text' },
      { key: 'lon', label: '经度', kind: 'number' },
      { key: 'lat', label: '纬度', kind: 'number' },
      { key: 'height', label: '高度 (米)', kind: 'number' },
      { key: 'heading', label: '朝向 (度)', kind: 'number' },
      { key: 'scale', label: '缩放', kind: 'number' }
    ]
  },
  {
    type: LayerType.PARTICLE,
    label: '粒子',
    hint: 'ParticleSystem',
    fields: [
      { key: 'lon', label: '经度', kind: 'number' },
      { key: 'lat', label: '纬度', kind: 'number' },
      { key: 'height', label: '高度 (米)', kind: 'number' },
      { key: 'color', label: '起始颜色', kind: 'color' },
      { key: 'endColor', label: '结束颜色', kind: 'color' }
    ]
  },
  {
    type: LayerType.GROUP,
    label: '图层组',
    hint: 'Group',
    fields: []
  }
]

const currentTypeDef = computed(() => ADD_TYPE_DEFS.find((def) => def.type === formType.value) ?? null)

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function defaultForm(type: LayerType): Record<string, unknown> {
  const base: Record<string, unknown> = { name: '' }
  switch (type) {
    case LayerType.IMAGERY:
      return { ...base, providerType: 'UrlTemplate', url: '', assetId: '' }
    case LayerType.TERRAIN:
      return { ...base, providerType: 'world', url: '' }
    case LayerType.TILESET:
      return { ...base, url: '', ionAssetId: '', maximumScreenSpaceError: 16 }
    case LayerType.DATASOURCE:
      return { ...base, format: 'geojson', url: '' }
    case LayerType.ENTITY:
      return { ...base, lon: 116.3974, lat: 39.9093, height: 0, color: '#ffd166', labelText: '' }
    case LayerType.PRIMITIVE:
      return { ...base, primitiveType: 'point', lon: 116.3974, lat: 39.9093, height: 0, color: '#3fd0ff', text: '', pixelSize: 10 }
    case LayerType.MODEL:
      return { ...base, url: '', lon: 116.3974, lat: 39.9093, height: 0, heading: 0, scale: 1 }
    case LayerType.PARTICLE:
      return { ...base, lon: 116.3974, lat: 39.9093, height: 120, color: '#ffe08a', endColor: '#ff6b3d' }
    default:
      return base
  }
}

function bump(): void {
  revision.value += 1
}

function setupControl(viewer: Viewer | null | undefined): void {
  control.value?.destroy()
  control.value = null
  if (!viewer) return
  const instance = new LayerTreeControl(viewer, props.options)
  instance.on('tree:change', bump)
  instance.on('contextmenu:action', ({ menuId, node }) => handleAction(menuId, node))
  control.value = instance
  emit('ready', instance)
}

onMounted(() => setupControl(props.viewer))

watch(
  () => props.viewer,
  (viewer) => setupControl(viewer)
)

onBeforeUnmount(() => {
  control.value?.destroy()
  control.value = null
})

// ---------------------------------------------------------------- 展示信息

function typeTag(node: LayerTreeNode): string {
  switch (node.type) {
    case LayerType.GROUP:
      return 'GROUP'
    case LayerType.IMAGERY:
      return String(node.config.imagery?.providerType ?? 'IMAGE').toUpperCase()
    case LayerType.TERRAIN:
      return 'TERRAIN'
    case LayerType.TILESET:
      return '3DTILES'
    case LayerType.DATASOURCE:
      return String(node.config.datasource?.format ?? 'DATA').toUpperCase()
    case LayerType.ENTITY:
      return 'ENTITY'
    case LayerType.PRIMITIVE:
      return 'PRIMITIVE'
    case LayerType.MODEL:
      return 'MODEL'
    case LayerType.PARTICLE:
      return 'PARTICLE'
    default:
      return String(node.type).toUpperCase()
  }
}

function typeColor(node: LayerTreeNode): string {
  return control.value?.getTypeColor(node.type) ?? '#8aa4c8'
}

function visibilityState(node: LayerTreeNode): string {
  revision.value
  return model.value?.getVisibilityState(node.id) ?? 'unchecked'
}

function isSelected(node: LayerTreeNode): boolean {
  revision.value
  return node.selected
}

function hasOpacity(node: LayerTreeNode): boolean {
  if (props.options.enableOpacity === false) return false
  const adapter = control.value?.getAdapter(node.type)
  return !!adapter?.setOpacity && [LayerType.IMAGERY, LayerType.TILESET, LayerType.MODEL, LayerType.PRIMITIVE].includes(node.type)
}

function highlight(name: string): string {
  const kw = keyword.value.trim()
  if (!kw) return LayerTreeControl.escapeHtml(name)
  const index = name.toLowerCase().indexOf(kw.toLowerCase())
  if (index < 0) return LayerTreeControl.escapeHtml(name)
  const safe = LayerTreeControl.escapeHtml(name)
  return `${safe.slice(0, index)}<mark>${safe.slice(index, index + kw.length)}</mark>${safe.slice(index + kw.length)}`
}

// ---------------------------------------------------------------- 选择与显隐

function focusRoot(): void {
  rootEl.value?.focus({ preventScroll: true })
}

function selectRow(node: LayerTreeNode, event: MouseEvent): void {
  closeContext()
  control.value?.selectLayer(node.id, { additive: event.ctrlKey || event.metaKey, range: event.shiftKey })
  focusRoot()
}

function toggleVisible(node: LayerTreeNode): void {
  control.value?.toggleVisible(node.id)
}

function toggleExpand(node: LayerTreeNode): void {
  model.value?.toggleExpand(node.id)
}

function onOpacityInput(node: LayerTreeNode, event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  control.value?.setOpacity(node.id, value)
}

// ---------------------------------------------------------------- 重命名

async function startRename(node: LayerTreeNode): Promise<void> {
  if (props.options.enableRename === false) return
  editingId.value = node.id
  editingName.value = node.name
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}

function commitRename(): void {
  if (!editingId.value) return
  control.value?.rename(editingId.value, editingName.value)
  editingId.value = ''
}

function cancelRename(): void {
  editingId.value = ''
}

// ---------------------------------------------------------------- 右键菜单

function openContext(node: LayerTreeNode, event: MouseEvent): void {
  event.preventDefault()
  if (props.options.enableContextMenu === false) return
  const items = control.value?.getContextMenuItems(node) ?? []
  contextMenu.value = { x: event.clientX, y: event.clientY, node, items }
}

function closeContext(): void {
  contextMenu.value = null
}

function runContextItem(item: ContextMenuItem): void {
  const state = contextMenu.value
  if (!state || item.divider) return
  if (typeof item.disabled === 'boolean' && item.disabled) return
  closeContext()
  item.action?.(state.node, control.value)
}

// ---------------------------------------------------------------- 新增图层

function openPicker(parentId: string | null = null): void {
  addParentId.value = parentId
  pickerOpen.value = true
}

async function applyPreset(preset: LayerAddPreset): Promise<void> {
  const parentId = addParentId.value
  pickerOpen.value = false
  const config = typeof preset.config === 'function' ? preset.config(parentId) : { ...preset.config }
  if (!config.id) delete config.id
  await control.value?.addLayer(config, parentId)
  if (parentId) model.value?.setExpanded(parentId, true)
}

function openForm(type: LayerType): void {
  formType.value = type
  formValue.value = defaultForm(type)
  formError.value = ''
  pickerOpen.value = false
  formOpen.value = true
}

function buildConfig(type: LayerType, value: Record<string, unknown>): LayerConfig {
  const name = String(value.name)
  switch (type) {
    case LayerType.IMAGERY: {
      const options: Record<string, unknown> = {}
      if (value.url) options.url = String(value.url)
      if (value.providerType === 'Ion' && value.assetId !== '' && value.assetId != null) options.assetId = toNumber(value.assetId)
      return { name, type, imagery: { providerType: String(value.providerType), options } }
    }
    case LayerType.TERRAIN: {
      const options: Record<string, unknown> = {}
      if (value.url) options.url = String(value.url)
      if (value.providerType === 'world') options.requestVertexNormals = true
      return { name, type, terrain: { providerType: String(value.providerType), options } }
    }
    case LayerType.TILESET: {
      const tileset: NonNullable<LayerConfig['tileset']> = {
        options: { maximumScreenSpaceError: toNumber(value.maximumScreenSpaceError, 16) }
      }
      if (value.url) tileset.url = String(value.url)
      if (value.ionAssetId !== '' && value.ionAssetId != null) tileset.ionAssetId = toNumber(value.ionAssetId)
      return { name, type, tileset }
    }
    case LayerType.DATASOURCE:
      return {
        name,
        type,
        datasource: {
          format: String(value.format) as 'geojson' | 'kml' | 'czml' | 'custom',
          url: value.url ? String(value.url) : undefined
        }
      }
    case LayerType.ENTITY: {
      const entity: Record<string, unknown> = {
        name,
        position: Cartesian3.fromDegrees(toNumber(value.lon), toNumber(value.lat), toNumber(value.height)),
        point: { pixelSize: 10, color: Color.fromCssColorString(String(value.color)) }
      }
      const labelText = String(value.labelText ?? '').trim()
      if (labelText) {
        entity.label = {
          text: labelText,
          font: '600 15px sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          pixelOffset: new Cartesian2(0, -22)
        }
      }
      return { name, type, entity }
    }
    case LayerType.PRIMITIVE: {
      const options: Record<string, unknown> = {
        lon: toNumber(value.lon),
        lat: toNumber(value.lat),
        altitude: toNumber(value.height),
        color: String(value.color)
      }
      const primitiveType = String(value.primitiveType)
      if (primitiveType === 'point') options.pixelSize = toNumber(value.pixelSize, 10)
      if (primitiveType === 'label') {
        options.text = String(value.text ?? '').trim() || name
        options.font = '700 18px sans-serif'
      }
      return { name, type, primitive: { primitiveType, options } }
    }
    case LayerType.MODEL:
      return {
        name,
        type,
        model: {
          url: String(value.url),
          options: {
            lon: toNumber(value.lon),
            lat: toNumber(value.lat),
            height: toNumber(value.height),
            heading: toNumber(value.heading),
            scale: toNumber(value.scale, 1),
            minimumPixelSize: 128
          }
        }
      }
    case LayerType.PARTICLE:
      return {
        name,
        type,
        particle: {
          options: {
            lon: toNumber(value.lon),
            lat: toNumber(value.lat),
            height: toNumber(value.height),
            startColor: String(value.color),
            endColor: String(value.endColor),
            rate: 80,
            minimumSpeed: 20,
            maximumSpeed: 60
          }
        }
      }
    default:
      return { name, type }
  }
}

async function submitForm(): Promise<void> {
  const type = formType.value
  if (!type) return
  const name = String(formValue.value.name ?? '').trim()
  if (!name) {
    formError.value = '请填写图层名称'
    return
  }
  formError.value = ''
  const config = buildConfig(type, { ...formValue.value, name })
  const parentId = addParentId.value
  formOpen.value = false
  await control.value?.addLayer(config, parentId)
  if (parentId) model.value?.setExpanded(parentId, true)
}

function toggleExpandAll(): void {
  if (allExpanded.value) control.value?.collapseAll()
  else control.value?.expandAll()
}

// ---------------------------------------------------------------- 样式设置

function openStyle(node: LayerTreeNode): void {
  const fields = control.value?.getStyleFields(node.id) ?? []
  styleNode.value = node
  styleFields.value = fields
  const values: Record<string, unknown> = {}
  for (const field of fields) values[field.key] = field.value
  styleValues.value = values
}

function applyStyleForm(): void {
  if (!styleNode.value) return
  control.value?.applyStyle(styleNode.value.id, { ...styleValues.value })
  styleNode.value = null
  styleFields.value = []
  styleValues.value = {}
}

// ---------------------------------------------------------------- 上下文动作

function handleAction(menuId: string, node: LayerTreeNode): void {
  switch (menuId) {
    case 'rename':
      void startRename(node)
      break
    case 'attributes': {
      const meta = control.value?.getMeta(node) ?? {}
      infoDialog.value = {
        title: '图层属性',
        subtitle: node.name,
        entries: Object.entries(meta).map(([label, value]) => ({ label, value: String(value) }))
      }
      break
    }
    case 'settings':
      openStyle(node)
      break
    case 'description':
      infoDialog.value = {
        title: '图层描述',
        subtitle: node.name,
        entries: [
          { label: '描述', value: String(node.config.meta?.description ?? node.config.entity?.description ?? '暂无描述') },
          { label: '来源', value: String(node.meta.source ?? '-') }
        ]
      }
      break
    case 'opacity':
      activeOpacityId.value = activeOpacityId.value === node.id ? '' : node.id
      break
    case 'delete':
      confirmNode.value = node
      break
    case 'terrainExaggeration':
      exaggerationOpen.value = true
      break
    case 'terrainWater': {
      if (props.viewer && !props.viewer.isDestroyed()) {
        const globe = props.viewer.scene.globe as unknown as { showWaterEffect: boolean }
        globe.showWaterEffect = !globe.showWaterEffect
      }
      break
    }
    case 'groupAddLayer':
      openPicker(node.id)
      break
    case 'groupAddGroup':
      void addGroupTo(node)
      break
    default:
      break
  }
}

async function addGroupTo(parent: LayerTreeNode): Promise<void> {
  await control.value?.addLayer({ name: '新建分组', type: LayerType.GROUP }, parent.id)
  model.value?.setExpanded(parent.id, true)
}

function confirmDelete(): void {
  if (confirmNode.value) control.value?.removeLayer(confirmNode.value.id)
  confirmNode.value = null
}

function applyExaggeration(): void {
  if (!props.viewer || props.viewer.isDestroyed()) return
  ;(props.viewer.scene as unknown as { verticalExaggeration: number }).verticalExaggeration = exaggeration.value
  exaggerationOpen.value = false
}

// ---------------------------------------------------------------- 拖拽排序

function onDragStart(node: LayerTreeNode, event: DragEvent): void {
  const origin = event.target as HTMLElement | null
  const fromControl = !!origin?.closest('input, button, .lt-opacity, .lt-check, .lt-arrow, .lt-locate')
  if (props.options.enableDragDrop === false || editingId.value || fromControl) {
    event.preventDefault()
    return
  }
  dragId.value = node.id
  event.dataTransfer?.setData('text/plain', node.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(node: LayerTreeNode, event: DragEvent): void {
  if (!dragId.value || dragId.value === node.id) return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const ratio = (event.clientY - rect.top) / rect.height
  const isGroup = node.type === LayerType.GROUP
  const position: DropState['position'] = isGroup && ratio > 0.3 && ratio < 0.7 ? 'inside' : ratio < 0.5 ? 'before' : 'after'
  dropTarget.value = { id: node.id, position }
}

function onDragLeave(node: LayerTreeNode): void {
  if (dropTarget.value?.id === node.id) dropTarget.value = null
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  const dragged = dragId.value
  const target = dropTarget.value
  dragId.value = ''
  dropTarget.value = null
  if (!dragged || !target || dragged === target.id) return
  const current = control.value?.model
  if (!current) return
  const targetNode = current.findNode(target.id)
  if (!targetNode) return
  if (target.position === 'inside') {
    current.moveNode(dragged, targetNode.id, targetNode.children.length)
    current.setExpanded(targetNode.id, true)
    return
  }
  const siblings = targetNode.parentId ? current.getChildren(targetNode.parentId) : current.getRoots()
  const base = siblings.findIndex((item) => item.id === targetNode.id)
  const index = base + (target.position === 'after' ? 1 : 0)
  current.moveNode(dragged, targetNode.parentId, index)
}

function onDragEnd(): void {
  dragId.value = ''
  dropTarget.value = null
}

function dropClass(node: LayerTreeNode): string {
  const target = dropTarget.value
  if (!target || target.id !== node.id) return ''
  return `is-drop-${target.position}`
}

// ---------------------------------------------------------------- 键盘

function onKeydown(event: KeyboardEvent): void {
  if (editingId.value) return
  if (event.key === 'Escape') {
    if (pickerOpen.value) pickerOpen.value = false
    else if (formOpen.value) formOpen.value = false
    else if (styleNode.value) styleNode.value = null
    else if (usageOpen.value) usageOpen.value = false
    else if (infoDialog.value) infoDialog.value = null
    else if (confirmNode.value) confirmNode.value = null
    else if (exaggerationOpen.value) exaggerationOpen.value = false
    else if (contextMenu.value) closeContext()
    else if (settingsOpen.value) settingsOpen.value = false
    else return
    event.preventDefault()
    return
  }
  if (!control.value) return
  const selected = model.value?.getSelected() ?? []
  const primary = selected[selected.length - 1] ?? null
  const meta = event.ctrlKey || event.metaKey

  switch (event.key) {
    case ' ':
      if (primary) {
        event.preventDefault()
        control.value.toggleVisible(primary.id)
      }
      break
    case 'F2':
      if (primary) {
        event.preventDefault()
        void startRename(primary)
      }
      break
    case 'Delete':
    case 'Backspace':
      if (selected.length) {
        event.preventDefault()
        if (props.options.confirmOnDelete) confirmNode.value = primary
        else control.value.removeLayers(selected.map((node) => node.id))
      }
      break
    case 'Enter':
      if (primary) {
        event.preventDefault()
        void control.value.flyTo(primary.id)
      }
      break
    case 'ArrowUp':
    case 'ArrowDown':
      event.preventDefault()
      moveSelection(event.key === 'ArrowDown' ? 1 : -1)
      break
    case 'ArrowLeft':
      if (primary) {
        event.preventDefault()
        if (primary.type === LayerType.GROUP && primary.expanded) model.value?.setExpanded(primary.id, false)
        else if (primary.parentId) control.value.selectLayer(primary.parentId)
      }
      break
    case 'ArrowRight':
      if (primary) {
        event.preventDefault()
        if (primary.type === LayerType.GROUP) model.value?.setExpanded(primary.id, true)
      }
      break
    case 'a':
      if (meta) {
        event.preventDefault()
        model.value?.selectAll()
      }
      break
    case 'd':
      if (meta && primary) {
        event.preventDefault()
        void control.value.duplicate(primary.id)
      }
      break
    case 'z':
      if (meta) {
        event.preventDefault()
        control.value.undoRemove()
      }
      break
    default:
      break
  }
}

function moveSelection(delta: number): void {
  const list = rows.value
  if (!list.length) return
  const selected = model.value?.getSelected() ?? []
  const primary = selected[selected.length - 1]
  const currentIndex = primary ? list.findIndex((row) => row.node.id === primary.id) : -1
  const nextIndex = Math.min(Math.max(currentIndex + delta, 0), list.length - 1)
  const next = list[nextIndex]
  if (next) control.value?.selectLayer(next.node.id)
}
</script>

<template>
  <div ref="rootEl" class="lt-root" :class="themeClass" tabindex="0" @keydown="onKeydown">
    <section class="lt-panel">
      <header class="lt-titlebar">
        <div class="lt-title">
          <span class="lt-title-dot"></span>
          {{ props.title }}
        </div>
        <div class="lt-title-actions">
          <button class="lt-icon-btn" :title="allExpanded ? '收起全部' : '展开全部'" @click="toggleExpandAll">
            <svg viewBox="0 0 24 24"><path :d="allExpanded ? 'M7 13l5 5 5-5M7 6l5 5 5-5' : 'M7 10l5-5 5 5M7 14l5 5 5-5'" /></svg>
          </button>
          <button class="lt-icon-btn" title="使用说明" @click="usageOpen = true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.6-2.4 1.9-2.4 3.5" /><path d="M12 17.3h.01" /></svg>
          </button>
          <button class="lt-icon-btn" title="控件设置" @click="settingsOpen = !settingsOpen">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 2.6 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9.5 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21.4 11a2 2 0 1 1 0 4z" /></svg>
          </button>
          <button class="lt-icon-btn" :title="collapsed ? '展开' : '折叠'" @click="collapsed = !collapsed">
            <svg viewBox="0 0 24 24"><path :d="collapsed ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'" /></svg>
          </button>
        </div>
      </header>

      <div v-show="!collapsed" class="lt-body">
        <div class="lt-toolbar">
          <label class="lt-search">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
            <input v-model="keyword" type="search" placeholder="搜索图层..." />
          </label>
          <button class="lt-add-btn" :class="{ active: pickerOpen }" @click="openPicker(null)">
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            新增图层
          </button>
        </div>

        <div class="lt-tree" role="tree">
          <div v-if="!rows.length" class="lt-empty">暂无图层</div>
          <div
            v-for="row in rows"
            :key="row.node.id"
            class="lt-row"
            :class="[
              {
                'is-selected': isSelected(row.node),
                'is-editing': editingId === row.node.id,
                'is-loading': row.node.loading,
                'is-error': !!row.node.error,
                'is-hidden': !visibilityState(row.node).includes('checked'),
                'is-dragging': dragId === row.node.id
              },
              dropClass(row.node)
            ]"
            :style="{ paddingLeft: `${row.depth * 20 + 8}px` }"
            draggable="true"
            @click="selectRow(row.node, $event)"
            @dblclick="startRename(row.node)"
            @mouseenter="hoverId = row.node.id"
            @mouseleave="hoverId === row.node.id && (hoverId = '')"
            @contextmenu="openContext(row.node, $event)"
            @dragstart="onDragStart(row.node, $event)"
            @dragover="onDragOver(row.node, $event)"
            @dragleave="onDragLeave(row.node)"
            @drop="onDrop"
            @dragend="onDragEnd"
          >
            <span
              class="lt-arrow"
              :class="{ 'is-leaf': !row.node.children.length, 'is-expanded': row.node.expanded }"
              @click.stop="toggleExpand(row.node)"
            >
              <svg v-if="row.node.children.length" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
            </span>

            <span
              class="lt-check"
              :class="visibilityState(row.node)"
              role="checkbox"
              :aria-checked="visibilityState(row.node) === 'indeterminate' ? 'mixed' : visibilityState(row.node) === 'checked'"
              @click.stop="toggleVisible(row.node)"
            >
              <svg v-if="visibilityState(row.node) === 'checked'" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              <span v-else-if="visibilityState(row.node) === 'indeterminate'" class="lt-check-bar"></span>
            </span>

            <span class="lt-type-icon" :style="{ background: `${typeColor(row.node)}22`, color: typeColor(row.node) }">
              <LayerTypeIcon :type="row.node.type" :color="typeColor(row.node)" :size="15" />
            </span>

            <input
              v-if="editingId === row.node.id"
              ref="renameInput"
              v-model="editingName"
              class="lt-rename-input"
              @click.stop
              @keydown.enter.stop.prevent="commitRename"
              @keydown.esc.stop.prevent="cancelRename"
              @blur="commitRename"
            />
            <span v-else class="lt-name" :title="row.node.name" v-html="highlight(row.node.name)"></span>

            <span v-if="row.node.loading" class="lt-spinner"></span>
            <span class="lt-type-tag">{{ typeTag(row.node) }}</span>

            <span v-if="hasOpacity(row.node) && (hoverId === row.node.id || activeOpacityId === row.node.id)" class="lt-opacity" @click.stop @mousedown.stop>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                draggable="false"
                :value="row.node.opacity"
                @input="onOpacityInput(row.node, $event)"
              />
              <em>{{ Math.round(row.node.opacity * 100) }}%</em>
            </span>

            <button class="lt-locate" title="定位到图层" @click.stop="control?.flyTo(row.node.id)">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
            </button>
          </div>
        </div>
      </div>

      <footer v-show="!collapsed" class="lt-statusbar">
        <span>共 {{ stats.total }} 项</span>
        <i></i>
        <span>可见 {{ stats.visible }} 项</span>
        <i></i>
        <span v-if="stats.selected">已选 {{ stats.selected }} 项</span>
        <span v-else class="lt-muted">未选择</span>
        <span v-if="stats.loading" class="lt-loading-chip">加载 {{ stats.loading }}</span>
      </footer>
    </section>

    <div v-if="settingsOpen" class="lt-settings">
      <div class="lt-settings-title">控件设置</div>
      <p>当前主题：{{ props.options.theme ?? 'dark' }}</p>
      <p>拖拽排序：{{ props.options.enableDragDrop === false ? '关闭' : '开启' }}</p>
      <p>右键菜单：{{ props.options.enableContextMenu === false ? '关闭' : '开启' }}</p>
      <p>删除确认：{{ props.options.confirmOnDelete ? '开启' : '关闭' }}</p>
      <button class="lt-settings-close" @click="settingsOpen = false">关闭</button>
    </div>

    <ul
      v-if="contextMenu"
      class="lt-context"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @click.stop
    >
      <template v-for="(item, index) in contextMenu.items" :key="`${item.id}-${index}`">
        <li v-if="item.divider" class="lt-context-divider"></li>
        <li
          v-else
          class="lt-context-item"
          :class="{ 'is-danger': item.danger, 'is-disabled': item.disabled === true }"
          @click="runContextItem(item)"
        >
          <span class="lt-context-label">{{ item.label }}</span>
          <span v-if="item.shortcut" class="lt-context-shortcut">{{ item.shortcut }}</span>
        </li>
      </template>
    </ul>

    <div v-if="infoDialog" class="lt-modal-mask" @click.self="infoDialog = null">
      <div class="lt-modal">
        <div class="lt-modal-head">
          <div>
            <h4>{{ infoDialog.title }}</h4>
            <p v-if="infoDialog.subtitle">{{ infoDialog.subtitle }}</p>
          </div>
          <button class="lt-icon-btn" @click="infoDialog = null">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div class="lt-modal-body">
          <div v-for="entry in infoDialog.entries" :key="entry.label" class="lt-modal-row">
            <span>{{ entry.label }}</span>
            <b>{{ entry.value }}</b>
          </div>
        </div>
      </div>
    </div>

    <div v-if="confirmNode" class="lt-modal-mask" @click.self="confirmNode = null">
      <div class="lt-modal lt-modal-sm">
        <div class="lt-modal-head">
          <h4>删除图层</h4>
        </div>
        <div class="lt-modal-body">
          确认删除「{{ confirmNode.name }}」及其子图层？
        </div>
        <div class="lt-modal-actions">
          <button class="lt-btn" @click="confirmNode = null">取消</button>
          <button class="lt-btn danger" @click="confirmDelete">删除</button>
        </div>
      </div>
    </div>

    <div v-if="exaggerationOpen" class="lt-modal-mask" @click.self="exaggerationOpen = false">
      <div class="lt-modal lt-modal-sm">
        <div class="lt-modal-head">
          <h4>地形夸张</h4>
        </div>
        <div class="lt-modal-body">
          <input v-model.number="exaggeration" type="range" min="1" max="5" step="0.1" />
          <p class="lt-modal-value">{{ exaggeration.toFixed(1) }} x</p>
        </div>
        <div class="lt-modal-actions">
          <button class="lt-btn" @click="exaggerationOpen = false">取消</button>
          <button class="lt-btn primary" @click="applyExaggeration">应用</button>
        </div>
      </div>
    </div>

    <div v-if="pickerOpen" class="lt-modal-mask" @click.self="pickerOpen = false">
      <div class="lt-modal">
        <div class="lt-modal-head">
          <div>
            <h4>新增图层</h4>
            <p>{{ addParentId ? '选择类型后将添加到所选分组' : '选择要新增的图层类型' }}</p>
          </div>
          <button class="lt-icon-btn" title="关闭" @click="pickerOpen = false">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div class="lt-modal-body">
          <div class="lt-type-grid">
            <button v-for="def in ADD_TYPE_DEFS" :key="def.type" class="lt-type-card" @click="openForm(def.type)">
              <span class="lt-type-card-label">{{ def.label }}</span>
              <span class="lt-type-card-hint">{{ def.hint }}</span>
            </button>
          </div>
          <template v-if="quickPresets.length">
            <div class="lt-modal-subtitle">快捷模板</div>
            <div class="lt-preset-list">
              <button v-for="preset in quickPresets" :key="preset.label" class="lt-preset-item" @click="applyPreset(preset)">
                <span>{{ preset.label }}</span>
                <em v-if="preset.hint">{{ preset.hint }}</em>
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div v-if="formOpen" class="lt-modal-mask" @click.self="formOpen = false">
      <div class="lt-modal">
        <div class="lt-modal-head">
          <div>
            <h4>新增{{ currentTypeDef?.label }}</h4>
            <p>填写图层信息后完成新增</p>
          </div>
          <button class="lt-icon-btn" title="关闭" @click="formOpen = false">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div class="lt-modal-body">
          <label class="lt-field">
            <span>图层名称</span>
            <input v-model="formValue.name" type="text" placeholder="请输入图层名称" />
          </label>
          <label v-for="field in currentTypeDef?.fields ?? []" :key="field.key" class="lt-field">
            <span>{{ field.label }}</span>
            <select v-if="field.kind === 'select'" v-model="formValue[field.key]">
              <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <input v-else-if="field.kind === 'color'" v-model="formValue[field.key]" type="color" />
            <input v-else-if="field.kind === 'number'" v-model.number="formValue[field.key]" type="number" />
            <input v-else v-model="formValue[field.key]" type="text" />
          </label>
          <p v-if="formError" class="lt-form-error">{{ formError }}</p>
        </div>
        <div class="lt-modal-actions">
          <button class="lt-btn" @click="formOpen = false">取消</button>
          <button class="lt-btn primary" @click="submitForm">确定新增</button>
        </div>
      </div>
    </div>

    <div v-if="styleNode" class="lt-modal-mask" @click.self="styleNode = null">
      <div class="lt-modal">
        <div class="lt-modal-head">
          <div>
            <h4>样式设置</h4>
            <p>{{ styleNode.name }}</p>
          </div>
          <button class="lt-icon-btn" title="关闭" @click="styleNode = null">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div class="lt-modal-body">
          <template v-if="styleFields.length">
            <label v-for="field in styleFields" :key="field.key" class="lt-field">
              <span>{{ field.label }}</span>
              <select v-if="field.type === 'select'" v-model="styleValues[field.key]">
                <option v-for="option in field.options ?? []" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
              <input v-else-if="field.type === 'color'" v-model="styleValues[field.key]" type="color" />
              <input v-else-if="field.type === 'boolean'" v-model="styleValues[field.key]" type="checkbox" class="lt-checkbox" />
              <input
                v-else-if="field.type === 'number'"
                v-model.number="styleValues[field.key]"
                type="number"
                :min="field.min"
                :max="field.max"
                :step="field.step"
              />
              <input v-else v-model="styleValues[field.key]" type="text" />
            </label>
          </template>
          <p v-else class="lt-empty">该图层类型暂无可调样式</p>
        </div>
        <div class="lt-modal-actions">
          <button class="lt-btn" @click="styleNode = null">取消</button>
          <button class="lt-btn primary" :disabled="!styleFields.length" @click="applyStyleForm">应用</button>
        </div>
      </div>
    </div>

    <div v-if="usageOpen" class="lt-modal-mask" @click.self="usageOpen = false">
      <div class="lt-modal lt-modal-lg">
        <div class="lt-modal-head">
          <div>
            <h4>图层树控件使用说明</h4>
            <p>支持的数据类型与关键方法</p>
          </div>
          <button class="lt-icon-btn" title="关闭" @click="usageOpen = false">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div class="lt-modal-body lt-usage">
          <h5>支持的数据类型</h5>
          <table>
            <thead>
              <tr><th>类型</th><th>说明</th></tr>
            </thead>
            <tbody>
              <tr><td>GROUP</td><td>图层组，可嵌套子节点，支持展开/收起</td></tr>
              <tr><td>IMAGERY</td><td>影像图层（UrlTemplate / WMS / WMTS / TMS / OSM / ArcGIS / Ion 等）</td></tr>
              <tr><td>TERRAIN</td><td>地形图层（全球地形 / 椭球体 / ArcGIS 地形）</td></tr>
              <tr><td>TILESET</td><td>3D Tiles 瓦片集，支持 URL 或 Ion 资产</td></tr>
              <tr><td>DATASOURCE</td><td>数据源（GeoJSON / KML / CZML / 自定义）</td></tr>
              <tr><td>ENTITY</td><td>实体（点、标签等）</td></tr>
              <tr><td>PRIMITIVE</td><td>图元（点 / 标签 / 广告牌 / 墙）</td></tr>
              <tr><td>MODEL</td><td>glTF / GLB 模型</td></tr>
              <tr><td>PARTICLE</td><td>粒子系统</td></tr>
            </tbody>
          </table>
          <h5>关键方法（LayerTreeControl）</h5>
          <ul>
            <li><code>addLayer(config, parentId?)</code> / <code>removeLayer(id)</code> / <code>removeLayers(ids)</code></li>
            <li><code>rename(id, name)</code> / <code>duplicate(id)</code> / <code>undoRemove()</code></li>
            <li><code>selectLayer(id, { additive, range })</code> / <code>selectAll()</code></li>
            <li><code>toggleVisible(id)</code> / <code>setOpacity(id, value)</code></li>
            <li><code>flyTo(id)</code> / <code>getMeta(node)</code> / <code>exportConfig()</code></li>
            <li><code>expandAll()</code> / <code>collapseAll()</code></li>
            <li><code>getStyleFields(id)</code> / <code>applyStyle(id, values)</code></li>
            <li>注册自定义适配器：<code>registerAdapter(adapter)</code> 或 <code>options.adapters</code></li>
          </ul>
          <h5>面板交互</h5>
          <ul>
            <li>单击选中，<code>Ctrl/Cmd</code> 多选，<code>Shift</code> 连选</li>
            <li>双击或 <code>F2</code> 重命名，<code>Space</code> 切换显隐，<code>Enter</code> 定位</li>
            <li>右键打开菜单（属性 / 样式设置 / 删除等）</li>
            <li>拖动行可排序或拖入分组，拖到组中间为「加入分组」</li>
            <li>悬停行显示透明度滑块，拖动滑块不会移动图层</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lt-root {
  position: relative;
  width: 326px;
  max-width: 94%;
  outline: none;
  color: var(--lt-text);
  font-size: 13px;
  --lt-text: #dbe7f6;
  --lt-muted: #8ea5c2;
  --lt-border: rgba(140, 180, 224, 0.18);
  --lt-panel: rgba(13, 29, 54, 0.9);
  --lt-row-hover: rgba(79, 140, 255, 0.12);
  --lt-accent: #4f9dff;
  --lt-danger: #ff6b6b;
}
.lt-theme-light {
  --lt-text: #22334d;
  --lt-muted: #7b8aa0;
  --lt-border: rgba(41, 78, 128, 0.14);
  --lt-panel: rgba(255, 255, 255, 0.96);
  --lt-row-hover: rgba(47, 128, 237, 0.09);
  --lt-accent: #2f80ed;
}
.lt-panel {
  display: flex;
  flex-direction: column;
  max-height: 100%;
  overflow: hidden;
  border: 1px solid var(--lt-border);
  border-radius: 12px;
  background: var(--lt-panel);
  backdrop-filter: blur(9px);
  box-shadow: 0 18px 48px rgba(4, 14, 30, 0.34);
}
.lt-theme-light .lt-panel { box-shadow: 0 18px 42px rgba(20, 40, 70, 0.16); }

.lt-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px 10px 13px;
  border-bottom: 1px solid var(--lt-border);
}
.lt-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; letter-spacing: 0.02em; }
.lt-title-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--lt-accent); box-shadow: 0 0 9px var(--lt-accent); }
.lt-title-actions { display: flex; align-items: center; gap: 2px; }
.lt-icon-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: transparent;
  color: var(--lt-muted);
}
.lt-icon-btn:hover { color: var(--lt-text); background: var(--lt-row-hover); }
.lt-icon-btn svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }

.lt-body { position: relative; display: flex; flex-direction: column; min-height: 0; }
.lt-toolbar { display: flex; gap: 8px; padding: 9px 10px; }
.lt-search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--lt-border);
  border-radius: 7px;
  background: rgba(8, 20, 40, 0.28);
}
.lt-theme-light .lt-search { background: #f3f6fb; }
.lt-search svg { width: 13px; height: 13px; flex: 0 0 auto; fill: none; stroke: var(--lt-muted); stroke-width: 1.7; stroke-linecap: round; }
.lt-search input { width: 100%; border: 0; outline: 0; background: transparent; color: var(--lt-text); font-size: 12px; }
.lt-search input::placeholder { color: var(--lt-muted); }
.lt-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid var(--lt-border);
  background: rgba(79, 157, 255, 0.12);
  color: var(--lt-text);
  font-size: 12px;
}
.lt-add-btn:hover, .lt-add-btn.active { background: var(--lt-accent); color: #fff; border-color: transparent; }
.lt-add-btn svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }

.lt-tree { min-height: 46px; max-height: 360px; overflow: auto; padding: 2px 6px 8px; }
.lt-tree::-webkit-scrollbar { width: 8px; }
.lt-tree::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: rgba(140, 180, 224, 0.4); background-clip: content-box; }
.lt-empty { padding: 22px 0; text-align: center; color: var(--lt-muted); font-size: 12px; }

.lt-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding-right: 6px;
  border-radius: 7px;
  cursor: pointer;
  user-select: none;
}
.lt-row:hover { background: var(--lt-row-hover); }
.lt-row.is-selected { background: rgba(79, 157, 255, 0.2); box-shadow: inset 2px 0 0 var(--lt-accent); }
.lt-row.is-hidden .lt-name, .lt-row.is-hidden .lt-type-tag, .lt-row.is-hidden .lt-type-icon { opacity: 0.42; }
.lt-row.is-dragging { opacity: 0.45; }
.lt-row.is-error { box-shadow: inset 0 0 0 1px rgba(255, 107, 107, 0.55); }
.lt-row.is-drop-before::before,
.lt-row.is-drop-after::after {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  height: 2px;
  border-radius: 2px;
  background: var(--lt-accent);
}
.lt-row.is-drop-before::before { top: -1px; }
.lt-row.is-drop-after::after { bottom: -1px; }
.lt-row.is-drop-inside { background: rgba(79, 157, 255, 0.26); box-shadow: inset 0 0 0 1px var(--lt-accent); }

.lt-arrow { display: grid; place-items: center; width: 16px; height: 16px; flex: 0 0 auto; color: var(--lt-muted); }
.lt-arrow svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform 0.18s ease; }
.lt-arrow.is-expanded svg { transform: rotate(90deg); }
.lt-arrow.is-leaf { visibility: hidden; }

.lt-check {
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  border: 1.4px solid var(--lt-muted);
  border-radius: 4px;
  color: #fff;
}
.lt-check.checked { background: var(--lt-accent); border-color: var(--lt-accent); }
.lt-check svg { width: 11px; height: 11px; fill: none; stroke: currentColor; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
.lt-check.indeterminate { background: var(--lt-accent); border-color: var(--lt-accent); }
.lt-check-bar { width: 8px; height: 2px; border-radius: 2px; background: #fff; }

.lt-type-icon { display: grid; place-items: center; width: 21px; height: 21px; flex: 0 0 auto; border-radius: 6px; }
.lt-name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.lt-name :deep(mark) { color: #ffd166; background: transparent; font-weight: 700; }
.lt-theme-light .lt-name :deep(mark) { color: #e08a00; }
.lt-rename-input {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--lt-accent);
  border-radius: 5px;
  outline: none;
  background: rgba(8, 20, 40, 0.5);
  color: var(--lt-text);
  font-size: 12px;
}
.lt-theme-light .lt-rename-input { background: #fff; }
.lt-type-tag { flex: 0 0 auto; color: var(--lt-muted); font: 600 9px/1 'DM Mono', monospace; letter-spacing: 0.04em; }
.lt-spinner {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  border-radius: 50%;
  border: 2px solid rgba(140, 180, 224, 0.3);
  border-top-color: var(--lt-accent);
  animation: lt-spin 0.8s linear infinite;
}
@keyframes lt-spin { to { transform: rotate(360deg); } }
.lt-opacity { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
.lt-opacity input { width: 62px; accent-color: var(--lt-accent); }
.lt-opacity em { color: var(--lt-muted); font: 9px 'DM Mono', monospace; font-style: normal; width: 26px; }
.lt-locate {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  border-radius: 5px;
  background: transparent;
  color: var(--lt-muted);
  opacity: 0;
}
.lt-row:hover .lt-locate { opacity: 1; }
.lt-locate:hover { color: var(--lt-accent); background: var(--lt-row-hover); }
.lt-locate svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }

.lt-add-menu {
  position: absolute;
  z-index: 20;
  right: 10px;
  top: 48px;
  width: 200px;
  padding: 6px;
  border: 1px solid var(--lt-border);
  border-radius: 9px;
  background: var(--lt-panel);
  backdrop-filter: blur(10px);
  box-shadow: 0 14px 34px rgba(4, 14, 30, 0.36);
}
.lt-add-menu-title { padding: 4px 8px 6px; color: var(--lt-muted); font: 9px 'DM Mono', monospace; letter-spacing: 0.1em; text-transform: uppercase; }
.lt-add-item { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 7px 8px; border-radius: 6px; background: transparent; color: var(--lt-text); font-size: 12px; text-align: left; }
.lt-add-item:hover { background: var(--lt-row-hover); }
.lt-add-hint { color: var(--lt-muted); font: 9px 'DM Mono', monospace; }

.lt-statusbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--lt-border);
  color: var(--lt-muted);
  font-size: 11px;
}
.lt-statusbar i { width: 1px; height: 10px; background: var(--lt-border); }
.lt-muted { color: var(--lt-muted); }
.lt-loading-chip { margin-left: auto; padding: 1px 7px; border-radius: 999px; background: rgba(79, 157, 255, 0.16); color: var(--lt-accent); }

.lt-settings {
  position: absolute;
  z-index: 30;
  right: 8px;
  top: 40px;
  width: 210px;
  padding: 12px;
  border: 1px solid var(--lt-border);
  border-radius: 10px;
  background: var(--lt-panel);
  backdrop-filter: blur(10px);
  box-shadow: 0 14px 34px rgba(4, 14, 30, 0.36);
  font-size: 11px;
  color: var(--lt-muted);
}
.lt-settings-title { margin-bottom: 8px; color: var(--lt-text); font-weight: 700; font-size: 12px; }
.lt-settings p { margin: 4px 0; }
.lt-settings-close { margin-top: 8px; width: 100%; height: 28px; border-radius: 6px; background: rgba(79, 157, 255, 0.16); color: var(--lt-accent); }

.lt-context {
  position: fixed;
  z-index: 60;
  min-width: 168px;
  margin: 0;
  padding: 5px;
  list-style: none;
  border: 1px solid var(--lt-border);
  border-radius: 9px;
  background: var(--lt-panel);
  backdrop-filter: blur(12px);
  box-shadow: 0 16px 40px rgba(4, 14, 30, 0.42);
}
.lt-theme-light .lt-context { background: rgba(255, 255, 255, 0.98); }
.lt-context-item { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 6px 9px; border-radius: 6px; color: var(--lt-text); font-size: 12px; cursor: pointer; }
.lt-context-item:hover { background: var(--lt-row-hover); }
.lt-context-item.is-danger { color: var(--lt-danger); }
.lt-context-item.is-disabled { opacity: 0.4; cursor: default; }
.lt-context-item.is-disabled:hover { background: transparent; }
.lt-context-shortcut { color: var(--lt-muted); font: 9px 'DM Mono', monospace; }
.lt-context-divider { height: 1px; margin: 4px 6px; background: var(--lt-border); }

.lt-modal-mask { position: fixed; z-index: 70; inset: 0; display: grid; place-items: center; background: rgba(4, 12, 24, 0.5); }
.lt-modal { width: 320px; max-width: 92vw; max-height: 74vh; overflow: hidden auto; border: 1px solid var(--lt-border); border-radius: 12px; background: #0f2340; color: var(--lt-text); box-shadow: 0 22px 54px rgba(0, 0, 0, 0.45); }
.lt-theme-light .lt-modal { background: #fff; }
.lt-modal-sm { width: 280px; }
.lt-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 10px; }
.lt-modal-head h4 { margin: 0; font-size: 14px; }
.lt-modal-head p { margin: 3px 0 0; color: var(--lt-muted); font-size: 11px; }
.lt-modal-body { padding: 4px 16px 14px; font-size: 12px; }
.lt-modal-row { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; padding: 6px 0; border-bottom: 1px dashed var(--lt-border); }
.lt-modal-row span { color: var(--lt-muted); }
.lt-modal-row b { text-align: right; font-weight: 600; word-break: break-all; }
.lt-modal-value { text-align: center; font: 700 16px 'DM Mono', monospace; color: var(--lt-accent); }
.lt-modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 16px 16px; }
.lt-btn { height: 30px; padding: 0 14px; border-radius: 7px; border: 1px solid var(--lt-border); background: transparent; color: var(--lt-text); font-size: 12px; }
.lt-btn:hover { background: var(--lt-row-hover); }
.lt-btn.primary { background: var(--lt-accent); border-color: transparent; color: #fff; }
.lt-btn.danger { background: var(--lt-danger); border-color: transparent; color: #fff; }
.lt-modal-body input[type='range'] { width: 100%; accent-color: var(--lt-accent); }
.lt-modal-lg { width: 460px; }
.lt-modal-subtitle { margin: 12px 0 6px; color: var(--lt-muted); font: 9px 'DM Mono', monospace; letter-spacing: 0.1em; text-transform: uppercase; }

.lt-type-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.lt-type-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 8px;
  border: 1px solid var(--lt-border);
  border-radius: 8px;
  background: rgba(8, 20, 40, 0.24);
  color: var(--lt-text);
  text-align: left;
}
.lt-theme-light .lt-type-card { background: #f4f7fc; }
.lt-type-card:hover { border-color: var(--lt-accent); background: rgba(79, 157, 255, 0.16); }
.lt-type-card-label { font-size: 12px; font-weight: 600; }
.lt-type-card-hint { color: var(--lt-muted); font: 9px 'DM Mono', monospace; word-break: break-all; }

.lt-preset-list { display: flex; flex-direction: column; gap: 4px; }
.lt-preset-item { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 7px 9px; border-radius: 6px; background: transparent; color: var(--lt-text); font-size: 12px; text-align: left; }
.lt-preset-item:hover { background: var(--lt-row-hover); }
.lt-preset-item em { color: var(--lt-muted); font: 9px 'DM Mono', monospace; font-style: normal; }

.lt-field { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 0; }
.lt-field > span { flex: 0 0 auto; color: var(--lt-muted); font-size: 12px; }
.lt-field input:not([type='checkbox']),
.lt-field select {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--lt-border);
  border-radius: 6px;
  outline: none;
  background: rgba(8, 20, 40, 0.3);
  color: var(--lt-text);
  font-size: 12px;
}
.lt-theme-light .lt-field input:not([type='checkbox']),
.lt-theme-light .lt-field select { background: #fff; }
.lt-field input[type='color'] { flex: 0 0 42px; padding: 2px; cursor: pointer; }
.lt-checkbox { flex: 0 0 auto; width: 15px; height: 15px; accent-color: var(--lt-accent); }
.lt-form-error { margin: 8px 0 0; color: var(--lt-danger); font-size: 11px; }

.lt-usage { max-height: 62vh; overflow: auto; }
.lt-usage h5 { margin: 14px 0 6px; color: var(--lt-text); font-size: 12px; }
.lt-usage h5:first-child { margin-top: 0; }
.lt-usage table { width: 100%; border-collapse: collapse; font-size: 11px; }
.lt-usage th, .lt-usage td { padding: 5px 8px; border-bottom: 1px solid var(--lt-border); text-align: left; vertical-align: top; }
.lt-usage th { color: var(--lt-muted); font-weight: 600; }
.lt-usage td:first-child { white-space: nowrap; }
.lt-usage ul { margin: 0; padding-left: 18px; }
.lt-usage li { margin: 4px 0; color: var(--lt-text); font-size: 11px; line-height: 1.5; }
.lt-usage code { padding: 1px 5px; border-radius: 4px; background: rgba(79, 157, 255, 0.16); color: var(--lt-accent); font: 10px 'DM Mono', monospace; }
</style>
