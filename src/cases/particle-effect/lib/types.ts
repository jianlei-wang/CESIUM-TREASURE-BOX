export type ParticleEmitter = {
  lon: number
  lat: number
  height: number
}

export type ParticleBlendMode = 'additive' | 'alpha'

export type ParticleInitializer = 'emitter' | 'sphere'
export type ParticleStyle = 'fire' | 'noise-cloud'

export type ParticleEffectOptions = {
  size: number
  emitter: ParticleEmitter
  colors: string[]
  blendMode: ParticleBlendMode
  lifetime: [number, number]
  initialSpeed: [number, number]
  coneAngle: number
  gravity: number
  drag: number
  turbulence: number
  lift: number
  emissionRate: number
  continuous: boolean
  pointSize: [number, number]
  pointGrowth: number
  emitterRadius: number
  heightScale: number
  initializer: ParticleInitializer
  emitAll: boolean
  displayRange: [number, number]
  style: ParticleStyle
  noiseScale: number
  noiseDetail: number
  cloudDensity: number
  smokeAmount: number
  cloudRadius: number
  edgeSoftness: number
  colorFrequency: number
}

export type ParticleSystemTextures = {
  currentPosition: import('cesium').Texture
  nextPosition: import('cesium').Texture
  currentVelocity: import('cesium').Texture
  nextVelocity: import('cesium').Texture
}
