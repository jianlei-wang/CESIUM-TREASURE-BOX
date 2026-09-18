<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Color,
  Ellipsoid,
  Math as CesiumMath,
  SceneMode,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Entity,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

interface ContextMenuEntry {
  label: string
  callback: (data: ContextMenuData) => void
}

interface ContextMenuData {
  windowPosition?: { x: number; y: number }
  position?: Cartesian3
  wgs84Position?: { lng: number; lat: number; alt: number }
  surfacePosition?: Cartesian3
  wgs84SurfacePosition?: { lng: number; lat: number; alt: number }
}

interface PointEntity {
  id: number
  wgs84: { lng: number; lat: number; alt: number }
  entity: Entity
}

const container = ref<HTMLElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const enabled = ref(true)
const isLoaded = ref(false)

const menuVisible = ref(false)
const menuLeft = ref(0)
const menuTop = ref(0)
const menus = ref<ContextMenuEntry[]>([])
const currentInfo = ref('')
const currentData = ref<ContextMenuData | null>(null)

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let points: PointEntity[] = []
let nextPointId = 1

const defaultMenus: ContextMenuEntry[] = [
  {
    label: '飞行到此位置',
    callback: (data) => {
      const pos = data.wgs84SurfacePosition ?? data.wgs84Position
      if (!viewer || viewer.isDestroyed() || !pos) return
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(pos.lng, pos.lat, Math.max(pos.alt + 1500, 2000)),
        duration: 1.2
      })
    }
  },
  {
    label: '在此添加标记点',
    callback: (data) => {
      const pos = data.wgs84SurfacePosition ?? data.wgs84Position
      if (!viewer || viewer.isDestroyed() || !pos) return
      const position = Cartesian3.fromDegrees(pos.lng, pos.lat, pos.alt)
      const entity = viewer.entities.add({
        position,
        point: {
          pixelSize: 12,
          color: Color.fromCssColorString('#ffb648'),
          outlineColor: Color.WHITE,
          outlineWidth: 2
        },
        label: {
          text: `P${points.length + 1}`,
          font: '12px sans-serif',
          fillColor: Color.WHITE,
          pixelOffset: new Cartesian2(0, -18),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      })
      points.push({ id: nextPointId++, wgs84: pos, entity })
    }
  },
  {
    label: '清除全部标记',
    callback: () => {
      if (!viewer || viewer.isDestroyed()) return
      points.forEach((p) => viewer?.entities.remove(p.entity))
      points = []
    }
  },
  {
    label: '飞到默认位置',
    callback: () => {
      if (viewer && !viewer.isDestroyed()) viewer.camera.flyHome(1.5)
    }
  },
  {
    label: '取消飞行',
    callback: () => {
      if (viewer && !viewer.isDestroyed()) viewer.camera.cancelFlight()
    }
  }
]

function onRightClick(movement: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !enabled.value) return
  const scene = viewer.scene
  const data: ContextMenuData = { windowPosition: { x: movement.position.x, y: movement.position.y } }

  if (scene.pickPositionSupported) {
    data.position = scene.pickPosition(movement.position)
  }
  if (data.position) {
    const c = Ellipsoid.WGS84.cartesianToCartographic(data.position)
    if (c) {
      data.wgs84Position = { lng: CesiumMath.toDegrees(c.longitude), lat: CesiumMath.toDegrees(c.latitude), alt: c.height }
    }
  }

  let surfacePosition: Cartesian3 | undefined
  if (scene.mode === SceneMode.SCENE3D) {
    const ray = scene.camera.getPickRay(movement.position)
    surfacePosition = ray ? scene.globe.pick(ray, scene) ?? undefined : undefined
  } else {
    surfacePosition = scene.camera.pickEllipsoid(movement.position, Ellipsoid.WGS84) ?? undefined
  }
  if (surfacePosition) {
    data.surfacePosition = surfacePosition
    const c = Ellipsoid.WGS84.cartesianToCartographic(surfacePosition)
    if (c) {
      data.wgs84SurfacePosition = { lng: CesiumMath.toDegrees(c.longitude), lat: CesiumMath.toDegrees(c.latitude), alt: c.height }
    }
  }

  currentData.value = data
  const shown = data.wgs84SurfacePosition ?? data.wgs84Position
  if (shown) {
    currentInfo.value = `经度 ${shown.lng.toFixed(6)}° / 纬度 ${shown.lat.toFixed(6)}° / 高 ${shown.alt.toFixed(1)} m`
  } else {
    currentInfo.value = '当前位置未拾取到地面点'
  }
  menus.value = [...defaultMenus]
  menuLeft.value = movement.position.x
  menuTop.value = movement.position.y
  menuVisible.value = true
}

