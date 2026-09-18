<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  HeightReference,
  HorizontalOrigin,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Entity,
  type Viewer
} from 'cesium'
import * as XLSX from 'xlsx'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { pickCartographic } from '../measure-lib'

type PointAttribute = {
  key: string
  value: string
}

type PointRecord = {
  id: string
  name: string
  longitude: number
  latitude: number
  attributes: PointAttribute[]
}

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const lonInput = ref<number | null>(116.3649)
const latInput = ref<number | null>(39.9975)
const points = ref<PointRecord[]>([])
const selectedId = ref('')
const pointSize = ref(10)
const clampToGround = ref(true)
const editingId = ref('')
const editName = ref('')
const editLon = ref(0)
const editLat = ref(0)
const editAttrs = ref<PointAttribute[]>([])

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let nextIndex = 1
const entityMap = new Map<string, Entity>()

const MARKER_COLORS = ['#ffb84d', '#ff5c5c', '#4a9eff', '#52de9f', '#c98bff', '#ff8ad8', '#5ad8a6', '#f5c26b']

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

let statusTimer: number | undefined

function clearStatus(): void {
  if (statusTimer !== undefined) {
    window.clearTimeout(statusTimer)
    statusTimer = undefined
  }
  statusMessage.value = ''
}

function flashStatus(message: string): void {
  clearStatus()
  statusMessage.value = message
  statusTimer = window.setTimeout(() => {
    statusMessage.value = ''
    statusTimer = undefined
  }, 3000)
}

function addPoint(longitude: number, latitude: number, name?: string): void {
  if (!viewer || viewer.isDestroyed()) return
  if (!isFiniteNumber(longitude) || !isFiniteNumber(latitude)) {
    flashStatus('经纬度数值无效，请检查输入')
    return
  }
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    flashStatus('经纬度超出有效范围（经度 ±180，纬度 ±90）')
    return
  }

  const record: PointRecord = {
    id: `point-${Date.now()}-${nextIndex}`,
    name: name ?? `点位${nextIndex}`,
    longitude,
    latitude,
    attributes: []
  }
  nextIndex += 1
  points.value.push(record)

  const color = Color.fromCssColorString(MARKER_COLORS[(points.value.length - 1) % MARKER_COLORS.length])
  const position = Cartesian3.fromDegrees(longitude, latitude)
  const entity = viewer.entities.add({
    id: record.id,
    position,
    point: {
      pixelSize: pointSize.value,
      color,
      outlineColor: Color.WHITE,
      outlineWidth: 1.5,
      heightReference: clampToGround.value ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      font: '12px sans-serif',
      fillColor: Color.WHITE,
      outlineColor: Color.BLACK,
      outlineWidth: 3,
      showBackground: true,
      backgroundColor: Color.fromCssColorString('#0a2030').withAlpha(0.75),
      verticalOrigin: VerticalOrigin.BOTTOM,
      horizontalOrigin: HorizontalOrigin.CENTER,
      pixelOffset: new Cartesian2(0, -20),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })
  entityMap.set(record.id, entity)
  selectedId.value = record.id
  clearStatus()
}

function onInputAdd(): void {
  if (!isFiniteNumber(lonInput.value) || !isFiniteNumber(latInput.value)) {
    flashStatus('请先输入有效的经度与纬度')
    return
  }
  addPoint(lonInput.value, latInput.value)
}

function onMapClick(event: { position: Cartesian2 }): void {
  if (!viewer) return
  const carto = pickCartographic(viewer.scene, event.position)
  if (!carto) {
    flashStatus('未拾取到有效地形点，请点击地图表面')
    return
  }
  const longitude = CesiumMath.toDegrees(carto.longitude)
  const latitude = CesiumMath.toDegrees(carto.latitude)
  addPoint(longitude, latitude)
}

function removePoint(id: string): void {
  if (!viewer || viewer.isDestroyed()) return
  const entity = entityMap.get(id)
  if (entity) viewer.entities.remove(entity)
  entityMap.delete(id)
  const index = points.value.findIndex((p) => p.id === id)
  if (index >= 0) points.value.splice(index, 1)
  if (selectedId.value === id) selectedId.value = ''
}

function clearAll(): void {
  if (!viewer || viewer.isDestroyed()) return
  const v = viewer
  entityMap.forEach((entity) => v.entities.remove(entity))
  entityMap.clear()
  points.value = []
  selectedId.value = ''
}

function flyToPoint(record: PointRecord): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(record.longitude, record.latitude, 8000),
    duration: 1
  })
}

function openEdit(record: PointRecord): void {
  editingId.value = record.id
  editName.value = record.name
  editLon.value = record.longitude
  editLat.value = record.latitude
  editAttrs.value = record.attributes.map((attribute) => ({ ...attribute }))
}

function closeEdit(): void {
  editingId.value = ''
  editName.value = ''
  editAttrs.value = []
}

function addAttr(): void {
  editAttrs.value.push({ key: '', value: '' })
}

