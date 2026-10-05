import * as THREE from 'three'
import type { GridSpec } from '@rt/types/model'

export type ParticleStyle = 'star' | 'arrow' | 'diamond' | 'ring'

export class FlowParticleRenderer {
  readonly points: THREE.Points
  private readonly positions: Float32Array
  private readonly intensities: Float32Array
  private readonly geometry: THREE.BufferGeometry
  private readonly count: number
  private readonly grid: GridSpec
  private readonly material: THREE.ShaderMaterial
  private readonly baseSize = 16
  private style: ParticleStyle = 'star'

  constructor(scene: THREE.Scene, grid: GridSpec, initialPositions: Float32Array, initialIntensities: Float32Array, count = 5200) {
    this.count = count
    this.grid = grid
    this.positions = new Float32Array(count * 3)
    this.intensities = new Float32Array(count)
    this.geometry = new THREE.BufferGeometry()

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('aIntensity', new THREE.BufferAttribute(this.intensities, 1))
    this.updateParticleData(initialPositions, initialIntensities)

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uSize: { value: this.baseSize },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uOpacity: { value: 0.74 },
        uStyle: { value: 0 },
      },
      vertexShader: `
        attribute float aIntensity;
        varying float vIntensity;
        varying float vAngle;
        uniform float uSize;
        uniform float uPixelRatio;
        void main() {
          vIntensity = aIntensity;
          vAngle = atan(position.y, position.x);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(uSize * uPixelRatio, 7.0, 26.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vIntensity;
        varying float vAngle;
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
          vec2 p = gl_PointCoord - vec2(0.5);
          float a = 0.0;
          if (uStyle == 0) {
            float star = max(abs(p.x), abs(p.y)) + 0.30 * min(abs(p.x),abs(p.y));
            a = 1.0 - smoothstep(0.16, 0.48, star);
          } else if (uStyle == 1) {
            float c = cos(-vAngle), s = sin(-vAngle);
            vec2 q = vec2(c*p.x - s*p.y, s*p.x + c*p.y);
            float shaft = 1.0 - smoothstep(0.045,0.11,abs(q.y));
            float body = 1.0 - smoothstep(0.40,0.49,abs(q.x));
            float head = step(0.04,q.x) * (1.0 - smoothstep(0.02,0.46,abs(q.y)+abs(q.x-0.15)));
            a = max(shaft*body, head);
          } else if (uStyle == 2) {
            a = 1.0 - smoothstep(0.32,0.50,abs(p.x)+abs(p.y));
          } else {
            a = 1.0 - smoothstep(0.035,0.09,abs(length(p)-0.25));
          }
          if (a < 0.02) discard;
          vec3 color = stepColor(vIntensity);
          float glow = 1.0 - smoothstep(0.10,0.50,length(p));
          gl_FragColor = vec4(color, a * glow * uOpacity);
        }
      `,
    })

    this.points = new THREE.Points(this.geometry, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = 25
    scene.add(this.points)
  }

  updateParticleData(sourcePositions: Float32Array, sourceIntensities: Float32Array): void {
    const max = Math.min(this.count, Math.floor(sourcePositions.length / 3), sourceIntensities.length)
    for (let i = 0; i < max; i += 1) {
      const gx = sourcePositions[i * 3]
      const gy = sourcePositions[i * 3 + 1]
      const gz = sourcePositions[i * 3 + 2]
      this.positions[i * 3] = (gx / Math.max(this.grid.nx - 1, 1) - 0.5) * this.grid.sizeX
      this.positions[i * 3 + 1] = (gy / Math.max(this.grid.ny - 1, 1) - 0.5) * this.grid.sizeY
      this.positions[i * 3 + 2] = this.grid.surfaceHeight - (gz / Math.max(this.grid.nz - 1, 1)) * (this.grid.depth + this.grid.surfaceHeight)
      this.intensities[i] = sourceIntensities[i]
    }
    for (let i = max; i < this.count; i += 1) {
      this.intensities[i] = 0
    }
    const posAttribute = this.geometry.getAttribute('position') as THREE.BufferAttribute
    const intensityAttribute = this.geometry.getAttribute('aIntensity') as THREE.BufferAttribute
    posAttribute.needsUpdate = true
    intensityAttribute.needsUpdate = true
  }

  setVisible(visible: boolean): void {
    this.points.visible = visible
  }

  setStyle(style: ParticleStyle): void {
    this.style = style
    const map = { star: 0, arrow: 1, diamond: 2, ring: 3 } as const
    this.material.uniforms.uStyle.value = map[style]
  }

  setOpacity(value: number): void {
    this.material.uniforms.uOpacity.value = value
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
