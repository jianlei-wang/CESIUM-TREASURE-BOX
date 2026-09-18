# Requirements Document

## Introduction

新增三个 GPU 粒子效果案例：火焰粒子、烟雾粒子、爆炸粒子。三个案例共享一套基于 Cesium WebGL2 与 GPU 计算的粒子系统库，粒子位置与速度以 `Float32` 纹理存储，通过 `ComputeCommand` 在 GPU 上逐帧迭代更新，经 `DrawCommand` 以点精灵渲染。案例间通过不同发射方向、力场参数、颜色表与混合模式区分效果。

## Glossary

- **GpuParticleSystem**：共享 GPU 粒子系统主类，管理位置/速度纹理对、计算命令与渲染命令。
- **位置纹理**：RGBA `Float32` 纹理，rgb 为相对发射点的 ENU 局部偏移（米），a 为粒子寿命（0 死亡，1 出生）。
- **速度纹理**：RGBA `Float32` 纹理，rgb 为速度（米/秒），a 为随机种子，用于粒子重生时确定初始方向与寿命。
- **连续发射**：粒子死亡后按概率在发射点附近重生，用于火焰与烟雾效果。
- **一次性爆发**：所有粒子初始从爆点全向飞散，死亡后不重生，用于爆炸效果。

## Requirements

### Requirement 1: 共享 GPU 粒子库

**User Story:** 作为案例浏览者，我希望三个粒子效果案例共用一套 GPU 计算粒子系统，以便获得一致的性能与架构。

#### Acceptance Criteria

1. THE 系统 SHALL 提供 `GpuParticleSystem` 主类，统一管理粒子纹理、计算命令与渲染命令。
2. THE 系统 SHALL 使用 `ComputeCommand` 在 GPU 上逐帧更新粒子速度与位置。
3. THE 系统 SHALL 使用 `DrawCommand` 以点精灵渲染粒子并按寿命采样颜色表。
4. THE 系统 SHALL 通过 `ParticleEffectOptions` 配置区分三种效果。

### Requirement 2: 火焰粒子案例

**User Story:** 作为案例浏览者，我希望观察 GPU 计算的火焰喷射效果，以便了解火焰粒子的运动规律。

#### Acceptance Criteria

1. THE 系统 SHALL 在三维特效分类中显示"火焰粒子-GPU计算"案例卡片。
2. WHILE 案例运行，THE 系统 SHALL 在发射点附近向上喷射上升且随机抖动的粒子。
3. WHILE 案例运行，THE 系统 SHALL 使用白-黄-橙-红渐变颜色表并以叠加混合渲染。
4. WHEN 用户点击地图，THE 系统 SHALL 将发射点移动到点击位置。
5. WHEN 用户调整参数，THE 系统 SHALL 实时更新粒子数、速度、寿命、湍流、浮力与发射锥角。

### Requirement 3: 烟雾粒子案例

**User Story:** 作为案例浏览者，我希望观察 GPU 计算的烟雾升腾扩散效果，以便了解烟雾粒子的运动规律。

#### Acceptance Criteria

1. THE 系统 SHALL 在三维特效分类中显示"烟雾粒子-GPU计算"案例卡片。
2. WHILE 案例运行，THE 系统 SHALL 在发射点附近缓慢升腾并向四周湍流扩散的粒子。
3. WHILE 案例运行，THE 系统 SHALL 使用灰白-浅灰-深灰颜色表并以透明度混合渲染。
4. WHEN 用户点击地图，THE 系统 SHALL 将发射点移动到点击位置。
5. WHEN 用户调整参数，THE 系统 SHALL 实时更新粒子数、速度、寿命、湍流、浮力与发射锥角。

### Requirement 4: 爆炸粒子案例

**User Story:** 作为案例浏览者，我希望观察 GPU 计算的爆炸飞散效果，以便了解爆炸粒子的运动规律。

#### Acceptance Criteria

1. THE 系统 SHALL 在三维特效分类中显示"爆炸粒子-GPU计算"案例卡片。
2. WHEN 案例首次打开，THE 系统 SHALL 在爆点全向爆发高速粒子并受重力回落。
3. WHEN 用户点击地图，THE 系统 SHALL 在点击位置重新引爆。
4. WHEN 用户点击重新引爆，THE 系统 SHALL 重置粒子状态并再次爆发。
5. WHEN 用户调整参数，THE 系统 SHALL 实时更新粒子数、威力、寿命、重力与湍流。

### Requirement 5: 生命周期与正确性

**User Story:** 作为案例浏览者，我希望案例打开与关闭时正确创建与释放资源，以便长期稳定运行。

#### Acceptance Criteria

1. WHEN 案例打开，THE 系统 SHALL 创建 Viewer、Bing 影像底图与 GPU 粒子系统。
2. WHEN 案例关闭，THE 系统 SHALL 释放 Viewer、纹理、命令、事件处理器与监听。
3. WHILE 粒子更新，THE 系统 SHALL 通过双纹理乒乓交换避免读写同一纹理。
4. WHILE 粒子渲染，THE 系统 SHALL 开启深度测试并关闭深度写入，保证地形遮挡正确。
5. IF 地图底图加载失败，THE 系统 SHALL 显示加载失败提示并保持案例可重试。