function removeAttr(index: number): void {
  editAttrs.value.splice(index, 1)
}

function saveEdit(): void {
  const record = points.value.find((p) => p.id === editingId.value)
  if (!record) {
    closeEdit()
    return
  }
  const name = editName.value.trim()
  if (!name) {
    flashStatus('名称不能为空')
    return
  }
  const cleaned: PointAttribute[] = []
  const seen = new Set<string>()
  editAttrs.value.forEach((attribute) => {
    const key = attribute.key.trim()
    if (!key) return
    if (seen.has(key)) {
      const existing = cleaned.find((item) => item.key === key)
      if (existing) existing.value = attribute.value
      return
    }
    seen.add(key)
    cleaned.push({ key, value: attribute.value })
  })
  record.name = name
  record.attributes = cleaned
  closeEdit()
  flashStatus('点位信息已更新')
}

function attributeSummary(record: PointRecord): string {
  const parts = record.attributes.map((attribute) => `${attribute.key}：${attribute.value}`)
  if (parts.length > 0) return parts.join('；')
  return `${record.name}（${record.longitude.toFixed(6)}, ${record.latitude.toFixed(6)}）`
}

function attributeKeys(): string[] {
  const keys: string[] = []
  points.value.forEach((p) =>
    p.attributes.forEach((attribute) => {
      const key = attribute.key.trim()
      if (key && !keys.includes(key)) keys.push(key)
    })
  )
  return keys
}

