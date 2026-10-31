export const IRRADIANCE_TEXTURE_WIDTH = 64
export const IRRADIANCE_TEXTURE_HEIGHT = 16
export const SCATTERING_TEXTURE_R_SIZE = 32
export const SCATTERING_TEXTURE_MU_SIZE = 128
export const SCATTERING_TEXTURE_MU_S_SIZE = 32
export const SCATTERING_TEXTURE_NU_SIZE = 8
export const SCATTERING_TEXTURE_WIDTH =
  SCATTERING_TEXTURE_NU_SIZE * SCATTERING_TEXTURE_MU_S_SIZE
export const SCATTERING_TEXTURE_HEIGHT = SCATTERING_TEXTURE_MU_SIZE
export const SCATTERING_TEXTURE_DEPTH = SCATTERING_TEXTURE_R_SIZE
export const TRANSMITTANCE_TEXTURE_WIDTH = 256
export const TRANSMITTANCE_TEXTURE_HEIGHT = 64
export const METER_TO_LENGTH_UNIT = 1 / 1000
export const SKY_RENDER_ORDER = 100

export const STBN_TEXTURE_WIDTH = 128
export const STBN_TEXTURE_HEIGHT = 128
export const STBN_TEXTURE_DEPTH = 64

const ref = '82e00c5222d6cbc222af69abdf6d3f4fc9f63030'
export const DEFAULT_PRECOMPUTED_TEXTURES_URL = `https://media.githubusercontent.com/media/takram-design-engineering/three-geospatial/${ref}/packages/atmosphere/assets`
export const DEFAULT_STARS_DATA_URL = `https://media.githubusercontent.com/media/takram-design-engineering/three-geospatial/${ref}/packages/atmosphere/assets/stars.bin`


export const CLOUD_SHAPE_TEXTURE_SIZE = 128
export const CLOUD_SHAPE_DETAIL_TEXTURE_SIZE = 32

const ref2 = '45a1c6c1bb9fd38b3680fd120795ff4c32df68ff'
export const DEFAULT_LOCAL_WEATHER_URL = `https://media.githubusercontent.com/media/takram-design-engineering/three-geospatial/${ref2}/packages/clouds/assets/local_weather.png`
export const DEFAULT_SHAPE_URL = `https://media.githubusercontent.com/media/takram-design-engineering/three-geospatial/${ref2}/packages/clouds/assets/shape.bin`
export const DEFAULT_SHAPE_DETAIL_URL = `https://media.githubusercontent.com/media/takram-design-engineering/three-geospatial/${ref2}/packages/clouds/assets/shape_detail.bin`
export const DEFAULT_TURBULENCE_URL = `https://media.githubusercontent.com/media/takram-design-engineering/three-geospatial/${ref2}/packages/clouds/assets/turbulence.png`

export default {};