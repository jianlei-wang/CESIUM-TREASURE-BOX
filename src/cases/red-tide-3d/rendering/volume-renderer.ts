import * as THREE from 'three'
import type { GridSpec } from '@rt/types/model'

// glslVersion: THREE.GLSL3 时 Three.js 会自动注入 #version 300 es 与
// position/projectionMatrix/modelViewMatrix 等内建声明，禁止重复声明。
const vertexShader = `out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

const fragmentShader = `precision highp float;
precision highp sampler2D;
precision highp sampler3D;

in vec2 vUv;
// renderTarget 使用 count:2 的多重渲染目标，必须为每个颜色附件声明对应输出，
// 否则 WebGL2 会报 "Active draw buffers with missing fragment shader outputs"，
// 导致整个体渲染 pass 失效（三维赤潮体开关无任何视觉变化）。
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outLinearDepth;

uniform sampler3D uVolume;
uniform sampler2D uAtlas;
uniform sampler2D uOcclusionDepth;
uniform int uUseAtlas;
uniform vec3 uAtlasGrid;
uniform vec3 uCameraLocal;
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
uniform mat4 uView;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uThresholdLow;
uniform float uThresholdHigh;
uniform float uIsoValue;
uniform float uIsoThickness;
uniform float uDensity;
uniform float uStepScale;
uniform float uTime;
uniform float uClipEnabled;
uniform vec4 uClipPlane;
uniform int uRenderMode;
uniform int uUseOcclusionDepth;
uniform vec2 uTargetSize;

const float DEPTH_SCALE = 2000000.0;

float decodeDepth32(vec4 c) {
  return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
}

vec4 packDepth32(float v) {
  v = clamp(v, 0.0, 1.0);
  vec4 enc = vec4(1.0, 255.0, 65025.0, 16581375.0) * v;
  enc = fract(enc);
  enc -= enc.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
  return enc;
}

float decodeRG(vec4 c) {
  float hi = floor(c.r * 255.0 + 0.5);
  float lo = floor(c.g * 255.0 + 0.5);
  return (hi * 256.0 + lo) / 65535.0;
}

float atlasSample(vec3 uvw) {
  uvw = clamp(uvw, vec3(0.001), vec3(0.999));
  float z = uvw.z * (uAtlasGrid.z - 1.0);
  float z0 = floor(z);
  float z1 = min(z0 + 1.0, uAtlasGrid.z - 1.0);
  float tz = z - z0;
  vec2 a = vec2(
    (uvw.x * (uAtlasGrid.x - 1.0) + 0.5) / uAtlasGrid.x,
    (uvw.y * (uAtlasGrid.y - 1.0) + z0 * uAtlasGrid.y + 0.5) / (uAtlasGrid.y * uAtlasGrid.z)
  );
  vec2 b = vec2(
    (uvw.x * (uAtlasGrid.x - 1.0) + 0.5) / uAtlasGrid.x,
    (uvw.y * (uAtlasGrid.y - 1.0) + z1 * uAtlasGrid.y + 0.5) / (uAtlasGrid.y * uAtlasGrid.z)
  );
  return mix(decodeRG(texture(uAtlas, a)), decodeRG(texture(uAtlas, b)), tz);
}

float sampleVolume(vec3 uvw) {
  if (uUseAtlas == 1) return atlasSample(uvw);
  return texture(uVolume, clamp(uvw, vec3(0.001), vec3(0.999))).r;
}

vec3 transfer(float value) {
  vec3 c0 = vec3(0.30, 0.84, 0.94);
  vec3 c1 = vec3(1.0, 0.68, 0.05);
  vec3 c2 = vec3(1.0, 0.16, 0.025);
  vec3 c3 = vec3(0.70, 0.0, 0.12);
  float t = smoothstep(uThresholdLow, uThresholdHigh, value);
  vec3 c = mix(c0, c1, smoothstep(0.02, 0.34, t));
  c = mix(c, c2, smoothstep(0.34, 0.70, t));
  return mix(c, c3, smoothstep(0.70, 1.0, t));
}

