uniform vec2 resolution;
uniform int frame;
uniform sampler3D stbnTexture;

// Atmosphere
uniform float bottomRadius;
uniform mat4 worldToECEFMatrix;
uniform mat4 ecefToWorldMatrix;
uniform vec3 altitudeCorrection;
uniform vec3 sunDirection;

// Participating medium
uniform float scatteringCoefficient;
uniform float absorptionCoefficient;

// Primary raymarch
uniform float minDensity;
uniform float minExtinction;
uniform float minTransmittance;

// Shape and weather（spec §4/§5.3：2D PNG → 时间切片 3D atlas）
uniform sampler3D weatherAtlasTexture;
uniform vec2 localWeatherRepeat;
uniform vec2 localWeatherOffset;
uniform float coverage;
// WeatherAtlas 运行时调制（CPU float64 mod 后传入，spec §4.1 精度陷阱）
uniform vec2 u_windOffset;      // 平流偏移，tile 单位 mod 1，加在 uv×repeat 后
uniform float u_atlasT;         // 演化相位 tNorm ∈[0,1)，3D 纹理 z 坐标
uniform float u_itczCenterSin;  // ITCZ 中心纬度正弦（CPU 按 doy 公式算）
uniform float u_climateBands;   // 气候带强度 0=关 1=默认（spec §6.1）
uniform float u_climateBandsFloor; // band 下限 clamp（T6 spec §5.4：预设激活 0.6/缺省 0.2，CPU 侧 setWeatherPreset 驱动）
uniform sampler3D shapeTexture;
uniform vec3 shapeRepeat;
uniform vec3 shapeOffset;
// P1 云内纹理风平流（纹理域 mod 1，CPU float64 mod 后传入——与 u_windOffset 同款精度铁律）
uniform vec3 u_shapeWindOffset;

#ifdef SHAPE_DETAIL
uniform sampler3D shapeDetailTexture;
uniform vec3 shapeDetailRepeat;
uniform vec3 shapeDetailOffset;
uniform vec3 u_detailWindOffset;
#endif // SHAPE_DETAIL

#ifdef TURBULENCE
uniform sampler2D turbulenceTexture;
uniform vec2 turbulenceRepeat;
uniform float turbulenceDisplacement;
#endif // TURBULENCE

// Haze
#ifdef HAZE
uniform float hazeDensityScale;
uniform float hazeExponent;
uniform float hazeScatteringCoefficient;
uniform float hazeAbsorptionCoefficient;
#endif // HAZE

// Cloud layers
uniform vec4 minLayerHeights;
uniform vec4 maxLayerHeights;
uniform vec3 minIntervalHeights;
uniform vec3 maxIntervalHeights;
uniform vec4 densityScales;
uniform vec4 shapeAmounts;
uniform vec4 shapeDetailAmounts;
uniform vec4 weatherExponents;
uniform vec4 shapeAlteringBiases;
uniform vec4 coverageFilterWidths;
uniform float minHeight;
uniform float maxHeight;
uniform float shadowTopHeight;
uniform float shadowBottomHeight;
uniform vec4 shadowLayerMask;
uniform CloudDensityProfile densityProfile;
