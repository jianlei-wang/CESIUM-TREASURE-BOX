import * as THREE from 'three'
import type { GridSpec } from '@rt/types/model'

// ShaderMaterial + GLSL3：#version、position、uv 由 Three.js 前缀自动注入。
const particleComputeVertex = `out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

const particleComputeFragment = `precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uState;
uniform sampler2D uRandom;
uniform vec3 uCell;
uniform vec3 uGrid;
uniform float uElapsed;
uniform float uDt;

const float PI = 3.141592653589793;

vec4 stateAt(vec2 uv) {
  return texture(uState, uv);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

vec3 velocityNormalized(vec3 p) {
  vec3 q = clamp(p, 0.0, 1.0);
  float phase = uElapsed / 3600.0;
  float u = 0.22 + 0.35 * sin(q.y * PI * 2.0 + phase * 0.55) + 0.10 * cos(q.z * PI);
  float v = 0.10 + 0.28 * cos(q.x * PI * 2.0 - phase * 0.4) + 0.08 * sin(q.z * PI * 1.5);
  float w = 0.025 * sin(q.x * PI * 3.0 + q.y * PI * 2.0 + phase);
  return vec3(u / uCell.x, v / uCell.y, w / uCell.z);
}

void main() {
  vec4 state = stateAt(vUv);
  vec3 p = state.xyz;
  float age = state.w;
  vec3 vel = velocityNormalized(p);

  p += vel * uDt;
  age += uDt;

  bool outside = any(lessThan(p, vec3(0.0))) || any(greaterThan(p, vec3(1.0)));
  if (outside || age > 18000.0) {
    vec4 rnd = texture(uRandom, vUv);
    float phase = floor(uElapsed / max(uDt, 1.0));
    float r0 = fract(rnd.r + hash21(vUv + phase));
    float r1 = fract(rnd.g + hash21(vUv.yx + phase * 1.17));
    float r2 = fract(rnd.b + hash21(vUv * 1.83 + phase * 0.73));
    p = vec3(r0, r1, r2);
    p.z = min(p.z, 0.42 + r2 * 0.22);
    age = 0.0;
  }

  // w 保存粒子寿命，既支持 reset，又避免额外状态纹理。
  outColor = vec4(p, age);
}`

// position、modelViewMatrix、projectionMatrix 均由 Three.js 顶点前缀注入。
const particleVertex = `precision highp float;
precision highp sampler2D;

uniform sampler2D uPosition;
uniform sampler2D uFieldAtlas;
uniform vec2 uAtlasSize;
uniform vec3 uWorldSize;
uniform float uSurfaceHeight;
uniform vec3 uGridSize;
uniform float uPointSize;
uniform float uOpacity;
uniform float uElapsed;
uniform int uStyle;

out float vIntensity;
out float vAge;
out float vAngle;

float decodeRG(vec4 c) {
  float hi = floor(c.r * 255.0 + 0.5);
  float lo = floor(c.g * 255.0 + 0.5);
  return (hi * 256.0 + lo) / 65535.0;
}

float sampleAtlas(vec3 p) {
  p = clamp(p, 0.001, 0.999);
  float z = p.z * (uGridSize.z - 1.0);
  float z0 = floor(z);
  float z1 = min(z0 + 1.0, uGridSize.z - 1.0);
  float tz = z - z0;
  vec2 a = vec2((p.x * (uGridSize.x - 1.0) + 0.5) / uAtlasSize.x,
                (p.y * (uGridSize.y - 1.0) + z0 * uGridSize.y + 0.5) / uAtlasSize.y);
  vec2 b = vec2((p.x * (uGridSize.x - 1.0) + 0.5) / uAtlasSize.x,
                (p.y * (uGridSize.y - 1.0) + z1 * uGridSize.y + 0.5) / uAtlasSize.y);
  return mix(decodeRG(texture(uFieldAtlas, a)), decodeRG(texture(uFieldAtlas, b)), tz);
}

void main() {
  // position.xy 为 particle texture 中的 UV；index 通过全屏 quad 的 position 写入。
  vec4 state = texture(uPosition, position.xy);
  vec3 p = state.xyz;
  vAge = state.w;
  float concentrationMetric = sampleAtlas(p);
  float phase = uElapsed / 3600.0;
  float fu = 0.22 + 0.35 * sin(p.y * 6.283185 + phase * 0.55);
  float fv = 0.10 + 0.28 * cos(p.x * 6.283185 - phase * 0.4);
  float speedMetric = clamp(length(vec2(fu, fv)) / 0.62, 0.0, 1.0);
  vIntensity = clamp(concentrationMetric * 0.72 + speedMetric * 0.28, 0.02, 1.0);
  vAngle = atan(fv, fu);

  vec3 localPosition = vec3((p.x - 0.5) * uWorldSize.x,
                            (p.y - 0.5) * uWorldSize.y,
                            uSurfaceHeight - p.z * uWorldSize.z);
  vec4 mvPosition = modelViewMatrix * vec4(localPosition, 1.0);
  float perspectiveSize = 1800.0 / max(150.0, -mvPosition.z);
  gl_PointSize = clamp(uPointSize * max(1.0, perspectiveSize), 7.0, 30.0);
  gl_Position = projectionMatrix * mvPosition;
}`

const particleFragment = `precision highp float;
in float vIntensity;
in float vAge;
in float vAngle;
out vec4 outColor;
uniform float uOpacity;
uniform int uStyle;

vec3 stepColor(float v) {
  if (v < 0.20) return vec3(0.10,0.80,1.0);
  if (v < 0.40) return vec3(0.05,1.0,0.62);
  if (v < 0.60) return vec3(1.0,0.86,0.12);
  if (v < 0.80) return vec3(1.0,0.34,0.03);
  return vec3(0.88,0.03,0.18);
}

void main() {
  vec2 p = gl_PointCoord - 0.5;
  float aa = fwidth(p.x) + fwidth(p.y);
  float alpha = 0.0;
  if (uStyle == 0) {
    float d = length(p);
    float star = max(abs(p.x), abs(p.y)) + 0.28 * min(abs(p.x),abs(p.y));
    alpha = 1.0 - smoothstep(0.18, 0.48, star);
    alpha *= 1.0 - smoothstep(0.0,0.28,d)*0.15;
  } else if (uStyle == 1) {
    float c = cos(-vAngle), s = sin(-vAngle);
    vec2 q = vec2(c*p.x - s*p.y, s*p.x + c*p.y);
    float shaft = 1.0 - smoothstep(0.05,0.13,abs(q.y));
    float body = 1.0 - smoothstep(0.42,0.50,abs(q.x));
    float head = 1.0 - smoothstep(0.0,0.10,abs(q.y + 0.12*sign(q.x)));
    float arrowHead = step(0.06, q.x) * (1.0 - smoothstep(0.0,0.43,abs(q.y) + abs(q.x-0.16)));
    alpha = max(shaft*body, arrowHead);
  } else if (uStyle == 2) {
    float diamond = 1.0 - smoothstep(0.34,0.50,abs(p.x)+abs(p.y));
    alpha = diamond;
  } else {
    float ring = abs(length(p)-0.26);
    alpha = 1.0 - smoothstep(0.04 + aa, 0.09 + aa, ring);
  }
  if (alpha < 0.02) discard;
  float freshness = 1.0 - smoothstep(9000.0,18000.0,vAge);
  vec3 color = stepColor(vIntensity);
  outColor = vec4(color, alpha * uOpacity * mix(0.62,1.0,freshness));
}`

export class GpuFlowParticleSimulator {
  readonly points: THREE.Points
  private readonly renderer: THREE.WebGLRenderer
  private readonly grid: GridSpec
  private readonly count: number
  private readonly size: number
  private readonly targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget]
  private readonly computeScene = new THREE.Scene()
  private readonly computeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly computeMaterial: THREE.ShaderMaterial
  private readonly computeQuad: THREE.Mesh
  private readonly renderMaterial: THREE.ShaderMaterial
  private readonly geometry: THREE.BufferGeometry
  private readonly randomTexture: THREE.DataTexture
  private front = 0
  private fieldTexture: THREE.Texture | null = null
  private readonly tempRandom: Float32Array
  private destroyed = false

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, grid: GridSpec, count = 8192) {
    this.renderer = renderer
    this.grid = grid
    this.count = count
    this.size = Math.ceil(Math.sqrt(count))

    this.targets = [this.createTarget(), this.createTarget()]
    this.computeMaterial = new THREE.ShaderMaterial({
      vertexShader: particleComputeVertex,
      fragmentShader: particleComputeFragment,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uState: { value: null },
        uRandom: { value: null },
        uCell: { value: new THREE.Vector3(grid.cellX, grid.cellY, grid.cellZ) },
        uGrid: { value: new THREE.Vector3(grid.nx - 1, grid.ny - 1, grid.nz - 1) },
        uElapsed: { value: 0 },
        uDt: { value: 900 },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.computeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.computeMaterial)
    this.computeQuad.frustumCulled = false
    this.computeScene.add(this.computeQuad)

    this.tempRandom = new Float32Array(this.size * this.size * 4)
    for (let i = 0; i < this.tempRandom.length; i += 1) this.tempRandom[i] = Math.random()
    this.randomTexture = new THREE.DataTexture(this.tempRandom, this.size, this.size, THREE.RGBAFormat, THREE.FloatType)
    this.randomTexture.needsUpdate = true
    this.randomTexture.minFilter = THREE.NearestFilter
    this.randomTexture.magFilter = THREE.NearestFilter

    const uvData = new Float32Array(this.size * this.size * 3)
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        const i = (y * this.size + x) * 3
        uvData[i] = (x + 0.5) / this.size
        uvData[i + 1] = (y + 0.5) / this.size
        uvData[i + 2] = 0
      }
    }
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(uvData, 3))
    this.geometry.setDrawRange(0, count)

    this.renderMaterial = new THREE.ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uPosition: { value: this.targets[0].texture },
        uFieldAtlas: { value: null },
        uAtlasSize: { value: new THREE.Vector2(grid.nx, grid.ny * grid.nz) },
        uWorldSize: { value: new THREE.Vector3(grid.sizeX, grid.sizeY, grid.depth + grid.surfaceHeight) },
        uSurfaceHeight: { value: grid.surfaceHeight },
        uGridSize: { value: new THREE.Vector3(grid.nx, grid.ny, grid.nz) },
        uPointSize: { value: 9.0 },
        uOpacity: { value: 0.74 },
        uElapsed: { value: 0 },
        uStyle: { value: 0 },
      },
    })
    this.points = new THREE.Points(this.geometry, this.renderMaterial)
    this.points.frustumCulled = false
    this.points.renderOrder = 25
    scene.add(this.points)

    this.seed()
  }

  bindFieldTexture(texture: THREE.Texture): void {
    this.fieldTexture = texture
    this.renderMaterial.uniforms.uFieldAtlas.value = texture
  }

  step(elapsedSeconds: number, dtSeconds: number): void {
    if (this.destroyed) return
    const back = 1 - this.front
    this.computeMaterial.uniforms.uState.value = this.targets[this.front].texture
    this.computeMaterial.uniforms.uRandom.value = this.randomTexture
    this.computeMaterial.uniforms.uElapsed.value = elapsedSeconds
    this.renderMaterial.uniforms.uElapsed.value = elapsedSeconds
    this.computeMaterial.uniforms.uDt.value = dtSeconds

    this.renderComputePass(this.targets[back])
    this.front = back
    this.renderMaterial.uniforms.uPosition.value = this.targets[this.front].texture
  }

  setVisible(value: boolean): void {
    this.points.visible = value
  }

  setStyle(style: 'star' | 'arrow' | 'diamond' | 'ring'): void {
    const map = { star: 0, arrow: 1, diamond: 2, ring: 3 } as const
    this.renderMaterial.uniforms.uStyle.value = map[style]
  }

  setOpacity(value: number): void {
    this.renderMaterial.uniforms.uOpacity.value = value
  }

  reset(): void {
    this.seed()
  }

  dispose(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.geometry.dispose()
    this.renderMaterial.dispose()
    this.computeMaterial.dispose()
    this.computeQuad.geometry.dispose()
    this.targets[0].dispose()
    this.targets[1].dispose()
    this.randomTexture.dispose()
  }

  // 与 Cesium 共享 GL 上下文：计算绘制前后强制 Three 重建自身 VAO/程序状态，
  // 避免在 Cesium 残留的 VAO（无 element buffer）上执行 drawElements。
  private renderComputePass(target: THREE.WebGLRenderTarget): void {
    this.renderer.resetState()
    this.renderer.setRenderTarget(target)
    this.renderer.clear()
    this.renderer.render(this.computeScene, this.computeCamera)
    this.renderer.setRenderTarget(null)
    this.renderer.resetState()
  }

  private createTarget(): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(this.size, this.size, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    })
  }

  private seed(): void {
    const data = new Float32Array(this.size * this.size * 4)
    for (let i = 0; i < this.count; i += 1) {
      const x = (i % this.size) / Math.max(this.size - 1, 1)
      const y = Math.floor(i / this.size) / Math.max(this.size - 1, 1)
      const idx = i * 4
      data[idx] = x
      data[idx + 1] = y
      data[idx + 2] = 0.05 + Math.random() * 0.35
      data[idx + 3] = Math.random() * 3600
    }
    const upload = new THREE.DataTexture(data, this.size, this.size, THREE.RGBAFormat, THREE.FloatType)
    upload.needsUpdate = true
    upload.minFilter = THREE.NearestFilter
    upload.magFilter = THREE.NearestFilter

    this.computeMaterial.uniforms.uState.value = upload
    this.computeMaterial.uniforms.uRandom.value = this.randomTexture
    for (const target of this.targets) {
      this.renderComputePass(target)
    }
    this.computeMaterial.uniforms.uState.value = this.targets[0].texture
    this.front = 0
    this.renderMaterial.uniforms.uPosition.value = this.targets[0].texture
    upload.dispose()
  }
}