vec3 uvFromLocal(vec3 p) {
  return clamp((p - uBoxMin) / (uBoxMax - uBoxMin), vec3(0.001), vec3(0.999));
}

vec3 estimateNormal(vec3 p) {
  vec3 cell = vec3(
    (uBoxMax.x - uBoxMin.x) / max(uAtlasGrid.x - 1.0, 1.0),
    (uBoxMax.y - uBoxMin.y) / max(uAtlasGrid.y - 1.0, 1.0),
    (uBoxMax.z - uBoxMin.z) / max(uAtlasGrid.z - 1.0, 1.0)
  );
  vec3 e = cell * 1.15;
  float dx = sampleVolume(uvFromLocal(p + vec3(e.x, 0.0, 0.0))) - sampleVolume(uvFromLocal(p - vec3(e.x, 0.0, 0.0)));
  float dy = sampleVolume(uvFromLocal(p + vec3(0.0, e.y, 0.0))) - sampleVolume(uvFromLocal(p - vec3(0.0, e.y, 0.0)));
  float dz = sampleVolume(uvFromLocal(p + vec3(0.0, 0.0, e.z))) - sampleVolume(uvFromLocal(p - vec3(0.0, 0.0, e.z)));
  vec3 g = vec3(dx, dy, dz);
  if (length(g) < 0.0001) return vec3(0.0, 0.0, 1.0);
  return normalize(g);
}

vec2 rayBoxIntersect(vec3 ro, vec3 rd) {
  vec3 invDir = 1.0 / rd;
  vec3 t0 = (uBoxMin - ro) * invDir;
  vec3 t1 = (uBoxMax - ro) * invDir;
  vec3 tMin = min(t0, t1);
  vec3 tMax = max(t0, t1);
  float tEnter = max(max(tMin.x, tMin.y), tMin.z);
  float tExit = min(min(tMax.x, tMax.y), tMax.z);
  return vec2(tEnter, tExit);
}

