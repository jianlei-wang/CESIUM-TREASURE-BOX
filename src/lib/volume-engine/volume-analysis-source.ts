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
  var threshold = message.threshold != null ? message.threshold : 20;
  var topGrid = new Float32Array(G * G);
  var maxTop = 0;
  var topSum = 0;
  var topCount = 0;
  for (var iy = 0; iy < G; iy += 1) {
    var y = (iy + 0.5) / G;
    for (var ix = 0; ix < G; ix += 1) {
      var x = (ix + 0.5) / G;
      var top = 0;
      for (var iz = V - 1; iz >= 0; iz -= 1) {
        var s = sampleField(x, y, (iz + 0.5) / V, tn, channel);
        if (s.valid && s.value >= threshold) { top = (iz + 0.5) / V; break; }
      }
      topGrid[iy * G + ix] = top;
      if (top > maxTop) maxTop = top;
      if (top > 0) { topSum += top; topCount += 1; }
    }
  }
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
        if (sc.valid && sc.value >= 45) candidates.push({ x: xx, y: yy, z: zz, v: sc.value });
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
  for (var k = 0; k < cores.length; k += 1) {
    corePos[k * 3] = cores[k].x;
    corePos[k * 3 + 1] = cores[k].y;
    corePos[k * 3 + 2] = cores[k].z;
    corePeak[k] = cores[k].v;
  }
  var result = {
    grid: G,
    maxTop: maxTop,
    meanTop: topCount ? topSum / topCount : 0,
    topGrid: topGrid,
    corePos: corePos,
    corePeak: corePeak,
    coreCount: cores.length
  };
  return { result: result, transfer: transferList([topGrid, corePos, corePeak]) };
}

function analyzePm25(message, tn) {
  var N = message.res || 40;
  var channel = message.channel;
  var threshold = message.threshold != null ? message.threshold : 75;
  var popDensity = message.popDensity != null ? message.popDensity : 1600;
  var areaKm2 = message.areaKm2 != null ? message.areaKm2 : 1600;
  var breakpoints = [35, 75, 115, 150, 250];
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
  for (var iy = 0; iy < N; iy += 1) {
    var y = (iy + 0.5) / N;
    for (var ix = 0; ix < N; ix += 1) {
      var x = (ix + 0.5) / N;
      var dx = x - 0.5;
      var dy = y - 0.55;
      var density = 0.35 + 0.65 * Math.exp(-(dx * dx + dy * dy) / (2 * 0.24 * 0.24));
      var column = 0;
      for (var iz = 0; iz < N; iz += 1) {
        var s = sampleField(x, y, (iz + 0.5) / N, tn, channel);
        if (!s.valid) continue;
        total += 1;
        values[count] = s.value;
        count += 1;
        sum += s.value;
        if (s.value < min) min = s.value;
        if (s.value > max) max = s.value;
        if (s.value >= threshold) above += 1;
        if (s.value > column) column = s.value;
        var cls = 0;
        while (cls < 5 && s.value > breakpoints[cls]) cls += 1;
        classHist[cls] += 1;
      }
      totalWeight += density;
      if (column >= threshold) exposedWeight += density;
    }
  }
  if (!count) { min = 0; max = 0; }
  var exposed = areaKm2 > 0 ? (exposedWeight / totalWeight) * areaKm2 * popDensity : 0;
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
    classHist: classHist,
    exposed: exposed,
    exposedFraction: totalWeight ? exposedWeight / totalWeight : 0
  };
  return { result: result, transfer: transferList([classHist]) };
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
  var isVector = sceneKind === 'wind' || sceneKind === 'cfd';
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
  var volMin = message.volMin;
  var volSize = message.volSize;
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

