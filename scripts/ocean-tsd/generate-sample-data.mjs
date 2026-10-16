#!/usr/bin/env node
/**
 * Ocean-TSD 离线样本数据生成器（构建阶段工具，浏览器不依赖）
 * ------------------------------------------------------------------
 * 生成 `public/data/ocean-tsd/<preset>/` 下的轻量、可追溯二进制样本：
 *   manifest.json        数据来源、范围、深度、变量、时间类型与量化编码元数据
 *   coords.bin           经纬度 / 深度坐标（带 3 字段头）
 *   bathymetry.bin       海底地形（正向下，单位 m）
 *   mask.bin             海陆 / 缺测掩膜（uint8）
 *   frames/MM.bin        各月份 T/S/密度/u/v 量化数据块（uint16）
 *
 * 重要声明：本默认样本为“程序化生成的水文样本”，仅用于演示真实数据管线与
 * 可视化 / 分析流程，不代表任何真实观测、再分析或预报产品。真实数据接入方式
 * 见同目录 preprocess_ocean.py 与 README.md。
 *
 * 运行：node scripts/ocean-tsd/generate-sample-data.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_ROOT = join(ROOT, 'public', 'data', 'ocean-tsd')

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
/**
 * 二进制块内变量顺序固定：温度、盐度、东西向流速 u、南北向流速 v。
 * 密度不落盘，由浏览器端以数据块内 T/S 经 EOS-80 sigma_t 实时计算，保证与展示数值一致。
 */
const VAR_ORDER = ['temperature', 'salinity', 'u', 'v']

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0
  return function random() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

/** 二维值噪声：格点 + 双线性，用于地形与流场细节 */
function makeNoise2D(seed) {
  const size = 64
  const grid = new Float32Array(size * size)
  const rnd = mulberry32(seed)
  for (let i = 0; i < grid.length; i += 1) grid[i] = rnd() * 2 - 1
  return (x, y) => {
    const fx = ((x % size) + size) % size
    const fy = ((y % size) + size) % size
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const sx = tx * tx * (3 - 2 * tx)
    const sy = ty * ty * (3 - 2 * ty)
    const i00 = (y0 % size) * size + (x0 % size)
    const i10 = (y0 % size) * size + ((x0 + 1) % size)
    const i01 = ((y0 + 1) % size) * size + (x0 % size)
    const i11 = ((y0 + 1) % size) * size + ((x0 + 1) % size)
    const a = grid[i00] + (grid[i10] - grid[i00]) * sx
    const b = grid[i01] + (grid[i11] - grid[i01]) * sx
    return a + (b - a) * sy
  }
}

function fbm2(noise, x, y, octaves, lacunarity = 2, gain = 0.5) {
  let amp = 1
  let freq = 1
  let sum = 0
  let norm = 0
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * noise(x * freq, y * freq)
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return sum / norm
}

/** EOS-80（UNESCO 1983）标准大气压下 sigma_t，作为样本密度的可追溯计算方法。
 * 生成阶段仅用于校验范围；浏览器端由 OceanGridSampler 以同一公式计算密度。 */
function sigmaT(T, S) {
  // EOS-80（UNESCO 1983）标准大气压下密度系数（单位 kg/m^3）
  const a0 = 999.842594
  const a1 = 6.793952e-2
  const a2 = -9.09529e-3
  const a3 = 1.001685e-4
  const a4 = -1.120083e-6
  const a5 = 6.536332e-9
  const b0 = 8.24493e-1
  const b1 = -4.0899e-3
  const b2 = 7.6438e-5
  const b3 = -8.2467e-7
  const b4 = 5.3875e-9
  const c0 = -5.72466e-3
  const c1 = 1.0227e-4
  const c2 = -1.6546e-6
  const d0 = 4.8314e-4
  const t = T
  const rhoW = a0 + a1 * t + a2 * t * t + a3 * t ** 3 + a4 * t ** 4 + a5 * t ** 5
  const rho = rhoW + (b0 + b1 * t + b2 * t * t + b3 * t ** 3 + b4 * t ** 4) * S + (c0 + c1 * t + c2 * t * t) * S * Math.sqrt(S) + d0 * S * S
  return rho
}

/* ------------------------------------------------------------------ */
/* 区域预设                                                            */
/* ------------------------------------------------------------------ */

