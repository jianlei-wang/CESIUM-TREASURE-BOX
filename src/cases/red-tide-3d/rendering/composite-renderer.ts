import * as THREE from 'three'

const compositeVertex = `#version 300 es
out vec2 vUv;
void main() {
  vec2 position;
  if (gl_VertexID == 0) position = vec2(-1.0, -1.0);
  else if (gl_VertexID == 1) position = vec2(3.0, -1.0);
  else position = vec2(-1.0, 3.0);
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`

const compositeFragment = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uVolumeColor;
uniform sampler2D uVolumeDepth;
uniform sampler2D uOverlayColor;
uniform sampler2D uOverlayDepth;
uniform sampler2D uCesiumDepth;
uniform float uHasCesiumDepth;
uniform float uHasOverlay;
uniform float uHasVolume;
uniform float uOverlayNear;
uniform float uOverlayFar;
uniform float uDepthScale;
uniform float uDepthBias;
uniform float uOpacity;

float unpackDepth32(vec4 value) {
  return dot(value, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
}

float linearizeThreeDepth(float depth01) {
  if (depth01 >= 0.999999) return 2000000.0;
  float z = depth01 * 2.0 - 1.0;
  return (2.0 * uOverlayNear * uOverlayFar) / max(1e-5, uOverlayFar + uOverlayNear - z * (uOverlayFar - uOverlayNear));
}

bool visibleAgainstCesium(float depth01) {
  if (uHasCesiumDepth < 0.5) return true;
  float sceneDepth01 = unpackDepth32(texture(uCesiumDepth, vUv));
  float sceneDepth = sceneDepth01 * uDepthScale;
  return depth01 * uDepthScale <= sceneDepth + uDepthBias;
}

vec4 alphaOver(vec4 foreground, vec4 background) {
  float a = foreground.a + background.a * (1.0 - foreground.a);
  if (a < 0.0001) return vec4(0.0);
  vec3 rgb = (foreground.rgb * foreground.a + background.rgb * background.a * (1.0 - foreground.a)) / a;
  return vec4(rgb, a);
}

void main() {
  vec4 volume = uHasVolume > 0.5 ? texture(uVolumeColor, vUv) : vec4(0.0);
  float volumeDepth = uHasVolume > 0.5 ? unpackDepth32(texture(uVolumeDepth, vUv)) * uDepthScale : 2000000.0;
  vec4 overlay = uHasOverlay > 0.5 ? texture(uOverlayColor, vUv) : vec4(0.0);
  float overlayDepth01 = uHasOverlay > 0.5 ? texture(uOverlayDepth, vUv).r : 1.0;
  float overlayDepth = linearizeThreeDepth(overlayDepth01);

  if (!visibleAgainstCesium(volumeDepth / uDepthScale)) volume = vec4(0.0);
  if (!visibleAgainstCesium(overlayDepth / uDepthScale)) overlay = vec4(0.0);

  // 三维体 shader 已输出预乘风格颜色，这里恢复为直通 alpha 颜色后再排序合成。
  if (volume.a > 0.0001) volume.rgb /= volume.a;
  volume.a = clamp(volume.a * uOpacity, 0.0, 1.0);

  vec4 combined;
  if (overlay.a < 0.0001) {
    combined = volume;
  } else if (volume.a < 0.0001) {
    combined = overlay;
  } else if (overlayDepth <= volumeDepth) {
    combined = alphaOver(overlay, volume);
  } else {
    combined = alphaOver(volume, overlay);
  }

  if (combined.a < 0.001) discard;
  outColor = combined;
}`

interface CompositeInputs {
  volumeColor: WebGLTexture | null
  volumeDepth: WebGLTexture | null
  overlayColor: WebGLTexture | null
  overlayDepth: WebGLTexture | null
  cesiumDepth: WebGLTexture | null
  hasVolume: boolean
  hasOverlay: boolean
  hasCesiumDepth: boolean
}

export class DepthAwareCompositeRenderer {
  private readonly renderer: THREE.WebGLRenderer
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly vertexShader: WebGLShader
  private readonly fragmentShader: WebGLShader
  private readonly vao: WebGLVertexArrayObject
  private readonly locations = new Map<string, WebGLUniformLocation | null>()
  private disposed = false

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    const gl = renderer.getContext()
    if (!(gl instanceof WebGL2RenderingContext)) {
      throw new Error('深度复合器要求 WebGL2。')
    }
    this.gl = gl
    this.vertexShader = this.compile(gl.VERTEX_SHADER, compositeVertex)
    this.fragmentShader = this.compile(gl.FRAGMENT_SHADER, compositeFragment)
    this.program = this.link(this.vertexShader, this.fragmentShader)
    this.vao = gl.createVertexArray() ?? (() => { throw new Error('无法创建 composite VAO。') })()
    gl.bindVertexArray(this.vao)
    gl.bindVertexArray(null)

    for (const name of [
      'uVolumeColor', 'uVolumeDepth', 'uOverlayColor', 'uOverlayDepth', 'uCesiumDepth',
      'uHasCesiumDepth', 'uHasOverlay', 'uHasVolume', 'uOverlayNear', 'uOverlayFar', 'uDepthScale', 'uDepthBias', 'uOpacity',
    ]) {
      this.locations.set(name, gl.getUniformLocation(this.program, name))
    }
  }

  render(inputs: CompositeInputs, near: number, far: number, biasMeters = 1.25, opacity = 1): void {
    if (this.disposed) return
    const gl = this.gl
    const width = this.renderer.domElement.width
    const height = this.renderer.domElement.height

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    gl.disable(gl.DEPTH_TEST)
    gl.depthMask(false)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.SCISSOR_TEST)
    gl.disable(gl.STENCIL_TEST)
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)

    this.bindTexture(0, inputs.volumeColor)
    this.uniform1i('uVolumeColor', 0)
    this.bindTexture(1, inputs.volumeDepth)
    this.uniform1i('uVolumeDepth', 1)
    this.bindTexture(2, inputs.overlayColor)
    this.uniform1i('uOverlayColor', 2)
    this.bindTexture(3, inputs.overlayDepth)
    this.uniform1i('uOverlayDepth', 3)
    this.bindTexture(4, inputs.cesiumDepth)
    this.uniform1i('uCesiumDepth', 4)

    this.uniform1f('uHasCesiumDepth', inputs.hasCesiumDepth ? 1 : 0)
    this.uniform1f('uHasOverlay', inputs.hasOverlay ? 1 : 0)
    this.uniform1f('uHasVolume', inputs.hasVolume ? 1 : 0)
    this.uniform1f('uOverlayNear', near)
    this.uniform1f('uOverlayFar', far)
    this.uniform1f('uDepthScale', 2000000)
    this.uniform1f('uDepthBias', biasMeters)
    this.uniform1f('uOpacity', opacity)

    gl.drawArrays(gl.TRIANGLES, 0, 3)

    gl.bindVertexArray(null)
    gl.useProgram(null)
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.disable(gl.BLEND)
    gl.depthMask(true)
    this.renderer.resetState()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.program)
    gl.deleteShader(this.vertexShader)
    gl.deleteShader(this.fragmentShader)
  }

  private bindTexture(unit: number, texture: WebGLTexture | null): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
  }

  private uniform1i(name: string, value: number): void {
    const location = this.locations.get(name)
    if (location) this.gl.uniform1i(location, value)
  }

  private uniform1f(name: string, value: number): void {
    const location = this.locations.get(name)
    if (location) this.gl.uniform1f(location, value)
  }

  private compile(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type) ?? (() => { throw new Error('无法创建 composite shader。') })()
    this.gl.shaderSource(shader, source)
    this.gl.compileShader(shader)
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader) ?? 'unknown shader error'
      this.gl.deleteShader(shader)
      throw new Error(`Composite shader 编译失败：${info}`)
    }
    return shader
  }

  private link(vertex: WebGLShader, fragment: WebGLShader): WebGLProgram {
    const program = this.gl.createProgram() ?? (() => { throw new Error('无法创建 composite program。') })()
    this.gl.attachShader(program, vertex)
    this.gl.attachShader(program, fragment)
    this.gl.linkProgram(program)
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const info = this.gl.getProgramInfoLog(program) ?? 'unknown program error'
      this.gl.deleteProgram(program)
      throw new Error(`Composite program 链接失败：${info}`)
    }
    return program
  }
}

export function getThreeTextureHandle(renderer: THREE.WebGLRenderer, texture: THREE.Texture | null): WebGLTexture | null {
  if (!texture) return null
  const properties = renderer.properties.get(texture as unknown as THREE.Texture & { isTexture: true }) as unknown as { __webglTexture?: WebGLTexture }
  return properties.__webglTexture ?? null
}