function analyzeStreamlines(message, tn) {
  var seedCount = message.seeds || 140;
  var steps = message.steps || 150;
  var step = message.step || 0.012;
  var channel = message.channel;
  var volMin = message.volMin;
  var volSize = message.volSize;
  var rand = mulberry32((params.seed || 1) + 4519 + Math.round(tn * 1000));
  var points = [];
  var offsets = [0];
  var speeds = [];
  for (var sIdx = 0; sIdx < seedCount; sIdx += 1) {
    var nx = 0.04 + 0.92 * rand();
    var ny = 0.04 + 0.92 * rand();
    var nz = 0.04 + (sceneKind === 'wind' ? 0.22 : 0.5) * rand();
    var lineStart = points.length / 3;
    for (var s = 0; s < steps; s += 1) {
      var vec = analysisVectorAt(nx, ny, nz, tn);
      if (vec.solid) break;
      var speed = Math.sqrt(vec.ux * vec.ux + vec.uy * vec.uy + vec.uz * vec.uz);
      if (speed < 0.05) break;
      var nvx = vec.ux / volSize[0];
      var nvy = vec.uy / volSize[1];
      var nvz = vec.uz / volSize[2];
      var nl = Math.sqrt(nvx * nvx + nvy * nvy + nvz * nvz) || 1;
      var mx = nx + (nvx / nl) * step * 0.5;
      var my = ny + (nvy / nl) * step * 0.5;
      var mz = nz + (nvz / nl) * step * 0.5;
      var vec2 = analysisVectorAt(mx, my, mz, tn);
      var sp2 = Math.sqrt(vec2.ux * vec2.ux + vec2.uy * vec2.uy + vec2.uz * vec2.uz) || 1;
      nx += ((vec2.ux / volSize[0]) / (Math.sqrt((vec2.ux / volSize[0]) * (vec2.ux / volSize[0]) + (vec2.uy / volSize[1]) * (vec2.uy / volSize[1]) + (vec2.uz / volSize[2]) * (vec2.uz / volSize[2])) || 1)) * step;
      ny += ((vec2.uy / volSize[1]) / (Math.sqrt((vec2.ux / volSize[0]) * (vec2.ux / volSize[0]) + (vec2.uy / volSize[1]) * (vec2.uy / volSize[1]) + (vec2.uz / volSize[2]) * (vec2.uz / volSize[2])) || 1)) * step;
      nz += ((vec2.uz / volSize[2]) / (Math.sqrt((vec2.ux / volSize[0]) * (vec2.ux / volSize[0]) + (vec2.uy / volSize[1]) * (vec2.uy / volSize[1]) + (vec2.uz / volSize[2]) * (vec2.uz / volSize[2])) || 1)) * step;
      if (nx < 0 || nx > 1 || ny < 0 || ny > 1 || nz < 0 || nz > 1) break;
      points.push(volMin[0] + nx * volSize[0], volMin[1] + ny * volSize[1], volMin[2] + nz * volSize[2]);
      speeds.push(sp2);
      if (sp2 < 0.05) break;
    }
    var lineEnd = points.length / 3;
    if (lineEnd - lineStart >= 2) offsets.push(lineEnd);
    else points.length = lineStart * 3;
  }
  var posArr = new Float32Array(points);
  var offArr = new Uint32Array(offsets);
  var speedArr = new Float32Array(speeds);
  var result = { positions: posArr, offsets: offArr, speeds: speedArr, local: true };
  return { result: result, transfer: transferList([posArr, offArr, speedArr]) };
}

