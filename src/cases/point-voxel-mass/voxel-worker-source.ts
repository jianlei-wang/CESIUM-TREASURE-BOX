/**
 * 海量体元素渲染的 Web Worker 源码（以字符串形式内联，运行时通过 Blob URL 创建 Worker）。
 *
 * 该 Worker 承担全部 CPU 密集的体数据生产过程，避免阻塞主线程的 Vue UI 与 Cesium 渲染：
 *   1. 生成离散采样点 (x, y, z, value)，并构建纯 TypedArray 的 CSR 扁平空间哈希；
 *   2. 按 Cesium VoxelProvider 的瓦片请求 (tileLevel, tileX, tileY, tileZ) ，
 *      在规则网格上做环形 K 近邻 + IDW 插值，得到可承载多级 LOD 的体数据砖块；
 *   3. 可选地做严格可分离（X→Y→Z）的三维高斯平滑；
 *   4. 在任意剖切平面上采样，供主线程绘制切面预览。
 *
 * 通过 postMessage 的 Transferable 直接转移 Float32Array / Uint8Array 缓冲区，无拷贝、少 GC。
 */
export const VOXEL_WORKER_SOURCE = `
'use strict';

// 单次查询保留的最大近邻数
const KNN_MAX = 64;
// 环形搜索的最大环数（与空间哈希分辨率一致时足以覆盖整个立方体）
const MAX_RING = 18;
// 回传主线程用于叠加显示的点云上限（超出则等间隔抽稀）
const CLOUD_MAX = 20000;
// 空间哈希沿每个轴的桶数量（固定，与插值参数解耦，参数变化无需重建）
const BUCKET_DIM = 16;

/** 当前点集与空间哈希（一次 build 后常驻） */
let store = null;
/** 复用的 KNN 结果缓冲，避免每次查询分配数组 */
let knnBestD2 = null;
let knnBestIdx = null;

self.onmessage = function (event) {
  const message = event.data;
  if (!message) {
    return;
  }
  if (message.type === 'build') {
    handleBuild(message);
  } else if (message.type === 'extract') {
    handleExtract(message);
  } else if (message.type === 'slice') {
    handleSlice(message);
  } else if (message.type === 'dispose') {
    store = null;
  }
};

/** 确定性伪随机数发生器，保证相同种子得到相同点集 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 归一化空间中的若干个三维高斯异常体 + 背景起伏，构成可重建的标量场 */
function makeAnomalies(rand) {
  const list = [];
  const count = 4;
  for (let i = 0; i < count; i += 1) {
    list.push({
      x: 0.18 + 0.64 * rand(),
      y: 0.18 + 0.64 * rand(),
      z: 0.18 + 0.64 * rand(),
      amp: 0.5 + 0.45 * rand(),
      sig: 0.1 + 0.13 * rand()
    });
  }
  return list;
}

function clampInt(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/** 解析标量场：多高斯叠加 + 低频起伏，截断到 [0,1] */
function fieldValue(nx, ny, nz, anomalies) {
  let v = 0;
  for (let i = 0; i < anomalies.length; i += 1) {
    const a = anomalies[i];
    const dx = nx - a.x;
    const dy = ny - a.y;
    const dz = nz - a.z;
    v += a.amp * Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * a.sig * a.sig));
  }
  v += 0.08 * Math.sin(nx * Math.PI * 2) * Math.cos(ny * Math.PI * 2);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 生成离散点集并构建 CSR 扁平空间哈希 */
function handleBuild(message) {
  const started = performance.now();
  const params = message.params;
  const count = params.pointCount;
  const rand = mulberry32(params.seed);
  const anomalies = makeAnomalies(rand);

  const pos = new Float32Array(count * 3);
  const val = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const x = rand();
    const y = rand();
    const z = rand();
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    const noisy = fieldValue(x, y, z, anomalies) + (rand() - 0.5) * 0.08;
    val[i] = noisy < 0 ? 0 : noisy > 1 ? 1 : noisy;
  }

  let dataMin = Number.POSITIVE_INFINITY;
  let dataMax = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i += 1) {
    const v = val[i];
    if (v < dataMin) dataMin = v;
    if (v > dataMax) dataMax = v;
  }
  if (!isFinite(dataMin) || !isFinite(dataMax)) {
    dataMin = 0;
    dataMax = 1;
  }

  // ---- CSR 空间哈希：bucketOffsets(starts) + pointIndices，纯 TypedArray、连续内存 ----
  const nb = BUCKET_DIM;
  const bucketCount = nb * nb * nb;
  const starts = new Int32Array(bucketCount + 1);
  for (let i = 0; i < count; i += 1) {
    const bx = clampInt(Math.floor(pos[i * 3] * nb), 0, nb - 1);
    const by = clampInt(Math.floor(pos[i * 3 + 1] * nb), 0, nb - 1);
    const bz = clampInt(Math.floor(pos[i * 3 + 2] * nb), 0, nb - 1);
    starts[(bz * nb + by) * nb + bx + 1] += 1;
  }
  for (let b = 0; b < bucketCount; b += 1) {
    starts[b + 1] += starts[b];
  }
  const cursor = new Int32Array(bucketCount);
  for (let b = 0; b < bucketCount; b += 1) {
    cursor[b] = starts[b];
  }
  const indices = new Int32Array(count);
  for (let i = 0; i < count; i += 1) {
    const bx = clampInt(Math.floor(pos[i * 3] * nb), 0, nb - 1);
    const by = clampInt(Math.floor(pos[i * 3 + 1] * nb), 0, nb - 1);
    const bz = clampInt(Math.floor(pos[i * 3 + 2] * nb), 0, nb - 1);
    const b = (bz * nb + by) * nb + bx;
    indices[cursor[b]] = i;
    cursor[b] += 1;
  }

  store = {
    count: count,
    pos: pos,
    val: val,
    nb: nb,
    cell: 1 / nb,
    starts: starts,
    indices: indices,
    dataMin: dataMin,
    dataMax: dataMax
  };
  knnBestD2 = new Float64Array(KNN_MAX);
  knnBestIdx = new Int32Array(KNN_MAX);

  // ---- 抽稀点云回传主线程用于叠加显示 ----
  const stride = Math.max(1, Math.ceil(count / CLOUD_MAX));
  const cloudPos = new Float32Array(count * 3);
  const cloudVal = new Float32Array(count);
  let w = 0;
  for (let i = 0; i < count; i += stride) {
    cloudPos[w * 3] = pos[i * 3];
    cloudPos[w * 3 + 1] = pos[i * 3 + 1];
    cloudPos[w * 3 + 2] = pos[i * 3 + 2];
    cloudVal[w] = val[i];
    w += 1;
  }
  const outPos = cloudPos.slice(0, w * 3);
  const outVal = cloudVal.slice(0, w);

  self.postMessage(
    {
      type: 'buildDone',
      epoch: message.epoch,
      stats: {
        points: count,
        buildTime: performance.now() - started,
        dataMin: dataMin,
        dataMax: dataMax,
        bucketDim: nb
      },
      cloud: { positions: outPos, values: outVal, cloudCount: w, stride: stride }
    },
    [outPos.buffer, outVal.buffer]
  );
}

/**
 * 环形扩展的 K 近邻查询：从中心桶向外逐环搜索，直到已获得 K 个候选，
 * 且下一环的最小可能距离都无法超越当前第 K 近距离时停止。
 * 结果写入 knnBestD2 / knnBestIdx（升序）。
 */
function queryKnn(px, py, pz, k, radius) {
  const nb = store.nb;
  const cell = store.cell;
  const starts = store.starts;
  const indices = store.indices;
  const pos = store.pos;
  const radius2 = radius * radius;
  let count = 0;
  // 当前 top-k 缓冲中的最差（距离最大）槽位，-1 表示尚未填满
  let worst = -1;
  const cx = clampInt(Math.floor(px * nb), 0, nb - 1);
  const cy = clampInt(Math.floor(py * nb), 0, nb - 1);
  const cz = clampInt(Math.floor(pz * nb), 0, nb - 1);

  for (let r = 0; r <= MAX_RING; r += 1) {
    // 已填满 top-k：若下一环的最短可能距离都超过第 k 近距离，则无需继续
    // 未填满：只要确认环外不可能再有半径内的点即可停止
    if (r > 0 && worst >= 0) {
      const ringMin = (r - 1) * cell;
      if (ringMin * ringMin >= knnBestD2[worst]) break;
    }
    for (let dz = -r; dz <= r; dz += 1) {
      const bz = cz + dz;
      if (bz < 0 || bz >= nb) continue;
      const az = dz < 0 ? -dz : dz;
      for (let dy = -r; dy <= r; dy += 1) {
        const by = cy + dy;
        if (by < 0 || by >= nb) continue;
        const ay = dy < 0 ? -dy : dy;
        for (let dx = -r; dx <= r; dx += 1) {
          const ax = dx < 0 ? -dx : dx;
          const shell = ax > ay ? (ax > az ? ax : az) : ay > az ? ay : az;
          if (shell !== r) continue;
          const bx = cx + dx;
          if (bx < 0 || bx >= nb) continue;
          const b = (bz * nb + by) * nb + bx;
          const from = starts[b];
          const to = starts[b + 1];
          for (let jj = from; jj < to; jj += 1) {
            const j = indices[jj];
            const ddx = px - pos[j * 3];
            const ddy = py - pos[j * 3 + 1];
            const ddz = pz - pos[j * 3 + 2];
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 > radius2) continue;
            if (count < k) {
              knnBestD2[count] = d2;
              knnBestIdx[count] = j;
              count += 1;
              if (count === k) {
                worst = 0;
                for (let t = 1; t < k; t += 1) {
                  if (knnBestD2[t] > knnBestD2[worst]) worst = t;
                }
              }
            } else if (d2 < knnBestD2[worst]) {
              // 无需插入排序：直接顶替当前最差槽位，再 O(k) 重算最差槽位
              knnBestD2[worst] = d2;
              knnBestIdx[worst] = j;
              worst = 0;
              for (let t = 1; t < k; t += 1) {
                if (knnBestD2[t] > knnBestD2[worst]) worst = t;
              }
            }
          }
        }
      }
    }
  }
  // 结果无需有序，仅用 count 标记有效长度；IDW 求和与顺序无关
  store._knnCount = count;
}

/**
 * 仅当体素在搜索半径内没有任何采样点时调用：由近及远找到第一个采样点，
 * 用于空体元素的最近邻回退。由于属于冷路径，单独实现以避免拖慢主查询。
 */
function queryNearest(px, py, pz) {
  const nb = store.nb;
  const cell = store.cell;
  const starts = store.starts;
  const indices = store.indices;
  const pos = store.pos;
  const cx = clampInt(Math.floor(px * nb), 0, nb - 1);
  const cy = clampInt(Math.floor(py * nb), 0, nb - 1);
  const cz = clampInt(Math.floor(pz * nb), 0, nb - 1);
  let best = -1;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (let r = 0; r <= MAX_RING; r += 1) {
    if (best >= 0) {
      const ringMin = (r - 1) * cell;
      if (ringMin * ringMin >= bestD2) break;
    }
    for (let dz = -r; dz <= r; dz += 1) {
      const bz = cz + dz;
      if (bz < 0 || bz >= nb) continue;
      const az = dz < 0 ? -dz : dz;
      for (let dy = -r; dy <= r; dy += 1) {
        const by = cy + dy;
        if (by < 0 || by >= nb) continue;
        const ay = dy < 0 ? -dy : dy;
        for (let dx = -r; dx <= r; dx += 1) {
          const ax = dx < 0 ? -dx : dx;
          const shell = ax > ay ? (ax > az ? ax : az) : ay > az ? ay : az;
          if (shell !== r) continue;
          const bx = cx + dx;
          if (bx < 0 || bx >= nb) continue;
          const b = (bz * nb + by) * nb + bx;
          const from = starts[b];
          const to = starts[b + 1];
          for (let jj = from; jj < to; jj += 1) {
            const j = indices[jj];
            const ddx = px - pos[j * 3];
            const ddy = py - pos[j * 3 + 1];
            const ddz = pz - pos[j * 3 + 2];
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 < bestD2) {
              bestD2 = d2;
              best = j;
            }
          }
        }
      }
    }
  }
  return best;
}

/**
 * 在归一化坐标处用 K 近邻 + 反距离加权求场值。
 * 仅统计搜索半径内的近邻；无有效近邻时按需回退到最近点，仍失败则返回 NaN（无效）。
 */
function sampleField(px, py, pz, params) {
  const k = params.k;
  const radius = params.radius;
  queryKnn(px, py, pz, k, radius);
  const radius2 = radius * radius;
  const half = params.power * 0.5;
  const val = store.val;
  const count = store._knnCount;
  let wsum = 0;
  let vsum = 0;
  for (let i = 0; i < count; i += 1) {
    const d2 = knnBestD2[i];
    if (d2 > radius2) continue;
    const w = 1 / Math.pow(d2 > 1e-8 ? d2 : 1e-8, half);
    wsum += w;
    vsum += w * val[knnBestIdx[i]];
  }
  if (wsum > 0) {
    return vsum / wsum;
  }
  if (params.fillEmpty) {
    const nearest = queryNearest(px, py, pz);
    if (nearest >= 0) return val[nearest];
  }
  return NaN;
}

/** 沿单一轴做 3 抽头 [1,2,1] 高斯卷积，仅统计有效体素并做权重归一化 */
function smoothAxis(src, srcMask, dst, dstMask, dim, axis) {
  for (let iz = 0; iz < dim; iz += 1) {
    for (let iy = 0; iy < dim; iy += 1) {
      for (let ix = 0; ix < dim; ix += 1) {
        const idx = (iz * dim + iy) * dim + ix;
        if (!srcMask[idx]) {
          dst[idx] = src[idx];
          dstMask[idx] = 0;
          continue;
        }
        let sum = 0;
        let wsum = 0;
        for (let d = -1; d <= 1; d += 1) {
          let jx = ix;
          let jy = iy;
          let jz = iz;
          if (axis === 0) jx += d;
          else if (axis === 1) jy += d;
          else jz += d;
          if (jx < 0 || jy < 0 || jz < 0 || jx >= dim || jy >= dim || jz >= dim) continue;
          const j = (jz * dim + jy) * dim + jx;
          if (!srcMask[j]) continue;
          const w = d === 0 ? 2 : 1;
          sum += w * src[j];
          wsum += w;
        }
        dst[idx] = wsum > 0 ? sum / wsum : src[idx];
        dstMask[idx] = wsum > 0 ? 1 : 0;
      }
    }
  }
}

/** 严格可分离的三维高斯平滑：每轮按 X→Y→Z 三个一维卷积完成，复杂度由 27N 降到约 9N */
function smoothField(values, mask, dim, passes) {
  const bx = new Float32Array(values.length);
  const bxm = new Uint8Array(mask.length);
  const by = new Float32Array(values.length);
  const bym = new Uint8Array(mask.length);
  for (let pass = 0; pass < passes; pass += 1) {
    smoothAxis(values, mask, bx, bxm, dim, 0);
    smoothAxis(bx, bxm, by, bym, dim, 1);
    smoothAxis(by, bym, values, mask, dim, 2);
  }
}

/**
 * 抽取一个体数据瓦片：对瓦片覆盖范围内的规则网格（含 1 层 padding）逐点做 IDW 插值。
 * 由于父/子层级、相邻瓦片都从同一个连续场采样，padding 恰好等于邻居边缘体素，拼接无缝。
 */
function handleExtract(message) {
  if (!store) {
    const empty = new Float32Array(0);
    self.postMessage(
      { type: 'extractDone', epoch: message.epoch, requestId: message.requestId, metadata: empty },
      [empty.buffer]
    );
    return;
  }
  const params = message.params;
  const D = message.tileSize;
  const dim = D + 2;
  const total = dim * dim * dim;
  const scale = Math.pow(2, message.tileLevel);
  const inv = 1 / scale;
  const tx = message.tileX;
  const ty = message.tileY;
  const tz = message.tileZ;

  const values = new Float32Array(total);
  const mask = new Uint8Array(total);
  for (let iz = 0; iz < dim; iz += 1) {
    const wz = (tz + (iz - 1 + 0.5) / D) * inv;
    for (let iy = 0; iy < dim; iy += 1) {
      const wy = (ty + (iy - 1 + 0.5) / D) * inv;
      for (let ix = 0; ix < dim; ix += 1) {
        const wx = (tx + (ix - 1 + 0.5) / D) * inv;
        const s = sampleField(wx, wy, wz, params);
        const idx = (iz * dim + iy) * dim + ix;
        if (s === s) {
          values[idx] = s;
          mask[idx] = 1;
        }
      }
    }
  }

  if (params.smoothPasses > 0) {
    smoothField(values, mask, dim, params.smoothPasses);
  }

  // 元数据按体素交错排列：[value, valid, value, valid, ...]，对应 VEC2 / FLOAT32
  const metadata = new Float32Array(total * 2);
  for (let i = 0; i < total; i += 1) {
    metadata[i * 2] = values[i];
    metadata[i * 2 + 1] = mask[i];
  }

  self.postMessage(
    {
      type: 'extractDone',
      epoch: message.epoch,
      requestId: message.requestId,
      tileLevel: message.tileLevel,
      tileX: tx,
      tileY: ty,
      tileZ: tz,
      metadata: metadata
    },
    [metadata.buffer]
  );
}

/** 在剖切平面上逐像素采样场值，回传原始值与有效掩膜（颜色由主线程的传递函数映射） */
function handleSlice(message) {
  const size = message.size;
  const t = new Float32Array(size * size);
  const valid = new Uint8Array(size * size);
  const params = message.params;
  if (store) {
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
        // 先在剖切面所在的局部 ENU 米坐标中定位，再换算到归一化体空间
        const wx = p0[0] + e1[0] * uu + e2[0] * vv;
        const wy = p0[1] + e1[1] * uu + e2[1] * vv;
        const wz = p0[2] + e1[2] * uu + e2[2] * vv;
        const ux = (wx - volMin[0]) / volSize[0];
        const uy = (wy - volMin[1]) / volSize[1];
        const uz = (wz - volMin[2]) / volSize[2];
        const idx = py * size + px;
        // 切面正方形远大于体积本身，落在体积外的像素不显示（否则会外插出拉伸的伪值）
        if (ux < 0 || ux > 1 || uy < 0 || uy > 1 || uz < 0 || uz > 1) {
          continue;
        }
        const s = sampleField(ux, uy, uz, params);
        if (s === s) {
          t[idx] = s;
          valid[idx] = 1;
        }
      }
    }
  }
  self.postMessage(
    {
      type: 'sliceDone',
      epoch: message.epoch,
      requestId: message.requestId,
      size: size,
      values: t,
      valid: valid
    },
    [t.buffer, valid.buffer]
  );
}
`