const PRESETS = [
  {
    id: 'east-china-sea',
    title: '东海陆架坡折—黑潮邻区（月气候态样本）',
    regionName: '东海陆架坡折带',
    extent: { west: 121.5, south: 25.0, east: 128.0, north: 31.0 },
    grid: { nx: 44, ny: 44, nz: 30 },
    targetNz: 30,
    /** 主视觉：包含浅海陆架、坡折与深水区（冲绳海槽一侧），0–1500 m */
    depthProfile: 'shelf-break',
    maxDepth: 1560,
    seed: 20261013,
    // 气候态参数
    sstSummer: 28.2,
    sstWinter: 16.5,
    deepTempC: 3.0,
    surfSalt: 33.2,
    coastSalt: 30.4,
    deepSalt: 34.7,
    jetSpeed: 1.05
  },
  {
    id: 'yellow-sea',
    title: '黄海中部陆架（月气候态样本）',
    regionName: '黄海中部陆架',
    extent: { west: 120.0, south: 33.0, east: 124.6, north: 37.0 },
    grid: { nx: 38, ny: 38, nz: 22 },
    targetNz: 18,
    depthProfile: 'shallow-shelf',
    maxDepth: 92,
    seed: 20261014,
    sstSummer: 26.5,
    sstWinter: 5.5,
    deepTempC: 6.0,
    surfSalt: 32.0,
    coastSalt: 29.6,
    deepSalt: 33.4,
    jetSpeed: 0.42
  }
]

function buildDepths(preset) {
  const { maxDepth, depthProfile, targetNz } = preset
  const depths = []
  const nearSurface = [0, 3, 6, 9, 12, 16, 20, 25, 30, 36]
  for (const d of nearSurface) if (d < maxDepth) depths.push(d)
  const ratio = depthProfile === 'shallow-shelf' ? 1.12 : 1.16
  let d = depths[depths.length - 1]
  while (d < maxDepth) {
    d = d * ratio
    depths.push(Math.round(d))
  }
  depths[depths.length - 1] = maxDepth
  // 按目标层数等距抽稀（保留海表与最大深度），控制样本体量
  if (targetNz && depths.length > targetNz) {
    const out = []
    for (let i = 0; i < targetNz; i += 1) {
      const idx = Math.round((i * (depths.length - 1)) / (targetNz - 1))
      out.push(depths[idx])
    }
    return Array.from(new Set(out))
  }
  return depths
}

/* ------------------------------------------------------------------ */
/* 地形与场生成                                                        */
/* ------------------------------------------------------------------ */

function buildBathymetry(preset) {
  const { nx, ny } = preset.grid
  const { west, south, east, north } = preset.extent
  const noise = makeNoise2D(preset.seed)
  const bathy = new Float32Array(nx * ny)
  for (let j = 0; j < ny; j += 1) {
    const lat = south + ((north - south) * j) / (ny - 1)
    for (let i = 0; i < nx; i += 1) {
      const lon = west + ((east - west) * i) / (nx - 1)
      // 归一化到区域坐标 [-1,1]
      const ux = (i / (nx - 1)) * 2 - 1
      const uy = (j / (ny - 1)) * 2 - 1
      let depth
      if (preset.depthProfile === 'shelf-break') {
        // 西北浅陆架 → 东南深水，坡折沿西北—东南对角线过渡
        const cross = ux * 0.72 + uy * 0.68
        const shelfBreak = 0.35
        const slope = 1 / (1 + Math.exp(-(cross - shelfBreak) * 6.5))
        depth = 45 + slope * (preset.maxDepth - 45)
        // 冲绳海槽一侧的额外下凹
        const trough = Math.exp(-((ux - 0.75) ** 2 + (uy - 0.72) ** 2) / 0.12)
        depth += trough * 260
        // 陆架上的古河道 / 浅滩起伏
        depth += fbm2(noise, i * 0.12, j * 0.12, 4) * 26
        depth -= fbm2(noise, i * 0.05 + 9, j * 0.05 + 3, 3) * 18
      } else {
        // 黄海浅陆架：中央略深、近岸浅
        const radial = Math.sqrt(ux * ux * 0.7 + uy * uy)
        depth = 34 + radial * (preset.maxDepth - 34) * 0.9
        depth += fbm2(noise, i * 0.15, j * 0.15, 3) * 12
      }
      // 北部近岸（长?/黄海近岸）更浅
      depth = clamp(depth, 8, preset.maxDepth + 120)
      bathy[j * nx + i] = depth
    }
  }
  return bathy
}