function isoEdge(a, b, va, vb, iso, out) {
  var t = (iso - va) / ((vb - va) || 1e-9);
  if (t < 0) t = 0; else if (t > 1) t = 1;
  out.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

function isoCrossing(p, v, iso, out) {
  var ins = [];
  var outs = [];
  for (var i = 0; i < 4; i += 1) { if (v[i] > iso) ins.push(i); else outs.push(i); }
  if (ins.length === 0 || ins.length === 4) return false;
  if (ins.length === 1) {
    var a = ins[0];
    isoEdge(p[a], p[outs[0]], v[a], v[outs[0]], iso, out);
    isoEdge(p[a], p[outs[1]], v[a], v[outs[1]], iso, out);
    isoEdge(p[a], p[outs[2]], v[a], v[outs[2]], iso, out);
    return true;
  }
  if (ins.length === 3) {
    var d = outs[0];
    isoEdge(p[d], p[ins[0]], v[d], v[ins[0]], iso, out);
    isoEdge(p[d], p[ins[1]], v[d], v[ins[1]], iso, out);
    isoEdge(p[d], p[ins[2]], v[d], v[ins[2]], iso, out);
    return true;
  }
  var i0 = ins[0], i1 = ins[1], o0 = outs[0], o1 = outs[1];
  isoEdge(p[i0], p[o0], v[i0], v[o0], iso, out);
  isoEdge(p[o0], p[i1], v[o0], v[i1], iso, out);
  isoEdge(p[i1], p[o1], v[i1], v[o1], iso, out);
  isoEdge(p[o1], p[i0], v[o1], v[i0], iso, out);
  return true;
}

function analyzeIsoSurface(message, tn) {
  var channel = message.channel;
  var iso = message.iso != null ? message.iso : 35;
  var volSize = message.volSize;
  var res = message.res || 36;
  var maxDim = Math.max(volSize[0], volSize[1], volSize[2]);
  var cell = maxDim / res;
  var nx = Math.max(3, Math.round(volSize[0] / cell));
  var ny = Math.max(3, Math.round(volSize[1] / cell));
  var nz = Math.max(3, Math.round(volSize[2] / cell));
  var nodeCount = (nx + 1) * (ny + 1) * (nz + 1);
  var grid = new Float32Array(nodeCount);
  for (var k = 0; k <= nz; k += 1) {
    var z = k / nz;
    for (var j = 0; j <= ny; j += 1) {
      var y = j / ny;
      for (var i = 0; i <= nx; i += 1) {
        var s = sampleField(i / nx, y, z, tn, channel);
        grid[((k * (ny + 1)) + j) * (nx + 1) + i] = s.valid ? s.value : -99999;
      }
    }
  }
  function nodeIndex(i, j, k) { return ((k * (ny + 1)) + j) * (nx + 1) + i; }
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
  var poly = [];
  for (var ck = 0; ck < nz; ck += 1) {
    for (var cj = 0; cj < ny; cj += 1) {
      for (var ci = 0; ci < nx; ci += 1) {
        var cp = [];
        var cv = [];
        for (var cIdx = 0; cIdx < 8; cIdx += 1) {
          var o = cor[cIdx];
          cp.push([(ci + o[0]) / nx, (cj + o[1]) / ny, (ck + o[2]) / nz]);
          cv.push(grid[nodeIndex(ci + o[0], cj + o[1], ck + o[2])]);
        }
        for (var t = 0; t < 6; t += 1) {
          var tet = tets[t];
          poly.length = 0;
          if (!isoCrossing([cp[tet[0]], cp[tet[1]], cp[tet[2]], cp[tet[3]]],
            [cv[tet[0]], cv[tet[1]], cv[tet[2]], cv[tet[3]]], iso, poly)) continue;
          var pn = poly.length / 3;
          for (var tri = 1; tri < pn - 1; tri += 1) {
            var ax = poly[0], ay = poly[1], az = poly[2];
            var bx = poly[(tri) * 3], by = poly[(tri) * 3 + 1], bz = poly[(tri) * 3 + 2];
            var cxx = poly[(tri + 1) * 3], cyy = poly[(tri + 1) * 3 + 1], czz = poly[(tri + 1) * 3 + 2];
            var ux = bx - ax, uy = by - ay, uz = bz - az;
            var vx = cxx - ax, vy = cyy - ay, vz = czz - az;
            var nxx = uy * vz - uz * vy;
            var nyy = uz * vx - ux * vz;
            var nzz = ux * vy - uy * vx;
            var nl = Math.sqrt(nxx * nxx + nyy * nyy + nzz * nzz) || 1;
            nxx /= nl; nyy /= nl; nzz /= nl;
            positions.push(ax, ay, az, bx, by, bz, cxx, cyy, czz);
            normals.push(nxx, nyy, nzz, nxx, nyy, nzz, nxx, nyy, nzz);
          }
        }
      }
    }
  }
  var posArr = new Float32Array(positions);
  var normArr = new Float32Array(normals);
  var result = { positions: posArr, normals: normArr, count: positions.length / 9, res: res };
  return { result: result, transfer: transferList([posArr, normArr]) };
}

function handleAnalyze(message) {
  var tn = message.timeSteps > 1 ? message.timeStep / (message.timeSteps - 1) : 0;
  var out;
  if (message.mode === 'stats') out = analyzeStats(message, tn);
  else if (message.mode === 'radar') out = analyzeRadar(message, tn);
  else if (message.mode === 'pm25') out = analyzePm25(message, tn);
  else if (message.mode === 'profile') out = analyzeProfile(message, tn);
  else if (message.mode === 'section') out = analyzeSection(message, tn);
  else if (message.mode === 'streamlines') out = analyzeStreamlines(message, tn);
  else if (message.mode === 'isosurface') out = analyzeIsoSurface(message, tn);
  else out = { result: {}, transfer: [] };
  self.postMessage(
    { type: 'analysisDone', epoch: message.epoch, requestId: message.requestId, mode: message.mode, result: out.result },
    out.transfer
  );
}
`
