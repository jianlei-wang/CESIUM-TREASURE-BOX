<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import * as Cesium from "cesium";
import {
  ControlPanel,
  InfoPanel,
  ScientificPanel,
  TimelineBar,
  TopBar,
} from "@rt/components";
import { useRedTideStore } from "@rt/stores/red-tide";
import { RedTideSystem } from "@rt/core/red-tide-system";
import "./styles.css";

const store = useRedTideStore();
const cesiumHost = ref<HTMLElement | null>(null);
const ready = ref(false);
const frameFps = ref(60);
const systemRef = shallowRef<RedTideSystem | null>(null);
const errorMessage = ref("");
const runtimeDiagnostics = ref("");

const dateText = computed(() => {
  const date = new Date("2026-06-15T00:00:00Z");
  date.setUTCSeconds(store.elapsedSeconds);
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
});

const renderOptions = computed(() => ({
  showVolume: store.showVolume,
  showSurface: store.showSurface,
  showFlow: store.showFlow,
  showSection: store.showSection,
  thresholdLow: Math.min(store.thresholdLow, store.thresholdHigh - 0.01),
  thresholdHigh: Math.max(store.thresholdHigh, store.thresholdLow + 0.01),
  density: store.density,
  surfaceOpacity: store.surfaceOpacity,
  flowOpacity: store.flowOpacity,
  particleStyle: store.particleStyle,
  renderMode: store.renderMode,
  isoValue: store.isoValue,
  isoThickness: store.isoThickness,
  clipEnabled: store.clipEnabled,
  clipDepth: store.clipDepth,
  sectionX: store.sectionX,
  sectionAxis: store.sectionAxis,
}));

let rafId = 0;
let lastFrame = performance.now();
let lastStatsUpdate = 0;
let lastSimulationTime = 0;
const startDate = Cesium.JulianDate.fromDate(new Date("2026-06-15T00:00:00Z"));
const scratchCurrent = new Cesium.JulianDate();

onMounted(() => {
  void initializeSystem();
});

async function initializeSystem(): Promise<void> {
  if (!cesiumHost.value) return;
  try {
    const system = await RedTideSystem.create(
      cesiumHost.value,
      store.studyArea,
      store.grid,
      {
        dtSeconds: 900,
        diffusion: store.diffusion,
        growthRate: store.growthRate,
        decayRate: store.decayRate,
        nutrient: store.nutrient,
        light: store.light,
        temperature: store.temperature,
        maxStepsPerFrame: 24,
      },
      renderOptions.value,
    );
    systemRef.value = system;
    system.setStations(store.stations, (station) => {
      store.selectedStation = station;
    });
    syncSimulationMetrics(system);
    system.cesium.setGlobeOpacity(store.globeOpacity);
    runtimeDiagnostics.value = `Cesium ${system.cesium.canvas.width}×${system.cesium.canvas.height} · Three ${system.three.renderer.domElement.width}×${system.three.renderer.domElement.height} · ${system.three.renderPathLabel} · objects ${system.three.sceneObjectCount} · ${system.computeMode}`;
    if (system.cesium.canvas.width < 2 || system.cesium.canvas.height < 2)
      throw new Error(
        "Cesium Canvas 尺寸为 0，请检查 .cesium-host 是否占满视口。",
      );
    ready.value = true;
    startLoop();
  } catch (error) {
    console.error(error);
    errorMessage.value =
      error instanceof Error ? error.message : "系统初始化失败。";
  }
}

watch(
  () => [
    store.diffusion,
    store.growthRate,
    store.decayRate,
    store.nutrient,
    store.light,
    store.temperature,
  ],
  () =>
    systemRef.value?.setSimulationParameters({
      diffusion: store.diffusion,
      growthRate: store.growthRate,
      decayRate: store.decayRate,
      nutrient: store.nutrient,
      light: store.light,
      temperature: store.temperature,
    }),
);

watch(
  () => [
    store.showVolume,
    store.showSurface,
    store.showFlow,
    store.thresholdLow,
    store.thresholdHigh,
    store.density,
    store.surfaceOpacity,
    store.flowOpacity,
    store.particleStyle,
    store.showSection,
    store.renderMode,
    store.isoValue,
    store.isoThickness,
    store.clipEnabled,
    store.clipDepth,
    store.sectionX,
    store.sectionAxis,
  ],
  () => systemRef.value?.setRenderOptions(renderOptions.value),
);

