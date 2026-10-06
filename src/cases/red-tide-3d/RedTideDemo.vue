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
  AnalysisPanel,
  LayerPanel,
  LegendPanel,
  MonitoringPanel,
  OverviewPanel,
  ParameterPanel,
  SimulationPanel,
  TimelineBar,
  TopBar,
} from "@rt/components";
import {
  SIMULATION_MAX_SECONDS,
  useRedTideStore,
} from "@rt/stores/red-tide";
import { RedTideSystem } from "@rt/core/red-tide-system";
import "./styles.css";

const store = useRedTideStore();
const cesiumHost = ref<HTMLElement | null>(null);
const ready = ref(false);
const frameFps = ref(60);
const systemRef = shallowRef<RedTideSystem | null>(null);
const errorMessage = ref("");

const renderOptions = computed(() => ({
  showVolume: store.showVolume,
  showSurface: store.showSurface,
  showFlow: store.showFlow,
  showSection: store.showSection,
  thresholdLow: Math.min(store.thresholdLow, store.thresholdHigh - 0.01),
  thresholdHigh: Math.max(store.thresholdHigh, store.thresholdLow + 0.01),
  density: store.density,
  verticalExaggeration: store.verticalExaggeration,
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
let smoothedFps = 60;
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
    if (import.meta.env.DEV) (window as unknown as { __rtSystem?: RedTideSystem }).__rtSystem = system;
    system.setStations(store.stations, (station) => {
      store.selectedStation = station;
    });
    syncSimulationMetrics(system);
    system.cesium.setGlobeOpacity(store.globeOpacity);
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
  () => {
    systemRef.value?.setSimulationParameters({
      diffusion: store.diffusion,
      growthRate: store.growthRate,
      decayRate: store.decayRate,
      nutrient: store.nutrient,
      light: store.light,
      temperature: store.temperature,
    });
    void onReset();
  },
);

watch(
  () => [
    store.showVolume,
    store.showSurface,
    store.showFlow,
    store.thresholdLow,
    store.thresholdHigh,
    store.density,
    store.verticalExaggeration,
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
  const rawSeconds = (now - lastFrame) / 1000;
  lastFrame = now;
  // FPS 用未截断的真实帧间隔做平滑，避免低帧率时被仿真用的 0.05s 上限“钉”在 20 FPS。
  if (rawSeconds > 0.0005) {
    smoothedFps += (1 / rawSeconds - smoothedFps) * 0.2;
    frameFps.value = Math.round(smoothedFps);
  }

  if (store.playing && systemRef.value) {
    // 仿真按真实墙钟时间推进（限幅仅用于防止后台标签页跳变）；
    // 低帧率环境下也能持续跨过 dtSeconds 门槛，使顶栏时间实时变化。
    const delta = Math.min(rawSeconds, 0.5);
    const simulationMultiplier = store.speed * 900;
    systemRef.value.tick(delta, simulationMultiplier);
    store.elapsedSeconds = systemRef.value.elapsedSeconds;
    if (store.elapsedSeconds >= SIMULATION_MAX_SECONDS) {
      store.elapsedSeconds = SIMULATION_MAX_SECONDS;
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
    <TopBar class="rt-header" :fps="frameFps" />

    <aside class="rt-dock rt-dock-left">
      <OverviewPanel v-if="store.activeModule === 'overview'" />
      <SimulationPanel v-else-if="store.activeModule === 'simulation'" />
      <ParameterPanel v-else-if="store.activeModule === 'parameters'" />
      <AnalysisPanel v-else-if="store.activeModule === 'analysis'" />
      <MonitoringPanel v-else-if="store.activeModule === 'monitoring'" />
    </aside>

    <section class="rt-stage">
      <div ref="cesiumHost" class="cesium-host"></div>
      <div class="vignette"></div>

      <LegendPanel class="stage-legend" />
    </section>

    <aside class="rt-dock rt-dock-right">
      <LayerPanel class="dock-layer" />
    </aside>

    <TimelineBar class="rt-footer" @play="onPlay" @reset="onReset" @seek="onSeek" />

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
  </main>
</template>