function onLeftClick(): void {
  menuVisible.value = false
}

function runMenu(item: ContextMenuEntry): void {
  item.callback(currentData.value ?? {})
  menuVisible.value = false
}

function onEnableChange(value: boolean): void {
  if (!handler || !viewer || viewer.isDestroyed()) return
  if (value) {
    handler.setInputAction(onRightClick, ScreenSpaceEventType.RIGHT_CLICK)
    handler.setInputAction(onLeftClick, ScreenSpaceEventType.LEFT_CLICK)
  } else {
    handler.removeInputAction(ScreenSpaceEventType.RIGHT_CLICK)
    handler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK)
  }
}

onMounted(async () => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.camera.setView({ destination: Cartesian3.fromDegrees(118.8, 32.05, 260000) })
    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction(onRightClick, ScreenSpaceEventType.RIGHT_CLICK)
    handler.setInputAction(onLeftClick, ScreenSpaceEventType.LEFT_CLICK)
    isLoaded.value = true
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (handler && !handler.isDestroyed()) handler.destroy()
  handler = undefined
  if (viewer && !viewer.isDestroyed()) {
    points.forEach((p) => viewer?.entities.remove(p.entity))
    points = []
  }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="widget-shell">
    <div ref="container" class="cesium-container"></div>

    <div ref="menuEl" v-show="menuVisible" class="cesium-context-menu" :style="{ left: menuLeft + 'px', top: menuTop + 'px' }">
      <ul class="menu-list">
        <li v-if="currentInfo" class="menu-item menu-info">{{ currentInfo }}</li>
        <li v-for="item in menus" :key="item.label" class="menu-item">
          <a href="javascript:void(0)" @click.prevent="runMenu(item)">{{ item.label }}</a>
        </li>
      </ul>
    </div>

    <div class="control-panel">
      <div class="panel-title">右键菜单控件</div>
      <div class="row">
        <span class="row-label">启用右键菜单</span>
        <button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '关闭右键菜单' : '启用右键菜单'" @click="enabled = !enabled; onEnableChange(enabled)"><i></i></button>
      </div>
      <p class="hint">
        在地图上任意位置单击鼠标右键，弹出上下文菜单：可飞行到此位置、添加标记点、清除标记、飞回默认位置或取消飞行。菜单顶部显示拾取点的经纬度与高程。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.widget-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.cesium-context-menu { position: absolute; top: 0; left: 0; z-index: 20; min-width: 150px; background: rgba(43, 44, 47, 0.88); border: 1px solid #2b2c2f; border-radius: 4px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4); cursor: pointer; }
.menu-list { margin: 0; padding: 4px 0; width: 100%; color: #fff; }
.menu-item { list-style: none; width: 100%; font-size: 13px; }
.menu-item + .menu-item { border-top: 1px solid hsla(0, 0%, 100%, 0.08); }
.menu-item a { color: #fff; display: block; padding: 7px 12px; text-decoration: none; }
.menu-item a:hover { background-color: #444d59; }
.menu-info { padding: 7px 12px; color: #9dbce0; font-size: 11px; line-height: 1.5; white-space: pre-line; word-break: break-all; }
.control-panel { position: absolute; top: 12px; left: 12px; z-index: 10; width: 260px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.row-label { color: #c3d5e8; font-size: 11px; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157, 188, 224, 0.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform 0.2s; }
.toggle.on { background: #2f80ed; }
.toggle.on i { transform: translateX(18px); }
.hint { margin: 10px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
