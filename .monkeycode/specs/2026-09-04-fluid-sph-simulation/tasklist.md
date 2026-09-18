# 任务列表：2026-09-04 fluid-sph 仿真案例与图标补齐

## 1. water-depth-extraction 图标
- [x] 复制 `.monkeycode-tmp-files/df01b465-image-1.webp` → `src/cases/water-depth-extraction/icon.webp`（md5 一致）
- [x] `index.ts` 加 icon import 与 `icon` 字段
- [x] 描述文案去除「基于」来源表述
- [x] headless 验证卡片 img 渲染（naturalWidth>0、src 含 icon.webp）

## 2. fluid-sph 案例
- [x] 拉取/研究 GPU SPH 地形流体模拟示例仓库结构
- [x] ~~准备高度图资产 `src/cases/fluid-sph/heightmap.png`（1024×1024）~~（V6.5.1 起废弃：原资产含来源水印，默认区域改为实时采样真实地形）
- [x] `fluid-sph-lib/sph-shaders.ts`：SPH 公共 GLSL + 4 段 compute 着色器 + 体积渲染着色器 + 几何/矩阵辅助
- [x] `fluid-sph-lib/fluid-sph-demo.ts`：`FluidSphDemo`（4×FLOAT 纹理、4 compute stage、体积 draw、状态/destroy）
- [x] 导出 `flood-sim-lib/fluid-demo.ts` 的 `CustomPrimitive` 供复用
- [x] `fluid-sph/FluidSphDemo.vue`：场景 + 控制面板 + 点击水源 + 暂停/重置
- [x] `fluid-sph/index.ts` 注册（id=`fluid-sph`，category=`water`，无 icon）
- [x] `src/cases/index.ts` 注册
- [x] vue-tsc 类型检查通过
- [x] headless 页面校验（卡片、无 shader 错误、暂停按钮）
- [x] `npm run build` 通过（EXIT=0，35.52s）
- [x] 视觉截图人工复核（浅/深水色像素出现在盒内区域）

## 3. 收尾
- [x] 更新 `.monkeycode/MEMORY.md` 记录图标映射与实现要点

## 4. V6.5 迭代
- [x] 清理 `sph-shaders.ts` 注释中 shadertoy 来源表述
- [x] `FluidSphDemo.vue` 重力默认 1（范围 0.1~10）
- [x] `SURFACE_SMOOTHING_GLSL` 输出平均速度到 `.zw`
- [x] `FLUID_VOLUME_GLSL` 增加流向箭头叠加 + `flowVisible/arrowRatio/arrowCount`
- [x] `FluidSphDemo` 增加 `flowVisible/setFlowVisible` 与 volume uniform
- [x] `FluidSphDemo.vue`「绘制区域」贴地矩形实时预览 + DEM 采样重建
- [x] 更新本目录 requirements/design/tasklist
- [ ] vue-tsc 类型检查通过
- [ ] headless 验证（绘制模式开关、箭头开关、gravity 默认 1.0、无 shader 错误）
- [ ] `npm run build` 通过
