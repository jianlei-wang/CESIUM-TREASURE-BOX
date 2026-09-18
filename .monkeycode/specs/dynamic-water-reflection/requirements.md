# Requirements Document

## Introduction

基于 Arc3DLab-SDK-Pro 参考项目移植"动态水面（带倒影）"案例（对应参考 `011-动态水面（带倒影）.html`），使用 `WaterPrimitive` 的镜像虚拟相机、帧缓冲离屏渲染与自定义 GLSL 水面材质，在当前 Cesium 案例中心中呈现丽江水域场景、波纹、反射、光照、高光与浮动盒子参数控制。

## Glossary

- **水面 Primitive**：基于 `PolygonGeometry` 与 `MaterialAppearance` 构建的 Cesium `Primitive`，其材质片元着色器采样离屏反射纹理与法线纹理生成水面视觉。
- **倒影**：水面材质通过镜像虚拟相机将场景渲染至帧缓冲 `colorTexture`，再按法线扰动采样该纹理形成的反射视觉。
- **反射条**：迭代历史中用于表现倒影的水面反射条视觉（V3.35），本次移植沿用真实倒影 Primitive 方案，不再使用反射条。
- **镜像虚拟相机**：相对水面反射平面对主相机位置、方向与上向量进行镜像后得到的虚拟相机，用于离屏反射渲染。
- **浮动盒子**：位于丽江水域上方、按时钟周期移动与旋转的半透明立方体实体。
- **水面高度**：水面 Primitive 顶面所在椭球高度（米），参考场景默认 1480 米。

## Requirements

### Requirement 1: 案例注册与场景初始化

**User Story:** 作为案例浏览者，我希望在三维特效分类中打开带真实倒影的动态水面案例，以便观察水体反射效果。

#### Acceptance Criteria

1. THE 系统 SHALL 在三维特效分类注册并显示"水面效果-Primitive真实倒影"案例入口，包含本地图标（用户提供的 image-1）。
2. WHEN 用户打开该案例，THE 系统 SHALL 创建 Cesium 场景，启用 Bing 影像底图与时钟动画，并加载 Cesium World Terrain 地形数据，将相机定位至丽江水域。
3. WHEN 用户打开该案例，THE 系统 SHALL 依据参考示例的丽江水域轮廓创建水面 Primitive，默认水面高度为 1480 米。
4. WHEN 用户打开该案例，THE 系统 SHALL 在水域内创建黄色中心球体与浮动盒子实体。
5. WHILE 案例处于打开状态，THE 系统 SHALL 保持离屏反射帧缓冲随画布尺寸重建，且水面材质每帧更新反射纹理。

### Requirement 2: 水面参数控制

**User Story:** 作为案例浏览者，我希望调整水面渲染参数，以便观察波纹、透明度、反射、扭曲、光照与色彩变化。

#### Acceptance Criteria

1. THE 系统 SHALL 提供波纹大小、水面透明度、水面反射率、水面扭曲强度、水面高度、太阳高光强度、水体颜色与光照方向控制。
2. WHEN 用户调整波纹大小，THE 系统 SHALL 更新水面材质噪声采样的 `size` uniform。
3. WHEN 用户调整水面透明度，THE 系统 SHALL 更新水面材质的 `waterAlpha` uniform。
4. WHEN 用户调整水面反射率，THE 系统 SHALL 更新水面材质的 `rf0` uniform。
5. WHEN 用户调整水面扭曲强度，THE 系统 SHALL 更新水面材质的 `distortionScale` uniform。
6. WHEN 用户调整水面高度，THE 系统 SHALL 更新水面 Primitive 的模型矩阵与反射平面。
7. WHEN 用户调整光照方向三分量，THE 系统 SHALL 更新水面材质的 `lightDirection` uniform。
8. WHEN 用户调整太阳高光强度，THE 系统 SHALL 更新水面材质的 `sunShiny` uniform。
9. WHEN 用户调整水体颜色，THE 系统 SHALL 更新水面材质的 `waterColor` uniform。

### Requirement 3: 浮动盒子控制

**User Story:** 作为案例浏览者，我希望控制浮动盒子的外观与运动，以便观察物体在倒影中的动态表现。

#### Acceptance Criteria

1. THE 系统 SHALL 提供浮动盒子的大小、移动速度、颜色与显示开关控制。
2. WHEN 用户调整盒子大小，THE 系统 SHALL 更新盒子实体尺寸。
3. WHEN 用户调整盒子移动速度，THE 系统 SHALL 更新盒子的移动与旋转速率。
4. WHEN 用户调整盒子颜色，THE 系统 SHALL 更新盒子实体材质颜色。
5. WHEN 用户切换盒子显示开关，THE 系统 SHALL 更新盒子实体的可见性。
6. WHILE 案例打开且盒子可见，THE 系统 SHALL 依据时钟周期更新盒子的位置与朝向。

### Requirement 4: 生命周期与稳定性

**User Story:** 作为案例浏览者，我希望案例打开、切换与窗口尺寸变化时保持稳定运行，以便无错误地观察效果。

#### Acceptance Criteria

1. WHEN 用户切换案例，THE 系统 SHALL 销毁水面 Primitive、离屏帧缓冲、纹理与监听器，并复用公共场景销毁流程。
2. WHEN 画布尺寸变化，THE 系统 SHALL 按新尺寸重建离屏反射帧缓冲。
3. WHEN 离屏反射渲染执行，THE 系统 SHALL 采用手动场景渲染流程避免嵌套 `scene.render()` 导致的主线程热循环。
4. THE 系统 SHALL 使用 `DEPTH_COMPONENT` 深度纹理格式创建离屏帧缓冲，满足 Cesium 1.144 帧缓冲校验。
5. THE 系统 SHALL 初始化反射材质时使用占位纹理初始化 `image` 与 `normalTexture` 采样器，并标记为 `sampler2D`，避免采样器为空引发运行时错误。
6. WHILE 反射材质更新反射纹理，THE 系统 SHALL 避免对同一纹理的双重销毁。