function buildMask(preset, bathy, depths) {
  const { nx, ny, nz } = preset.grid
  const mask = new Uint8Array(nx * ny * nz)
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const seabed = bathy[j * nx + i]
        const d = depths[k]
        // 数据块盖住地形以下少量层，以便海底边界平滑；但实际有效海水为 d <= seabed
        mask[i + nx * (j + ny * k)] = d <= seabed ? 1 : 0
      }
    }
  }
  return mask
}

/** 单月三维场：返回 { temperature, salinity, density, u, v } 数组 */
function buildMonthFields(preset, bathy, depths, month) {
  const { nx, ny, nz } = preset.grid
  const { west, south, east, north } = preset.extent
  const noise = makeNoise2D(preset.seed + month * 17)
  const n = nx * ny * nz
  const temperature = new Float32Array(n)
  const salinity = new Float32Array(n)
  const density = new Float32Array(n)
  const u = new Float32Array(n)
  const v = new Float32Array(n)

  // 季节相位：8 月最暖、2 月最冷
  const seasonal = Math.cos((2 * Math.PI * (month + 1 - 8)) / 12)
  const sstMid = (preset.sstSummer + preset.sstWinter) / 2
  const sstAmp = (preset.sstSummer - preset.sstWinter) / 2

  for (let k = 0; k < nz; k += 1) {
    const d = depths[k]
    for (let j = 0; j < ny; j += 1) {
      const lat = south + ((north - south) * j) / (ny - 1)
      for (let i = 0; i < nx; i += 1) {
        const idx = i + nx * (j + ny * k)
        const lon = west + ((east - west) * i) / (nx - 1)
        const ux = (i / (nx - 1)) * 2 - 1
        const uy = (j / (ny - 1)) * 2 - 1
        const seabed = bathy[j * nx + i]

        // 陆架距离（0=近岸浅水，1=深水）
        const oceanic = clamp(seabed / preset.maxDepth, 0, 1)

        // 表层温度：夏季近岸偏暖、冬季近岸偏冷（大陆性）
        const sst = sstMid + sstAmp * seasonal * (0.75 + 0.5 * (1 - oceanic)) + (lat - (south + north) / 2) * -0.18
        // 温跃层：冬季混合加深
        const mixDepth = 24 + 40 * (1 - seasonal) * 0.5 + oceanic * 22
        const thermScale = preset.depthProfile === 'shallow-shelf' ? mixDepth * 0.75 : mixDepth
        const deepT = preset.deepTempC + oceanic * 1.4
        const t = deepT + (sst - deepT) * Math.exp(-d / Math.max(8, thermScale))
        // 中尺度涡导致的温跃层扰动
        const eddy = Math.exp(-(((ux - 0.25) ** 2 + (uy + 0.35) ** 2) / 0.09)) * Math.sin(d / 55) * 1.8
        temperature[idx] = t + eddy + fbm2(noise, i * 0.2 + d * 0.02, j * 0.2, 3) * 0.35

        // 盐度：近岸（长江口）淡水输入，深层增盐
        const coastDist = clamp(1 - (ux * 0.5 + uy * 0.5 + 1) * 0.5, 0, 1)
        const sSurf = preset.deepSalt - (preset.deepSalt - preset.surfSalt) * oceanic - (preset.surfSalt - preset.coastSalt) * (1 - coastDist)
        const sScale = preset.depthProfile === 'shallow-shelf' ? 55 : 90
        const sDeep = preset.deepSalt + oceanic * 0.12
        const s = sDeep - (sDeep - sSurf) * Math.exp(-d / sScale)
        salinity[idx] = s + fbm2(noise, i * 0.18, j * 0.18 + d * 0.03, 3) * 0.08

        // 密度由温盐经 EOS-80 计算（可追溯）
        density[idx] = sigmaT(temperature[idx], salinity[idx])

        // 流场：坡折之上的黑潮/沿岸流急流（沿东北向），随深度衰减
        const slopeJet = Math.exp(-((ux * 0.72 + uy * 0.68 - 0.35) ** 2) / 0.05)
        const jetDecay = Math.exp(-d / (preset.depthProfile === 'shallow-shelf' ? 28 : 220))
        const seasonJet = 0.82 + 0.18 * seasonal
        const speed = preset.jetSpeed * slopeJet * jetDecay * seasonJet
        // 方向：东北向 ~ 045°，叠加一个中尺度涡旋转
        const baseAng = preset.depthProfile === 'shallow-shelf' ? 0.5 : 0.72
        const eddAng = Math.exp(-(((ux - 0.25) ** 2 + (uy + 0.35) ** 2) / 0.09)) * 1.9
        const ang = baseAng + eddAng
        const shelfWeak = preset.depthProfile === 'shallow-shelf' ? 1 : 1
        u[idx] = Math.cos(ang) * speed * shelfWeak + fbm2(noise, i * 0.3, j * 0.3 + 5, 2) * 0.05
        v[idx] = Math.sin(ang) * speed * shelfWeak + fbm2(noise, i * 0.3 + 7, j * 0.3, 2) * 0.05
      }
    }
  }
  return { temperature, salinity, density, u, v }
}

