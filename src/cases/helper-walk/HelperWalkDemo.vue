<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import {
  Cartesian3,
  Cesium3DTileset,
  Cartographic,
  Color,
  HeadingPitchRoll,
  Matrix4,
  Math as CesiumMath,
  Transforms,
  sampleTerrainMostDetailed
} from 'cesium'
import CesiumWalk from '../cesium-helpers-lib/packages/cesium-walk/src/cesium-walk.js'
import { ObstacleProbe, tilesetObstacle } from '../cesium-helpers-lib/packages/cesium-obstacles/src/cesium-obstacles.js'
import { useHelperViewer } from '../cesium-helpers-lib/use-helper-viewer'
import HelperToggle from '../cesium-helpers-lib/HelperToggle.vue'
import '../cesium-helpers-lib/helper-ui.css'

const BUILDINGS = 'https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json'
const START = Cartographic.fromDegrees(7.857, 46.6866)
const WALLS = [
  { east: 0, north: 20, width: 6, heading: 0, alpha: 1 },
  { east: -6, north: 12, width: 6, heading: 45, alpha: 1 },
  { east: 6, north: 12, width: 6, heading: 0, alpha: 0.5 }
]

type Walk = { active: boolean; collision: boolean; obstacleAhead?: (toward: Cartesian3, key: string) => unknown }

const container = ref<HTMLElement | null>(null)
const walking = ref(false)
const collision = ref(true)
let walk: Walk | null = null

const { viewer, status } = useHelperViewer(container, {}, async (instance) => {
  const frame = Transforms.eastNorthUpToFixedFrame(Cartographic.toCartesian(START))
  const [start, ...ground] = await sampleTerrainMostDetailed(instance.terrainProvider, [
    START,
    ...WALLS.map(({ east, north }) =>
      Cartographic.fromCartesian(Matrix4.multiplyByPoint(frame, new Cartesian3(east, north, 0), new Cartesian3()))
    )
  ])
  instance.camera.cancelFlight()
  instance.camera.setView({
    destination: Cartesian3.fromRadians(start.longitude, start.latitude, (start.height ?? 0) + 2),
    orientation: { heading: 0, pitch: 0, roll: 0 }
  })
  WALLS.forEach(({ width, heading, alpha }, index) => {
    const spot = ground[index]
    const position = Cartesian3.fromRadians(spot.longitude, spot.latitude, (spot.height ?? 0) + 1.5)
    instance.entities.add({
      position,
      orientation: Transforms.headingPitchRollQuaternion(position, new HeadingPitchRoll(CesiumMath.toRadians(heading), 0, 0)),
      box: { dimensions: new Cartesian3(width, 0.3, 5), material: Color.ORANGE.withAlpha(alpha) }
    })
  })

  const buildings = await Cesium3DTileset.fromUrl(BUILDINGS, { maximumScreenSpaceError: 24 })
  instance.scene.primitives.add(buildings)

  const mode = new CesiumWalk(instance) as Walk
  walk = mode
  // 建筑用瓦片射线阻挡，墙体等图元用深度探测
  const probe = new ObstacleProbe(instance.scene)
  mode.obstacleAhead = (toward: Cartesian3, key: string) =>
    tilesetObstacle(instance.scene, buildings, instance.camera.positionWC, toward) ?? probe.ahead(toward, key)
  mode.collision = collision.value

  return () => {
    mode.active = false
    walk = null
  }
})

function toggleWalk(value: boolean): void {
  walking.value = value
  if (walk) walk.active = value
}

function toggleCollision(value: boolean): void {
  collision.value = value
  if (walk) walk.collision = value
}

onBeforeUnmount(() => {
  if (walk) walk.active = false
})
</script>

<template>
  <div class="helper-shell">
    <div ref="container" class="helper-canvas"></div>

    <div class="helper-panel">
      <div class="helper-title">步行漫游</div>
      <p class="helper-hint">
        开启后用 WASD 或方向键行走，按住 Shift 奔跑，空格跳跃；相机会贴合地形，遇到建筑与墙体停下。
      </p>
      <HelperToggle :model-value="walking" label="步行模式" @update:model-value="toggleWalk" />
      <HelperToggle :model-value="collision" label="碰撞检测" @update:model-value="toggleCollision" />
    </div>

    <div v-if="status" class="helper-status">{{ status }}</div>
  </div>
</template>
