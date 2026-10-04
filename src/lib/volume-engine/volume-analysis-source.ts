/**
 * Volume Engine —— Web Worker 分析源码（内联字符串，追加在 VOLUME_WORKER_SOURCE 之后）
 *
 * 与体数据生产源码拼接到同一个 Worker 脚本作用域，复用 sampleField / windVector /
 * cfdVector 等场函数，承担各案例领域分析：
 *   - stats：全局 min/max/mean/P95 + 直方图；
 *   - radar：回波顶高栅格 + 强对流核心提取；
 *   - pm25：区域平均/P95、超标体积比例、AQI 分级与暴露人口估算；
 *   - profile：任意平面位置的垂直廓线（含三维矢量分量）；
 *   - section：剖切面上的矢量箭头；
 *   - streamlines：矢量场流线（RK2 积分）；
 *   - isosurface：标量场等值面（Marching Tetrahedra，输出三角面片）。
 *
 * 注意：本字符串不可包含反引号与 ${}，避免破坏 String.raw 模板。
 */

export const VOLUME_ANALYSIS_SOURCE = String.raw`
/* ============================ Analysis ============================ */

function analysisVectorAt(nx, ny, nz, tn) {
  if (sceneKind === 'wind') return windVector(nx, ny, nz);
  if (sceneKind === 'cfd') return cfdVector(nx, ny, nz, tn);
  if (sceneKind === 'flood') return floodVector(nx, ny, nz, tn);
  if (sceneKind === 'fire') return fireVector(nx, ny, nz, tn);
  if (sceneKind === 'ocean') return oceanVector(nx, ny, nz, tn);
  if (sceneKind === 'plume') return plumeVector(nx, ny, nz, tn);
  return { ux: 0, uy: 0, uz: 0, solid: 0 };
}

function buildHistogram(values, count, min, max, bins) {
  var hist = new Float32Array(bins);
  var span = (max - min) || 1;
  for (var i = 0; i < count; i += 1) {
    var b = Math.floor(((values[i] - min) / span) * bins);
    if (b < 0) b = 0; else if (b >= bins) b = bins - 1;
    hist[b] += 1;
  }
  return hist;
}

function percentile(values, count, ratio) {
  if (!count) return 0;
  var sorted = Array.prototype.slice.call(values, 0, count);
  sorted.sort(function (a, b) { return a - b; });
  var idx = Math.min(count - 1, Math.max(0, Math.floor(ratio * count)));
  return sorted[idx];
}

function transferList(list) {
  var buffers = [];
  for (var i = 0; i < list.length; i += 1) buffers.push(list[i].buffer);
  return buffers;
}

function analyzeStats(message, tn) {
  var N = message.res || 40;
  var channel = message.channel;
  var total = N * N * N;
  var values = new Float32Array(total);
  var count = 0;
  var sum = 0;
  var min = Infinity;
  var max = -Infinity;
  for (var iz = 0; iz < N; iz += 1) {
    var z = (iz + 0.5) / N;
    for (var iy = 0; iy < N; iy += 1) {
      var y = (iy + 0.5) / N;
      for (var ix = 0; ix < N; ix += 1) {
        var s = sampleField((ix + 0.5) / N, y, z, tn, channel);
        if (!s.valid) continue;
        values[count] = s.value;
        count += 1;
        sum += s.value;
        if (s.value < min) min = s.value;
        if (s.value > max) max = s.value;
      }
    }
  }
  if (!count) { min = 0; max = 0; }
  var bins = 32;
  var hist = buildHistogram(values, count, min, max, bins);
  var result = {
    count: count,
    min: min,
    max: max,
    mean: count ? sum / count : 0,
    p50: percentile(values, count, 0.5),
    p95: percentile(values, count, 0.95),
    histogram: hist,
    bins: bins
  };
  return { result: result, transfer: transferList([hist]) };
}

function analyzeRadar(message, tn) {
  var G = message.res || 44;
  var V = message.vertical || 48;
  var channel = message.channel;
  var topThreshold = message.topThreshold != null ? message.topThreshold : (message.threshold != null ? message.threshold : 20);
  var coreThreshold = message.coreThreshold != null ? message.coreThreshold : 45;
  var volSize = message.volSize || [1, 1, 1];
  var footprintAreaKm2 = (volSize[0] * volSize[1]) / 1e6;
  var topGrid = new Float32Array(G * G);
  var columnMax = new Float32Array(G * G);
  var maxTop = 0;
  var topSum = 0;
  var topCount = 0;
  var maxDbz = 0;
  var area20 = 0, area35 = 0, area45 = 0;
  var topValues = [];
  for (var iy = 0; iy < G; iy += 1) {
    var y = (iy + 0.5) / G;
    for (var ix = 0; ix < G; ix += 1) {
      var x = (ix + 0.5) / G;
      var top = 0;
      var cMax = 0;
      for (var iz = V - 1; iz >= 0; iz -= 1) {
        var s = sampleField(x, y, (iz + 0.5) / V, tn, channel);
        var val = s.valid ? s.value : 0;
        if (val > cMax) cMax = val;
        if (val > maxDbz) maxDbz = val;
        if (top === 0 && val >= topThreshold) top = (iz + 0.5) / V;
      }
      topGrid[iy * G + ix] = top;
      columnMax[iy * G + ix] = cMax;
      if (cMax >= 20) area20 += 1;
      if (cMax >= 35) area35 += 1;
      if (cMax >= 45) area45 += 1;
      if (top > maxTop) maxTop = top;
      if (top > 0) { topSum += top; topCount += 1; topValues.push(top); }
    }
  }
  var p95Top = percentile(topValues, topValues.length, 0.95);
  // 强对流核心：3D 粗网格上取高值并做最小间距去重
  var C = 26;
  var candidates = [];
  for (var cz = 0; cz < 14; cz += 1) {
    var zz = (cz + 0.5) / 14;
    for (var cy = 0; cy < C; cy += 1) {
      var yy = (cy + 0.5) / C;
      for (var cx = 0; cx < C; cx += 1) {
        var xx = (cx + 0.5) / C;
        var sc = sampleField(xx, yy, zz, tn, channel);
        if (sc.valid && sc.value >= coreThreshold) candidates.push({ x: xx, y: yy, z: zz, v: sc.value });
      }
    }
  }
  candidates.sort(function (a, b) { return b.v - a.v; });
  var cores = [];
  for (var i = 0; i < candidates.length && cores.length < 8; i += 1) {
    var c = candidates[i];
    var ok = true;
    for (var j = 0; j < cores.length; j += 1) {
      var o = cores[j];
      var dx = c.x - o.x;
      var dy = c.y - o.y;
      var dz = c.z - o.z;
      if (dx * dx + dy * dy + dz * dz < 0.014) { ok = false; break; }
    }
    if (ok) cores.push(c);
  }
  var corePos = new Float32Array(cores.length * 3);
  var corePeak = new Float32Array(cores.length);
  var coreTop = new Float32Array(cores.length);
  for (var k = 0; k < cores.length; k += 1) {
    corePos[k * 3] = cores[k].x;
    corePos[k * 3 + 1] = cores[k].y;
    corePos[k * 3 + 2] = cores[k].z;
    corePeak[k] = cores[k].v;
    // 该核心所在列的回波顶高
    var gi = Math.max(0, Math.min(G - 1, Math.floor(cores[k].x * G)));
    var gj = Math.max(0, Math.min(G - 1, Math.floor(cores[k].y * G)));
    coreTop[k] = topGrid[gj * G + gi];
  }
  var result = {
    grid: G,
    maxDbz: maxDbz,
    maxTop: maxTop,
    meanTop: topCount ? topSum / topCount : 0,
    p95Top: p95Top,
    topGrid: topGrid,
    columnMax: columnMax,
    footprint: {
      area20Km2: footprintAreaKm2 * (area20 / (G * G)),
      area35Km2: footprintAreaKm2 * (area35 / (G * G)),
      area45Km2: footprintAreaKm2 * (area45 / (G * G))
    },
    topThreshold: topThreshold,
    coreThreshold: coreThreshold,
    corePos: corePos,
    corePeak: corePeak,
    coreTop: coreTop,
    coreCount: cores.length
  };
  return { result: result, transfer: transferList([topGrid, columnMax, corePos, corePeak, coreTop]) };
}

// 时间演变趋势：在较粗网格上逐时间步统计 最大 dBZ / 最高顶高 / ≥35dBZ 面积
function analyzeRadarTrend(message) {
  var steps = message.steps || 12;
  var N = message.res || 18;
  var V = message.vertical || 16;
  var channel = message.channel;
  var topThreshold = message.topThreshold != null ? message.topThreshold : 20;
  var volSize = message.volSize || [1, 1, 1];
  var footprintAreaKm2 = (volSize[0] * volSize[1]) / 1e6;
  var maxDbz = new Float32Array(steps);
  var maxTopKm = new Float32Array(steps);
  var area35Km2 = new Float32Array(steps);
  var topHeightKm = volSize[2] / 1000;
  for (var t = 0; t < steps; t += 1) {
    var tn = steps > 1 ? t / (steps - 1) : 0;
    var mDbz = 0, mTop = 0, a35 = 0;
    for (var iy = 0; iy < N; iy += 1) {
      var y = (iy + 0.5) / N;
      for (var ix = 0; ix < N; ix += 1) {
        var x = (ix + 0.5) / N;
        var cMax = 0, top = 0;
        for (var iz = V - 1; iz >= 0; iz -= 1) {
          var s = sampleField(x, y, (iz + 0.5) / V, tn, channel);
          var val = s.valid ? s.value : 0;
          if (val > cMax) cMax = val;
          if (top === 0 && val >= topThreshold) top = (iz + 0.5) / V;
        }
        if (cMax > mDbz) mDbz = cMax;
        if (top > mTop) mTop = top;
        if (cMax >= 35) a35 += 1;
      }
    }
    maxDbz[t] = mDbz;
    maxTopKm[t] = mTop * topHeightKm;
    area35Km2[t] = footprintAreaKm2 * (a35 / (N * N));
  }
  var result = { steps: steps, maxDbz: maxDbz, maxTopKm: maxTopKm, area35Km2: area35Km2 };
  return { result: result, transfer: transferList([maxDbz, maxTopKm, area35Km2]) };
}

/*
 * PM2.5 综合分析：
 *   - 浓度统计（min/max/mean/P50/P95）与浓度分级直方图；
 *   - 地面 footprint 栅格（近地列最大值，用于地面浓度热力与超标边界）；
 *   - 污染柱顶高（逐列超过阈值最高处）；
 *   - 超标面积 / 超标体积（物理单位换算，面积取自体域而不是固定 1600）；
 *   - 人口暴露估算（人口权重栅格）；
 *   - 监测站“模型 vs 观测”配对散点，输出 RMSE / 偏差 / 相关系数。
 */
function analyzePm25(message, tn) {
  var N = message.res || 36;
  var channel = message.channel || 'pm25';
  var threshold = message.threshold != null ? message.threshold : 75;
  var breakpoints = [35, 75, 115, 150, 250];
  var volSize = message.volSize || [1, 1, 1];
  var areaKm2 = (volSize[0] * volSize[1]) / 1e6;
  var heightKm = volSize[2] / 1000;
  var popDensity = message.popDensity != null ? message.popDensity : 1600;
  var grid = N;
  var surfaceGrid = new Float32Array(grid * grid);
  var values = new Float32Array(N * N * N);
  var classHist = new Float32Array(6);
  var count = 0;
  var sum = 0;
  var min = Infinity;
  var max = -Infinity;
  var above = 0;
  var total = 0;
  var exposedWeight = 0;
  var totalWeight = 0;
  var maxTop = 0;
  var topWeighted = 0;
  var topCount = 0;
  var topValues = [];
  var columnsAbove = 0;
  var columnTotal = 0;
  var maxSurface = 0;
  var surfaceSum = 0;
  // 分级阈值体积：按当前污染物值域把 35/75/150/250 折算为等效断点，
  // 输出每个等级以上的体积，支撑“分阈体积”分析（PM2.5 通道即为国标原始断点）。
  var tierBases = [35, 75, 150, 250];
  var tierScale = pm25ChannelMax(channel) / 300;
  var tierAbove = [0, 0, 0, 0];
  // 近地层采样带宽约 0–180 m（按体域物理高度换算，而非固定层数比例）
  var bottomLevels = Math.max(1, Math.round((180 / Math.max(1, volSize[2])) * N));
  for (var iy = 0; iy < N; iy += 1) {
    var y = (iy + 0.5) / N;
    for (var ix = 0; ix < N; ix += 1) {
      var x = (ix + 0.5) / N;
      var dx = x - 0.5;
      var dy = y - 0.5;
      var density = 0.35 + 0.65 * Math.exp(-(dx * dx + dy * dy) / (2 * 0.26 * 0.26));
      var surface = 0;
      var columnTop = 0;
      for (var iz = 0; iz < N; iz += 1) {
        var s = sampleField(x, y, (iz + 0.5) / N, tn, channel);
        if (!s.valid) continue;
        total += 1;
        values[count] = s.value;
        count += 1;
        sum += s.value;
        if (s.value < min) min = s.value;
        if (s.value > max) max = s.value;
        for (var ti = 0; ti < tierBases.length; ti += 1) {
          if (s.value >= tierBases[ti] * tierScale) tierAbove[ti] += 1;
        }
        if (s.value >= threshold) {
          above += 1;
          if ((iz + 0.5) / N > columnTop) columnTop = (iz + 0.5) / N;
        }
        if (iz < bottomLevels && s.value > surface) surface = s.value;
        var cls = 0;
        while (cls < 5 && s.value > breakpoints[cls]) cls += 1;
        classHist[cls] += 1;
      }
      var gx = Math.min(grid - 1, Math.floor(x * grid));
      var gy = Math.min(grid - 1, Math.floor(y * grid));
      if (surface > surfaceGrid[gy * grid + gx]) surfaceGrid[gy * grid + gx] = surface;
      if (surface > maxSurface) maxSurface = surface;
      surfaceSum += surface;
      totalWeight += density;
      if (surface >= threshold) exposedWeight += density;
      columnTotal += 1;
      if (surface >= threshold) columnsAbove += 1;
      if (columnTop > maxTop) maxTop = columnTop;
      if (columnTop > 0) { topWeighted += columnTop; topCount += 1; topValues.push(columnTop); }
    }
  }
  if (!count) { min = 0; max = 0; }

  // 监测站配对：模型浓度 vs 模拟观测，用于误差评估（PM2.5 通道）
  var sc = ctx.stations.length;
  var stationRaw = new Float32Array(sc);
  var stationObserved = new Float32Array(sc);
  var stationPos = new Float32Array(sc * 2);
  var stationKind = new Uint8Array(sc);
  var errSum = 0;
  var err2 = 0;
  var sumO = 0;
  var sumM = 0;
  var sumOO = 0;
  var sumMM = 0;
  var sumOM = 0;
  for (var si = 0; si < sc; si += 1) {
    var st = ctx.stations[si];
    var raw = pm25Raw(st.x, st.y, 0.012, tn, channel).conc;
    var obs = pm25StationObserved(si, raw, tn);
    stationRaw[si] = raw;
    stationObserved[si] = obs;
    stationPos[si * 2] = st.x;
    stationPos[si * 2 + 1] = st.y;
    stationKind[si] = st.kind === 'traffic' ? 1 : (st.kind === 'industry' ? 2 : (st.kind === 'background' ? 3 : 0));
    var e = obs - raw;
    errSum += e;
    err2 += e * e;
    sumO += obs;
    sumM += raw;
    sumOO += obs * obs;
    sumMM += raw * raw;
    sumOM += obs * raw;
  }
  var meanO = sc ? sumO / sc : 0;
  var meanM = sc ? sumM / sc : 0;
  var varO = sc ? sumOO / sc - meanO * meanO : 0;
  var varM = sc ? sumMM / sc - meanM * meanM : 0;
  var cov = sc ? sumOM / sc - meanO * meanM : 0;
  var corr = (varO > 1e-6 && varM > 1e-6) ? cov / Math.sqrt(varO * varM) : 0;

  var result = {
    count: count,
    total: total,
    min: min,
    max: max,
    mean: count ? sum / count : 0,
    p50: percentile(values, count, 0.5),
    p95: percentile(values, count, 0.95),
    threshold: threshold,
    above: above,
    exceedFraction: total ? above / total : 0,
    exceedVolumeKm3: total ? (above / total) * areaKm2 * heightKm : 0,
    exceedAreaKm2: columnTotal ? areaKm2 * (columnsAbove / columnTotal) : 0,
    totalAreaKm2: areaKm2,
    classHist: classHist,
    grid: grid,
    surfaceGrid: surfaceGrid,
    maxSurface: maxSurface,
    meanSurface: columnTotal ? surfaceSum / columnTotal : 0,
    topHeightM: maxTop * volSize[2],
    meanTopM: topCount ? (topWeighted / topCount) * volSize[2] : 0,
    p95TopM: topValues.length ? percentile(topValues, topValues.length, 0.95) * volSize[2] : 0,
    volumeHeightM: volSize[2],
    exposed: totalWeight ? (exposedWeight / totalWeight) * areaKm2 * popDensity : 0,
    exposedFraction: totalWeight ? exposedWeight / totalWeight : 0,
    stationCount: sc,
    stationPos: stationPos,
    stationRaw: stationRaw,
    stationObserved: stationObserved,
    stationKind: stationKind,
    stationRmse: sc ? Math.sqrt(err2 / sc) : 0,
    stationBias: sc ? errSum / sc : 0,
    stationCorr: corr,
    surfaceP95: percentile(surfaceGrid, grid * grid, 0.95),
    tierThresholds: transferThresholds(tierBases, tierScale),
    tierVolumesKm3: transferTierVolumes(tierAbove, count, areaKm2, heightKm)
  };
  return {
    result: result,
    transfer: transferList([surfaceGrid, stationPos, stationRaw, stationObserved, stationKind, result.tierThresholds, result.tierVolumesKm3])
  };
}

/* 分级阈值数组（按通道折算） */
function transferThresholds(bases, scale) {
  var out = new Float32Array(bases.length);
  for (var i = 0; i < bases.length; i += 1) out[i] = bases[i] * scale;
  return out;
}

/* 分级体积数组：count 为有效体素总数，areaKm2 × heightKm 为体域体积 */
function transferTierVolumes(counts, count, areaKm2, heightKm) {
  var out = new Float32Array(counts.length);
  for (var i = 0; i < counts.length; i += 1) {
    out[i] = count ? (counts[i] / count) * areaKm2 * heightKm : 0;
  }
  return out;
}

/* 站点专项：仅输出各站模型/观测值，供时间轴与通道切换时快速刷新 */
function analyzePm25Stations(message, tn) {
  var channel = message.channel || 'pm25';
  var sc = ctx.stations.length;
  var pos = new Float32Array(sc * 2);
  var model = new Float32Array(sc);
  var observed = new Float32Array(sc);
  var kind = new Uint8Array(sc);
  var err = new Float32Array(sc);
  for (var i = 0; i < sc; i += 1) {
    var st = ctx.stations[i];
    var raw = pm25Raw(st.x, st.y, 0.012, tn, channel).conc;
    var obs = pm25StationObserved(i, raw, tn);
    pos[i * 2] = st.x;
    pos[i * 2 + 1] = st.y;
    model[i] = raw;
    observed[i] = obs;
    err[i] = obs - raw;
    kind[i] = st.kind === 'traffic' ? 1 : (st.kind === 'industry' ? 2 : (st.kind === 'background' ? 3 : 0));
  }
  var result = { count: sc, positions: pos, model: model, observed: observed, bias: err, kind: kind };
  return { result: result, transfer: transferList([pos, model, observed, err, kind]) };
}

/* 污染热点：粗三维网格取高浓度单元并按最小间距去重 */
function analyzePm25Hotspots(message, tn) {
  var channel = message.channel || 'pm25';
  var threshold = message.threshold != null ? message.threshold : 75;
  var C = message.res || 22;
  var V = message.vertical || 10;
  var volSize = message.volSize || [1, 1, 1];
  var candidates = [];
  for (var k = 0; k < V; k += 1) {
    var z = (k + 0.5) / V;
    for (var j = 0; j < C; j += 1) {
      var y = (j + 0.5) / C;
      for (var i = 0; i < C; i += 1) {
        var x = (i + 0.5) / C;
        var s = sampleField(x, y, z, tn, channel);
        if (s.valid && s.value >= threshold) candidates.push({ x: x, y: y, z: z, v: s.value });
      }
    }
  }
  candidates.sort(function (a, b) { return b.v - a.v; });
  var hotspots = [];
  for (var c = 0; c < candidates.length && hotspots.length < 10; c += 1) {
    var cand = candidates[c];
    var ok = true;
    for (var h = 0; h < hotspots.length; h += 1) {
      var o = hotspots[h];
      var dx = cand.x - o.x;
      var dy = cand.y - o.y;
      var dz = (cand.z - o.z) * (volSize[2] / Math.max(volSize[0], 1));
      if (dx * dx + dy * dy + dz * dz < 0.012) { ok = false; break; }
    }
    if (ok) hotspots.push(cand);
  }
  var pos = new Float32Array(hotspots.length * 3);
  var val = new Float32Array(hotspots.length);
  for (var q = 0; q < hotspots.length; q += 1) {
    pos[q * 3] = hotspots[q].x;
    pos[q * 3 + 1] = hotspots[q].y;
    pos[q * 3 + 2] = hotspots[q].z;
    val[q] = hotspots[q].v;
  }
  var result = { count: hotspots.length, positions: pos, values: val, threshold: threshold };
  return { result: result, transfer: transferList([pos, val]) };
}

/* 源贡献：给定空间点，拆解各启用源的浓度贡献，支撑源解析与源强控制 */
function analyzePm25Sources(message, tn) {
  var channel = message.channel || 'pm25';
  var x = message.x != null ? message.x : 0.5;
  var y = message.y != null ? message.y : 0.5;
  var z = message.z != null ? message.z : 0.05;
  var met = pm25Meteorology(tn);
  var n = ctx.sources.length;
  var contributions = new Float32Array(n);
  var total = 0;
  for (var i = 0; i < n; i += 1) {
    var s = ctx.sources[i];
    var t = pm25SourceTerm(s, x, y, z, tn, met, channel);
    contributions[i] = t.conc + t.near;
    total += contributions[i];
  }
  var background = pm25Background(channel, z, tn);
  var result = {
    count: n,
    contributions: contributions,
    total: total,
    background: background,
    x: x,
    y: y,
    z: z
  };
  return { result: result, transfer: transferList([contributions]) };
}

/* 时间趋势：逐时间步统计地面峰值 / 地面均值 / 超标面积 / 污染层顶高 / 浓度均值 */
function analyzePm25Trend(message) {
  var steps = message.steps || 24;
  var N = message.res || 20;
  var V = message.vertical || 12;
  var channel = message.channel || 'pm25';
  var threshold = message.threshold != null ? message.threshold : 75;
  var volSize = message.volSize || [1, 1, 1];
  var areaKm2 = (volSize[0] * volSize[1]) / 1e6;
  var maxSurface = new Float32Array(steps);
  var meanSurface = new Float32Array(steps);
  var exceedAreaKm2 = new Float32Array(steps);
  var meanConcentration = new Float32Array(steps);
  var topHeightKm = new Float32Array(steps);
  var bottomLevels = Math.max(1, Math.round(V * 0.2));
  for (var t = 0; t < steps; t += 1) {
    var tn = steps > 1 ? t / (steps - 1) : 0;
    var mSurf = 0;
    var sSurf = 0;
    var above = 0;
    var concSum = 0;
    var concCount = 0;
    var mTop = 0;
    for (var iy = 0; iy < N; iy += 1) {
      var y = (iy + 0.5) / N;
      for (var ix = 0; ix < N; ix += 1) {
        var x = (ix + 0.5) / N;
        var surface = 0;
        var columnTop = 0;
        for (var iz = 0; iz < V; iz += 1) {
          var s = sampleField(x, y, (iz + 0.5) / V, tn, channel);
          if (!s.valid) continue;
          concSum += s.value;
          concCount += 1;
          if (s.value >= threshold && (iz + 0.5) / V > columnTop) columnTop = (iz + 0.5) / V;
          if (iz < bottomLevels && s.value > surface) surface = s.value;
        }
        if (surface > mSurf) mSurf = surface;
        sSurf += surface;
        if (surface >= threshold) above += 1;
        if (columnTop > mTop) mTop = columnTop;
      }
    }
    maxSurface[t] = mSurf;
    meanSurface[t] = sSurf / (N * N);
    exceedAreaKm2[t] = areaKm2 * (above / (N * N));
    meanConcentration[t] = concCount ? concSum / concCount : 0;
    topHeightKm[t] = mTop * (volSize[2] / 1000);
  }
  var result = { steps: steps, maxSurface: maxSurface, meanSurface: meanSurface, exceedAreaKm2: exceedAreaKm2, meanConcentration: meanConcentration, topHeightKm: topHeightKm };
  return { result: result, transfer: transferList([maxSurface, meanSurface, exceedAreaKm2, meanConcentration, topHeightKm]) };
}

/* 地面 footprint：高分辨率近地列最大值栅格，供地面热力图与超标边界绘制 */
function analyzePm25Footprint(message, tn) {
  var grid = message.grid || 96;
  var V = message.vertical || 14;
  var channel = message.channel || 'pm25';
  var threshold = message.threshold != null ? message.threshold : 75;
  var volSize = message.volSize || [0, 0, 2500];
  // 近地层带宽约 0–180 m，保证地面热力对应真正的近地污染而非整层平均
  var bottomLevels = Math.max(1, Math.round((180 / Math.max(1, volSize[2])) * V));
  var surface = new Float32Array(grid * grid);
  var maxVal = 0;
  for (var j = 0; j < grid; j += 1) {
    var y = (j + 0.5) / grid;
    for (var i = 0; i < grid; i += 1) {
      var x = (i + 0.5) / grid;
      var best = 0;
      for (var k = 0; k < bottomLevels; k += 1) {
        var s = sampleField(x, y, (k + 0.5) / V, tn, channel);
        if (s.valid && s.value > best) best = s.value;
      }
      surface[j * grid + i] = best;
      if (best > maxVal) maxVal = best;
    }
  }
  var result = { grid: grid, surface: surface, max: maxVal, p95: percentile(surface, grid * grid, 0.95), threshold: threshold };
  return { result: result, transfer: transferList([surface]) };
}

/* 点位多污染物采样：供拾取浮层同时显示 PM2.5 / PM10 / NO₂ 与阈值状态 */
function analyzePm25Point(message, tn) {
  var x = message.x != null ? message.x : 0.5;
  var y = message.y != null ? message.y : 0.5;
  var z = message.z != null ? message.z : 0.05;
  var result = {
    x: x,
    y: y,
    z: z,
    pm25: pm25Raw(x, y, z, tn, 'pm25').conc,
    pm10: pm25Raw(x, y, z, tn, 'pm10').conc,
    no2: pm25Raw(x, y, z, tn, 'no2').conc,
    threshold: message.threshold != null ? message.threshold : 75
  };
  return { result: result, transfer: [] };
}

/* 拾取射线步进：半透明体素不写深度缓冲，scene.pickPosition 常为空。
   在体域归一化空间沿射线定位首个可见（越过显示下限）采样点，保证拾取数值与画面一致。 */
function analyzePm25Ray(message, tn) {
  var o = message.origin || [0.5, 0.5, 0.5];
  var d = message.direction || [0, 0, -1];
  var channel = message.channel || 'pm25';
  var minValue = message.minValue != null ? message.minValue : 0;
  var steps = message.steps || 360;
  var threshold = message.threshold != null ? message.threshold : 75;
  var t0 = -1e9;
  var t1 = 1e9;
  var hit = true;
  for (var a = 0; a < 3; a += 1) {
    var oa = o[a];
    var da = d[a];
    if (Math.abs(da) < 1e-9) {
      if (oa < 0 || oa > 1) hit = false;
    } else {
      var ta = (0 - oa) / da;
      var tb = (1 - oa) / da;
      if (ta > tb) { var tt = ta; ta = tb; tb = tt; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
    }
  }
  if (!hit || t1 <= t0) {
    return { result: { found: false, x: 0.5, y: 0.5, z: 0.05, pm25: 0, pm10: 0, no2: 0, threshold: threshold }, transfer: [] };
  }
  var fx = 0.5;
  var fy = 0.5;
  var fz = 0.05;
  var found = false;
  for (var i = 0; i < steps; i += 1) {
    var t = t0 + (t1 - t0) * ((i + 0.5) / steps);
    var px = o[0] + d[0] * t;
    var py = o[1] + d[1] * t;
    var pz = o[2] + d[2] * t;
    var v = pm25Raw(px, py, pz, tn, channel).conc;
    if (v >= minValue && v > 0) { found = true; fx = px; fy = py; fz = pz; break; }
  }
  if (!found) {
    var bv = -1;
    for (var j = 0; j < steps; j += 1) {
      var tj = t0 + (t1 - t0) * ((j + 0.5) / steps);
      var qx = o[0] + d[0] * tj;
      var qy = o[1] + d[1] * tj;
      var qz = o[2] + d[2] * tj;
      var qv = pm25Raw(qx, qy, qz, tn, channel).conc;
      if (qv > bv) { bv = qv; fx = qx; fy = qy; fz = qz; }
    }
  }
  fx = clamp(fx, 0.001, 0.999);
  fy = clamp(fy, 0.001, 0.999);
  fz = clamp(fz, 0.001, 0.999);
  var result = {
    found: found,
    x: fx,
    y: fy,
    z: fz,
    pm25: pm25Raw(fx, fy, fz, tn, 'pm25').conc,
    pm10: pm25Raw(fx, fy, fz, tn, 'pm10').conc,
    no2: pm25Raw(fx, fy, fz, tn, 'no2').conc,
    threshold: threshold
  };
  return { result: result, transfer: [] };
}

function analyzeProfile(message, tn) {
  var levels = message.levels || 56;
  var x = message.x != null ? message.x : 0.5;
  var y = message.y != null ? message.y : 0.5;
  var channel = message.channel;
  var values = new Float32Array(levels);
  var valid = new Uint8Array(levels);
  var vu = new Float32Array(levels);
  var vv = new Float32Array(levels);
  var vw = new Float32Array(levels);
  var isVector = sceneKind === 'wind' || sceneKind === 'cfd' || sceneKind === 'flood' || sceneKind === 'fire' || sceneKind === 'ocean';
  for (var i = 0; i < levels; i += 1) {
    var z = (i + 0.5) / levels;
    var s = sampleField(x, y, z, tn, channel);
    values[i] = s.value;
    valid[i] = s.valid ? 1 : 0;
    if (isVector) {
      var vec = analysisVectorAt(x, y, z, tn);
      vu[i] = vec.ux;
      vv[i] = vec.uy;
      vw[i] = vec.uz;
    }
  }
  var result = { x: x, y: y, levels: levels, values: values, valid: valid, u: vu, v: vv, w: vw };
  return { result: result, transfer: transferList([values, valid, vu, vv, vw]) };
}

function analyzeSection(message, tn) {
  var count = message.count || 9;
  var channel = message.channel;
  var normal = message.normal;
  var point = message.point;
  var e1 = message.e1;
  var e2 = message.e2;
  var half = message.halfDiag;
  var volMin = message.volMin || [0, 0, 0];
  var volSize = message.volSize || [1, 1, 1];
  var scale = message.vectorScale || 1;
  var points = [];
  var offsets = [0];
  var speeds = [];
  var arrowLen = half * 0.09;
  for (var gy = 0; gy < count; gy += 1) {
    var vv = -(((gy + 0.5) / count) * 2 - 1) * half * 0.9;
    for (var gx = 0; gx < count; gx += 1) {
      var uu = (((gx + 0.5) / count) * 2 - 1) * half * 0.9;
      var lx = point[0] + e1[0] * uu + e2[0] * vv;
      var ly = point[1] + e1[1] * uu + e2[1] * vv;
      var lz = point[2] + e1[2] * uu + e2[2] * vv;
      var nx = (lx - volMin[0]) / volSize[0];
      var ny = (ly - volMin[1]) / volSize[1];
      var nz = (lz - volMin[2]) / volSize[2];
      if (nx < 0.02 || nx > 0.98 || ny < 0.02 || ny > 0.98 || nz < 0.01 || nz > 0.99) continue;
      var vec = analysisVectorAt(nx, ny, nz, tn);
      if (vec.solid) continue;
      var speed = Math.sqrt(vec.ux * vec.ux + vec.uy * vec.uy + vec.uz * vec.uz);
      if (speed < 0.05) continue;
      var dx = vec.ux / speed;
      var dy = vec.uy / speed;
      var dz = vec.uz / speed;
      var len = arrowLen * (0.6 + 0.4 * clamp(speed / 15, 0, 1)) * scale;
      var hx = lx + dx * len;
      var hy = ly + dy * len;
      var hz = lz + dz * len;
      // 正交基用于箭头羽翼
      var sx = -dy;
      var sy = dx;
      var sl = Math.sqrt(sx * sx + sy * sy) || 1;
      sx /= sl; sy /= sl;
      var bw = len * 0.36;
      var bl = len * 0.34;
      points.push(lx, ly, lz, hx, hy, hz,
        hx - dx * bl + sx * bw, hy - dy * bl + sy * bw, hz - dz * bl,
        hx, hy, hz,
        hx - dx * bl - sx * bw, hy - dy * bl - sy * bw, hz - dz * bl);
      offsets.push(points.length / 3);
      speeds.push(speed);
    }
  }
  var posArr = new Float32Array(points);
  var offArr = new Uint32Array(offsets);
  var speedArr = new Float32Array(speeds);
  var result = { positions: posArr, offsets: offArr, speeds: speedArr, local: true };
  return { result: result, transfer: transferList([posArr, offArr, speedArr]) };
}

function directionAt(nx, ny, nz, tn, volSize) {
  // 越界采样（RK4 中间估计可能略微越界）直接判为无方向：
  // 否则 Math.pow(负数, 0.6) 会产生 NaN 并沿积分链污染整条流线。
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1 || nz < 0 || nz > 1) return null;
  var v = analysisVectorAt(nx, ny, nz, tn);
  if (v.solid) return null;
  var x = v.ux / volSize[0];
  var y = v.uy / volSize[1];
  var z = v.uz / volSize[2];
  var l = Math.sqrt(x * x + y * y + z * z);
  if (!(l >= 1e-7)) return null;
  return { x: x / l, y: y / l, z: z / l, speed: Math.sqrt(v.ux * v.ux + v.uy * v.uy + v.uz * v.uz) };
}

function streamlineSeed(rand, levels, index, seedCount) {
  var bandCount = Math.max(1, Math.round(levels || 1));
  if (sceneKind === 'cfd') {
    // 入口释放：+X 来流面近地高度带，贴近真实风洞入口布种
    return { x: 0.015 + 0.02 * rand(), y: 0.05 + 0.9 * rand(), z: 0.02 + 0.34 * rand() };
  }
  if (sceneKind === 'flood') {
    // 洪水只在近地薄层有水流，沿河道附近布种
    var fx = 0.03 + 0.94 * rand();
    var fy = 0.5 + ctx.riverAmp * Math.sin(fx * ctx.riverFreq) + 0.05 * Math.sin(fx * 9.1);
    return { x: fx, y: clamp(fy + (rand() - 0.5) * 0.16, 0.03, 0.97), z: 0.02 + 0.22 * rand() };
  }
  if (sceneKind === 'fire') {
    // 火源附近布种，随浮升热羽与风场输运
    var srcs = ctx.sources;
    var s = srcs.length ? srcs[Math.floor(rand() * srcs.length)] : { x: 0.5, y: 0.5 };
    return { x: clamp(s.x + (rand() - 0.5) * 0.14, 0.02, 0.98), y: clamp(s.y + (rand() - 0.5) * 0.14, 0.02, 0.98), z: 0.02 + 0.4 * rand() };
  }
  if (sceneKind === 'ocean') {
    return { x: 0.05 + 0.9 * rand(), y: 0.05 + 0.9 * rand(), z: 0.05 + 0.9 * rand() };
  }
  if (sceneKind === 'wind') {
    // 多高度分层布种：按 index 比例做幂次映射，低空更密、高空更疏，形成层次分明的流线族
    var total = seedCount && seedCount > 1 ? seedCount : bandCount;
    var u = (index + 0.5) / total;
    if (u > 1) u = 1;
    var z = 0.06 + 0.9 * Math.pow(u, 1.45);
    // 离散到若干高度带：按 u 的幂次映射使低空带更密、高空带更疏
    if (bandCount > 1) {
      var band = Math.floor(Math.pow(u, 1.35) * bandCount);
      if (band > bandCount - 1) band = bandCount - 1;
      z = 0.06 + 0.9 * (band / (bandCount - 1));
      z += (rand() - 0.5) * 0.06;
    }
    // 近地/近顶再混入少量带外种子，保持三维覆盖
    if (rand() < 0.18) z = 0.05 + 0.9 * rand();
    return { x: 0.04 + 0.92 * rand(), y: 0.04 + 0.92 * rand(), z: z < 0.03 ? 0.03 : z > 0.97 ? 0.97 : z };
  }
  if (sceneKind === 'plume') {
    // 各含水层内规则布种，形成随地下水流向运移的分层流线族
    var aqs = [];
    for (var ai = 0; ai < ctx.layers.length; ai += 1) {
      if (ctx.layers[ai].aquifer) aqs.push(ctx.layers[ai]);
    }
    if (!aqs.length) aqs = ctx.layers;
    var total = seedCount && seedCount > 1 ? seedCount : aqs.length;
    var perLayer = Math.max(1, Math.floor(total / aqs.length));
    var li = Math.floor(index / perLayer);
    if (li > aqs.length - 1) li = aqs.length - 1;
    var A = aqs[li];
    var local = index - li * perLayer;
    var cols = Math.max(1, Math.round(Math.sqrt(perLayer)));
    var gx = ((local % cols) + 0.5) / cols;
    var gy = (Math.floor(local / cols) + 0.5) / cols;
    var zCenter = 1 - 0.5 * (A.top + A.bottom);
    var z = clamp(zCenter + (rand() - 0.5) * 0.55 * (A.bottom - A.top), 0.03, 0.97);
    return { x: clamp(0.06 + 0.88 * gx, 0.03, 0.97), y: clamp(0.06 + 0.88 * gy, 0.03, 0.97), z: z };
  }
  return { x: 0.04 + 0.92 * rand(), y: 0.04 + 0.92 * rand(), z: 0.04 + 0.5 * rand() };
}

// 从种子点沿场方向积分半支流线（sign=1 顺流、-1 逆流），结果写入 outPts / outSpd
function traceHalf(x, y, z, sign, tn, volSize, step, steps, outPts, outSpd) {
  for (var s = 0; s < steps; s += 1) {
    var d1 = directionAt(x, y, z, tn, volSize);
    if (!d1) break;
    var h = step * sign;
    // RK4：四个斜率估计，步长按归一化弧长
    var a = directionAt(x + d1.x * h * 0.5, y + d1.y * h * 0.5, z + d1.z * h * 0.5, tn, volSize) || d1;
    var b = directionAt(x + a.x * h * 0.5, y + a.y * h * 0.5, z + a.z * h * 0.5, tn, volSize) || a;
    var c = directionAt(x + b.x * h, y + b.y * h, z + b.z * h, tn, volSize) || b;
    var dx = (d1.x + 2 * a.x + 2 * b.x + c.x) / 6;
    var dy = (d1.y + 2 * a.y + 2 * b.y + c.y) / 6;
    var dz = (d1.z + 2 * a.z + 2 * b.z + c.z) / 6;
    if (!isFinite(dx) || !isFinite(dy) || !isFinite(dz)) break;
    var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    x += (dx / dl) * h;
    y += (dy / dl) * h;
    z += (dz / dl) * h;
    if (x < 0 || x > 1 || y < 0 || y > 1 || z < 0 || z > 1) break;
    outPts.push(x, y, z);
    outSpd.push(d1.speed);
    if (d1.speed < 0.05) break;
  }
}

function analyzeStreamlines(message, tn) {
  var seedCount = message.seeds || 160;
  var steps = message.steps || 220;
  var step = message.step || 0.006;
  var levels = message.levels || 1;
  var bidirectional = message.bidirectional !== false;
  var volMin = message.volMin || [0, 0, 0];
  var volSize = message.volSize || [1, 1, 1];
  var rand = mulberry32((params.seed || 1) + 4519 + Math.round(tn * 1000));
  var points = [];
  var offsets = [0];
  var speeds = [];
  for (var sIdx = 0; sIdx < seedCount; sIdx += 1) {
    var seed = streamlineSeed(rand, levels, sIdx, seedCount);
    var seedD = directionAt(seed.x, seed.y, seed.z, tn, volSize);
    if (!seedD) continue;
    var lineStart = points.length / 3;

    var fwdPts = [];
    var fwdSpd = [];
    traceHalf(seed.x, seed.y, seed.z, 1, tn, volSize, step, steps, fwdPts, fwdSpd);

    if (bidirectional) {
      var bwdPts = [];
      var bwdSpd = [];
      traceHalf(seed.x, seed.y, seed.z, -1, tn, volSize, step, steps, bwdPts, bwdSpd);
      // 逆流半支倒序：远端 → 种子
      for (var i = bwdSpd.length - 1; i >= 0; i -= 1) {
        points.push(
          volMin[0] + bwdPts[i * 3] * volSize[0],
          volMin[1] + bwdPts[i * 3 + 1] * volSize[1],
          volMin[2] + bwdPts[i * 3 + 2] * volSize[2]
        );
        speeds.push(bwdSpd[i]);
      }
    }

    // 种子点
    points.push(
      volMin[0] + seed.x * volSize[0],
      volMin[1] + seed.y * volSize[1],
      volMin[2] + seed.z * volSize[2]
    );
    speeds.push(seedD.speed);

    // 顺流半支
    for (var k = 0; k < fwdSpd.length; k += 1) {
      points.push(
        volMin[0] + fwdPts[k * 3] * volSize[0],
        volMin[1] + fwdPts[k * 3 + 1] * volSize[1],
        volMin[2] + fwdPts[k * 3 + 2] * volSize[2]
      );
      speeds.push(fwdSpd[k]);
    }

    var lineEnd = points.length / 3;
    if (lineEnd - lineStart >= 2) offsets.push(lineEnd);
    else {
      points.length = lineStart * 3;
      speeds.length = lineStart;
    }
  }
  var posArr = new Float32Array(points);
  var offArr = new Uint32Array(offsets);
  var speedArr = new Float32Array(speeds);
  var result = { positions: posArr, offsets: offArr, speeds: speedArr, local: true };
  return { result: result, transfer: transferList([posArr, offArr, speedArr]) };
}

function isoEdge(a, b, va, vb, na, nb, iso, pos, nrm) {
  var t = (iso - va) / ((vb - va) || 1e-9);
  if (t < 0) t = 0; else if (t > 1) t = 1;
  pos.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  var gx = na[0] + (nb[0] - na[0]) * t;
  var gy = na[1] + (nb[1] - na[1]) * t;
  var gz = na[2] + (nb[2] - na[2]) * t;
  var gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
  nrm.push(gx / gl, gy / gl, gz / gl);
}

function isoCrossing(p, v, g, iso, pos, nrm) {
  var ins = [];
  var outs = [];
  for (var i = 0; i < 4; i += 1) { if (v[i] > iso) ins.push(i); else outs.push(i); }
  if (ins.length === 0 || ins.length === 4) return false;
  if (ins.length === 1) {
    var a = ins[0];
    isoEdge(p[a], p[outs[0]], v[a], v[outs[0]], g[a], g[outs[0]], iso, pos, nrm);
    isoEdge(p[a], p[outs[1]], v[a], v[outs[1]], g[a], g[outs[1]], iso, pos, nrm);
    isoEdge(p[a], p[outs[2]], v[a], v[outs[2]], g[a], g[outs[2]], iso, pos, nrm);
    return true;
  }
  if (ins.length === 3) {
    var d = outs[0];
    isoEdge(p[d], p[ins[0]], v[d], v[ins[0]], g[d], g[ins[0]], iso, pos, nrm);
    isoEdge(p[d], p[ins[1]], v[d], v[ins[1]], g[d], g[ins[1]], iso, pos, nrm);
    isoEdge(p[d], p[ins[2]], v[d], v[ins[2]], g[d], g[ins[2]], iso, pos, nrm);
    return true;
  }
  var i0 = ins[0], i1 = ins[1], o0 = outs[0], o1 = outs[1];
  isoEdge(p[i0], p[o0], v[i0], v[o0], g[i0], g[o0], iso, pos, nrm);
  isoEdge(p[o0], p[i1], v[o0], v[i1], g[o0], g[i1], iso, pos, nrm);
  isoEdge(p[i1], p[o1], v[i1], v[o1], g[i1], g[o1], iso, pos, nrm);
  isoEdge(p[o1], p[i0], v[o1], v[i0], g[o1], g[i0], iso, pos, nrm);
  return true;
}

function analyzeIsoSurface(message, tn) {
  var channel = message.channel;
  var iso = message.iso != null ? message.iso : 35;
  var volSize = message.volSize || [1, 1, 1];
  var base = message.res || 64;
  // XY 采用基础分辨率，Z 依据体域高宽比独立取值并保底，消除垂向欠采样
  var nx = Math.max(4, base);
  var ny = Math.max(4, base);
  var ratio = volSize[2] / Math.max(volSize[0], volSize[1]);
  var nz = Math.max(10, Math.round(base * ratio));
  var nodeCount = (nx + 1) * (ny + 1) * (nz + 1);
  var grid = new Float32Array(nodeCount);
  function nodeIndex(i, j, k) { return ((k * (ny + 1)) + j) * (nx + 1) + i; }
  for (var k = 0; k <= nz; k += 1) {
    var z = k / nz;
    for (var j = 0; j <= ny; j += 1) {
      var y = j / ny;
      for (var i = 0; i <= nx; i += 1) {
        var s = sampleField(i / nx, y, z, tn, channel);
        grid[nodeIndex(i, j, k)] = s.valid ? s.value : -99999;
      }
    }
  }
  // 物理空间中心差分梯度，作为各网格节点的法线（供着色平滑与法线插值）
  var gnx = new Float32Array(nodeCount);
  var gny = new Float32Array(nodeCount);
  var gnz = new Float32Array(nodeCount);
  var sx = volSize[0] / nx;
  var sy = volSize[1] / ny;
  var sz = volSize[2] / nz;
  for (var gk = 0; gk <= nz; gk += 1) {
    for (var gj = 0; gj <= ny; gj += 1) {
      for (var gi = 0; gi <= nx; gi += 1) {
        var idx = nodeIndex(gi, gj, gk);
        var c = grid[idx];
        if (c <= -90000) continue;
        var im = gi > 0 ? gi - 1 : gi;
        var ip = gi < nx ? gi + 1 : gi;
        var jm = gj > 0 ? gj - 1 : gj;
        var jp = gj < ny ? gj + 1 : gj;
        var km = gk > 0 ? gk - 1 : gk;
        var kp = gk < nz ? gk + 1 : gk;
        var vx = grid[nodeIndex(ip, gj, gk)];
        var vxm = grid[nodeIndex(im, gj, gk)];
        var vy = grid[nodeIndex(gi, jp, gk)];
        var vym = grid[nodeIndex(gi, jm, gk)];
        var vz = grid[nodeIndex(gi, gj, kp)];
        var vzm = grid[nodeIndex(gi, gj, km)];
        if (vx > -90000 && vxm > -90000) gnx[idx] = (vx - vxm) / ((ip - im) * sx);
        if (vy > -90000 && vym > -90000) gny[idx] = (vy - vym) / ((jp - jm) * sy);
        if (vz > -90000 && vzm > -90000) gnz[idx] = (vz - vzm) / ((kp - km) * sz);
      }
    }
  }
  var positions = [];
  var normals = [];
  var cor = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
  ];
  var tets = [
    [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
    [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]
  ];
  for (var ck = 0; ck < nz; ck += 1) {
    for (var cj = 0; cj < ny; cj += 1) {
      for (var ci = 0; ci < nx; ci += 1) {
        var cp = [];
        var cv = [];
        var cg = [];
        for (var cIdx = 0; cIdx < 8; cIdx += 1) {
          var o = cor[cIdx];
          cp.push([(ci + o[0]) / nx, (cj + o[1]) / ny, (ck + o[2]) / nz]);
          var nd = nodeIndex(ci + o[0], cj + o[1], ck + o[2]);
          cv.push(grid[nd]);
          cg.push([gnx[nd], gny[nd], gnz[nd]]);
        }
        for (var t = 0; t < 6; t += 1) {
          var tet = tets[t];
          var pos = [];
          var nrm = [];
          if (!isoCrossing([cp[tet[0]], cp[tet[1]], cp[tet[2]], cp[tet[3]]],
            [cv[tet[0]], cv[tet[1]], cv[tet[2]], cv[tet[3]]],
            [cg[tet[0]], cg[tet[1]], cg[tet[2]], cg[tet[3]]], iso, pos, nrm)) continue;
          var pn = pos.length / 3;
          for (var tri = 1; tri < pn - 1; tri += 1) {
            positions.push(pos[0], pos[1], pos[2],
              pos[tri * 3], pos[tri * 3 + 1], pos[tri * 3 + 2],
              pos[(tri + 1) * 3], pos[(tri + 1) * 3 + 1], pos[(tri + 1) * 3 + 2]);
            normals.push(nrm[0], nrm[1], nrm[2],
              nrm[tri * 3], nrm[tri * 3 + 1], nrm[tri * 3 + 2],
              nrm[(tri + 1) * 3], nrm[(tri + 1) * 3 + 1], nrm[(tri + 1) * 3 + 2]);
          }
        }
      }
    }
  }
  var posArr = new Float32Array(positions);
  var normArr = new Float32Array(normals);
  var result = { positions: posArr, normals: normArr, count: positions.length / 9, res: base, nz: nz };
  return { result: result, transfer: transferList([posArr, normArr]) };
}

// 地质层位统计：逐层厚度、平均孔隙率/饱和度、渗透率均值与 P95，并回传构造起伏栅格
function analyzeGeology(message, tn) {
  var N = message.res || 48;
  var V = message.vres || 64;
  var contacts = ctx.contacts;
  var layerCount = contacts.length + 1;
  var count = new Float32Array(layerCount + 1);
  var porSum = new Float32Array(layerCount + 1);
  var satSum = new Float32Array(layerCount + 1);
  var permMeanSum = new Float32Array(layerCount + 1);
  var permList = [];
  for (var li = 0; li <= layerCount; li += 1) permList.push([]);
  var total = 0;
  for (var iz = 0; iz < V; iz += 1) {
    var z = (iz + 0.5) / V;
    for (var iy = 0; iy < N; iy += 1) {
      var y = (iy + 0.5) / N;
      for (var ix = 0; ix < N; ix += 1) {
        var x = (ix + 0.5) / N;
        var code = geoLayer(x, y, z);
        var por = geoProperty(x, y, z, code, 'porosity');
        var sat = geoProperty(x, y, z, code, 'saturation');
        var perm = geoProperty(x, y, z, code, 'permeability');
        count[code] += 1;
        porSum[code] += por;
        satSum[code] += sat;
        permMeanSum[code] += perm;
        if (permList[code].length < 40000) permList[code].push(perm);
        total += 1;
      }
    }
  }
  var layers = [];
  for (var c = 1; c <= layerCount; c += 1) {
    var cnt = count[c];
    var arr = permList[c];
    layers.push({
      code: c,
      fraction: total ? cnt / total : 0,
      thicknessNorm: total ? cnt / (V * N * N) : 0,
      porosity: cnt ? porSum[c] / cnt : 0,
      saturation: cnt ? satSum[c] / cnt : 0,
      permMean: cnt ? permMeanSum[c] / cnt : 0,
      permP95: arr.length ? percentile(arr, arr.length, 0.95) : 0
    });
  }
  // 构造起伏栅格：前端据此推算各层界埋深（层界埋深 = 接触面 - 起伏）
  var relief = new Float32Array(N * N);
  for (var ry = 0; ry < N; ry += 1) {
    for (var rx = 0; rx < N; rx += 1) {
      relief[ry * N + rx] = geoShift((rx + 0.5) / N, (ry + 0.5) / N);
    }
  }
  var result = {
    res: N,
    contacts: contacts.slice(0),
    layers: layers,
    relief: relief
  };
  return { result: result, transfer: transferList([relief]) };
}

// 地质剖面：沿 A-B 直线逐点垂向采样岩性码与属性值，供前端绘制专业剖面图
function analyzeGeologyProfile(message, tn) {
  var a = message.a || [0.08, 0.5];
  var b = message.b || [0.92, 0.5];
  var steps = message.steps || 160;
  var levels = message.levels || 96;
  var channel = message.channel || 'litho';
  var litho = new Uint8Array(steps * levels);
  var values = new Float32Array(steps * levels);
  for (var s = 0; s < steps; s += 1) {
    var t = steps > 1 ? s / (steps - 1) : 0;
    var nx = a[0] + (b[0] - a[0]) * t;
    var ny = a[1] + (b[1] - a[1]) * t;
    for (var l = 0; l < levels; l += 1) {
      var nz = 1 - (l + 0.5) / levels;
      var code = geoLayer(nx, ny, nz);
      var idx = l * steps + s;
      litho[idx] = code;
      values[idx] = channel === 'litho' ? code : geoProperty(nx, ny, nz, code, channel);
    }
  }
  var result = { steps: steps, levels: levels, litho: litho, values: values, a: a, b: b, channel: channel };
  return { result: result, transfer: transferList([litho, values]) };
}

function analyzeCfd(message, tn) {
  var N = message.res || 40;
  var inflow = params.inflow != null ? params.inflow : 6;
  var ambient = params.ambientTemp != null ? params.ambientTemp : 300;
  var sourceTemp = params.sourceTemp != null ? params.sourceTemp : 320;
  var deltaT = Math.max(1e-3, sourceTemp - ambient);
  var volSize = message.volSize || [1, 1, 1];
  var speedSum = 0;
  var speedCount = 0;
  var speedMax = 0;
  var speeds = new Float32Array(N * N * N);
  var pMin = Infinity;
  var pMax = -Infinity;
  var tMax = ambient;
  var plumeTop = 0;
  var wakeMax = 0;
  var bHeight = 0.3;
  var boxes = ctx.buildings;
  var refX = 0.5;
  if (boxes.length) {
    bHeight = 0;
    for (var bi = 0; bi < boxes.length; bi += 1) {
      if (boxes[bi].z1 > bHeight) bHeight = boxes[bi].z1;
      refX = Math.min(refX, boxes[bi].x1);
    }
  }
  for (var iz = 0; iz < N; iz += 1) {
    var z = (iz + 0.5) / N;
    for (var iy = 0; iy < N; iy += 1) {
      var y = (iy + 0.5) / N;
      for (var ix = 0; ix < N; ix += 1) {
        var x = (ix + 0.5) / N;
        if (cfdSolid(x, y, z)) continue;
        var v = cfdVector(x, y, z, tn);
        var sp = Math.sqrt(v.ux * v.ux + v.uy * v.uy + v.uz * v.uz);
        speeds[speedCount] = sp;
        speedCount += 1;
        speedSum += sp;
        if (sp > speedMax) speedMax = sp;
        var p = 2.4 * (v.ref * v.ref - sp * sp);
        if (p < -120) p = -120; else if (p > 120) p = 120;
        if (p < pMin) pMin = p;
        if (p > pMax) pMax = p;
        var tp = cfdTemperature(x, y, z, tn);
        if (tp > tMax) tMax = tp;
        if (tp > ambient + 0.25 * deltaT && z > plumeTop) plumeTop = z;
        // 尾流长度：顺风向速度恢复距离，以建筑高度归一
        if (x > refX && Math.abs(y - 0.5) < 0.14 && z < bHeight) {
          if (sp < 0.55 * Math.max(inflow, 0.1)) {
            var len = (x - refX) * volSize[0];
            if (len > wakeMax) wakeMax = len;
          }
        }
      }
    }
  }
  if (!speedCount) { pMin = 0; pMax = 0; }
  var bHeightM = Math.max(1, bHeight * volSize[2]);
  var result = {
    inflow: inflow,
    meanSpeed: speedCount ? speedSum / speedCount : 0,
    maxSpeed: speedMax,
    p95Speed: percentile(speeds, speedCount, 0.95),
    pressureMin: pMin === Infinity ? 0 : pMin,
    pressureMax: pMax === -Infinity ? 0 : pMax,
    maxTemp: tMax,
    overheat: tMax - ambient,
    plumeTopM: plumeTop * volSize[2],
    wakeLengthM: wakeMax,
    wakeRatio: wakeMax / bHeightM,
    buildingHeightM: bHeightM,
    sampleCount: speedCount
  };
  return { result: result, transfer: [] };
}

/* ------------------------------------------------------------------ *
 * 第二批案例领域分析：污染羽流 / 矿体品位 / 洪水 / 火灾 / 海洋
 * ------------------------------------------------------------------ */

// 污染羽流：给定浓度阈值下的污染体积、影响面积、前缘迁移距离、分层赋存与抽采捕获率
function analyzePlume(message, tn) {
  var channel = message.channel;
  var threshold = message.threshold != null ? message.threshold : 50;
  var coreThreshold = message.coreThreshold != null ? message.coreThreshold : threshold * 2;
  var N = message.res || 40;
  var V = message.vres || 48;
  var volSize = message.volSize || [1, 1, 1];
  var cellArea = (volSize[0] / N) * (volSize[1] / N);
  var cellVol = cellArea * (volSize[2] / V);
  var src = ctx.source;
  var flow = ctx.flowDir;
  var cosf = Math.cos(flow);
  var sinf = Math.sin(flow);
  var distScale = Math.sqrt(Math.pow(volSize[0] * cosf, 2) + Math.pow(volSize[1] * sinf, 2));
  var layers = ctx.layers;
  var aVolume = new Float64Array(layers.length);
  var aAbove = new Float64Array(layers.length);
  var columnAbove = new Uint8Array(N * N);
  var volume = 0;
  var coreVolume = 0;
  var area = 0;
  var frontMax = 0;
  var maxConc = 0;
  var maxPos = [0, 0, 0];
  var sum = 0;
  var count = 0;
  var aboveCount = 0;
  var aboveAfterStart = 0;
  var captured = 0;
  var pw = ctx.pumping;
  var monthIdx = pw ? tn * ((pw.totalSteps || 24) - 1) : 0;
  for (var iz = 0; iz < V; iz += 1) {
    var nz = (iz + 0.5) / V;
    var depth = 1 - nz;
    var code = layers.length - 1;
    for (var ai = 0; ai < layers.length; ai += 1) {
      if (depth >= layers[ai].top && depth <= layers[ai].bottom) { code = ai; break; }
    }
    for (var iy = 0; iy < N; iy += 1) {
      var ny = (iy + 0.5) / N;
      for (var ix = 0; ix < N; ix += 1) {
        var nx = (ix + 0.5) / N;
        var s = plumeValue(nx, ny, nz, tn, channel);
        if (!s.valid || s.value <= 0) continue;
        count += 1;
        sum += s.value;
        if (s.value > maxConc) { maxConc = s.value; maxPos = [nx, ny, nz]; }
        if (s.value >= threshold) {
          aboveCount += 1;
          volume += cellVol;
          if (s.value >= coreThreshold) coreVolume += cellVol;
          columnAbove[iy * N + ix] = 1;
          var along = (nx - src.x) * cosf + (ny - src.y) * sinf;
          if (along > frontMax) frontMax = along;
          aVolume[code] += cellVol;
          aAbove[code] += 1;
          if (pw && monthIdx >= pw.startStep) {
            aboveAfterStart += 1;
            var cdx = nx - pw.x;
            var cdy = ny - pw.y;
            var cr = Math.sqrt(cdx * cdx + cdy * cdy);
            var bandC = 0.5 * (pw.screenTop + pw.screenBottom);
            if (cr <= pw.radius && Math.abs(depth - bandC) <= 0.13) captured += 1;
          }
        }
      }
    }
  }
  for (var ci = 0; ci < N * N; ci += 1) if (columnAbove[ci]) area += cellArea;
  var aquiferStats = [];
  for (var k = 0; k < layers.length; k += 1) {
    aquiferStats.push({
      code: layers[k].code,
      above: aAbove[k],
      volumeM3: aVolume[k],
      fraction: aboveCount ? aAbove[k] / aboveCount : 0
    });
  }
  var result = {
    threshold: threshold,
    coreThreshold: coreThreshold,
    volumeM3: volume,
    coreVolumeM3: coreVolume,
    areaM2: area,
    frontDistanceM: frontMax * distScale,
    maxConc: maxConc,
    meanConc: count ? sum / count : 0,
    maxPos: maxPos,
    aquiferStats: aquiferStats,
    captureRate: aboveAfterStart ? captured / aboveAfterStart : 0,
    captureCount: captured,
    sampleCount: count,
    aboveCount: aboveCount
  };
  return { result: result, transfer: [] };
}

// 矿体品位：给定边界/工业品位下的矿量、平均品位、金属量与高品位分布
function analyzeMining(message, tn) {
  var channel = message.channel || 'cu';
  var cutoff = message.cutoff != null ? message.cutoff : 0.2;
  var density = message.density != null ? message.density : 2.7;
  var N = message.res || 44;
  var V = message.vres || 44;
  var volSize = message.volSize || [1, 1, 1];
  var cellVol = (volSize[0] / N) * (volSize[1] / N) * (volSize[2] / V);
  var volume = 0;
  var gradeSum = 0;
  var count = 0;
  var maxGrade = 0;
  var maxPos = [0, 0, 0];
  var total = 0;
  var sumAll = 0;
  var maxVal = channel === 'au' ? 4 : channel === 'fe' ? 60 : 2;
  var bins = new Float64Array(6);
  for (var iz = 0; iz < V; iz += 1) {
    var nz = (iz + 0.5) / V;
    for (var iy = 0; iy < N; iy += 1) {
      var ny = (iy + 0.5) / N;
      for (var ix = 0; ix < N; ix += 1) {
        var nx = (ix + 0.5) / N;
        var value = miningValue(nx, ny, nz, tn, channel).value;
        total += 1;
        sumAll += value;
        if (value > maxGrade) { maxGrade = value; maxPos = [nx, ny, nz]; }
        var bin = Math.min(5, Math.floor((value / maxVal) * 6));
        if (bin >= 0) bins[bin] += 1;
        if (value >= cutoff) {
          volume += cellVol;
          gradeSum += value;
          count += 1;
        }
      }
    }
  }
  var tonnage = volume * density;
  var avgGrade = count ? gradeSum / count : 0;
  var metalAmount;
  var metalUnit;
  if (channel === 'au') { metalAmount = tonnage * avgGrade / 1000; metalUnit = 'kg'; }
  else { metalAmount = tonnage * avgGrade / 100; metalUnit = 't'; }
  var result = {
    channel: channel,
    cutoff: cutoff,
    density: density,
    oreVolumeM3: volume,
    tonnage: tonnage,
    avgGrade: avgGrade,
    maxGrade: maxGrade,
    meanGrade: total ? sumAll / total : 0,
    metalAmount: metalAmount,
    metalUnit: metalUnit,
    oreFraction: total ? count / total : 0,
    maxPos: maxPos,
    bins: bins,
    sampleCount: total
  };
  return { result: result, transfer: [] };
}

// 洪水：淹没范围 / 最大水深 / 流速与受影响对象（含到达时间估计）
function analyzeFlood(message, tn) {
  var depthThreshold = message.depthThreshold != null ? message.depthThreshold : 0.5;
  var N = message.res || 48;
  var V = message.vres || 24;
  var timeSteps = message.timeSteps || 1;
  var volSize = message.volSize || [1, 1, 1];
  var zones = message.zones || [];
  var cellArea = (volSize[0] / N) * (volSize[1] / N);
  var wetColumns = new Uint8Array(N * N);
  var volume = 0;
  var maxDepth = 0;
  var maxPos = [0, 0, 0];
  var depthSum = 0;
  var depthCount = 0;
  var maxSpeed = 0;
  var speedSum = 0;
  var speedCount = 0;
  for (var iz = 0; iz < V; iz += 1) {
    var nz = (iz + 0.5) / V;
    for (var iy = 0; iy < N; iy += 1) {
      var ny = (iy + 0.5) / N;
      for (var ix = 0; ix < N; ix += 1) {
        var nx = (ix + 0.5) / N;
        var dNorm = floodDepthNorm(nx, ny, tn);
        if (dNorm <= 0.0008) continue;
        var depth = dNorm * 30;
        volume += depth * cellArea;
        depthSum += depth;
        depthCount += 1;
        if (depth > maxDepth) { maxDepth = depth; maxPos = [nx, ny, nz]; }
        var vec = floodVector(nx, ny, nz, tn);
        var sp = Math.sqrt(vec.ux * vec.ux + vec.uy * vec.uy + vec.uz * vec.uz);
        speedSum += sp;
        speedCount += 1;
        if (sp > maxSpeed) maxSpeed = sp;
      }
    }
  }
  var area = 0;
  for (var iy2 = 0; iy2 < N; iy2 += 1) {
    for (var ix2 = 0; ix2 < N; ix2 += 1) {
      if (floodDepthNorm((ix2 + 0.5) / N, (iy2 + 0.5) / N, tn) * 30 >= depthThreshold) {
        area += cellArea;
        wetColumns[iy2 * N + ix2] = 1;
      }
    }
  }
  var zoneStats = [];
  for (var zi = 0; zi < zones.length; zi += 1) {
    var z = zones[zi];
    var zMax = 0;
    var zWet = 0;
    var zCells = 0;
    var arrival = -1;
    var rr = z.r || 0.05;
    for (var gy = 0; gy < N; gy += 1) {
      for (var gx = 0; gx < N; gx += 1) {
        var px = (gx + 0.5) / N;
        var py = (gy + 0.5) / N;
        if (Math.pow(px - z.x, 2) + Math.pow(py - z.y, 2) > rr * rr) continue;
        zCells += 1;
        var dd = floodDepthNorm(px, py, tn) * 30;
        if (dd > zMax) zMax = dd;
        if (dd >= depthThreshold) zWet += 1;
      }
    }
    if (zCells && timeSteps > 1) {
      for (var ts = 0; ts < timeSteps; ts += 1) {
        var tt = ts / (timeSteps - 1);
        if (floodDepthNorm(z.x, z.y, tt) * 30 >= depthThreshold) { arrival = ts; break; }
      }
    }
    zoneStats.push({
      id: z.id,
      maxDepthM: zMax,
      arrivalStep: arrival,
      floodedFrac: zCells ? zWet / zCells : 0
    });
  }
  var result = {
    depthThreshold: depthThreshold,
    floodedAreaM2: area,
    floodedVolumeM3: volume,
    maxDepthM: maxDepth,
    meanDepthM: depthCount ? depthSum / depthCount : 0,
    maxSpeed: maxSpeed,
    meanSpeed: speedCount ? speedSum / speedCount : 0,
    floodedFraction: (N * N) ? countTrue(wetColumns) / (N * N) : 0,
    maxPos: maxPos,
    zoneStats: zoneStats,
    sampleCount: depthCount
  };
  return { result: result, transfer: [] };
}

function countTrue(arr) {
  var c = 0;
  for (var i = 0; i < arr.length; i += 1) if (arr[i]) c += 1;
  return c;
}

// 洪水纵剖面：沿河道中心线逐点给出水面高程、地面高程与水深，供剖面图绘制
function analyzeFloodProfile(message, tn) {
  var steps = message.steps || 160;
  var xs = new Float32Array(steps);
  var depth = new Float32Array(steps);
  var level = new Float32Array(steps);
  var terrain = new Float32Array(steps);
  var maxDepth = 0;
  var maxIdx = 0;
  for (var s = 0; s < steps; s += 1) {
    var nx = 0.02 + (0.96 * s) / Math.max(1, steps - 1);
    var ny = 0.5 + ctx.riverAmp * Math.sin(nx * ctx.riverFreq) + 0.05 * Math.sin(nx * 9.1);
    var nyc = ny < 0.02 ? 0.02 : ny > 0.98 ? 0.98 : ny;
    xs[s] = nx;
    depth[s] = floodDepthNorm(nx, nyc, tn) * 30;
    level[s] = floodSurface(nx, nyc, tn) * 30;
    terrain[s] = floodTerrain(nx, nyc) * 30;
    if (depth[s] > maxDepth) { maxDepth = depth[s]; maxIdx = s; }
  }
  var result = {
    steps: steps,
    x: xs,
    depth: depth,
    level: level,
    terrain: terrain,
    maxDepthM: maxDepth,
    peakAt: maxIdx / Math.max(1, steps - 1)
  };
  return { result: result, transfer: transferList([xs, depth, level, terrain]) };
}

// 火灾：危险温度体积 / 烟气体积 / 风险分级体积 / 烟羽顶高 / 下风向影响距离与建筑受威胁度
function analyzeFire(message, tn) {
  var tempThreshold = message.tempThreshold != null ? message.tempThreshold : 150;
  var smokeThreshold = message.smokeThreshold != null ? message.smokeThreshold : 150;
  var riskTemp = message.riskTemp || [60, 150, 350, 600];
  var riskSmoke = message.riskSmoke || [50, 150, 250, 400];
  var N = message.res || 44;
  var V = message.vres || 40;
  var volSize = message.volSize || [1, 1, 1];
  var cellVol = (volSize[0] / N) * (volSize[1] / N) * (volSize[2] / V);
  var maxTemp = 20;
  var maxTempPos = [0, 0, 0];
  var dangerVolume = 0;
  var smokeVolume = 0;
  var plumeTop = 0;
  var count = 0;
  var bands = [0, 0, 0, 0, 0];
  var src = ctx.sources.length ? ctx.sources[0] : { x: 0.5, y: 0.5 };
  var flow = fireFlowDir();
  var cosf = Math.cos(flow);
  var sinf = Math.sin(flow);
  var distScale = Math.sqrt(Math.pow(volSize[0] * cosf, 2) + Math.pow(volSize[1] * sinf, 2));
  var downwind = 0;
  for (var iz = 0; iz < V; iz += 1) {
    var nz = (iz + 0.5) / V;
    for (var iy = 0; iy < N; iy += 1) {
      var ny = (iy + 0.5) / N;
      for (var ix = 0; ix < N; ix += 1) {
        var nx = (ix + 0.5) / N;
        var tVal = fireValue(nx, ny, nz, tn, 'temp');
        var sVal = fireValue(nx, ny, nz, tn, 'smoke');
        count += 1;
        if (tVal.valid && tVal.value > maxTemp) { maxTemp = tVal.value; maxTempPos = [nx, ny, nz]; }
        if (tVal.valid && tVal.value >= tempThreshold) {
          dangerVolume += cellVol;
          if (nz > plumeTop) plumeTop = nz;
        }
        if (sVal.valid && sVal.value >= smokeThreshold) {
          smokeVolume += cellVol;
          if (nz > plumeTop) plumeTop = nz;
          var along = (nx - src.x) * cosf + (ny - src.y) * sinf;
          if (along > downwind) downwind = along;
        }
        if (sVal.valid || tVal.valid) {
          var tb = (tVal.valid && tVal.value >= riskTemp[0] ? 1 : 0) + (tVal.valid && tVal.value >= riskTemp[1] ? 1 : 0) + (tVal.valid && tVal.value >= riskTemp[2] ? 1 : 0) + (tVal.valid && tVal.value >= riskTemp[3] ? 1 : 0);
          var sb = (sVal.valid && sVal.value >= riskSmoke[0] ? 1 : 0) + (sVal.valid && sVal.value >= riskSmoke[1] ? 1 : 0) + (sVal.valid && sVal.value >= riskSmoke[2] ? 1 : 0) + (sVal.valid && sVal.value >= riskSmoke[3] ? 1 : 0);
          var band = Math.max(tb, sb);
          bands[band] += cellVol;
        }
      }
    }
  }
  var buildings = message.buildings || [];
  var impacts = [];
  for (var bi = 0; bi < buildings.length; bi += 1) {
    var b = buildings[bi];
    var midZ = clamp(b.height != null ? b.height * 0.55 : 0.1, 0.02, 0.95);
    var bTemp = fireValue(b.x, b.y, midZ, tn, 'temp').value;
    var bSmoke = fireValue(b.x, b.y, 0.5, tn, 'smoke').value;
    impacts.push({ id: b.id, temp: bTemp, smoke: bSmoke });
  }
  var result = {
    tempThreshold: tempThreshold,
    smokeThreshold: smokeThreshold,
    dangerVolumeM3: dangerVolume,
    smokeVolumeM3: smokeVolume,
    bandsM3: bands,
    maxTemp: maxTemp,
    plumeTopM: plumeTop * volSize[2],
    downwindM: downwind * distScale,
    maxPos: maxTempPos,
    impacts: impacts,
    sampleCount: count
  };
  return { result: result, transfer: [] };
}

// 海洋：温盐深极值 / 层平均 / 温跃层深度与站位温盐散点
function analyzeOcean(message, tn) {
  var channel = message.channel || 'temperature';
  var N = message.res || 40;
  var V = message.vres || 40;
  var volSize = message.volSize || [1, 1, 1];
  var stations = message.stations || [];
  var minV = Infinity;
  var maxV = -Infinity;
  var sum = 0;
  var count = 0;
  var profileT = new Float32Array(V);
  for (var iz = 0; iz < V; iz += 1) {
    var nz = (iz + 0.5) / V;
    var layerSum = 0;
    var layerCount = 0;
    for (var iy = 0; iy < N; iy += 1) {
      var ny = (iy + 0.5) / N;
      for (var ix = 0; ix < N; ix += 1) {
        var nx = (ix + 0.5) / N;
        var value = oceanValue(nx, ny, nz, tn, channel).value;
        if (value < minV) minV = value;
        if (value > maxV) maxV = value;
        sum += value;
        count += 1;
        layerSum += value;
        layerCount += 1;
      }
    }
    profileT[iz] = layerCount ? layerSum / layerCount : 0;
  }
  // 温跃层深度：垂向温度梯度最大处（对温度通道；其他通道用自身梯度的近似）
  var thermoIdx = 0;
  var thermoGrad = -1;
  for (var k = 1; k < V; k += 1) {
    var g = Math.abs(profileT[k] - profileT[k - 1]);
    if (g > thermoGrad) { thermoGrad = g; thermoIdx = k; }
  }
  var stationOut = [];
  for (var si = 0; si < stations.length; si += 1) {
    var st = stations[si];
    var tSurf = oceanValue(st.x, st.y, 0.97, tn, 'temperature').value;
    var sSurf = oceanValue(st.x, st.y, 0.97, tn, 'salinity').value;
    var rhoSurf = oceanValue(st.x, st.y, 0.97, tn, 'density').value;
    var tDeep = oceanValue(st.x, st.y, 0.08, tn, 'temperature').value;
    var sDeep = oceanValue(st.x, st.y, 0.08, tn, 'salinity').value;
    var rhoDeep = oceanValue(st.x, st.y, 0.08, tn, 'density').value;
    stationOut.push({
      id: st.id,
      x: st.x,
      y: st.y,
      tSurface: tSurf,
      sSurface: sSurf,
      rhoSurface: rhoSurf,
      tDeep: tDeep,
      sDeep: sDeep,
      rhoDeep: rhoDeep
    });
  }
  var result = {
    channel: channel,
    minValue: minV === Infinity ? 0 : minV,
    maxValue: maxV === -Infinity ? 0 : maxV,
    meanValue: count ? sum / count : 0,
    thermoclineDepthM: (1 - (thermoIdx + 0.5) / V) * volSize[2],
    profile: profileT,
    stations: stationOut,
    sampleCount: count
  };
  return { result: result, transfer: transferList([profileT]) };
}

function handleAnalyze(message) {
  var tn = message.timeSteps > 1 ? message.timeStep / (message.timeSteps - 1) : 0;
  var out;
  if (message.mode === 'stats') out = analyzeStats(message, tn);
  else if (message.mode === 'radar') out = analyzeRadar(message, tn);
  else if (message.mode === 'radarTrend') out = analyzeRadarTrend(message);
  else if (message.mode === 'pm25') out = analyzePm25(message, tn);
  else if (message.mode === 'pm25Stations') out = analyzePm25Stations(message, tn);
  else if (message.mode === 'pm25Hotspots') out = analyzePm25Hotspots(message, tn);
  else if (message.mode === 'pm25Sources') out = analyzePm25Sources(message, tn);
  else if (message.mode === 'pm25Trend') out = analyzePm25Trend(message);
  else if (message.mode === 'pm25Footprint') out = analyzePm25Footprint(message, tn);
  else if (message.mode === 'pm25Point') out = analyzePm25Point(message, tn);
  else if (message.mode === 'pm25Ray') out = analyzePm25Ray(message, tn);
  else if (message.mode === 'profile') out = analyzeProfile(message, tn);
  else if (message.mode === 'section') out = analyzeSection(message, tn);
  else if (message.mode === 'streamlines') out = analyzeStreamlines(message, tn);
  else if (message.mode === 'isosurface') out = analyzeIsoSurface(message, tn);
  else if (message.mode === 'geology') out = analyzeGeology(message, tn);
  else if (message.mode === 'geologyProfile') out = analyzeGeologyProfile(message, tn);
  else if (message.mode === 'cfd') out = analyzeCfd(message, tn);
  else if (message.mode === 'plume') out = analyzePlume(message, tn);
  else if (message.mode === 'mining') out = analyzeMining(message, tn);
  else if (message.mode === 'flood') out = analyzeFlood(message, tn);
  else if (message.mode === 'floodProfile') out = analyzeFloodProfile(message, tn);
  else if (message.mode === 'fire') out = analyzeFire(message, tn);
  else if (message.mode === 'ocean') out = analyzeOcean(message, tn);
  else out = { result: {}, transfer: [] };
  self.postMessage(
    { type: 'analysisDone', epoch: message.epoch, requestId: message.requestId, mode: message.mode, result: out.result },
    out.transfer
  );
}
`
