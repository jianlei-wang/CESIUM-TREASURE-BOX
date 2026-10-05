import * as THREE from 'three'
import type { FieldStats, GridSpec, SimulationParameters } from '@rt/types/model'

// ShaderMaterial + GLSL3：Three.js 会自动注入 #version 与内置 position 属性，勿重复声明。
const quadVertex = `out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

// 3D 场被打包到 2D atlas：每个 z 层占 nx × ny，沿 Y 方向顺序排列。
// 浓度使用 RG 两通道保存 16bit 定点值，避免依赖浮点颜色附件。
const computeFragment = `precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uState;
uniform vec3 uGrid;
uniform vec3 uCell;
uniform float uElapsed;
uniform float uDt;
uniform float uDiffusion;
uniform float uGrowthRate;
uniform float uDecayRate;
uniform float uNutrient;
uniform float uLight;
uniform float uTemperature;

const float PI = 3.141592653589793;

float decodeRG(vec4 c) {
  float hi = floor(c.r * 255.0 + 0.5);
  float lo = floor(c.g * 255.0 + 0.5);
  return (hi * 256.0 + lo) / 65535.0;
}

vec4 encodeRG(float value) {
  float v = clamp(value, 0.0, 1.0) * 65535.0;
  float hi = floor(v / 256.0);
  float lo = v - hi * 256.0;
  return vec4(hi / 255.0, lo / 255.0, 0.0, 1.0);
}

float atlasSample(vec3 p) {
  vec3 maxCell = uGrid - vec3(1.0);
  p = clamp(p, vec3(0.0), maxCell);

  float z0 = floor(p.z);
  float z1 = min(z0 + 1.0, maxCell.z);
  float tz = p.z - z0;

  vec2 texel = vec2(1.0 / (uGrid.x), 1.0 / (uGrid.y * uGrid.z));
  vec2 xy0 = vec2((p.x + 0.5) / uGrid.x, (p.y + z0 * uGrid.y + 0.5) / (uGrid.y * uGrid.z));
  vec2 xy1 = vec2((p.x + 0.5) / uGrid.x, (p.y + z1 * uGrid.y + 0.5) / (uGrid.y * uGrid.z));

  // 使用 texture 的双线性插值做 XY，手动做 Z 线性插值。
  float a = decodeRG(texture(uState, xy0));
  float b = decodeRG(texture(uState, xy1));
  return mix(a, b, tz);
}

vec3 velocityNormalized(vec3 p) {
  vec3 q = p / max(uGrid - vec3(1.0), vec3(1.0));
  float phase = uElapsed / 3600.0;
  float u = 0.22 + 0.35 * sin(q.y * PI * 2.0 + phase * 0.55) + 0.10 * cos(q.z * PI);
  float v = 0.10 + 0.28 * cos(q.x * PI * 2.0 - phase * 0.4) + 0.08 * sin(q.z * PI * 1.5);
  float w = 0.025 * sin(q.x * PI * 3.0 + q.y * PI * 2.0 + phase);
  return vec3(u / uCell.x, v / uCell.y, w / uCell.z);
}

