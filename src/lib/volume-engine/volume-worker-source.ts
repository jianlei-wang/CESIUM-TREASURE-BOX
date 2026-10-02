/**
 * Volume Engine —— Web Worker 源码（内联字符串，运行时经 Blob URL 创建）
 *
 * 承担全部 CPU 密集的体数据生产，避免阻塞主线程的 Vue UI 与 Cesium 渲染：
 *   - init：按场景生成确定性上下文（对流单体、污染源与站点、涡旋、地层、障碍物等）；
 *   - tile：按 VoxelProvider 的瓦片请求，在规则网格上解析式采样标量/分类场，打包为 VEC4 元数据；
 *   - slice：在任意剖切平面上逐像素采样，回传原始值/分类码与有效掩膜；
 *   - particleInit / particleTick：向量场粒子平流，供风场与 CFD 叠加显示。
 *
 * 所有场均为解析式或轻量随机，无需预生成点云，天然支持多级 LOD 与时间步切换；
 * 通过 postMessage 的 Transferable 直接转移 TypedArray，无拷贝、少 GC。
 */

export const VOLUME_WORKER_SOURCE = String.raw`
'use strict';

let sceneKind = '';
let params = {};
let ctx = null;
let particleState = null;
let geometry = null;

// 时间步瓦片缓存：播放 / 拖动时间轴时避免重复解析采样
var tileCache = new Map();
var tileCacheEpoch = -1;
var TILE_CACHE_MAX = 240;

self.onmessage = function (event) {
  const message = event.data;
  if (!message) return;
  switch (message.type) {
    case 'init': handleInit(message); break;
    case 'tile': handleTile(message); break;
    case 'slice': handleSlice(message); break;
    case 'particleInit': handleParticleInit(message); break;
    case 'particleTick': handleParticleTick(message); break;
    case 'analyze': handleAnalyze(message); break;
    case 'dispose': particleState = null; ctx = null; tileCache.clear(); break;
    default: break;
  }
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

const LITHO_COLORS = {
  1: [139 / 255, 69 / 255, 19 / 255],
  2: [210 / 255, 180 / 255, 140 / 255],
  3: [192 / 255, 192 / 255, 192 / 255],
  4: [128 / 255, 128 / 255, 128 / 255],
  5: [105 / 255, 105 / 255, 105 / 255],
  6: [75 / 255, 0 / 255, 130 / 255]
};

/* ------------------------------------------------------------------ *
 * PM2.5 领域配置：体域物理尺度与固定污染源清单
 * ------------------------------------------------------------------ */

var PM25_WIDTH = 40000;
var PM25_HEIGHT = 2500;

// 固定源清单：位置/类型/源高在任何参数下保持一致，仅“启用数量”可调，
// 保证调整源数量时既有污染源不跳变、空间格局可追踪。
var PM25_SOURCE_DEFS = [
  { id: 'S01', name: '东部电厂烟囱', type: 'stack', x: 0.30, y: 0.34, height: 0.10, strength: 1.00, phase: 0.0 },
  { id: 'S02', name: '化工园区烟囱', type: 'stack', x: 0.25, y: 0.47, height: 0.12, strength: 0.92, phase: 0.7 },
  { id: 'S03', name: '钢铁厂烟囱', type: 'stack', x: 0.37, y: 0.24, height: 0.09, strength: 0.96, phase: 1.4 },
  { id: 'S04', name: '中心城区面源', type: 'area', x: 0.52, y: 0.50, height: 0.012, strength: 0.72, phase: 0.3 },
  { id: 'S05', name: '老城面源', type: 'area', x: 0.44, y: 0.58, height: 0.010, strength: 0.62, phase: 2.1 },
  { id: 'S06', name: '城北面源', type: 'area', x: 0.57, y: 0.63, height: 0.011, strength: 0.55, phase: 3.2 },
  { id: 'S07', name: '绕城高速', type: 'road', x: 0.42, y: 0.44, height: 0.004, strength: 0.52, phase: 0.9, heading: 30, length: 0.52 },
  { id: 'S08', name: '东西主干道', type: 'road', x: 0.55, y: 0.40, height: 0.004, strength: 0.46, phase: 1.8, heading: 115, length: 0.42 },
  { id: 'S09', name: '港口物流通道', type: 'road', x: 0.30, y: 0.66, height: 0.004, strength: 0.40, phase: 2.5, heading: 70, length: 0.36 },
  { id: 'S10', name: '远郊面源', type: 'area', x: 0.67, y: 0.30, height: 0.010, strength: 0.34, phase: 4.1 }
];

var PM25_STATION_KINDS = ['urban', 'urban', 'traffic', 'industry', 'urban', 'background'];

function preparePm25(p) {
  var defs = PM25_SOURCE_DEFS;
  var active = p.activeSources != null ? p.activeSources : (p.sources != null ? p.sources : 5);
  active = Math.max(1, Math.min(defs.length, Math.round(active)));
  var sources = [];
  for (var i = 0; i < active; i += 1) {
    var d = defs[i];
    sources.push({
      id: d.id,
      name: d.name,
      type: d.type,
      index: i,
      x: d.x,
      y: d.y,
      height: d.height,
      strength: d.strength,
      phase: d.phase,
      heading: d.heading || 0,
      length: d.length || 0
    });
  }
  var stations = [];
  var rand = mulberry32(((p.seed || 1) + 7919) >>> 0);
  for (var s = 0; s < 36; s += 1) {
    var kind = PM25_STATION_KINDS[Math.floor(rand() * PM25_STATION_KINDS.length)];
    var idNum = (s + 1 < 10 ? '0' : '') + (s + 1);
    var bias = kind === 'background' ? 0.82 : (kind === 'industry' ? 1.18 : (kind === 'traffic' ? 1.12 : 0.94 + 0.12 * rand()));
    stations.push({
      index: s,
      id: 'ST' + idNum,
      name: '监测站 ST' + idNum,
      kind: kind,
      x: 0.06 + 0.88 * rand(),
      y: 0.06 + 0.88 * rand(),
      bias: bias,
      residual: 0
    });
  }
  return { kind: 'pm25', sources: sources, stations: stations, diagnosticsReady: false };
}

/* ---- PM2.5 辅助函数 ---- */

function hash01(n) {
  var x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/* 监测同化：由确定性观测噪声 + 站点类型系统偏差生成残差，供时空订正使用 */
function computePm25StationDiagnostics() {
  var tn = 0.25;
  for (var i = 0; i < ctx.stations.length; i += 1) {
    var st = ctx.stations[i];
    var raw = pm25Raw(st.x, st.y, 0.012, tn, 'pm25').conc;
    var noise = (hash01(i * 97.13 + 11.7) - 0.5) * 14;
    var observed = clamp(raw * st.bias + noise, 0, 600);
    st.residual = observed - raw;
  }
  ctx.diagnosticsReady = true;
}

function pm25StationObserved(i, raw, tn) {
  var st = ctx.stations[i];
  var noise = (hash01(i * 97.13 + tn * 53.7 + 11.7) - 0.5) * 14;
  return clamp(raw * st.bias + noise, 0, 600);
}

function pm25StationCorrection(nx, ny) {
  var num = 0;
  var den = 0;
  for (var i = 0; i < ctx.stations.length; i += 1) {
    var st = ctx.stations[i];
    var dx = nx - st.x;
    var dy = ny - st.y;
    var w = 1 / (dx * dx + dy * dy + 0.006);
    num += w * st.residual;
    den += w;
  }
  return den > 0 ? num / den : 0;
}

/* 气象条件：风向（来向）缓慢摆动、风速阵性脉动、边界层高度与稳定度 */
function pm25Meteorology(tn) {
  var from = params.windFrom != null ? params.windFrom : (params.windDir != null ? params.windDir : 235);
  var baseSpeed = params.windSpeed != null ? params.windSpeed : 4.5;
  var meander = 0.20 * Math.sin(tn * 6.283 * 0.5 + 0.7) + 0.07 * Math.sin(tn * 6.283 * 2.3 + 1.1);
  var dirFrom = from + meander * 16;
  var flow = (dirFrom * Math.PI) / 180 + Math.PI;
  var gust = 1 + 0.18 * Math.sin(tn * 6.283 * 1.5 + 0.4);
  return {
    wx: Math.cos(flow),
    wy: Math.sin(flow),
    speed: baseSpeed * gust,
    from: dirFrom,
    blh: params.blh != null ? params.blh : 0.35,
    stability: params.stability != null ? params.stability : 0.5
  };
}

/* 边界层风廓线：幂律，10 m 处为 1，1500 m 处约 1.9（风切变随高度增强输运） */
function pm25Shear(nz) {
  var zM = Math.max(nz, 0.0005) * PM25_HEIGHT;
  return Math.min(2.6, Math.pow(Math.max(zM, 2) / 10, 0.16));
}

/* 混合层盖：边界层内充分混合，边界层顶以上浓度快速衰减 */
function pm25Mix(nz, blh) {
  var top = smoothstep(blh + 0.16, blh - 0.02, nz);
  return 0.10 + 0.90 * top;
}

/* 污染物类型 → 排放权重与大气寿命系数（道路源 NO2/PM10 权重高且寿命短） */
function pm25Emission(type, channel) {
  if (channel === 'pm10') {
    var w10 = type === 'road' ? 1.7 : (type === 'area' ? 1.05 : 0.6);
    return { weight: w10, life: type === 'road' ? 0.75 : 0.9 };
  }
  if (channel === 'no2') {
    var wno = type === 'road' ? 1.9 : (type === 'stack' ? 1.15 : 0.45);
    return { weight: wno, life: type === 'road' ? 0.6 : 0.85 };
  }
  return { weight: 1, life: type === 'road' ? 0.85 : 1 };
}

function pm25Background(channel, nz, tn) {
  var base = params.background != null ? params.background : 22;
  var diurnal = 1 + 0.18 * Math.sin(tn * 6.283 - 1.4);
  if (channel === 'pm10') return (base * 1.8 + 12) * diurnal * (1 - 0.35 * nz);
  if (channel === 'no2') return (base * 0.4 + 6) * (1 + 0.25 * Math.sin(tn * 6.283 - 2.2)) * (1 - 0.5 * nz);
  return base * diurnal * (1 - 0.42 * nz);
}

/*
 * 单个源的高斯烟羽项：下风向输运 + 侧向扩散 + 垂向扩散。
 * 风速参与“拉伸 / 稀释 / 收窄”三个作用，稳定度控制扩散强弱，
 * 边界层高度约束垂向混合范围，源高与浮力抬升决定羽流中心高度。
 */
function pm25SourceTerm(s, nx, ny, nz, tn, met, channel) {
  var dx = nx - s.x;
  var dy = ny - s.y;
  // 风切变：高度越高风速越大，同一水平位置在高层的等效下风向距离被拉长，
  // 使羽流中心随高度向下风向倾斜，形成“随高度改变的输运方向”。
  var shear = pm25Shear(nz);
  var down = (dx * met.wx + dy * met.wy) * shear;
  var cross = -dx * met.wy + dy * met.wx;

  var stretch = clamp(met.speed / 4.5, 0.4, 2.4);
  var dilution = Math.pow(4.5 / Math.max(1.6, met.speed), 0.6);
  var stabMix = 1.25 - 0.65 * met.stability;
  var windNarrow = 1 / (0.55 + 0.45 * stretch);

  // 污染物独立扩散参数：粗颗粒（PM10）横向更宽、垂向沉降更快；
  // NO₂ 反应性气体寿命短、扩散更窄，避免三通道退化为同一烟羽的等比缩放。
  var dispY = channel === 'pm10' ? 1.25 : (channel === 'no2' ? 0.85 : 1);
  var dispZ = channel === 'pm10' ? 1.15 : (channel === 'no2' ? 0.8 : 1);

  var em = pm25Emission(s.type, channel);
  var pulse = channel === 'pm25'
    ? 1 + 0.35 * Math.sin(s.phase + tn * 6.283 - 1.2)
    : 0.62 + 0.38 * Math.sin(s.phase + tn * 6.283);

  var sigY = (0.045 + 0.26 * Math.max(down, 0)) * windNarrow * stabMix * dispY;
  var sigZ = (0.03 + 0.16 * Math.max(down, 0)) * windNarrow * stabMix * dispZ;

  var he = s.height;
  if (s.type === 'stack') he += 0.09 * s.strength / Math.max(0.7, stretch);
  if (s.type === 'area') { sigY += 0.06; sigZ += 0.05; }
  if (s.type === 'road') sigY += 0.085;

  var within = down > 0.005 || s.type === 'area';
  var conc = 0;
  var near = 0;

  if (within) {
    var decayLen = (s.type === 'road' ? 0.42 : 0.62) * (0.6 + 0.4 * stretch);
    var decay = Math.exp(-Math.max(down, 0) / decayLen / em.life);
    var lateral = Math.exp(-(cross * cross) / (2 * sigY * sigY + 1e-6));
    var vertical = Math.exp(-Math.pow((nz - he) / (sigZ + 0.02), 2));
    var amp = (s.strength * pulse * em.weight * 24 * dilution) / (sigY + 0.03);
    conc = amp * lateral * vertical * decay * pm25Mix(nz, met.blh);
  }

  // 面源近域补充：不设下风向门限，保证城区面源在地面形成连片高值
  if (s.type === 'area') {
    var nd = Math.sqrt(dx * dx + dy * dy);
    near = s.strength * em.weight * 34 * Math.exp(-(nd * nd) / (2 * 0.09 * 0.09)) * pm25Mix(nz, met.blh);
  }
  return { conc: conc, near: near };
}

function pm25ChannelMax(channel) {
  if (channel === 'pm10') return 500;
  if (channel === 'no2') return 200;
  return 300;
}

/* 原始浓度场（不含监测订正），供站点诊断与主采样共用，避免循环依赖 */
function pm25Raw(nx, ny, nz, tn, channel) {
  var met = pm25Meteorology(tn);
  var conc = pm25Background(channel, nz, tn);
  var minDist = 10;
  for (var i = 0; i < ctx.sources.length; i += 1) {
    var s = ctx.sources[i];
    var t = pm25SourceTerm(s, nx, ny, nz, tn, met, channel);
    conc += t.conc + t.near;
    var dx = nx - s.x;
    var dy = ny - s.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < minDist) minDist = d;
  }
  var correct = params.correct != null ? params.correct : 0;
  if (correct > 0.5 && channel === 'pm25' && ctx.diagnosticsReady) {
    conc += pm25StationCorrection(nx, ny) * 0.85;
  }
  return { conc: conc, minDist: minDist, met: met };
}

/* ------------------------------------------------------------------ *
 * 场景上下文构建
 * ------------------------------------------------------------------ */

function prepare(kind, p) {
  const rand = mulberry32(p.seed || 1);
  if (kind === 'radar') {
    const cells = [];
    const count = Math.max(1, Math.round(p.cells || 6));
    for (let i = 0; i < count; i += 1) {
      cells.push({
        x: 0.22 + 0.56 * rand(),
        y: 0.22 + 0.56 * rand(),
        sig: 0.045 + 0.095 * rand(),
        peak: 46 + 22 * rand(),
        top: 0.5 + 0.46 * rand(),
        phase: rand() * 6.283,
        vx: (rand() - 0.5) * 0.5,
        vy: (rand() - 0.5) * 0.5,
        tilt: (rand() - 0.5) * 0.25
      });
    }
    return { kind, cells };
  }
  if (kind === 'pm25') {
    return preparePm25(p);
  }
  if (kind === 'wind') {
    const vortices = [];
    const count = Math.max(0, Math.round(p.vortices || 3));
    for (let i = 0; i < count; i += 1) {
      vortices.push({
        x: 0.2 + 0.6 * rand(),
        y: 0.2 + 0.6 * rand(),
        radius: 0.08 + 0.1 * rand(),
        strength: (rand() > 0.5 ? 1 : -1) * (0.5 + 0.8 * rand())
      });
    }
    return { kind, vortices };
  }
  if (kind === 'geology') {
    // 地层层序：自地表向下的归一化埋深接触面（接触面之上为上一层）
    // 1 表土层 / 2 砂岩 / 3 页岩 / 4 石灰岩 / 5 花岗岩 / 6 基岩
    var radius = p.intrusion != null ? p.intrusion : 0.12;
    return {
      kind,
      contacts: [0.09, 0.22, 0.4, 0.6, 0.8],
      intrusion: { x: 0.64, y: 0.42, depth: 0.58, rx: radius, rz: radius * 1.35 }
    };
  }
  if (kind === 'cfd') {
    const boxes = [];
    const on = p.obstacle == null ? true : p.obstacle > 0.5;
    if (on && geometry && geometry.length >= 5) {
      for (let i = 0; i + 4 < geometry.length; i += 5) {
        boxes.push({
          x0: geometry[i],
          x1: geometry[i + 1],
          y0: geometry[i + 2],
          y1: geometry[i + 3],
          z1: geometry[i + 4]
        });
      }
    }
    const sx = p.sourceX != null ? p.sourceX : 0.5;
    const sy = p.sourceY != null ? p.sourceY : 0.5;
    return { kind, buildings: boxes, source: { x: sx, y: sy } };
  }
  return { kind };
}

function handleInit(message) {
  const started = performance.now();
  sceneKind = message.scene;
  params = message.params || {};
  geometry = message.geometry || null;
  tileCache.clear();
  tileCacheEpoch = message.epoch;
  ctx = prepare(sceneKind, params);
  const extra = { buildTime: performance.now() - started };
  if (sceneKind === 'pm25') {
    computePm25StationDiagnostics();
    const stationPos = new Float32Array(ctx.stations.length * 2);
    const stationVal = new Float32Array(ctx.stations.length);
    let max = 0;
    for (let i = 0; i < ctx.stations.length; i += 1) {
      const s = ctx.stations[i];
      stationPos[i * 2] = s.x;
      stationPos[i * 2 + 1] = s.y;
      const raw = pm25Raw(s.x, s.y, 0.012, 0.25, 'pm25').conc;
      const v = pm25StationObserved(i, raw, 0.25);
      stationVal[i] = v;
      if (v > max) max = v;
    }
    extra.stationMax = max;
    self.postMessage(
      { type: 'initDone', epoch: message.epoch, buildTime: extra.buildTime, stations: { positions: stationPos, values: stationVal } },
      [stationPos.buffer, stationVal.buffer]
    );
    return;
  }
  self.postMessage({ type: 'initDone', epoch: message.epoch, buildTime: extra.buildTime });
}

/* ------------------------------------------------------------------ *
 * 各场景场函数
 * ------------------------------------------------------------------ */

function radarValue(nx, ny, nz, tn) {
  let best = 0;
  for (let i = 0; i < ctx.cells.length; i += 1) {
    const c = ctx.cells[i];
    const drift = params.wind || 0.5;
    const cx = c.x + c.vx * tn * drift;
    const cy = c.y + c.vy * tn * drift;
    const dx = nx - cx;
    const dy = ny - cy;
    const horiz = Math.exp(-(dx * dx + dy * dy) / (2 * c.sig * c.sig));
    const pulse = 0.72 + 0.28 * Math.sin(c.phase + tn * 6.283);
    const shear = 1 - c.tilt * nz;
    let vert;
    if (nz <= c.top) {
      vert = Math.exp(-Math.pow((nz - 0.26) / 0.55, 2));
    } else {
      vert = 0.4 * Math.exp(-Math.pow((nz - c.top) / 0.05, 2));
    }
    const v = c.peak * pulse * horiz * vert * shear;
    if (v > best) best = v;
  }
  let dbz = best;
  if (best > 6) dbz += 13 * Math.exp(-Math.pow((nz - 0.12) / 0.028, 2));
  if (nz < 0.008) dbz += 6 * Math.exp(-((nx - 0.5) * (nx - 0.5) + (ny - 0.5) * (ny - 0.5)) / 0.002);

  // 雷达坐标系：以雷达站为中心的极坐标 + 波束几何
  const g = radarGeometry(nx, ny, nz, tn);
  dbz *= 0.55 + 0.45 * g.coverage;
  if (dbz < 4) dbz = 0;
  const value = clamp(dbz, 0, 70);
  return {
    value: value,
    valid: g.coverage > 0.015 && value > 3 ? 1 : 0,
    coverage: g.coverage,
    density: smoothstep(5, 50, value),
    quality: g.quality
  };
}

/* 雷达覆盖场：距离圈、波束抬升、体域边界淡出、站顶静锥区与螺旋雨带纹理 */
function radarGeometry(nx, ny, nz, tn) {
  const dxs = nx - 0.5;
  const dys = ny - 0.5;
  const rn = Math.min(1.45, Math.sqrt(dxs * dxs + dys * dys) / 0.5);
  const az = Math.atan2(dys, dxs);
  // 可探测高度随距离下降（近站可及 20km，远端仅低层）
  const zHi = clamp(1.02 - 0.6 * rn, 0.14, 1.0);
  const top = 1 - smoothstep(zHi - 0.14, zHi + 0.05, nz);
  const bottom = smoothstep(-0.01, 0.05, nz);
  // 站顶静锥区
  const coneHole = 1 - 0.85 * Math.exp(-Math.pow(rn / 0.11, 2)) * smoothstep(0.5, 0.92, nz);
  // 径向衰减
  const atten = params.attenuation != null ? params.attenuation : 0.35;
  const radial = 0.82 + 0.18 * Math.exp(-atten * rn);
  // 体域边界淡出
  const boundary = 1 - smoothstep(0.9, 1.4, rn);
  // 螺旋雨带纹理
  const bands = 0.74 + 0.26 * Math.sin(rn * 9 - az * 2 + tn * 1.6);
  const coverage = clamp(top * bottom * coneHole * radial * boundary * bands, 0, 1);
  return { coverage: coverage, quality: clamp(radial * boundary, 0, 1) };
}

function pm25Value(nx, ny, nz, tn, channel) {
  const r = pm25Raw(nx, ny, nz, tn, channel);
  const max = pm25ChannelMax(channel);
  const value = clamp(r.conc, 0, max);
  const mix = pm25Mix(nz, r.met.blh);
  const proximity = Math.exp(-r.minDist / 0.28);
  const confidence = clamp(0.30 + 0.55 * mix + 0.35 * proximity, 0, 1);
  return {
    value: value,
    valid: 1,
    coverage: 1,
    density: clamp(value / max, 0, 1),
    quality: confidence
  };
}

function windVector(nx, ny, nz) {
  const sp = params.baseSpeed != null ? params.baseSpeed : 9;
  // 气象风向：baseDir 为来向，水平流速矢量指向下游（+180°）
  const flowDir = ((params.baseDir != null ? params.baseDir : 235) * Math.PI) / 180 + Math.PI;
  const shear = 0.4 + 0.6 * Math.pow(nz, 0.6);
  const meander = 0.14 * Math.sin(nx * 3.1 + nz * 2.0) + 0.1 * Math.cos(ny * 2.7);
  const dir = flowDir + meander;
  let ux = Math.cos(dir) * sp * shear;
  let uy = Math.sin(dir) * sp * shear;
  let uz = 0;
  for (let i = 0; i < ctx.vortices.length; i += 1) {
    const v = ctx.vortices[i];
    const dx = nx - v.x;
    const dy = ny - v.y;
    const d2 = dx * dx + dy * dy;
    const g = v.strength * Math.exp(-d2 / (2 * v.radius * v.radius)) * 8;
    ux += -dy * g;
    uy += dx * g;
    uz += v.strength * 0.8 * Math.sin((nx + ny) * 6.283) * nz;
  }
  const gust = params.gust != null ? params.gust : 0.25;
  ux += gust * sp * Math.sin(nx * 7.3 + nz * 5.1) * (0.4 + nz);
  uy += gust * sp * Math.cos(ny * 6.7 + nz * 4.3) * (0.4 + nz);
  uz += gust * sp * 0.35 * Math.sin((nx + ny) * 5.5) * (0.3 + nz);
  return { ux, uy, uz };
}

function windValue(nx, ny, nz, channel) {
  const v = windVector(nx, ny, nz);
  if (channel === 'w') return clamp(v.uz, -3, 3);
  // 保留真实风速，不做 20 m/s 上限截断；显示范围由图例 / 通道值域单独控制
  const speed = Math.sqrt(v.ux * v.ux + v.uy * v.uy + v.uz * v.uz);
  return speed > 0 ? speed : 0;
}

/* ---- 地质结构：倾斜 + 褶皱 + 断层共享同一个构造位移场 ---- */

// 构造起伏（归一化埋深偏移）：地层倾斜 + 背斜/向斜褶皱
function geoRelief(nx, ny) {
  var dip = params.dip != null ? params.dip : 0.06;
  var dipDir = ((params.dipDir != null ? params.dipDir : 35) * Math.PI) / 180;
  var along = (nx - 0.5) * Math.cos(dipDir) + (ny - 0.5) * Math.sin(dipDir);
  var dipTerm = -dip * along;
  var foldAmp = params.foldAmp != null ? params.foldAmp : 0.05;
  var fold = foldAmp * Math.sin(nx * 4.084) * Math.cos(ny * 3.456);
  return dipTerm + fold;
}

// 断层：沿一条直线产生空间阶跃位移，使层位与属性一起错断
function geoFaultShift(nx, ny) {
  var throwAmt = params.faultThrow != null ? params.faultThrow : 0.06;
  if (throwAmt < 0.0005) return 0;
  var dir = ((params.faultDir != null ? params.faultDir : 118) * Math.PI) / 180;
  var dist = (nx - 0.5) * Math.cos(dir) + (ny - 0.5) * Math.sin(dir);
  var step = smoothstep(-0.02, 0.02, dist) - 0.5;
  return -throwAmt * step;
}

function geoShift(nx, ny) {
  return geoRelief(nx, ny) + geoFaultShift(nx, ny);
}

// 侵入体强度：椭球岩浆体，中心处为 1，向外平滑衰减
function geoHeat(nx, ny, nz) {
  var it = ctx.intrusion;
  var d = 1 - nz;
  var ex = (nx - it.x) / (it.rx * 1.6);
  var ey = (ny - it.y) / (it.rx * 1.6);
  var ez = (d - it.depth) / (it.rz * 1.6);
  var q = ex * ex + ey * ey + ez * ez;
  return q < 12 ? Math.exp(-q) : 0;
}

function geoLayer(nx, ny, nz) {
  var d = 1 - nz; // 自地表向下的归一化埋深
  var dd = d + geoShift(nx, ny);
  var c = ctx.contacts;
  var code;
  if (dd < c[0]) code = 1;
  else if (dd < c[1]) code = 2;
  else if (dd < c[2]) code = 3;
  else if (dd < c[3]) code = 4;
  else if (dd < c[4]) code = 5;
  else code = 6;
  // 侵入体穿层：椭球岩浆体覆盖原岩性
  if (geoHeat(nx, ny, nz) > 0.32) code = 5;
  return code;
}

// 沉积相约束的岩性属性基准（孔隙率 / 饱和度 / 渗透率对数）
var GEO_FACIES = {
  1: { por: 30, sat: 38, permLog: 1.4 },
  2: { por: 22, sat: 52, permLog: 2.4 },
  3: { por: 11, sat: 66, permLog: -0.4 },
  4: { por: 17, sat: 54, permLog: 1.3 },
  5: { por: 6, sat: 30, permLog: -0.9 },
  6: { por: 3, sat: 26, permLog: -1.6 }
};

// 低频连续性：模拟大尺度空间渐变
function geoLowFreq(nx, ny, nz) {
  return (
    Math.sin(nx * 3.1 + ny * 2.3 + nz * 1.7) * 0.6 +
    Math.cos(nx * 1.7 - ny * 2.9 + nz * 2.1) * 0.4
  );
}

// 高频细节：仅保留少量，避免颗粒噪声
function geoHighFreq(nx, ny, nz) {
  return Math.sin(nx * 17.3 + ny * 15.1 + nz * 21.7);
}

// 砂岩储层甜点：沿构造脊分布的透镜状高孔高渗体
function geoReservoir(nx, ny, nz) {
  var d = 1 - nz;
  var ridge = Math.sin(nx * 5.5 + 0.7) * Math.cos(ny * 4.1 - 0.3);
  var band = Math.exp(-Math.pow((d - 0.3) / 0.07, 2));
  var lens = Math.exp(-Math.pow(ridge / 0.5, 2));
  return band * lens;
}

// 高渗通道：砂岩层内沿弯曲河道的一维连通条带
function geoHighPerm(nx, ny, nz) {
  var d = 1 - nz;
  var river = Math.exp(-Math.pow((ny - (0.35 + 0.25 * Math.sin(nx * 4.2))) / 0.06, 2));
  var band = Math.exp(-Math.pow((d - 0.27) / 0.06, 2));
  return river * band;
}

function geoProperty(nx, ny, nz, code, channel) {
  var base = GEO_FACIES[code] || GEO_FACIES[3];
  var low = geoLowFreq(nx, ny, nz);
  var high = geoHighFreq(nx, ny, nz);
  var d = 1 - nz;
  var reserv = code === 2 ? geoReservoir(nx, ny, nz) : 0;
  var heat = geoHeat(nx, ny, nz);
  if (channel === 'porosity') {
    var v = base.por + low * 3.4 + high * 0.7 + reserv * 9 - 3.5 * d - heat * 5;
    return clamp(v, 0.5, 35);
  }
  if (channel === 'saturation') {
    var owc = smoothstep(0.62, 0.74, d);
    var v2 = base.sat + low * 5 + high * 1.2 + owc * 26 - heat * 12;
    return clamp(v2, 0, 100);
  }
  var permHigh = geoHighPerm(nx, ny, nz) * (code === 2 ? 1 : 0.25);
  var lk = base.permLog + low * 0.55 + high * 0.12 + reserv * 0.9 - 0.6 * d + permHigh - heat * 1.4;
  return clamp(Math.pow(10, lk), 0.1, 1000);
}

function cfdSolid(nx, ny, nz) {
  if (nz < 0) return true;
  const boxes = ctx.buildings;
  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i];
    if (nx >= b.x0 && nx <= b.x1 && ny >= b.y0 && ny <= b.y1 && nz <= b.z1) return true;
  }
  return false;
}

// 大气边界层风廓线：幂律，近地面 0.55 倍，高空趋于 1
function cfdShear(nz) {
  const zM = Math.max(nz, 0) * 300;
  const s = Math.pow(Math.max(zM, 1) / 60, 0.16);
  return 0.55 + 0.45 * Math.min(s, 1.6);
}

function cfdVector(nx, ny, nz, tn) {
  const inflow = params.inflow != null ? params.inflow : 6;
  const phase = tn * 6.283;
  const ref = Math.max(0.2, inflow * cfdShear(nz));
  let ux = ref;
  let uy = 0;
  let uz = 0;
  let turb = 0;
  const boxes = ctx.buildings;
  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i];
    const hcx = (b.x0 + b.x1) * 0.5;
    const hcy = (b.y0 + b.y1) * 0.5;
    const hx = (b.x1 - b.x0) * 0.5 + 0.012;
    const hy = (b.y1 - b.y0) * 0.5 + 0.012;
    if (nz > b.z1 + 0.42) continue;
    const spanY = Math.exp(-Math.pow((ny - hcy) / (hy * 1.7), 2));
    const hEff = Math.max(b.z1, 0.05);
    const spanZ = Math.exp(-Math.pow((nz - hEff * 0.55) / (hEff * 0.7 + 0.06), 2));
    // 迎风滞止区：减速并抬升
    const front = nx - b.x0;
    if (front < 0.03 && front > -0.2) {
      const stag = Math.exp(-Math.pow(front / 0.055, 2));
      ux -= ref * 0.6 * stag * spanY * spanZ;
    }
    // 侧向绕流：沿建筑高度层向两侧加速
    const lateral = Math.exp(-Math.pow((Math.abs(ny - hcy) - hy) / (hy * 0.9 + 0.03), 2));
    uy += (ny >= hcy ? 1 : -1) * ref * 0.55 * lateral * spanZ * Math.exp(-Math.pow((nx - hcx) / (hx * 2.6), 2));
    // 顶部越流
    if (nz > b.z1 && nz < b.z1 + 0.35) {
      const over = Math.exp(-Math.pow((nz - b.z1) / 0.1, 2)) * spanY;
      ux += ref * 0.55 * over;
      uz += ref * 0.14 * over;
    }
    // 尾流：速度亏损 + 卡门涡街横向摆动
    if (nx > b.x1) {
      const s = nx - b.x1;
      const decay = Math.exp(-s / 0.4);
      const wY = Math.exp(-Math.pow((ny - hcy) / (hy * 1.8), 2));
      const wZ = Math.exp(-Math.pow((nz - hEff * 0.5) / (hEff * 0.8 + 0.07), 2));
      const shed = Math.sin(phase + s * 20 + i * 1.7);
      ux -= ref * 1.55 * decay * wY * wZ;
      uy += ref * 0.4 * decay * wY * wZ * shed;
      uz += ref * 0.1 * decay * wY * wZ * Math.sin(s * 14 + phase + i);
      turb += decay * wY * wZ;
    }
  }
  const amp = Math.min(0.4, turb) * ref;
  if (amp > 0.001) {
    ux += amp * 0.12 * Math.sin(nx * 21 + nz * 17 + phase);
    uy += amp * 0.13 * Math.cos(ny * 19 + nz * 15 + phase * 0.9);
    uz += amp * 0.1 * Math.sin((nx + ny) * 17 + phase) * (0.4 + nz);
  }
  return { ux, uy, uz, solid: 0, ref };
}

function cfdPressure(nx, ny, nz, tn, ref) {
  const v = cfdVector(nx, ny, nz, tn);
  const speed2 = v.ux * v.ux + v.uy * v.uy + v.uz * v.uz;
  return clamp(2.4 * (ref * ref - speed2), -120, 120);
}

function cfdTemperature(nx, ny, nz, tn) {
  const ambient = params.ambientTemp != null ? params.ambientTemp : 300;
  const sourceTemp = params.sourceTemp != null ? params.sourceTemp : 320;
  const heat = params.heat != null ? params.heat : 1;
  const inflow = params.inflow != null ? params.inflow : 6;
  const deltaT = Math.max(0, sourceTemp - ambient);
  if (deltaT <= 0 || heat <= 0) return ambient;
  const src = ctx.source;
  const dx = nx - src.x;
  if (dx < -0.03) return ambient;
  const s = Math.max(dx, 0);
  // 浮升高度：热强度越大越高，强来流把羽流压弯
  const zTop = clamp((0.5 * heat) / (1 + Math.max(0, inflow - 6) / 10), 0.08, 0.62);
  const zc = zTop * (1 - Math.exp(-s * 3.2));
  const yc = src.y + 0.03 * Math.sin(s * 9 + tn * 6.283);
  const sigmaY = 0.045 + 0.24 * s;
  const sigmaZ = 0.04 + 0.11 * s + 0.05 * heat;
  const gy = Math.exp(-Math.pow((ny - yc) / sigmaY, 2));
  const gz = Math.exp(-Math.pow((nz - zc) / sigmaZ, 2));
  const decay = Math.exp(-s * 0.9);
  const near = Math.exp(-Math.pow(dx / 0.04, 2)) * Math.exp(-Math.pow((ny - src.y) / 0.05, 2)) * Math.exp(-Math.pow(nz / 0.05, 2));
  const core = Math.max(near, gy * gz * decay);
  const temporal = 0.85 + 0.15 * Math.sin(tn * 6.283);
  return clamp(ambient + deltaT * heat * core * temporal, ambient - 20, ambient + 60);
}

function cfdValue(nx, ny, nz, tn, channel) {
  if (cfdSolid(nx, ny, nz)) return { value: 0, valid: 0 };
  const v = cfdVector(nx, ny, nz, tn);
  if (channel === 'temperature') return { value: cfdTemperature(nx, ny, nz, tn), valid: 1 };
  if (channel === 'pressure') return { value: cfdPressure(nx, ny, nz, tn, v.ref), valid: 1 };
  const speed = Math.sqrt(v.ux * v.ux + v.uy * v.uy + v.uz * v.uz);
  return { value: clamp(speed, 0, 20), valid: 1 };
}

/* ------------------------------------------------------------------ *
 * 统一采样
 * ------------------------------------------------------------------ */

function sampleScalar(kind, nx, ny, nz, tn, channel) {
  if (kind === 'radar') return radarValue(nx, ny, nz, tn);
  if (kind === 'pm25') return pm25Value(nx, ny, nz, tn, channel);
  if (kind === 'wind') return { value: windValue(nx, ny, nz, channel), valid: 1 };
  if (kind === 'cfd') return cfdValue(nx, ny, nz, tn, channel);
  return { value: 0, valid: 0 };
}

function sampleField(nx, ny, nz, tn, channel) {
  if (sceneKind === 'geology') {
    const code = geoLayer(nx, ny, nz);
    if (channel === 'litho') return { value: code, valid: 1, categorical: true, layer: code };
    return { value: geoProperty(nx, ny, nz, code, channel), valid: 1, layer: code };
  }
  return sampleScalar(sceneKind, nx, ny, nz, tn, channel);
}

/* ------------------------------------------------------------------ *
 * 瓦片抽取
 * ------------------------------------------------------------------ */

function handleTile(message) {
  if (message.epoch !== tileCacheEpoch) { tileCache.clear(); tileCacheEpoch = message.epoch; }
  const cacheKey = message.channel + '|' + message.mode + '|' + message.timeStep + '|' + message.tileSize + '|' +
    message.tileLevel + '|' + message.tileX + ',' + message.tileY + ',' + message.tileZ;
  const cached = tileCache.get(cacheKey);
  if (cached) {
    // 命中缓存：发送副本并转移其 buffer，缓存本体保留
    const hit = cached.slice(0);
    tileCache.delete(cacheKey);
    tileCache.set(cacheKey, cached);
    self.postMessage(
      { type: 'tileDone', epoch: message.epoch, requestId: message.requestId, metadata: hit },
      [hit.buffer]
    );
    return;
  }
  const D = message.tileSize;
  const dim = D + 2;
  const total = dim * dim * dim;
  const scaleLevel = Math.pow(2, message.tileLevel);
  const inv = 1 / scaleLevel;
  const tx = message.tileX;
  const ty = message.tileY;
  const tz = message.tileZ;
  const channel = message.channel;
  const tn = message.timeSteps > 1 ? message.timeStep / (message.timeSteps - 1) : 0;
  const categorical = message.mode === 'categorical';
  const metadata = new Float32Array(total * 4);

  for (let iz = 0; iz < dim; iz += 1) {
    const wz = (tz + (iz - 1 + 0.5) / D) * inv;
    for (let iy = 0; iy < dim; iy += 1) {
      const wy = (ty + (iy - 1 + 0.5) / D) * inv;
      for (let ix = 0; ix < dim; ix += 1) {
        const wx = (tx + (ix - 1 + 0.5) / D) * inv;
        const idx = ((iz * dim + iy) * dim + ix) * 4;
        if (wx < 0 || wx > 1 || wy < 0 || wy > 1 || wz < 0 || wz > 1) {
          continue;
        }
        const s = sampleField(clamp(wx, 0, 1), clamp(wy, 0, 1), clamp(wz, 0, 1), tn, channel);
        // VEC4 约定：.r=数值/分类码；.g=覆盖度(或缺省有效掩膜)；.b=体密度；.a=数据质量（地质案例改存地层码）
        metadata[idx] = s.value;
        metadata[idx + 1] = s.coverage != null ? s.coverage : (s.valid ? 1 : 0);
        metadata[idx + 2] = s.density != null ? s.density : 1;
        metadata[idx + 3] = s.layer != null ? s.layer : (s.quality != null ? s.quality : (s.valid ? 1 : 0));
      }
    }
  }

  // PM2.5 元数据后处理：把浓度梯度写入 .b（烟羽锋面/边界增强），.a 保留置信度
  if (sceneKind === 'pm25' && !categorical) {
    const span = pm25ChannelMax(channel) * 0.05;
    const row = dim * 4;
    const plane = dim * dim * 4;
    for (let iz = 1; iz < dim - 1; iz += 1) {
      for (let iy = 1; iy < dim - 1; iy += 1) {
        for (let ix = 1; ix < dim - 1; ix += 1) {
          const c0 = ((iz * dim + iy) * dim + ix) * 4;
          const gx = metadata[c0 + 4] - metadata[c0 - 4];
          const gy = metadata[c0 + row] - metadata[c0 - row];
          const gz = metadata[c0 + plane] - metadata[c0 - plane];
          const grad = Math.sqrt(gx * gx + gy * gy + gz * gz) * scaleLevel;
          metadata[c0 + 2] = clamp(grad / Math.max(1, span), 0, 1);
        }
      }
    }
  }

  // 写入 LRU 缓存（发送转移原数组，缓存保存副本）
  if ((sceneKind === 'radar' || sceneKind === 'geology' || sceneKind === 'pm25') && tileCache.size < TILE_CACHE_MAX) {
    tileCache.set(cacheKey, metadata.slice(0));
  }
  self.postMessage(
    { type: 'tileDone', epoch: message.epoch, requestId: message.requestId, metadata },
    [metadata.buffer]
  );
}

/* ------------------------------------------------------------------ *
 * 剖切面采样
 * ------------------------------------------------------------------ */

function handleSlice(message) {
  const size = message.size;
  const values = new Float32Array(size * size);
  const valid = new Uint8Array(size * size);
  const channel = message.channel;
  const tn = message.timeSteps > 1 ? message.timeStep / (message.timeSteps - 1) : 0;
  const p0 = message.point;
  const e1 = message.e1;
  const e2 = message.e2;
  const half = message.halfDiag;
  const volMin = message.volMin;
  const volSize = message.volSize;

  for (let py = 0; py < size; py += 1) {
    const vv = -(((py + 0.5) / size) * 2 - 1) * half;
    for (let px = 0; px < size; px += 1) {
      const uu = (((px + 0.5) / size) * 2 - 1) * half;
      const wx = p0[0] + e1[0] * uu + e2[0] * vv;
      const wy = p0[1] + e1[1] * uu + e2[1] * vv;
      const wz = p0[2] + e1[2] * uu + e2[2] * vv;
      const ux = (wx - volMin[0]) / volSize[0];
      const uy = (wy - volMin[1]) / volSize[1];
      const uz = (wz - volMin[2]) / volSize[2];
      const idx = py * size + px;
      if (ux < 0 || ux > 1 || uy < 0 || uy > 1 || uz < 0 || uz > 1) continue;
      const s = sampleField(ux, uy, uz, tn, channel);
      if (s.valid) {
        values[idx] = s.value;
        valid[idx] = 1;
      }
    }
  }

  self.postMessage(
    { type: 'sliceDone', epoch: message.epoch, requestId: message.requestId, size, values, valid },
    [values.buffer, valid.buffer]
  );
}

/* ------------------------------------------------------------------ *
 * 向量场粒子
 * ------------------------------------------------------------------ */

// CFD 入口释放：粒子从 +X 来流面进入，仅覆盖近地来流高度带
function cfdInletSeed(rand, state, i) {
  state.positions[i * 3] = 0.012 + 0.018 * rand();
  state.positions[i * 3 + 1] = 0.05 + 0.9 * rand();
  state.positions[i * 3 + 2] = 0.02 + 0.3 * rand();
}

function handleParticleInit(message) {
  const count = Math.max(1, message.count);
  const rand = mulberry32((params.seed || 1) + 977);
  const positions = new Float32Array(count * 3);
  const ages = new Float32Array(count);
  const lives = new Float32Array(count);
  const state = { count, positions, ages, lives };
  for (let i = 0; i < count; i += 1) {
    if (sceneKind === 'cfd') {
      cfdInletSeed(rand, state, i);
    } else {
      positions[i * 3] = rand();
      positions[i * 3 + 1] = rand();
      positions[i * 3 + 2] = 0.02 + 0.9 * rand();
    }
    ages[i] = rand() * 2.5;
    lives[i] = 2 + 2.5 * rand();
  }
  particleState = state;
  self.postMessage({ type: 'particleDone', count });
}

function respawn(state, i, rand) {
  if (sceneKind === 'cfd') {
    cfdInletSeed(rand, state, i);
  } else {
    state.positions[i * 3] = rand() * 0.15;
    state.positions[i * 3 + 1] = rand();
    state.positions[i * 3 + 2] = 0.02 + 0.9 * rand();
  }
  state.ages[i] = 0;
  state.lives[i] = 2 + 2.5 * rand();
}

function handleParticleTick(message) {
  if (!particleState) return;
  const state = particleState;
  const dt = message.dt;
  const tn = message.timeSteps > 1 ? message.timeStep / (message.timeSteps - 1) : 0;
  const scale = message.scale;
  const rand = mulberry32((params.seed || 1) + 31 + Math.round((message.timeStep || 0) * 7));
  const out = new Float32Array(state.count * 3);
  const speeds = new Float32Array(state.count);
  const pos = state.positions;
  for (let i = 0; i < state.count; i += 1) {
    const nx = pos[i * 3];
    const ny = pos[i * 3 + 1];
    const nz = pos[i * 3 + 2];
    let v;
    if (sceneKind === 'wind') v = windVector(nx, ny, nz);
    else if (sceneKind === 'cfd') v = cfdVector(nx, ny, nz, tn);
    else v = { ux: 0, uy: 0, uz: 0 };
    if (v.solid) {
      respawn(state, i, rand);
      out[i * 3] = pos[i * 3];
      out[i * 3 + 1] = pos[i * 3 + 1];
      out[i * 3 + 2] = pos[i * 3 + 2];
      speeds[i] = 0;
      continue;
    }
    let x = nx + v.ux * dt * scale[0];
    let y = ny + v.uy * dt * scale[1];
    let z = nz + v.uz * dt * scale[2] + 0.02 * dt;
    state.ages[i] += dt;
    if (x < 0 || x > 1 || y < 0 || y > 1 || z < 0 || z > 1 || state.ages[i] > state.lives[i]) {
      respawn(state, i, rand);
      x = state.positions[i * 3];
      y = state.positions[i * 3 + 1];
      z = state.positions[i * 3 + 2];
    } else {
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
    }
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
    speeds[i] = Math.sqrt(v.ux * v.ux + v.uy * v.uy + v.uz * v.uz);
  }
  self.postMessage(
    { type: 'particleTickDone', positions: out, speeds },
    [out.buffer, speeds.buffer]
  );
}
`