watch(
  () => store.globeOpacity,
  (value) => systemRef.value?.cesium.setGlobeOpacity(value),
);

function startLoop(): void {
  lastFrame = performance.now();
  lastStatsUpdate = lastFrame;
  rafId = requestAnimationFrame(loop);
}

function loop(now: number): void {
  const realSeconds = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  frameFps.value = Math.round(1 / Math.max(realSeconds, 1 / 120));

  if (store.playing && systemRef.value) {
    const simulationMultiplier = store.speed * 900;
    systemRef.value.tick(realSeconds, simulationMultiplier);
    store.elapsedSeconds = systemRef.value.elapsedSeconds;
    if (store.elapsedSeconds >= 48 * 3600) {
      store.elapsedSeconds = 48 * 3600;
      store.playing = false;
    }
  }

  if (
    systemRef.value &&
    now - lastStatsUpdate > 250 &&
    Math.abs(store.elapsedSeconds - lastSimulationTime) > 1
  ) {
    store.setStats(systemRef.value.stats);
    store.setSimulationMetrics(
      systemRef.value.computeMs,
      systemRef.value.computeMode,
    );
    lastStatsUpdate = now;
    lastSimulationTime = store.elapsedSeconds;
  }

  rafId = requestAnimationFrame(loop);
}

function onPlay(): void {
  store.playing = !store.playing;
}

async function onReset(): Promise<void> {
  store.playing = false;
  store.elapsedSeconds = 0;
  if (systemRef.value) {
    await systemRef.value.reset();
    store.elapsedSeconds = systemRef.value.elapsedSeconds;
    systemRef.value.cesium.viewer.clock.currentTime = startDate.clone();
    systemRef.value.requestRender();
    store.setStats(systemRef.value.stats);
    syncSimulationMetrics(systemRef.value);
  }
}

async function onSeek(value: number): Promise<void> {
  store.playing = false;
  store.elapsedSeconds = value;
  if (systemRef.value) {
    await systemRef.value.seekTo(value);
    store.elapsedSeconds = systemRef.value.elapsedSeconds;
    Cesium.JulianDate.addSeconds(startDate, value, scratchCurrent);
    systemRef.value.cesium.viewer.clock.currentTime = scratchCurrent.clone();
    systemRef.value.requestRender();
    store.setStats(systemRef.value.stats);
    syncSimulationMetrics(systemRef.value);
  }
}

function syncSimulationMetrics(system: RedTideSystem): void {
  store.elapsedSeconds = system.elapsedSeconds;
  store.setStats(system.stats);
  store.setSimulationMetrics(system.computeMs, system.computeMode);
  store.setDepthPipelineStatus(
    system.three.depthOcclusionSupported,
    system.three.pipelineLabel,
    system.cesium.terrainMode,
  );
  store.setRenderMetrics(system.three.lastGpuRenderMs);
}

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
  systemRef.value?.destroy();
  systemRef.value = null;
});
</script>

<template>
  <main class="rt-shell">
    <div ref="cesiumHost" class="cesium-host"></div>
    <div class="vignette"></div>

    <TopBar />
    <ControlPanel />
    <InfoPanel />
    <ScientificPanel />

    <section class="hud-left-bottom glass-panel">
      <div class="hud-title">研究区</div>
      <div>{{ store.studyArea.name }}</div>
      <div class="hud-coord">E 122.150° · N 30.950° · 深度 1,800m</div>
    </section>

    <section class="hud-right-top">
      <div class="date-pill">{{ dateText }}</div>
      <div class="fps-pill">{{ frameFps }} FPS</div>
    </section>

    <TimelineBar @play="onPlay" @reset="onReset" @seek="onSeek" />

    <div v-if="!ready && !errorMessage" class="loading-mask">
      <div class="loader-ring"></div>
      <div>正在初始化三维海洋仿真引擎…</div>
    </div>
    <div v-if="errorMessage" class="error-mask">
      <strong>系统初始化异常</strong>
      <span>{{ errorMessage }}</span>
      <span
        >请执行 npm install 后重新运行 npm run dev，并检查 Cesium
        资产复制是否正常。</span
      >
    </div>

    <div class="nav-hint">
      左键旋转 · 右键平移 · 滚轮缩放 · 点击监测站查看观测参数
    </div>
    <div v-if="runtimeDiagnostics" class="runtime-diagnostics">
      {{ runtimeDiagnostics }}
    </div>
  </main>
</template>