void main() {
  // 用完整屏幕射线代替 Cube proxy 的插值位置，避免大尺度海域下 front-face
  // 插值与 Three/ Cesium 相机矩阵之间产生误差，这是三维体不可见的高风险来源之一。
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 nearH = uInvProjection * vec4(ndc, -1.0, 1.0);
  vec4 farH = uInvProjection * vec4(ndc, 1.0, 1.0);
  nearH /= nearH.w;
  farH /= farH.w;
  vec3 rayDirCamera = normalize(farH.xyz - nearH.xyz);
  vec3 rayOrigin = uCameraLocal;
  vec3 rayDir = normalize((uCameraWorld * vec4(rayDirCamera, 0.0)).xyz);

  vec2 hit = rayBoxIntersect(rayOrigin, rayDir);
  if (hit.y <= max(hit.x, 0.0)) discard;

  float tStart = max(hit.x, 0.0);
  float tEnd = hit.y;
  float extent = length(uBoxMax - uBoxMin);
  // 旧版本为 extent/190，约 800m/step，在 1800m 深的赤潮核心层里极易“跨过去”。
  // 现在提高采样密度，并保留 stepScale 供用户动态调节。
  float stepLength = clamp(extent / 520.0 * uStepScale, 90.0, 340.0);
  stepLength *= mix(0.74, 1.0, abs(rayDir.z));

  // 近距斜视下固定步长会在平滑密度场上采样出一圈圈同心带状伪影（“洋葱圈”）。
  // 逐像素抖动起始偏移打散相干条纹，并让步长随离相机距离增大（近细远粗），
  // 在不显著增加采样次数的前提下消除近景带状伪影。
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float t = tStart + jitter * stepLength;

  vec3 lightDir = normalize(vec3(-0.32, 0.40, 0.86));
  vec3 accumColor = vec3(0.0);
  float accumAlpha = 0.0;
  bool hitIso = false;
  float firstDepth = DEPTH_SCALE;

  for (int i = 0; i < 560; i++) {
    if (t >= tEnd || accumAlpha > 0.986) break;
    vec3 p = rayOrigin + rayDir * t;
    // 先推进采样位置，保证后续 continue 不会停在原地造成死循环。
    t += stepLength * (0.5 + 0.5 * clamp(t / extent, 0.0, 1.0));

    if (uClipEnabled > 0.5 && dot(uClipPlane.xyz, p) + uClipPlane.w < 0.0) continue;

    float value = sampleVolume(uvFromLocal(p));
    if (value < max(0.002, uThresholdLow * 0.20)) continue;

    float eyeDepth = max(-(uView * vec4(p, 1.0)).z, 0.0);
    if (uUseOcclusionDepth == 1) {
      float blocker = decodeDepth32(texture(uOcclusionDepth, vUv)) * DEPTH_SCALE;
      if (blocker < DEPTH_SCALE * 0.99999 && eyeDepth >= blocker - 0.8) break;
    }

    float densitySample = smoothstep(uThresholdLow * 0.42, uThresholdHigh, value);
    float isoBand = 1.0 - smoothstep(0.0, max(uIsoThickness, 0.003), abs(value - uIsoValue));
    if (!hitIso && isoBand > 0.10) hitIso = true;

    float contribution = densitySample;
    if (uRenderMode == 1) contribution = isoBand;
    if (uRenderMode == 2) contribution = max(densitySample * 0.76, isoBand * 0.98);

    vec3 color = transfer(value);
    vec3 normal = estimateNormal(p);
    float diffuse = 0.56 + 0.44 * max(dot(normal, lightDir), 0.0);
    float depth01 = clamp((p.z - uBoxMin.z) / max(uBoxMax.z - uBoxMin.z, 1.0), 0.0, 1.0);
    float depthFade = mix(1.08, 0.76, depth01);
    color *= diffuse * depthFade;
    if (isoBand > 0.08) color = mix(color, vec3(1.0, 0.92, 0.38), isoBand * 0.72);

    float alpha = 1.0 - exp(-contribution * uDensity * stepLength * 0.00245);
    if (alpha < 0.001) continue;
    if (firstDepth >= DEPTH_SCALE) firstDepth = eyeDepth;
    accumColor += (1.0 - accumAlpha) * color * alpha;
    accumAlpha += (1.0 - accumAlpha) * alpha;
  }

  if (accumAlpha < 0.004) discard;
  float edge = smoothstep(0.0, 0.14, accumAlpha);
  outColor = vec4(accumColor / max(accumAlpha, 0.001), clamp(accumAlpha * edge, 0.0, 0.96));
  float depth01 = firstDepth >= DEPTH_SCALE ? 1.0 : clamp(firstDepth / DEPTH_SCALE, 0.0, 1.0);
  outLinearDepth = packDepth32(depth01);
}`

// 直接绘制路径只输出颜色；此前 `//` 单行注释曾把这个声明吞掉，导致
// `fragmentShader: directFragmentShader` 在运行时 ReferenceError。这里明确使用
// 真正的多行代码块注释，并把变量放在独立源码行，避免再次发生同类问题。
const directFragmentShader = fragmentShader