void main() {
  vec2 atlasPixels = vUv * vec2(uGrid.x, uGrid.y * uGrid.z);
  vec2 cellXY = floor(atlasPixels);
  float z = floor(cellXY.y / uGrid.y);
  float y = mod(cellXY.y, uGrid.y);
  float x = cellXY.x;
  vec3 p = vec3(x, y, z);

  vec3 vel = velocityNormalized(p);
  vec3 back = p - vel * uDt;
  float advected = atlasSample(back);

  float dx1 = atlasSample(p + vec3(1.0, 0.0, 0.0));
  float dx0 = atlasSample(p - vec3(1.0, 0.0, 0.0));
  float dy1 = atlasSample(p + vec3(0.0, 1.0, 0.0));
  float dy0 = atlasSample(p - vec3(0.0, 1.0, 0.0));
  float dz1 = atlasSample(p + vec3(0.0, 0.0, 1.0));
  float dz0 = atlasSample(p - vec3(0.0, 0.0, 1.0));
  float laplacian = dx0 + dx1 + dy0 + dy1 + dz0 + dz1 - advected * 6.0;

  float depth01 = z / max(uGrid.z - 1.0, 1.0);
  float lightFactor = 1.0 - 0.72 * depth01;
  float temperatureFactor = clamp(1.0 - abs(uTemperature - 24.0) / 16.0, 0.2, 1.0);
  float envGrowth = uGrowthRate * (0.55 + 0.45 * uNutrient) * (0.55 + 0.45 * uLight) * temperatureFactor;
  float response = clamp(temperatureFactor * (0.5 + 0.5 * lightFactor), 0.0, 1.0);
  response = response * response * (3.0 - 2.0 * response);

  float growth = advected * envGrowth * response * uDt;
  float decay = advected * uDecayRate * uDt;
  float result = advected + uDiffusion * laplacian + growth - decay;

  // 边界采用零梯度近似，避免浓度被采样到场外后产生异常值。
  outColor = encodeRG(result);
}`

export interface GpuSimulationSource {
  texture: THREE.Texture
  atlasWidth: number
  atlasHeight: number
  nx: number
  ny: number
  nz: number
}

function encode16(value: number, out: Uint8Array, offset: number): void {
  const q = Math.max(0, Math.min(65535, Math.round(value * 65535)))
  out[offset] = q >> 8
  out[offset + 1] = q & 0xff
  out[offset + 2] = 0
  out[offset + 3] = 255
}

function idx(x: number, y: number, z: number, grid: GridSpec): number {
  return x + grid.nx * (y + grid.ny * z)
}

export class GpuRedTideSimulation {
  readonly grid: GridSpec
  readonly params: SimulationParameters
  readonly atlasWidth: number
  readonly atlasHeight: number

  private readonly renderer: THREE.WebGLRenderer
  private readonly snapshotInterval = 4 * 3600
  private readonly snapshots = new Map<number, Uint8Array>()
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly material: THREE.ShaderMaterial
  private readonly mesh: THREE.Mesh
  private readonly targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget]
  private frontIndex = 0
  private elapsedSeconds = 0
  private version = 0
  private lastComputeMs = 0
  private lastStatsAt = 0
  private cachedStats: FieldStats | null = null
  private statsReadbackPromise: Promise<FieldStats> | null = null
  private readback = new Uint8Array(1)
  private seedAtlas: Uint8Array
  private destroyed = false

  constructor(renderer: THREE.WebGLRenderer, grid: GridSpec, params: SimulationParameters, initialField: Uint8Array) {
    this.renderer = renderer
    this.grid = grid
    this.params = params
    this.atlasWidth = grid.nx
    this.atlasHeight = grid.ny * grid.nz
    this.seedAtlas = fieldToAtlas(initialField, grid)

    const targetOptions = {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    }
    this.targets = [
      new THREE.WebGLRenderTarget(this.atlasWidth, this.atlasHeight, targetOptions),
      new THREE.WebGLRenderTarget(this.atlasWidth, this.atlasHeight, targetOptions),
    ]

    this.material = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: computeFragment,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uState: { value: null },
        uGrid: { value: new THREE.Vector3(grid.nx, grid.ny, grid.nz) },
        uCell: { value: new THREE.Vector3(grid.cellX, grid.cellY, grid.cellZ) },
        uElapsed: { value: 0 },
        uDt: { value: params.dtSeconds },
        uDiffusion: { value: params.diffusion },
        uGrowthRate: { value: params.growthRate },
        uDecayRate: { value: params.decayRate },
        uNutrient: { value: params.nutrient },
        uLight: { value: params.light },
        uTemperature: { value: params.temperature },
      },
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)

    this.readback = new Uint8Array(this.atlasWidth * this.atlasHeight * 4)
    this.initializeSeed()
  }

  get elapsed(): number {
    return this.elapsedSeconds
  }

  get computeMs(): number {
    return this.lastComputeMs
  }

  get texture(): THREE.Texture {
    return this.targets[this.frontIndex].texture
  }

  setParameters(params: Partial<SimulationParameters>): void {
    Object.assign(this.params, params)
    if (params.dtSeconds !== undefined) this.material.uniforms.uDt.value = params.dtSeconds
    if (params.diffusion !== undefined) this.material.uniforms.uDiffusion.value = params.diffusion
    if (params.growthRate !== undefined) this.material.uniforms.uGrowthRate.value = params.growthRate
    if (params.decayRate !== undefined) this.material.uniforms.uDecayRate.value = params.decayRate
    if (params.nutrient !== undefined) this.material.uniforms.uNutrient.value = params.nutrient
    if (params.light !== undefined) this.material.uniforms.uLight.value = params.light
    if (params.temperature !== undefined) this.material.uniforms.uTemperature.value = params.temperature
    this.cachedStats = null
  }

  get source(): GpuSimulationSource {
    return {
      texture: this.texture,
      atlasWidth: this.atlasWidth,
      atlasHeight: this.atlasHeight,
      nx: this.grid.nx,
      ny: this.grid.ny,
      nz: this.grid.nz,
    }
  }

  reset(): void {
    this.version = 0
    this.cachedStats = null
    this.lastStatsAt = 0
    this.initializeSeed()
  }

  restoreNearestSnapshot(targetSeconds: number): number {
    const keys = [...this.snapshots.keys()].filter((key) => key <= targetSeconds)
    const nearest = keys.length ? Math.max(...keys) : 0
    const snapshot = this.snapshots.get(nearest) ?? this.snapshots.get(0)
    if (!snapshot) return 0
    this.restoreAtlas(snapshot, nearest)
    return nearest
  }

  advanceSteps(requestedSteps: number): number {
    if (this.destroyed) return 0
    const steps = Math.max(0, Math.min(this.params.maxStepsPerFrame ?? 24, Math.floor(requestedSteps)))
    if (steps === 0) return 0

    const startedAt = performance.now()
    for (let i = 0; i < steps; i += 1) this.step()
    this.lastComputeMs = (performance.now() - startedAt) / steps
    this.version += 1
    return steps
  }

  stats(force = false): FieldStats {
    const now = performance.now()
    if (!force && this.cachedStats && now - this.lastStatsAt < 1000) return this.cachedStats

    this.renderer.readRenderTargetPixels(this.targets[this.frontIndex], 0, 0, this.atlasWidth, this.atlasHeight, this.readback)
    this.cachedStats = this.calculateStats(this.readback)
    this.lastStatsAt = now
    return this.cachedStats
  }

  async statsAsync(force = false): Promise<FieldStats> {
    const now = performance.now()
    if (!force && this.cachedStats && now - this.lastStatsAt < 1000) return this.cachedStats
    if (this.statsReadbackPromise) return this.statsReadbackPromise

    const buffer = new Uint8Array(this.readback.length)
    this.statsReadbackPromise = this.renderer
      .readRenderTargetPixelsAsync(this.targets[this.frontIndex], 0, 0, this.atlasWidth, this.atlasHeight, buffer)
      .then(() => {
        this.cachedStats = this.calculateStats(buffer)
        this.lastStatsAt = performance.now()
        return this.cachedStats
      })
      .finally(() => {
        this.statsReadbackPromise = null
      })

    return this.statsReadbackPromise
  }

  private calculateStats(data: Uint8Array): FieldStats {
    let min = 1
    let max = 0
    let sum = 0
    let affectedVolumeCells = 0
    let affectedSurfaceCells = 0
    let affectedDepthIndex = 0
    let surfaceMax = 0

    for (let z = 0; z < this.grid.nz; z += 1) {
      for (let y = 0; y < this.grid.ny; y += 1) {
        for (let x = 0; x < this.grid.nx; x += 1) {
          const atlasIndex = ((z * this.grid.ny + y) * this.grid.nx + x) * 4
          const value = (data[atlasIndex] * 256 + data[atlasIndex + 1]) / 65535
          min = Math.min(min, value)
          max = Math.max(max, value)
          sum += value
          if (value >= 0.18) {
            affectedVolumeCells += 1
            affectedDepthIndex = Math.max(affectedDepthIndex, z)
          }
          if (z < Math.min(this.grid.nz, 4)) surfaceMax = Math.max(surfaceMax, value)
        }
      }
    }

    for (let y = 0; y < this.grid.ny; y += 1) {
      for (let x = 0; x < this.grid.nx; x += 1) {
        let affected = false
        for (let z = 0; z < this.grid.nz; z += 1) {
          const atlasIndex = ((z * this.grid.ny + y) * this.grid.nx + x) * 4
          const value = (data[atlasIndex] * 256 + data[atlasIndex + 1]) / 65535
          if (value >= 0.18) {
            affected = true
            break
          }
        }
        if (affected) affectedSurfaceCells += 1
      }
    }

    const horizontalCellAreaKm2 = (this.grid.cellX * this.grid.cellY) / 1e6
    return {
      min,
      max,
      mean: sum / (this.grid.nx * this.grid.ny * this.grid.nz),
      affectedAreaKm2: affectedSurfaceCells * horizontalCellAreaKm2,
      affectedVolumeKm3: affectedVolumeCells * this.grid.cellX * this.grid.cellY * this.grid.cellZ / 1e9,
      affectedDepthM: (affectedDepthIndex / Math.max(this.grid.nz - 1, 1)) * this.grid.depth,
      surfaceMax,
    }
  }

  quantizeField(out: Uint8Array): void {
    if (out.length !== this.grid.nx * this.grid.ny * this.grid.nz) throw new Error('GPU field output size mismatch.')
    this.renderer.readRenderTargetPixels(this.targets[this.frontIndex], 0, 0, this.atlasWidth, this.atlasHeight, this.readback)
    const data = this.readback
    for (let z = 0; z < this.grid.nz; z += 1) {
      for (let y = 0; y < this.grid.ny; y += 1) {
        for (let x = 0; x < this.grid.nx; x += 1) {
          const a = ((z * this.grid.ny + y) * this.grid.nx + x) * 4
          out[idx(x, y, z, this.grid)] = Math.round(((data[a] * 256 + data[a + 1]) / 65535) * 255)
        }
      }
    }
  }

  dispose(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.targets[0].dispose()
    this.targets[1].dispose()
  }

  private captureSnapshot(timeSeconds: number): void {
    const buffer = new Uint8Array(this.readback.length)
    this.renderer.readRenderTargetPixels(
      this.targets[this.frontIndex],
      0,
      0,
      this.atlasWidth,
      this.atlasHeight,
      buffer,
    )
    this.snapshots.set(timeSeconds, buffer)
  }

  private restoreAtlas(atlas: Uint8Array, timeSeconds: number): void {
    const upload = new THREE.DataTexture(atlas, this.atlasWidth, this.atlasHeight, THREE.RGBAFormat, THREE.UnsignedByteType)
    upload.minFilter = THREE.LinearFilter
    upload.magFilter = THREE.LinearFilter
    upload.wrapS = THREE.ClampToEdgeWrapping
    upload.wrapT = THREE.ClampToEdgeWrapping
    upload.needsUpdate = true

    const previous = this.material.uniforms.uState.value
    const previousDt = this.material.uniforms.uDt.value
    const previousDiffusion = this.material.uniforms.uDiffusion.value
    const previousGrowth = this.material.uniforms.uGrowthRate.value
    const previousDecay = this.material.uniforms.uDecayRate.value
    this.material.uniforms.uState.value = upload
    this.material.uniforms.uDt.value = 0
    this.material.uniforms.uDiffusion.value = 0
    this.material.uniforms.uGrowthRate.value = 0
    this.material.uniforms.uDecayRate.value = 0
    for (const target of this.targets) {
      this.renderComputePass(target)
    }
    this.frontIndex = 0
    this.elapsedSeconds = timeSeconds
    this.material.uniforms.uState.value = previous
    this.material.uniforms.uDt.value = previousDt
    this.material.uniforms.uDiffusion.value = previousDiffusion
    this.material.uniforms.uGrowthRate.value = previousGrowth
    this.material.uniforms.uDecayRate.value = previousDecay
    this.cachedStats = null
    this.lastStatsAt = 0
    upload.dispose()
  }

  private initializeSeed(): void {
    const upload = new THREE.DataTexture(this.seedAtlas, this.atlasWidth, this.atlasHeight, THREE.RGBAFormat, THREE.UnsignedByteType)
    upload.minFilter = THREE.LinearFilter
    upload.magFilter = THREE.LinearFilter
    upload.wrapS = THREE.ClampToEdgeWrapping
    upload.wrapT = THREE.ClampToEdgeWrapping
    upload.needsUpdate = true

    const previous = this.material.uniforms.uState.value
    const previousDt = this.material.uniforms.uDt.value
    const previousDiffusion = this.material.uniforms.uDiffusion.value
    const previousGrowth = this.material.uniforms.uGrowthRate.value
    const previousDecay = this.material.uniforms.uDecayRate.value
    this.material.uniforms.uState.value = upload
    this.material.uniforms.uDt.value = 0
    this.material.uniforms.uDiffusion.value = 0
    this.material.uniforms.uGrowthRate.value = 0
    this.material.uniforms.uDecayRate.value = 0
    this.renderComputePass(this.targets[0])
    this.renderComputePass(this.targets[1])
    this.frontIndex = 0
    this.elapsedSeconds = 0
    this.snapshots.clear()
    this.captureSnapshot(0)
    this.material.uniforms.uState.value = previous
    this.material.uniforms.uDt.value = previousDt
    this.material.uniforms.uDiffusion.value = previousDiffusion
    this.material.uniforms.uGrowthRate.value = previousGrowth
    this.material.uniforms.uDecayRate.value = previousDecay
    upload.dispose()
  }

  /**
   * 计算 pass 与 Cesium 共用同一个 GL 上下文：Cesium 每帧会切换自己的 VAO/程序，
   * Three 内部缓存可能与实际 GL 绑定不一致。绘制前后各 resetState() 一次，强制
   * Three 重新绑定自身 VAO（含 ELEMENT_ARRAY_BUFFER），杜绝在外部 VAO 上调用
   * glDrawElements 导致的 “Must have element array buffer bound” 错误。
   */
  private renderComputePass(target: THREE.WebGLRenderTarget): void {
    this.renderer.resetState()
    this.renderer.setRenderTarget(target)
    this.renderer.clear()
    this.renderer.render(this.scene, this.camera)
    this.renderer.setRenderTarget(null)
    this.renderer.resetState()
  }

  step(): void {
    const front = this.targets[this.frontIndex]
    const backIndex = 1 - this.frontIndex
    const back = this.targets[backIndex]

    this.material.uniforms.uState.value = front.texture
    this.material.uniforms.uElapsed.value = this.elapsedSeconds
    this.material.uniforms.uDt.value = this.params.dtSeconds
    this.renderComputePass(back)

    this.frontIndex = backIndex
    this.elapsedSeconds += this.params.dtSeconds
    this.cachedStats = null
    if (this.elapsedSeconds > 0 && this.elapsedSeconds % this.snapshotInterval === 0) {
      this.captureSnapshot(this.elapsedSeconds)
    }
  }
}

function fieldToAtlas(field8: Uint8Array, grid: GridSpec): Uint8Array {
  const out = new Uint8Array(grid.nx * grid.ny * grid.nz * 4)
  for (let z = 0; z < grid.nz; z += 1) {
    for (let y = 0; y < grid.ny; y += 1) {
      for (let x = 0; x < grid.nx; x += 1) {
        const src = idx(x, y, z, grid)
        const dst = src * 4
        encode16(field8[src] / 255, out, dst)
      }
    }
  }
  return out
}
