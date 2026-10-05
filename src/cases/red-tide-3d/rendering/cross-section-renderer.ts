import * as THREE from 'three'
import type { GridSpec } from '@rt/types/model'

// glslVersion: THREE.GLSL3 时 Three.js 会自动注入 #version 300 es 与
// position/uv/projectionMatrix/modelViewMatrix 内建声明，禁止重复声明。
const vertexShader = `out vec3 vLocalPosition;
out vec2 vUv;
void main() {
  vLocalPosition = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const fragmentShader = `precision highp float;
precision highp sampler2D;
precision highp sampler3D;
in vec3 vLocalPosition;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uAtlas;
uniform sampler3D uVolume;
uniform int uUseVolume3D;
uniform vec3 uAtlasGrid;
uniform float uThresholdLow;
uniform float uThresholdHigh;
uniform float uOpacity;
uniform float uIsoValue;
uniform float uAxisY;

float decodeRG(vec4 c) {
  float hi = floor(c.r * 255.0 + 0.5);
  float lo = floor(c.g * 255.0 + 0.5);
  return (hi * 256.0 + lo) / 65535.0;
}

float sampleAtlas(vec3 uvw) {
  uvw = clamp(uvw, vec3(0.001), vec3(0.999));
  float z = uvw.z * (uAtlasGrid.z - 1.0);
  float z0 = floor(z);
  float z1 = min(z0 + 1.0, uAtlasGrid.z - 1.0);
  float tz = z - z0;
  vec2 a = vec2((uvw.x * (uAtlasGrid.x - 1.0) + 0.5) / uAtlasGrid.x,
                (uvw.y * (uAtlasGrid.y - 1.0) + z0 * uAtlasGrid.y + 0.5) / (uAtlasGrid.y * uAtlasGrid.z));
  vec2 b = vec2((uvw.x * (uAtlasGrid.x - 1.0) + 0.5) / uAtlasGrid.x,
                (uvw.y * (uAtlasGrid.y - 1.0) + z1 * uAtlasGrid.y + 0.5) / (uAtlasGrid.y * uAtlasGrid.z));
  return mix(decodeRG(texture(uAtlas, a)), decodeRG(texture(uAtlas, b)), tz);
}

float sampleValue(vec3 uvw) {
  if (uUseVolume3D == 1) return texture(uVolume, uvw).r;
  return sampleAtlas(uvw);
}

vec3 transfer(float v) {
  vec3 c0 = vec3(0.25, 0.78, 0.88);
  vec3 c1 = vec3(1.0, 0.54, 0.05);
  vec3 c2 = vec3(1.0, 0.08, 0.02);
  vec3 c3 = vec3(0.63, 0.0, 0.10);
  float t = smoothstep(uThresholdLow, uThresholdHigh, v);
  vec3 c = mix(c0, c1, smoothstep(0.05, 0.45, t));
  c = mix(c, c2, smoothstep(0.45, 0.76, t));
  return mix(c, c3, smoothstep(0.76, 1.0, t));
}

void main() {
  float x01 = uAxisY > 0.5 ? vUv.x : 0.5;
  float y01 = uAxisY > 0.5 ? 0.5 : vUv.x;
  float z01 = vUv.y;
  float value = sampleValue(vec3(x01, y01, z01));
  float alpha = smoothstep(uThresholdLow * 0.65, uThresholdHigh, value) * uOpacity;
  float iso = 1.0 - smoothstep(0.0, 0.025, abs(value - uIsoValue));
  vec3 color = mix(transfer(value), vec3(0.95, 0.98, 0.82), iso * 0.72);
  float contour = 1.0 - smoothstep(0.0, 0.025, abs(fract(value * 10.0) - 0.5));
  color = mix(color, vec3(0.96, 0.99, 0.92), contour * 0.14);
  if (alpha < 0.008) discard;
  outColor = vec4(color, alpha * 0.88);
}`

export class CrossSectionRenderer {
  readonly mesh: THREE.Mesh
  private readonly grid: GridSpec
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.ShaderMaterial
  private axis: 'x' | 'y' = 'x'

  constructor(scene: THREE.Scene, grid: GridSpec, atlasTexture: THREE.Texture | null = null) {
    this.grid = grid
    const y0 = -grid.sizeY * 0.5
    const y1 = grid.sizeY * 0.5
    const x0 = -grid.sizeX * 0.5
    const x1 = grid.sizeX * 0.5
    const z0 = -grid.depth
    const z1 = grid.surfaceHeight
    const positions = new Float32Array([
      0, y0, z0,
      0, y1, z0,
      0, y1, z1,
      0, y0, z1,
    ])
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3])
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1))

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide,
      uniforms: {
        uAtlas: { value: atlasTexture },
        uVolume: { value: null },
        uUseVolume3D: { value: 1 },
        uAtlasGrid: { value: new THREE.Vector3(grid.nx, grid.ny, grid.nz) },
        uThresholdLow: { value: 0.08 },
        uThresholdHigh: { value: 0.42 },
        uOpacity: { value: 0.55 },
        uIsoValue: { value: 0.52 },
        uAxisY: { value: 0 },
      },
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 8
    this.setAxis('x')
    this.setSectionX(0)
    scene.add(this.mesh)
  }

  bindAtlas(texture: THREE.Texture): void {
    this.material.uniforms.uAtlas.value = texture
    this.material.uniforms.uUseVolume3D.value = 0
  }

  bindVolume(texture: THREE.Data3DTexture): void {
    this.material.uniforms.uVolume.value = texture
    this.material.uniforms.uUseVolume3D.value = 1
  }

  setAxis(axis: 'x' | 'y'): void {
    this.axis = axis
    this.material.uniforms.uAxisY.value = axis === 'y' ? 1 : 0
    const positions = this.geometry.getAttribute('position') as THREE.BufferAttribute
    const z0 = -this.grid.depth
    const z1 = this.grid.surfaceHeight
    if (axis === 'x') {
      const y0 = -this.grid.sizeY * 0.5
      const y1 = this.grid.sizeY * 0.5
      positions.array.set([0, y0, z0, 0, y1, z0, 0, y1, z1, 0, y0, z1])
      this.mesh.position.y = 0
    } else {
      const x0 = -this.grid.sizeX * 0.5
      const x1 = this.grid.sizeX * 0.5
      positions.array.set([x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1])
      this.mesh.position.x = 0
    }
    positions.needsUpdate = true
    this.setSectionX(this.mesh.position.x || this.mesh.position.y || 0)
  }

  setSectionX(value: number): void {
    if (this.axis === 'x') {
      this.mesh.position.x = THREE.MathUtils.clamp(value, -this.grid.sizeX * 0.5, this.grid.sizeX * 0.5)
    } else {
      this.mesh.position.y = THREE.MathUtils.clamp(value, -this.grid.sizeY * 0.5, this.grid.sizeY * 0.5)
    }
  }

  setThreshold(low: number, high: number): void {
    this.material.uniforms.uThresholdLow.value = low
    this.material.uniforms.uThresholdHigh.value = high
  }

  setIsoValue(value: number): void {
    this.material.uniforms.uIsoValue.value = value
  }

  setOpacity(value: number): void {
    this.material.uniforms.uOpacity.value = value
  }

  setVisible(value: boolean): void {
    this.mesh.visible = value
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