const volumeCopyVertex = `out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

const volumeCopyFragment = `precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uColor;
void main() {
  outColor = texture(uColor, vUv);
}`

export interface VolumeAtlasBinding {
  texture: THREE.Texture
  nx: number
  ny: number
  nz: number
}

export interface VolumeRenderState {
  renderMode: 'volume' | 'iso' | 'hybrid'
  isoValue: number
  isoThickness: number
  clipEnabled: boolean
  clipDepth: number
}

export class VolumeRenderer {
  readonly mesh: THREE.Mesh
  readonly scene: THREE.Scene
  private readonly directScene: THREE.Scene
  private directMesh!: THREE.Mesh
  private readonly copyScene: THREE.Scene
  private readonly copyMaterial: THREE.ShaderMaterial
  private readonly copyMesh: THREE.Mesh
  readonly renderTarget: THREE.WebGLRenderTarget
  private readonly texture3D: THREE.Data3DTexture
  private readonly data: Uint8Array
  private readonly material: THREE.ShaderMaterial
  private readonly directMaterial: THREE.ShaderMaterial
  private readonly camera: THREE.OrthographicCamera
  private readonly cesiumDepthExternalTexture = new THREE.ExternalTexture()
  private readonly grid: GridSpec
  private volumeResolutionScale = 0.78

  constructor(renderer: THREE.WebGLRenderer, grid: GridSpec, initialField8: Uint8Array) {
    void renderer
    this.grid = grid
    this.scene = new THREE.Scene()
    this.directScene = new THREE.Scene()
    this.copyScene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    this.data = new Uint8Array(initialField8.length)
    this.data.set(initialField8)
    this.texture3D = new THREE.Data3DTexture(this.data, grid.nx, grid.ny, grid.nz)
    this.texture3D.format = THREE.RedFormat
    this.texture3D.type = THREE.UnsignedByteType
    this.texture3D.minFilter = THREE.LinearFilter
    this.texture3D.magFilter = THREE.LinearFilter
    this.texture3D.unpackAlignment = 1
    this.texture3D.needsUpdate = true

    this.renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      count: 2,
    })
    this.renderTarget.textures[0].colorSpace = THREE.NoColorSpace
    this.renderTarget.textures[1].colorSpace = THREE.NoColorSpace

    const geometry = new THREE.PlaneGeometry(2, 2)
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uVolume: { value: this.texture3D },
        uAtlas: { value: null },
        uOcclusionDepth: { value: null },
        uUseAtlas: { value: 0 },
        uAtlasGrid: { value: new THREE.Vector3(grid.nx, grid.ny, grid.nz) },
        uCameraLocal: { value: new THREE.Vector3() },
        uBoxMin: { value: new THREE.Vector3(-grid.sizeX * 0.5, -grid.sizeY * 0.5, -grid.depth) },
        uBoxMax: { value: new THREE.Vector3(grid.sizeX * 0.5, grid.sizeY * 0.5, grid.surfaceHeight) },
        uThresholdLow: { value: 0.08 },
        uThresholdHigh: { value: 0.42 },
        uIsoValue: { value: 0.58 },
        uIsoThickness: { value: 0.026 },
        uDensity: { value: 1.32 },
        uStepScale: { value: 1.0 },
        uTime: { value: 0 },
        uClipEnabled: { value: 0 },
        uClipPlane: { value: new THREE.Vector4(0, 0, 1, -grid.surfaceHeight + grid.depth) },
        uRenderMode: { value: 2 },
        uUseOcclusionDepth: { value: 0 },
        uTargetSize: { value: new THREE.Vector2(1280, 720) },
        uInvProjection: { value: new THREE.Matrix4() },
        uCameraWorld: { value: new THREE.Matrix4() },
        uView: { value: new THREE.Matrix4() },
      },
      vertexShader,
      fragmentShader,
      glslVersion: THREE.GLSL3,
      transparent: false,
      depthWrite: false,
      depthTest: false,
      side: THREE.FrontSide,
    })
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
    this.directMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uVolume: { value: this.texture3D },
        uAtlas: { value: null },
        uOcclusionDepth: { value: null },
        uUseAtlas: { value: 0 },
        uAtlasGrid: { value: new THREE.Vector3(grid.nx, grid.ny, grid.nz) },
        uCameraLocal: { value: new THREE.Vector3() },
        uBoxMin: { value: new THREE.Vector3(-grid.sizeX * 0.5, -grid.sizeY * 0.5, -grid.depth) },
        uBoxMax: { value: new THREE.Vector3(grid.sizeX * 0.5, grid.sizeY * 0.5, grid.surfaceHeight) },
        uThresholdLow: { value: 0.08 },
        uThresholdHigh: { value: 0.42 },
        uIsoValue: { value: 0.58 },
        uIsoThickness: { value: 0.026 },
        uDensity: { value: 1.32 },
        uStepScale: { value: 1.0 },
        uTime: { value: 0 },
        uClipEnabled: { value: 0 },
        uClipPlane: { value: new THREE.Vector4(0, 0, 1, -grid.surfaceHeight + grid.depth) },
        uRenderMode: { value: 2 },
        uUseOcclusionDepth: { value: 0 },
        uTargetSize: { value: new THREE.Vector2(1280, 720) },
        uInvProjection: { value: new THREE.Matrix4() },
        uCameraWorld: { value: new THREE.Matrix4() },
        uView: { value: new THREE.Matrix4() },
      },
      vertexShader,
      fragmentShader: directFragmentShader,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
      side: THREE.FrontSide,
    })
    const directGeometry = new THREE.PlaneGeometry(2, 2)
    this.directMesh = new THREE.Mesh(directGeometry, this.directMaterial)
    this.directMesh.frustumCulled = false
    this.directScene.add(this.directMesh)

    this.copyMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.renderTarget.textures[0] } },
      vertexShader: volumeCopyVertex,
      fragmentShader: volumeCopyFragment,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    })
    this.copyMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMaterial)
    this.copyMesh.frustumCulled = false
    this.copyScene.add(this.copyMesh)
    this.setSize(1280, 720)
  }

  get colorTexture(): THREE.Texture { return this.renderTarget.textures[0] }
  get linearDepthTexture(): THREE.Texture { return this.renderTarget.textures[1] }
  get fallbackTexture(): THREE.Data3DTexture { return this.texture3D }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width * this.volumeResolutionScale))
    const h = Math.max(1, Math.floor(height * this.volumeResolutionScale))
    if (w === this.renderTarget.width && h === this.renderTarget.height) return
    this.renderTarget.setSize(w, h)
    this.material.uniforms.uTargetSize.value.set(w, h)
    this.directMaterial.uniforms.uTargetSize.value.set(w, h)
  }

  setResolutionScale(value: number): void {
    this.volumeResolutionScale = THREE.MathUtils.clamp(value, 0.45, 1.0)
  }

  bindAtlas(binding: VolumeAtlasBinding): void {
    for (const material of [this.material, this.directMaterial]) {
      material.uniforms.uAtlas.value = binding.texture
      material.uniforms.uAtlasGrid.value.set(binding.nx, binding.ny, binding.nz)
      material.uniforms.uUseAtlas.value = 1
    }
  }

  useCpuTexture(): void {
    for (const material of [this.material, this.directMaterial]) {
      material.uniforms.uUseAtlas.value = 0
      material.uniforms.uAtlas.value = null
    }
  }

  updateField(field8: Uint8Array): void {
    this.data.set(field8)
    this.texture3D.needsUpdate = true
    this.useCpuTexture()
  }

  bindCesiumOcclusionDepth(webglTexture: WebGLTexture | null): void {
    this.cesiumDepthExternalTexture.sourceTexture = webglTexture
    for (const material of [this.material, this.directMaterial]) {
      material.uniforms.uOcclusionDepth.value = webglTexture ? this.cesiumDepthExternalTexture : null
      material.uniforms.uUseOcclusionDepth.value = webglTexture ? 1 : 0
    }
  }

  updateCamera(cameraLocal: THREE.Vector3, camera?: THREE.PerspectiveCamera): void {
    this.material.uniforms.uCameraLocal.value.copy(cameraLocal)
    this.directMaterial.uniforms.uCameraLocal.value.copy(cameraLocal)
    if (camera) {
      camera.updateMatrixWorld(true)
      const invProjection = camera.projectionMatrixInverse
      for (const material of [this.material, this.directMaterial]) {
        material.uniforms.uInvProjection.value.copy(invProjection)
        material.uniforms.uCameraWorld.value.copy(camera.matrixWorld)
        material.uniforms.uView.value.copy(camera.matrixWorldInverse)
      }
    }
  }

  updateTime(timeSeconds: number): void {
    this.material.uniforms.uTime.value = timeSeconds * 1000
    this.directMaterial.uniforms.uTime.value = timeSeconds * 1000
  }

  setThreshold(low: number, high: number): void {
    for (const material of [this.material, this.directMaterial]) {
      material.uniforms.uThresholdLow.value = low
      material.uniforms.uThresholdHigh.value = Math.max(high, low + 0.01)
    }
  }

  setDensity(value: number): void { this.material.uniforms.uDensity.value = value; this.directMaterial.uniforms.uDensity.value = value }

  /**
   * 纵向夸张：保持体数据垂向中心位置不变，围绕中心对称地拉伸 scale 倍。
   * 放大时顶部与底部同时向外扩展，缩小时同时向内收拢。
   */
  setVerticalScale(scale: number): void {
    const s = THREE.MathUtils.clamp(Number.isFinite(scale) ? scale : 1, 0.02, 20)
    const top = this.grid.surfaceHeight
    const bottom = -this.grid.depth
    const center = (top + bottom) * 0.5
    const half = (top - bottom) * 0.5
    const scaledTop = center + half * s
    const scaledBottom = center - half * s
    for (const material of [this.material, this.directMaterial]) {
      material.uniforms.uBoxMax.value.z = scaledTop
      material.uniforms.uBoxMin.value.z = scaledBottom
    }
  }

  setScientificState(state: VolumeRenderState): void {
    const modeMap = { volume: 0, iso: 1, hybrid: 2 } as const
    const mode = modeMap[state.renderMode]
    const isoValue = THREE.MathUtils.clamp(state.isoValue, 0, 1)
    const isoThickness = THREE.MathUtils.clamp(state.isoThickness, 0.002, 0.12)
    const clipEnabled = state.clipEnabled ? 1 : 0
    const clipZ = this.grid.surfaceHeight - THREE.MathUtils.clamp(state.clipDepth, 0, this.grid.depth + this.grid.surfaceHeight)
    for (const material of [this.material, this.directMaterial]) {
      material.uniforms.uRenderMode.value = mode
      material.uniforms.uIsoValue.value = isoValue
      material.uniforms.uIsoThickness.value = isoThickness
      material.uniforms.uClipEnabled.value = clipEnabled
      material.uniforms.uClipPlane.value.set(0, 0, 1, -clipZ)
    }
  }

  warmup(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    renderer.compile(this.directScene, camera)
    renderer.compile(this.copyScene, camera)
  }

  renderToTarget(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    renderer.setRenderTarget(this.renderTarget)
    renderer.setClearColor(0, 0)
    renderer.clear(true, false, false)
    renderer.render(this.scene, camera)
    renderer.setRenderTarget(null)
  }

  renderDirect(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    // 先在低分辨率 Offscreen RenderTarget 做高成本 ray marching，再用一次廉价 fullscreen copy
    // 回到 Cesium 默认 framebuffer，显著降低体渲染每帧的 fragment 采样量。
    renderer.setRenderTarget(this.renderTarget)
    renderer.setScissorTest(false)
    renderer.setViewport(0, 0, this.renderTarget.width, this.renderTarget.height)
    renderer.setClearColor(0, 0)
    renderer.clear(true, false, false)
    renderer.render(this.directScene, camera)

    renderer.setRenderTarget(null)
    renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height)
    renderer.setClearColor(0, 0)
    renderer.render(this.copyScene, camera)
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible
    this.directMesh.visible = visible
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.directMaterial.dispose()
    this.copyMesh.geometry.dispose()
    this.copyMaterial.dispose()
    this.texture3D.dispose()
    this.renderTarget.dispose()
  }
}
