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

self.onmessage = function (event) {
  const message = event.data;
  if (!message) return;
  switch (message.type) {
    case 'init': handleInit(message); break;
    case 'tile': handleTile(message); break;
    case 'slice': handleSlice(message); break;
    case 'particleInit': handleParticleInit(message); break;
    case 'particleTick': handleParticleTick(message); break;
    case 'dispose': particleState = null; ctx = null; break;
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
 * 场景上下文构建
 * ------------------------------------------------------------------ */

function prepare(kind, p) {
  const rand = mulberry32(p.seed || 1);
  if (kind === 'radar') {
    const cells = [];
    const count = Math.max(1, Math.round(p.cells || 6));
    for (let i = 0; i < count; i += 1) {
      cells.push({
        x: 0.16 + 0.68 * rand(),
        y: 0.16 + 0.68 * rand(),
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
    const sources = [];
    const count = Math.max(1, Math.round(p.sources || 4));
    for (let i = 0; i < count; i += 1) {
      sources.push({
        x: 0.2 + 0.6 * rand(),
        y: 0.2 + 0.6 * rand(),
        emit: 0.7 + 0.9 * rand(),
        phase: rand() * 6.283
      });
    }
    const stations = [];
    const stationCount = 36;
    for (let i = 0; i < stationCount; i += 1) {
      stations.push({ x: 0.06 + 0.88 * rand(), y: 0.06 + 0.88 * rand() });
    }
    return { kind, sources, stations };
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
    return {
      kind,
      contacts: [0.16, 0.31, 0.47, 0.63, 0.8],
      intrusion: { x: 0.66, y: 0.46, z: 0.32, r: p.intrusion || 0.12 }
    };
  }
  if (kind === 'cfd') {
    return {
      kind,
      box: { x0: 0.34, x1: 0.66, y0: 0.3, y1: 0.7, z1: 0.55 },
      source: { x: 0.3, y: 0.5 }
    };
  }
  return { kind };
}

function handleInit(message) {
  const started = performance.now();
  sceneKind = message.scene;
  params = message.params || {};
  ctx = prepare(sceneKind, params);
  const extra = { buildTime: performance.now() - started };
  if (sceneKind === 'pm25') {
    const stationPos = new Float32Array(ctx.stations.length * 2);
    const stationVal = new Float32Array(ctx.stations.length);
    let max = 0;
    for (let i = 0; i < ctx.stations.length; i += 1) {
      const s = ctx.stations[i];
      stationPos[i * 2] = s.x;
      stationPos[i * 2 + 1] = s.y;
      const v = sampleField(s.x, s.y, 0.01, 0, 'pm25');
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
  if (dbz < 4) dbz = 0;
  return clamp(dbz, 0, 70);
}

function pm25Value(nx, ny, nz, tn, channel) {
  const dir = ((params.windDir || 225) * Math.PI) / 180 + 0.25 * Math.sin(tn * 6.283);
  const wx = Math.cos(dir);
  const wy = Math.sin(dir);
  const blh = params.blh || 0.35;
  const background = params.background != null ? params.background : 20;
  let conc = background * (1 - 0.45 * nz);
  for (let i = 0; i < ctx.sources.length; i += 1) {
    const s = ctx.sources[i];
    const dx = nx - s.x;
    const dy = ny - s.y;
    const down = dx * wx + dy * wy;
    if (down < 0.01) continue;
    const cross = -dx * wy + dy * wx;
    const sigY = 0.035 + 0.26 * down;
    const sigZ = 0.022 + 0.095 * down;
    const pulse = 0.8 + 0.2 * Math.sin(s.phase + tn * 6.283);
    const vert = Math.exp(-Math.pow(nz - 0.05, 2) / (2 * sigZ * sigZ));
    const mix = nz < blh ? 1 : Math.exp(-Math.pow((nz - blh) / 0.05, 2)) * 0.85;
    conc += ((s.emit * pulse * 26) / (sigY + 0.03)) * Math.exp(-(cross * cross) / (2 * sigY * sigY)) * vert * mix;
  }
  if (channel === 'pm10') return clamp(conc * 1.7 + 14, 0, 500);
  if (channel === 'no2') return clamp(conc * 0.42 + 8, 0, 200);
  return clamp(conc, 0, 300);
}

function windVector(nx, ny, nz) {
  const sp = params.baseSpeed != null ? params.baseSpeed : 9;
  const baseDir = ((params.baseDir != null ? params.baseDir : 235) * Math.PI) / 180;
  const shear = 0.4 + 0.6 * Math.pow(nz, 0.6);
  const meander = 0.14 * Math.sin(nx * 3.1 + nz * 2.0) + 0.1 * Math.cos(ny * 2.7);
  const dir = baseDir + meander;
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
  return clamp(Math.sqrt(v.ux * v.ux + v.uy * v.uy + v.uz * v.uz), 0, 20);
}

function geoLayer(nx, ny, nz) {
  const und = (params.undulation != null ? params.undulation : 0.06) * Math.sin(nx * 5.5) * Math.cos(ny * 4.5);
  const h = nz + und;
  const c = ctx.contacts;
  let code;
  if (h < c[0]) code = 1;
  else if (h < c[1]) code = 2;
  else if (h < c[2]) code = 3;
  else if (h < c[3]) code = 4;
  else if (h < c[4]) code = 5;
  else code = 6;
  const it = ctx.intrusion;
  const dx = nx - it.x;
  const dy = ny - it.y;
  const dz = (nz - (1 - it.z)) * 0.9;
  if (dx * dx + dy * dy + dz * dz < it.r * it.r) code = 5;
  return code;
}

const GEO_PROP = {
  1: { porosity: 0.3, saturation: 0.35, perm: 1.0 },
  2: { porosity: 0.22, saturation: 0.5, perm: 2.2 },
  3: { porosity: 0.12, saturation: 0.68, perm: -0.5 },
  4: { porosity: 0.18, saturation: 0.55, perm: 1.4 },
  5: { porosity: 0.07, saturation: 0.3, perm: -1.0 },
  6: { porosity: 0.03, saturation: 0.25, perm: -1.6 }
};

function geoProperty(nx, ny, nz, code, channel) {
  const base = GEO_PROP[code] || GEO_PROP[3];
  const noise = 0.5 + 0.5 * Math.sin(nx * 13.3 + ny * 11.1 + nz * 17.7);
  if (channel === 'porosity') {
    const v = base.porosity * (0.75 + 0.5 * noise) + 0.02 * nz;
    return clamp(v * 100, 0, 35);
  }
  if (channel === 'saturation') {
    const v = base.saturation * (0.85 + 0.3 * noise) + 0.1 * (1 - nz);
    return clamp(v * 100, 0, 100);
  }
  const shift = (noise - 0.5) * 0.6 - 0.5 * nz;
  return clamp(Math.pow(10, base.perm + shift), 0.1, 1000);
}

function cfdVector(nx, ny, nz, tn) {
  const inflow = params.inflow != null ? params.inflow : 6;
  const b = ctx.box;
  const phase = tn * 6.283;
  let ux = inflow;
  let uy = 0;
  let uz = 0;
  const inBox = nx > b.x0 && nx < b.x1 && ny > b.y0 && ny < b.y1 && nz < b.z1;
  if (inBox) return { ux: 0, uy: 0, uz: 0, solid: 1 };
  const nearFront = Math.exp(-Math.pow((nx - b.x0) / 0.09, 2)) * (ny > b.y0 - 0.08 && ny < b.y1 + 0.08 ? 1 : 0.3) * smoothstep(0, b.z1, nz) * (1 - smoothstep(b.z1, b.z1 + 0.15, nz));
  ux *= 1 - 0.55 * nearFront;
  const over = nx > b.x0 - 0.05 && nx < b.x1 + 0.12 && ny > b.y0 - 0.06 && ny < b.y1 + 0.06 && nz > b.z1 && nz < b.z1 + 0.35 ? 1.5 : 1;
  ux *= over;
  if (nx > b.x1) {
    const edge = Math.exp(-Math.pow((nz - b.z1 * 0.5) / 0.35, 2));
    const wd = Math.exp(-(nx - b.x1) / 0.22) * edge;
    ux *= 1 - 0.78 * wd;
    uy += Math.sin((nx - b.x1) * 14 + phase) * inflow * 0.18 * wd;
    uz += 0.6 * inflow * 0.12 * Math.sin((nx - b.x1) * 10 + phase + 1.0) * wd;
  }
  const sideBand = Math.exp(-Math.pow((ny - 0.5) / 0.5, 2));
  if (nx > b.x0 - 0.1 && nx < b.x1 + 0.15 && nz < b.z1 + 0.1) {
    const sign = ny >= 0.5 ? 1 : -1;
    uy += sign * (1 - sideBand) * inflow * 0.35 * Math.exp(-Math.pow((nx - 0.5) / 0.25, 2));
  }
  ux += 0.14 * inflow * Math.sin(nx * 11 + nz * 9 + phase);
  uy += 0.14 * inflow * Math.cos(ny * 12 + nz * 8 + phase * 0.8);
  uz += 0.1 * inflow * Math.sin((nx + ny) * 9 + phase * 1.3) * (0.3 + nz);
  return { ux, uy, uz, solid: 0 };
}

function cfdValue(nx, ny, nz, tn, channel) {
  const v = cfdVector(nx, ny, nz, tn);
  if (v.solid) return { value: 0, valid: 0 };
  if (channel === 'pressure') {
    const b = ctx.box;
    const front = 90 * Math.exp(-Math.pow((nx - (b.x0 - 0.03)) / 0.06, 2)) * (ny > b.y0 - 0.1 && ny < b.y1 + 0.1 ? 1 : 0.25);
    const wake = -70 * Math.exp(-(nx - b.x1) / 0.3) * (nx > b.x1 ? 1 : 0) * Math.exp(-Math.pow((nz - b.z1 * 0.6) / 0.4, 2));
    return { value: clamp(front + wake, -120, 120), valid: 1 };
  }
  if (channel === 'temperature') {
    const b = ctx.box;
    const src = ctx.source;
    const dx = nx - src.x;
    const dy = ny - src.y;
    const stream = dx + (nz * 0.6);
    const core = Math.exp(-(dy * dy) / (2 * 0.06 * 0.06)) * Math.exp(-(Math.max(stream, 0) * Math.max(stream, 0)) / (2 * 0.16 * 0.16));
    const rise = Math.exp(-Math.pow((nz - 0.08 - 0.5 * Math.max(stream, 0)) / 0.12, 2));
    const t = 300 + (params.sourceTemp || 320 - 300) * core * rise * (0.8 + 0.2 * Math.sin(tn * 6.283));
    return { value: clamp(t, 280, 340), valid: 1 };
  }
  const speed = Math.sqrt(v.ux * v.ux + v.uy * v.uy + v.uz * v.uz);
  return { value: clamp(speed, 0, 15), valid: 1 };
}

/* ------------------------------------------------------------------ *
 * 统一采样
 * ------------------------------------------------------------------ */

function sampleScalar(kind, nx, ny, nz, tn, channel) {
  if (kind === 'radar') return { value: radarValue(nx, ny, nz, tn), valid: 1 };
  if (kind === 'pm25') return { value: pm25Value(nx, ny, nz, tn, channel), valid: 1 };
  if (kind === 'wind') return { value: windValue(nx, ny, nz, channel), valid: 1 };
  if (kind === 'cfd') return cfdValue(nx, ny, nz, tn, channel);
  return { value: 0, valid: 0 };
}

function sampleField(nx, ny, nz, tn, channel) {
  if (sceneKind === 'geology') {
    const code = geoLayer(nx, ny, nz);
    if (channel === 'litho') return { value: code, valid: 1, categorical: true };
    return { value: geoProperty(nx, ny, nz, code, channel), valid: 1 };
  }
  return sampleScalar(sceneKind, nx, ny, nz, tn, channel);
}

/* ------------------------------------------------------------------ *
 * 瓦片抽取
 * ------------------------------------------------------------------ */

function handleTile(message) {
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
        // 标量：.r=数值；分类：.r=分类码；.g 统一为有效掩膜
        metadata[idx] = s.value;
        metadata[idx + 1] = s.valid ? 1 : 0;
      }
    }
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

function handleParticleInit(message) {
  const count = Math.max(1, message.count);
  const rand = mulberry32((params.seed || 1) + 977);
  const positions = new Float32Array(count * 3);
  const ages = new Float32Array(count);
  const lives = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = rand();
    positions[i * 3 + 1] = rand();
    positions[i * 3 + 2] = 0.02 + 0.9 * rand();
    ages[i] = rand() * 2.5;
    lives[i] = 2 + 2.5 * rand();
  }
  particleState = { count, positions, ages, lives };
  self.postMessage({ type: 'particleDone', count });
}

function respawn(state, i, rand) {
  state.positions[i * 3] = rand() * 0.15;
  state.positions[i * 3 + 1] = rand();
  state.positions[i * 3 + 2] = 0.02 + 0.9 * rand();
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
