// 物理常量逐字取自 three-geospatial AtmosphereParameters.DEFAULT（见源仓库
// packages/atmosphere/src/AtmosphereParameters.ts）。bottomRadius/topRadius 已乘
// METER_TO_LENGTH_UNIT (1/1000) → km。
//
// 关键：源仓库用 `uniform AtmosphereParameters ATMOSPHERE;`（three 自动展开
// ATMOSPHERE.field 的 uniform location）。Cesium PostProcessStage 的 uniformMap
// 不支持嵌套 struct / struct 数组（DensityProfile 含 layers[2]），故这里改为
// GLSL `const` 构造注入。GLSL ES 3.00 struct 数组成员构造用 `Layer[2](a, b)`。
// 这是 G1 编译验证的关键语法点。
export const ATMOSPHERE_DEFAULT_GLSL = `const AtmosphereParameters ATMOSPHERE = AtmosphereParameters(
  IrradianceSpectrum(1.474, 1.8504, 1.91198),
  0.004675,
  6360.0,
  6420.0,
  DensityProfile(DensityProfileLayer[2](
    DensityProfileLayer(0.0, 0.0, 0.0, 0.0, 0.0),
    DensityProfileLayer(0.0, 1.0, -0.125, 0.0, 0.0)
  )),
  ScatteringSpectrum(0.005802, 0.013558, 0.0331),
  DensityProfile(DensityProfileLayer[2](
    DensityProfileLayer(0.0, 0.0, 0.0, 0.0, 0.0),
    DensityProfileLayer(0.0, 1.0, -0.833333, 0.0, 0.0)
  )),
  ScatteringSpectrum(0.003996, 0.003996, 0.003996),
  ScatteringSpectrum(0.00444, 0.00444, 0.00444),
  0.8,
  DensityProfile(DensityProfileLayer[2](
    DensityProfileLayer(25.0, 0.0, 0.0, 0.06666667, -0.66666667),
    DensityProfileLayer(0.0, 0.0, 0.0, -0.06666667, 2.66666667)
  )),
  ScatteringSpectrum(0.00065, 0.001881, 0.000085),
  DimensionlessSpectrum(0.1, 0.1, 0.1),
  -0.5
);`

// CPU 侧需要的标量（密切球校正、cosSunAngularRadius 等）
export const ATMOSPHERE_BOTTOM_RADIUS_M = 6360000
export const ATMOSPHERE_TOP_RADIUS_M = 6420000
export const SUN_ANGULAR_RADIUS = 0.004675
