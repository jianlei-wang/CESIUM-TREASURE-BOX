# Requirements Document

## Introduction

"爆炸特效-噪声云团"案例融合 Shadertoy Bim Boom Bam 的 gyroid/fbm 云团形态与 Cesium GPU 绘制系统，在指定经纬度创建可调节的单次云爆炸，地图相机与深度关系由 Cesium 场景处理。

## Glossary

- **fbm**：分形布朗运动，多 octave 噪声叠加，用于云团细节。
- **gyroid**：基于三角函数点积的隐式曲面，用于生成孔洞化的有机噪声形态。
- **GPU 粒子系统**：以纹理作为粒子状态缓冲，通过 Cesium ComputeCommand 更新速度与位置并在世界坐标中绘制粒子点的系统。
- **发射器**：由经度、纬度和高度定义的粒子局部 ENU 坐标系原点。
- **火焰类型**：噪声云团案例中单团火焰的粒子颜色梯度预设（能量青蓝/炽热橙金/烈焰红黄/霓虹紫粉/毒雾翠绿/电磁亮蓝/冰霜蓝白/星云彩带）。

## Requirements

### Requirement 1: 双爆炸案例卡片

**User Story:** 作为案例浏览者，我希望在三维特效分类中看到两个全新的爆炸效果案例，与既有 GPU 粒子爆炸案例并列展示。

#### Acceptance Criteria

1. THE 系统 SHALL 在三维特效分类中显示"爆炸特效-噪声云团"案例卡片。
2. THE 系统 SHALL 使用 image-1 作为"爆炸特效-噪声云团"案例的缩略图图标。

### Requirement 2: 爆炸特效-噪声云团案例

**User Story:** 作为案例浏览者，我希望在地图指定经纬度观察一团以 Shadertoy 云团效果为主体的 GPU 着色器爆炸，并调节云团外观。

#### Acceptance Criteria

1. WHEN 案例打开，THE 系统 SHALL 在默认经纬度创建一个固定世界坐标的 GPU 点精灵，并在点精灵内部渲染循环生长、消退和烟化的 Shadertoy 风格云爆。
2. WHEN 用户点击地球任意位置或输入有效经纬度，THE 系统 SHALL 将粒子发射器更新到该世界坐标。
3. WHILE 用户拖动、缩放或旋转地图相机，THE 系统 SHALL 以 Cesium 世界坐标渲染火焰并遵循场景深度测试。
4. WHEN 用户选择八种"火焰类型"之一，THE 系统 SHALL 更新粒子颜色梯度。
5. THE 系统 SHALL 在点精灵片元中使用固定编号、8 octave gyroid/fbm、法线调色、烟化混色和生长消退遮罩，渲染单团循环爆炸。
6. THE 系统 SHALL 使用固定背景系数替代参考着色器的纹理依赖，并消除平铺实例造成的分割线。
7. WHEN 云爆时间达到用户设置的生命周期时长，THE 系统 SHALL 隐藏当前云爆公告牌。
8. WHEN 用户点击"重新引爆"，THE 系统 SHALL 销毁当前云爆对象并在当前经纬度创建新的云爆对象。
9. THE 系统 SHALL 以透明形状遮罩输出云团片元，使点精灵边界区域保持地图可见。
10. WHEN 用户调整"云团速度/生命周期/云团显示尺寸/噪声尺度/fbm 细节/云团密度/烟化程度/爆炸半径/边缘柔和度/调色频率"，THE 系统 SHALL 在控件定义的完整范围内实时更新云爆外观。

### Requirement 3: 资源与生命周期

**User Story:** 作为开发者，我希望案例正确加载共用噪声纹理并在退出时完整释放 WebGL 与场景资源。

#### Acceptance Criteria

1. WHEN 噪声云团案例卸载，THE 系统 SHALL 销毁点击事件处理器、GPU 粒子状态纹理、ComputeCommand、DrawCommand 与 Cesium Viewer。
2. THE 系统 SHALL 在 Cesium 场景初始化或 GPU 粒子资源创建失败时显示错误提示。