function attributeMap(record: PointRecord): Record<string, string> {
  const map: Record<string, string> = {}
  record.attributes.forEach((attribute) => {
    const key = attribute.key.trim()
    if (key) map[key] = attribute.value
  })
  return map
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function exportCsv(): void {
  const keys = attributeKeys()
  const header = ['序号', '名称', '经度', '纬度', ...keys].join(',')
  const rows = points.value.map((p, i) => {
    const attrs = attributeMap(p)
    return [i + 1, p.name, p.longitude.toFixed(6), p.latitude.toFixed(6), ...keys.map((key) => attrs[key] ?? '')]
      .map((cell) => csvCell(String(cell)))
      .join(',')
  })
  const blob = new Blob([`\ufeff${header}\n${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, '点位清单.csv')
}

function exportExcel(): void {
  if (points.value.length === 0) {
    flashStatus('点位清单为空，无可导出的数据')
    return
  }
  const keys = attributeKeys()
  const data = points.value.map((p, i) => {
    const attrs = attributeMap(p)
    const row: Record<string, number | string> = {
      序号: i + 1,
      名称: p.name,
      经度: Number(p.longitude.toFixed(6)),
      纬度: Number(p.latitude.toFixed(6))
    }
    keys.forEach((key) => {
      row[key] = attrs[key] ?? ''
    })
    return row
  })
  const sheet = XLSX.utils.json_to_sheet(data)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, '点位清单')
  XLSX.writeFile(workbook, '点位清单.xlsx')
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { clearStatus() }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)

    handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(onMapClick, ScreenSpaceEventType.LEFT_CLICK)
    clearStatus()
  } catch (error) {
    flashStatus(error instanceof Error ? error.message : String(error))
  }
})

onBeforeUnmount(() => {
  if (statusTimer !== undefined) window.clearTimeout(statusTimer)
  statusTimer = undefined
  handler?.destroy()
  handler = undefined
  entityMap.clear()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="point-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">点位标记与清单</div>

      <div class="section-title">添加点位</div>
      <div class="coordinate-row">
        <div class="coordinate-field">
          <span class="field-label">经度</span>
          <input v-model.number="lonInput" type="number" step="0.000001" placeholder="经度" />
        </div>
        <div class="coordinate-field">
          <span class="field-label">纬度</span>
          <input v-model.number="latInput" type="number" step="0.000001" placeholder="纬度" />
        </div>
        <button class="action-button primary" @click="onInputAdd">添加</button>
      </div>
      <p class="hint">也可直接在地图上左键点击拾取点位；点击清单中「跳转」定位到对应点。</p>

      <div class="section-title">样式</div>
      <div class="control-row">
        <span class="row-label">点大小</span>
        <input v-model.number="pointSize" type="range" min="4" max="24" step="1" />
        <span class="row-value">{{ pointSize }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">贴地显示</span>
        <label class="switch">
          <input v-model="clampToGround" type="checkbox" />
          <span class="switch-slider"></span>
        </label>
      </div>

      <div class="section-title">点位清单（{{ points.length }}）</div>
      <div class="point-list">
        <div v-if="points.length === 0" class="empty-tip">暂无点位，输入坐标或点击地图添加</div>
        <div v-for="record in points" :key="record.id" class="point-item" :title="attributeSummary(record)">
          <span class="point-name">{{ record.name }}</span>
          <span class="point-coord">{{ record.longitude.toFixed(5) }}, {{ record.latitude.toFixed(5) }}</span>
          <div class="point-actions">
            <button class="mini-button" title="跳转定位" @click="flyToPoint(record)">跳转</button>
            <button class="mini-button" title="编辑名称与属性" @click="openEdit(record)">编辑</button>
            <button class="mini-button danger" title="删除该点" @click="removePoint(record.id)">删除</button>
          </div>
        </div>
      </div>

      <div class="button-row">
        <button class="action-button secondary" @click="clearAll">清空</button>
        <button class="action-button secondary" @click="exportCsv">导出CSV</button>
        <button class="action-button secondary" @click="exportExcel">导出Excel</button>
      </div>
    </div>

    <div v-if="editingId" class="edit-mask" @click.self="closeEdit">
      <div class="edit-dialog">
        <div class="edit-title">编辑点位</div>
        <div class="edit-field">
          <span class="field-label">名称</span>
          <input v-model="editName" type="text" placeholder="点位名称" />
        </div>
        <div class="edit-field">
          <span class="field-label">经纬度（不可修改）</span>
          <div class="coord-readonly">{{ editLon.toFixed(6) }}, {{ editLat.toFixed(6) }}</div>
        </div>
        <div class="edit-field">
          <span class="field-label">属性字段</span>
          <div class="attr-list">
            <div v-for="(attribute, index) in editAttrs" :key="index" class="attr-row">
              <input v-model="attribute.key" type="text" placeholder="属性名" />
              <input v-model="attribute.value" type="text" placeholder="属性值" />
              <button class="mini-button danger" title="删除该属性" @click="removeAttr(index)">删</button>
            </div>
            <button class="action-button secondary add-attr" @click="addAttr">+ 添加属性</button>
          </div>
        </div>
        <div class="edit-actions">
          <button class="action-button secondary" @click="closeEdit">取消</button>
          <button class="action-button primary" @click="saveEdit">保存</button>
        </div>
      </div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.point-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; width: 320px; max-height: calc(100% - 24px); padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.coordinate-row { display: flex; align-items: flex-end; gap: 6px; }
.coordinate-field { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.field-label { color: #c3d5e8; font-size: 10px; }
.coordinate-field input { width: 100%; height: 24px; padding: 0 6px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: #1a2c4a; color: #e8f1fb; font-size: 11px; box-sizing: border-box; }
.action-button { height: 26px; padding: 0 10px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; white-space: nowrap; }
.action-button.primary { background: #2f80ed; color: #eef4ff; }
.action-button.secondary { flex: 1; background: #2c3a52; color: #c3d5e8; }
.button-row { display: flex; gap: 6px; margin-top: 10px; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 40px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.switch { position: relative; display: inline-block; width: 30px; height: 16px; flex: 0 0 auto; }
.switch input { opacity: 0; width: 0; height: 0; }
.switch-slider { position: absolute; inset: 0; border-radius: 8px; background: #2c3a52; transition: background 0.2s; }
.switch-slider::before { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #9fb8d4; transition: transform 0.2s; }
.switch input:checked + .switch-slider { background: #2f80ed; }
.switch input:checked + .switch-slider::before { transform: translateX(14px); background: #ffffff; }
.hint { margin: 6px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.point-list { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow: auto; }
.point-item { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border: 1px solid rgba(157, 188, 224, 0.16); border-radius: 5px; background: rgba(26, 44, 74, 0.6); }
.point-name { flex: 0 0 auto; color: #e8f1fb; font-size: 11px; }
.point-coord { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.point-actions { display: flex; gap: 4px; flex: 0 0 auto; }
.mini-button { height: 20px; padding: 0 6px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: #2c3a52; color: #c3d5e8; font-size: 10px; cursor: pointer; }
.mini-button.danger { border-color: rgba(255, 92, 92, 0.4); color: #ff9d9d; }
.empty-tip { padding: 10px 0; text-align: center; color: #7f96b3; font-size: 11px; }
.edit-mask { position: absolute; inset: 0; z-index: 20; display: grid; place-items: center; padding: 24px; background: rgba(8, 21, 40, 0.6); }
.edit-dialog { width: 100%; max-width: 360px; padding: 14px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 9px; background: rgba(12, 28, 56, 0.96); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.edit-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 10px; }
.edit-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.edit-field input[type="text"] { width: 100%; height: 26px; padding: 0 6px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: #1a2c4a; color: #e8f1fb; font-size: 11px; box-sizing: border-box; }
.coord-readonly { padding: 6px; border: 1px solid rgba(157, 188, 224, 0.18); border-radius: 4px; background: rgba(26, 44, 74, 0.4); color: #9fb8d4; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.attr-list { display: flex; flex-direction: column; gap: 4px; }
.attr-row { display: flex; gap: 4px; align-items: center; }
.attr-row input[type="text"] { flex: 1; min-width: 0; }
.attr-row .mini-button { flex: 0 0 auto; }
.add-attr { height: 24px; font-size: 10px; }
.edit-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 12px; }
.edit-actions .action-button { min-width: 64px; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