/* ------------------------------------------------------------------ */
/* 量化与写出                                                          */
/* ------------------------------------------------------------------ */

function writeFloat32LE(buffer, offset, value) {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 4)
  view.setFloat32(0, value, true)
}

const QUANT = {
  temperature: { scale: 0.005, unit: '°C', label: '温度', sourceVariable: 'thetao (simulated)' },
  salinity: { scale: 0.001, unit: 'PSU', label: '盐度', sourceVariable: 'so (simulated)' },
  density: { scale: 0.001, unit: 'kg/m³', label: '密度 σt', sourceVariable: 'dens0(EOS-80) derived' },
  u: { scale: 0.0005, unit: 'm/s', label: '东西向流速 u', sourceVariable: 'uo (simulated)' },
  v: { scale: 0.0005, unit: 'm/s', label: '南北向流速 v', sourceVariable: 'vo (simulated)' }
}

function generatePreset(preset) {
  const dir = join(OUT_ROOT, preset.id)
  mkdirSync(join(dir, 'frames'), { recursive: true })
  const depths = buildDepths(preset)
  preset.grid.nz = depths.length
  const { nx, ny, nz } = preset.grid

  const bathy = buildBathymetry(preset)
  const mask = buildMask(preset, bathy, depths)

  // coords.bin：12 字节头 + nx(lon f32) + ny(lat f32) + nz(depth f32)
  const coordsBuf = new Uint8Array(12 + (nx + ny + nz) * 4)
  const coordsView = new DataView(coordsBuf.buffer)
  coordsView.setUint32(0, nx, true)
  coordsView.setUint32(4, ny, true)
  coordsView.setUint32(8, nz, true)
  let off = 12
  for (let i = 0; i < nx; i += 1) {
    coordsView.setFloat32(off, preset.extent.west + ((preset.extent.east - preset.extent.west) * i) / (nx - 1), true)
    off += 4
  }
  for (let j = 0; j < ny; j += 1) {
    coordsView.setFloat32(off, preset.extent.south + ((preset.extent.north - preset.extent.south) * j) / (ny - 1), true)
    off += 4
  }
  for (let k = 0; k < nz; k += 1) {
    coordsView.setFloat32(off, depths[k], true)
    off += 4
  }
  writeFileSync(join(dir, 'coords.bin'), coordsBuf)

  // bathymetry.bin
  const bathyBuf = new Uint8Array(nx * ny * 4)
  for (let i = 0; i < nx * ny; i += 1) writeFloat32LE(bathyBuf, i * 4, bathy[i])
  writeFileSync(join(dir, 'bathymetry.bin'), bathyBuf)

  // mask.bin
  writeFileSync(join(dir, 'mask.bin'), mask)

  let bathyMin = Infinity
  let bathyMax = -Infinity
  for (const v of bathy) {
    if (v < bathyMin) bathyMin = v
    if (v > bathyMax) bathyMax = v
  }

  // 先生成全部月份场，统计每变量全局范围（保证所有月份共用同一 scale/offset）
  const months = []
  const global = {}
  for (const name of VAR_ORDER) global[name] = { min: Infinity, max: -Infinity }
  for (let m = 0; m < 12; m += 1) {
    const fields = buildMonthFields(preset, bathy, depths, m)
    months.push(fields)
    for (const name of VAR_ORDER) {
      const f = fields[name]
      for (let i = 0; i < f.length; i += 1) {
        if (f[i] < global[name].min) global[name].min = f[i]
        if (f[i] > global[name].max) global[name].max = f[i]
      }
    }
  }

  const varMeta = {}
  const encoding = {}
  const maxRaw = 65534
  for (const name of VAR_ORDER) {
    const { min, max } = global[name]
    const nominal = QUANT[name].scale
    const offset = Math.round(min / nominal) * nominal
    const span = max - min || 1
    const effScale = span > maxRaw * nominal ? span / maxRaw : nominal
    varMeta[name] = {
      sourceVariable: QUANT[name].sourceVariable,
      label: QUANT[name].label,
      unit: QUANT[name].unit,
      scale: effScale,
      offset,
      validMin: min,
      validMax: max,
      missingValue: 65535
    }
    encoding[name] = { scale: effScale, offset }
  }

  const n = nx * ny * nz
  for (let m = 0; m < 12; m += 1) {
    const fields = months[m]
    const block = new Uint16Array(n * VAR_ORDER.length)
    let cursor = 0
    for (const name of VAR_ORDER) {
      const { scale, offset } = encoding[name]
      const f = fields[name]
      for (let i = 0; i < n; i += 1) {
        block[cursor + i] = clamp(Math.round((f[i] - offset) / scale), 0, maxRaw)
      }
      cursor += n
    }
    writeFileSync(join(dir, 'frames', `${String(m + 1).padStart(2, '0')}.bin`), Buffer.from(block.buffer, block.byteOffset, block.byteLength))
  }

  const manifest = {
    id: preset.id,
    title: preset.title,
    source: '程序化生成的海水水文样本（演示数据）',
    productId: `sample/${preset.id}`,
    sourceUrl: 'https://data.marine.copernicus.eu/product/GLOBAL_MULTIYEAR_PHY_001_030/services',
    sourceVersion: 'sample-2026.10',
    citation:
      '本样本为演示数据，非真实观测或官方再分析产品；接入真实数据的方法见 scripts/ocean-tsd/preprocess_ocean.py',
    license: 'CC-BY-4.0 (sample only)',
    generatedAt: new Date().toISOString().slice(0, 10),
    timeKind: 'demo',
    timeNote: '示例数据：程序化生成的水文样本，用于演示真实数据管线、体渲染与分析流程，绝不代表真实海况。',
    timeLabels: MONTHS,
    regionName: preset.regionName,
    extent: preset.extent,
    nativeResolution: {
      lonLat: `${(((preset.extent.east - preset.extent.west) / (nx - 1)) * 111).toFixed(1)} km × ${(((preset.extent.north - preset.extent.south) / (ny - 1)) * 111).toFixed(1)} km`,
      verticalLevels: nz,
      depthsM: depths
    },
    grid: { nx, ny, nz, encoding: 'uint16' },
    verticalPositive: 'down',
    depthRangeM: [0, preset.maxDepth],
    bathymetryRangeM: [Math.round(bathyMin), Math.round(bathyMax)],
    densityMethod: '位密度异常 σt：EOS-80 (UNESCO 1983) 标准大气压密度减去 1000，参考压力 0 dbar，由数据块 T/S 实时计算',
    variables: varMeta,
    varOrder: VAR_ORDER,
    files: {
      coords: 'coords.bin',
      bathymetry: 'bathymetry.bin',
      mask: 'mask.bin',
      frames: Array.from({ length: 12 }, (_, m) => `frames/${String(m + 1).padStart(2, '0')}.bin`)
    }
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  console.log(`[generate] ${preset.id}: grid ${nx}×${ny}×${nz}, depths ${depths.length}, var ${VAR_ORDER.length}`)
}

mkdirSync(OUT_ROOT, { recursive: true })
for (const preset of PRESETS) generatePreset(preset)

// 顶层预设索引
const index = {
  generatedAt: new Date().toISOString().slice(0, 10),
  generator: 'scripts/ocean-tsd/generate-sample-data.mjs',
  note: '示例数据索引；每个预设目录内各自包含 manifest.json 与二进制数据块。',
  presets: PRESETS.map((p) => ({ id: p.id, title: p.title, manifest: `${p.id}/manifest.json` }))
}
writeFileSync(join(OUT_ROOT, 'index.json'), JSON.stringify(index, null, 2))
console.log(`[generate] done → ${OUT_ROOT}`)
