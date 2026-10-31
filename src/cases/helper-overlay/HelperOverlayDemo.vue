<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import {
  BoxGeometry,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  Math as CesiumMath,
  Matrix4,
  PerInstanceColorAppearance,
  Primitive,
  Transforms
} from 'cesium'
import type { Viewer } from 'cesium'
import { overlayOf } from '../cesium-helpers-lib/packages/cesium-overlay/src/cesium-overlay.js'
import { useHelperViewer } from '../cesium-helpers-lib/use-helper-viewer'
import '../cesium-helpers-lib/helper-ui.css'

type Overlay = {
  line(points: unknown, options?: Record<string, unknown>): { move(points: unknown): void; hidden: boolean }
}

const container = ref<HTMLElement | null>(null)
const activeView = ref('above')
const occlude = ref(true)

let viewer: Viewer | null = null
let overlay: Overlay | null = null
let lines: Record<string, { move(points: unknown): void; hidden: boolean }> | null = null
let frame = Matrix4.IDENTITY
const views: Record<string, () => void> = {}

const HALF = 150
const N = 6
const SPACING = 60

function local(x: number, y: number, z: number): Cartesian3 {
  return Matrix4.multiplyByPoint(frame, new Cartesian3(x, y, z), new Cartesian3())
}

function buildLines(): void {
  if (!overlay) return
  const test = occlude.value ? 'depth' : false
  const [W, TOP] = [HALF + 40, 160]
  const square: [number, number][] = [
    [-W, -W],
    [W, -W],
    [W, W],
    [-W, W]
  ]
  lines = {
    frameBottom: overlay.line(square.map(([x, y]) => local(x, y, 0)), { closed: true, occlude: test, className: 'ov-frame' }),
    frameTop: overlay.line(square.map(([x, y]) => local(x, y, TOP)), { closed: true, occlude: test, className: 'ov-frame' }),
    uprights: overlay.line(square.map(([x, y]) => [local(x, y, 0), local(x, y, TOP)]), { occlude: test, className: 'ov-frame' }),
    plane: overlay.line(
      [local(-W, -W / 3, TOP), local(W, W / 3, TOP), local(W, W / 3, 0), local(-W, -W / 3, 0)],
      { closed: true, fill: true, occlude: test, className: 'ov-plane', strokes: ['edge', 'core'] }
    ),
    measure: overlay.line([local(-HALF, HALF + 30, 10), local(HALF, -HALF - 30, 120)], { occlude: test, className: 'ov-measure' }),
    ring: overlay.line(
      Array.from({ length: 48 }, (_, k) => local(W * 0.6 * Math.cos((k * Math.PI) / 24), W * 0.6 * Math.sin((k * Math.PI) / 24), 200)),
      {
        closed: true,
        className: 'ov-ring',
        // 自带遮挡判断：只画在画布左半边
        occlude: occlude.value
          ? (point: Cartesian3, at: { x: number }) => at.x < (viewer?.scene.canvas.clientWidth ?? 0) / 2
          : false
      }
    ),
    curve: overlay.line([], { occlude: test, className: 'ov-curve' })
  }
  const count = 160
  lines.curve.move(
    Array.from({ length: count }, (_, k) => {
      const t = k / (count - 1)
      return local(W * (2 * t - 1), W * 0.8 * Math.sin(t * 6 * Math.PI), 60 + 30 * Math.sin(t * 17 * Math.PI))
    })
  )
}

