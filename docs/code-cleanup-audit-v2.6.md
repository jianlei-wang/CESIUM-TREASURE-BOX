# V2.6 代码清理审计

日期：2026-08-25

## 执行动作

- 修复 `src/cases/explosion-boom/index.ts` 图标引用：由被 gitignore 的临时目录 `.monkeycode-tmp-files/f84726a8-image-1.webp` 改为案例本地 `./icon.webp`，消除构建可移植性隐患。
- 删除 4 个空目录：`src/cases/explosion-space/`、`src/cases/imagery-split-vertical/`、`.monkeycode/specs/imagery-split-vertical/`、`public/icons/`。
- 删除 2 个未引用资源：`src/cases/explosion-boom/boom.frag`、`src/cases/explosion-boom/assets/noise.png`。
- 更新 `.monkeycode/specs/explosion-effects/design.md` 中关于历史 shader 与噪声纹理保留的说明。
- 复核 v2.5 审计中 `src/lib/tianditu.ts` 的结论。

## 扫描结果

| 项目 | 分类 | 证据 | 处理 |
| --- | --- | --- | --- |
| `src/cases/explosion-boom/index.ts` 图标引用 | REVIEW_REQUIRED | 引用 `.monkeycode-tmp-files/`（`.gitignore` 内容为 `*`）中的图片，不受版本控制；案例目录内已有 `icon.webp` | 改为 `./icon.webp` |
| `src/cases/explosion-space/` | SAFE_CANDIDATE | 空目录（仅空 `assets/`），V3.32 已移除空间反转案例，无 `index.ts`、无注册、无外部引用 | 删除 |
| `src/cases/imagery-split-vertical/` | SAFE_CANDIDATE | 空目录，无 `index.ts`、无注册、无外部引用 | 删除 |
| `.monkeycode/specs/imagery-split-vertical/` | SAFE_CANDIDATE | 空目录，无任何文件 | 删除 |
| `public/icons/` | SAFE_CANDIDATE | 空目录，无任何文件 | 删除 |
| `src/cases/explosion-boom/boom.frag` | SAFE_CANDIDATE | 全仓库无静态/动态引用，构建产物不含该文件；`design.md` 记载运行时不再加载 | 删除（备份至 `/tmp/opencode/cleanup-backup/`） |
| `src/cases/explosion-boom/assets/noise.png` | SAFE_CANDIDATE | 全仓库无引用，构建产物不含该文件 | 删除（备份至 `/tmp/opencode/cleanup-backup/`） |
| `src/lib/tianditu.ts` | KEEP_REQUIRED | `src/cases/imagery-split/ImagerySplitDemo.vue:6` 静态导入 `createTiandituImageryProvider`、`createTiandituLabelProvider` | 保留，更新 v2.5 审计结论 |
| `src/lib/cesium-scene.ts` | KEEP_REQUIRED | 30 个案例静态导入 `createMapScene` 与 `destroyScene` | 保留 |
| `src/lib/bing.ts` | KEEP_REQUIRED | 公共场景模块与 imagery-split 案例静态导入 | 保留 |
| `src/lib/weather.ts` | KEEP_REQUIRED | 天气/闪电/雾案例依赖 shader 常量 | 保留 |
| `src/lib/water.ts` | KEEP_REQUIRED | 动态多边形水面案例依赖材质常量 | 保留 |
| `src/lib/wmts.ts` | KEEP_REQUIRED | GeoServer 案例依赖 WMTS provider 工厂 | 保留 |
| `src/lib/geoserver-capabilities.ts` | KEEP_REQUIRED | GeoServer 案例依赖服务能力解析 | 保留 |
| `src/cases/measure-lib/` | KEEP_REQUIRED | 6 个测量/标注案例静态导入 | 保留 |
| `src/cases/particle-effect/lib/` | KEEP_REQUIRED | 4 个粒子/爆炸案例静态导入 `GpuParticleSystem` | 保留 |
| `src/cases/wind-layer-3d/lib/` | KEEP_REQUIRED | wind-layer-3d 案例静态导入 | 保留 |
| `src/cesium-render.d.ts` | KEEP_REQUIRED | wind-layer-3d 使用 Texture3D/Framebuffer 等声明 | 保留 |
| `src/shims-shpjs.d.ts` | KEEP_REQUIRED | vector-loader 案例使用 `shpjs` 模块声明 | 保留 |
| npm 依赖 | KEEP_REQUIRED | `shpjs`、`xlsx`、`element-plus`、`cesium`、`vite-plugin-cesium` 均有实际使用 | 保留 |
| `src/lib/cesium-scene.ts` 的 Ion token | SECURITY_REVIEW | 硬编码 `CESIUM_ION_ACCESS_TOKEN` | 仅记录风险，不输出真实值 |
| `src/lib/tianditu.ts` 的 token | SECURITY_REVIEW | 硬编码 `TIANDITU_TOKEN` | 仅记录风险，不输出真实值 |

## 收益

- 删除 2 个未引用资源（约 96 KB）与 4 个空目录，降低仓库噪声。
- 修复爆炸案例图标对 gitignore 临时目录的隐式依赖，克隆仓库后构建不受 `.monkeycode-tmp-files/` 是否存在的制约。
- 修正 v2.5 审计中 `tianditu.ts` 的过时结论（实际存在静态引用）。

## 验证项

- `npm run build`（vue-tsc 类型检查 + vite 构建）
- `git diff --check`
- 全仓库搜索确认删除项无残留引用

## 遗留风险

- `src/lib/cesium-scene.ts` 与 `src/lib/tianditu.ts` 中的硬编码第三方访问 token 需凭据迁移方案，当前仅记录风险。
- `.monkeycode-tmp-files/` 目录仍包含历史上传的临时文件（被自身 `.gitignore` 排除在版本控制外），本次未处理，等待清理确认。
