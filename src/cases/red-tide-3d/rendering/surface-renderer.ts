import * as THREE from 'three'
import type { GridSpec } from '@rt/types/model'

// 注意：glslVersion: THREE.GLSL3 时 Three.js 会自动在最前面注入
// `#version 300 es` 以及 position/uv/projectionMatrix/modelViewMatrix 等内建声明，
// 这里不能再手写，否则会出现 #version 位置错误与变量重定义。
const surfaceVertex = `out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const surfaceFragment = `in vec2 vUv;
out vec4 outColor;
uniform sampler2D uField;
uniform sampler2D uAtlas;
uniform int uUseAtlas;
uniform vec3 uAtlasGrid;
uniform float uOpacity;
uniform float uThresholdLow;
uniform float uThresholdHigh;

float decodeRG(vec4 c) {
  float hi = floor(c.r * 255.0 + 0.5);
  float lo = floor(c.g * 255.0 + 0.5);
  return (hi * 256.0 + lo) / 65535.0;
}

float atlasSurface() {
  vec2 uv = vec2((vUv.x * (uAtlasGrid.x - 1.0) + 0.5) / uAtlasGrid.x,
                 (vUv.y * (uAtlasGrid.y - 1.0) + 0.5) / (uAtlasGrid.y * uAtlasGrid.z));
  return decodeRG(texture(uAtlas, uv));
}

float sampleValue() {
  return uUseAtlas == 1 ? atlasSurface() : texture(uField, vUv).r;
}

vec3 transfer(float v) {
  vec3 c0 = vec3(1.0, 0.55, 0.05);
  vec3 c1 = vec3(1.0, 0.13, 0.04);
  vec3 c2 = vec3(0.72, 0.015, 0.10);
  float t = smoothstep(uThresholdLow, uThresholdHigh, v);
  vec3 c = mix(c0, c1, smoothstep(0.05, 0.55, t));
  c = mix(c, c2, smoothstep(0.55, 1.0, t));
  return c;
}

void main() {
  float value = sampleValue();
  float alpha = smoothstep(uThresholdLow * 0.7, uThresholdHigh, value) * uOpacity;
  if (alpha < 0.005) discard;
  vec3 color = transfer(value);

  // 科研图层：在连续浓度色带上叠加弱等值线，增强空间梯度与核心区边界识别。
  float contour = 1.0 - smoothstep(0.0, 0.022, abs(fract(value * 10.0) - 0.5));
  float highBand = smoothstep(uThresholdHigh, 0.92, value);
  color = mix(color, vec3(1.0, 0.86, 0.38), contour * 0.12);
  color = mix(color, vec3(0.56, 0.0, 0.08), highBand * 0.22);
  outColor = vec4(color, alpha);
}`

export interface SurfaceAtlasBinding {
  texture: THREE.Texture
  nx: number
  ny: number
  nz: number
}

export class SurfaceFieldRenderer {
  readonly mesh: THREE.Mesh
  private readonly texture: THREE.DataTexture
  private readonly data: Uint8Array
  private readonly material: THREE.ShaderMaterial

  constructor(scene: THREE.Scene, grid: GridSpec, initialSurface8: Uint8Array) {
    this.data = new Uint8Array(128 * 128)
    this.texture = new THREE.DataTexture(this.data, 128, 128, THREE.RedFormat, THREE.UnsignedByteType)
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.wrapS = THREE.ClampToEdgeWrapping
    this.texture.wrapT = THREE.ClampToEdgeWrapping
    this.texture.needsUpdate = true

    const geometry = new THREE.PlaneGeometry(grid.sizeX, grid.sizeY, 1, 1)
    geometry.translate(0, 0, grid.surfaceHeight)

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uField: { value: this.texture },
        uAtlas: { value: null },
        uUseAtlas: { value: 0 },
        uAtlasGrid: { value: new THREE.Vector3(grid.nx, grid.ny, grid.nz) },
        uOpacity: { value: 0.46 },
        uThresholdLow: { value: 0.08 },
        uThresholdHigh: { value: 0.42 },
      },
      vertexShader: surfaceVertex,
      fragmentShader: surfaceFragment,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    })

    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 15
    scene.add(this.mesh)
    this.updateSurface(initialSurface8)
  }

  bindAtlas(binding: SurfaceAtlasBinding): void {
    this.material.uniforms.uAtlas.value = binding.texture
    this.material.uniforms.uAtlasGrid.value.set(binding.nx, binding.ny, binding.nz)
    this.material.uniforms.uUseAtlas.value = 1
  }

  updateSurface(surface8: Uint8Array): void {
    this.data.set(surface8)
    this.texture.needsUpdate = true
    this.material.uniforms.uUseAtlas.value = 0
  }

  setThreshold(low: number, high: number): void {
    this.material.uniforms.uThresholdLow.value = low
    this.material.uniforms.uThresholdHigh.value = high
  }

  setOpacity(value: number): void {
    this.material.uniforms.uOpacity.value = value
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.texture.dispose()
  }
}