const { status } = useHelperViewer(container, { smooth: true }, (instance) => {
  viewer = instance
  instance.scene.globe.show = false
  if (instance.scene.skyAtmosphere) instance.scene.skyAtmosphere.show = false
  instance.scene.backgroundColor = Color.fromCssColorString('#5b6168')
  instance.scene.requestRenderMode = true
  const origin = Cartesian3.fromDegrees(7.863775, 46.686447, 600)
  frame = Transforms.eastNorthUpToFixedFrame(origin)

  const instances: GeometryInstance[] = []
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const height = 20 + ((i * 7 + j * 13) % 9) * 15
      instances.push(
        new GeometryInstance({
          geometry: BoxGeometry.fromDimensions({ dimensions: new Cartesian3(40, 40, height) }),
          modelMatrix: Matrix4.multiplyByTranslation(
            frame,
            new Cartesian3(i * SPACING - ((N - 1) * SPACING) / 2, j * SPACING - ((N - 1) * SPACING) / 2, height / 2),
            new Matrix4()
          ),
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(Color.fromHsl(0.55 + 0.1 * ((i + j) % 3), 0.35, 0.55))
          }
        })
      )
    }
  }
  instance.scene.primitives.add(
    new Primitive({
      geometryInstances: instances,
      appearance: new PerInstanceColorAppearance({ translucent: false, closed: true }),
      asynchronous: false
    })
  )

  overlay = overlayOf(instance) as Overlay
  buildLines()

  views.above = () => {
    instance.camera.setView({
      destination: local(-700, -700, 600),
      orientation: { heading: CesiumMath.toRadians(45), pitch: CesiumMath.toRadians(-30), roll: 0 }
    })
    instance.scene.requestRender()
  }
  views.side = () => {
    instance.camera.setView({
      destination: local(0, -650, 60),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-3), roll: 0 }
    })
    instance.scene.requestRender()
  }
  views.inside = () => {
    instance.camera.setView({
      destination: local(-HALF + 30, -HALF - 10, 40),
      orientation: { heading: CesiumMath.toRadians(30), pitch: CesiumMath.toRadians(-5), roll: 0 }
    })
    instance.scene.requestRender()
  }
  views.above()

  return () => {
    overlay = null
    lines = null
    viewer = null
  }
})

function view(name: string): void {
  activeView.value = name
  views[name]?.()
}

function toggleOcclude(): void {
  occlude.value = !occlude.value
  buildLines()
}

onBeforeUnmount(() => {
  overlay = null
  lines = null
})
</script>

<template>
  <div class="helper-shell">
    <div ref="container" class="helper-canvas"></div>

    <div class="helper-panel">
      <div class="helper-title">遮挡线叠加层</div>
      <p class="helper-hint">
        SVG 叠加层直接铺在画布之上：被建筑挡住的线段会自动切成虚线或隐藏。切换视角查看遮挡变化。
      </p>
      <div class="helper-actions">
        <button class="helper-button" :class="{ 'is-active': activeView === 'above' }" type="button" @click="view('above')">俯视</button>
        <button class="helper-button" :class="{ 'is-active': activeView === 'side' }" type="button" @click="view('side')">侧视</button>
        <button class="helper-button" :class="{ 'is-active': activeView === 'inside' }" type="button" @click="view('inside')">进入内部</button>
      </div>
      <div class="helper-row">
        <span class="helper-row-label">深度遮挡</span>
        <button class="helper-toggle" :class="{ 'is-on': occlude }" type="button" role="switch" :aria-checked="occlude" @click="toggleOcclude">
          <i></i>
        </button>
      </div>
    </div>

    <div v-if="status" class="helper-status">{{ status }}</div>
  </div>
</template>

<style>
.ov-frame.cesium-overlay-seen,
.ov-frame.cesium-overlay-hidden {
  stroke: #ffd23f;
}

.ov-plane.cesium-overlay-fill {
  fill: #fff;
}

.ov-plane.edge {
  stroke: #000;
  stroke-opacity: 0.5;
  stroke-width: 4;
}

.ov-plane.core {
  stroke: #fff;
  stroke-width: 2;
}

.ov-measure.cesium-overlay-seen,
.ov-measure.cesium-overlay-hidden {
  stroke: #3cf;
  stroke-width: 2;
}

.ov-ring.cesium-overlay-seen,
.ov-ring.cesium-overlay-hidden {
  stroke: #f6c;
}

.ov-curve.cesium-overlay-seen,
.ov-curve.cesium-overlay-hidden {
  stroke: #7f7;
}
</style>
