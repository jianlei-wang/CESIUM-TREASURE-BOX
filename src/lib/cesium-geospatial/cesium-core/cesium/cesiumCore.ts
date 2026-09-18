import { glslIndex } from '../glslIndex'
import { ATMOSPHERE_DEFAULT_GLSL } from '../math/atmosphereParameters'

// 所有大气 shader 的公共前缀：precision + 纹理尺寸 #define + COMBINED_SCATTERING_TEXTURES +
// bruneton definitions（AtmosphereParameters struct 定义）+ const ATMOSPHERE。
// 顺序关键：const ATMOSPHERE 必须在 definitions（struct 定义）之后。
// 值逐字取自 three-geospatial atmosphere/constants.ts 与 AtmosphereMaterialBase.defines。
export function buildAtmospherePrefix(): string {
  return [
    'precision highp float;',
    'precision highp sampler3D;',
    '#define PI 3.14159265358979323846',
    '#define TRANSMITTANCE_TEXTURE_WIDTH 256',
    '#define TRANSMITTANCE_TEXTURE_HEIGHT 64',
    '#define SCATTERING_TEXTURE_R_SIZE 32',
    '#define SCATTERING_TEXTURE_MU_SIZE 128',
    '#define SCATTERING_TEXTURE_MU_S_SIZE 32',
    '#define SCATTERING_TEXTURE_NU_SIZE 8',
    '#define IRRADIANCE_TEXTURE_WIDTH 64',
    '#define IRRADIANCE_TEXTURE_HEIGHT 16',
    '#define METER_TO_LENGTH_UNIT 0.0010000',
    '#define COMBINED_SCATTERING_TEXTURES',
    // C9（spec 附录 E2/E3 + r2 F1）：启用 higher-order scattering 分支，云 god rays 走
    // bruneton/runtime.glsl 物理正确路径（只遮 single Rayleigh 保留多阶），防过暗黑。
    '#define HAS_HIGHER_ORDER_SCATTERING_TEXTURE',
    glslIndex.bruneton.definitions,
    ATMOSPHERE_DEFAULT_GLSL
  ].join('\n')
}
