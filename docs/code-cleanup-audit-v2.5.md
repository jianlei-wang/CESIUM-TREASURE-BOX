# V2.5 代码清理审计

日期：2026-08-23

## 执行动作

- 将 Cesium Ion 显示策略集中到全局 `src/style.css`。
- 移除 `src/lib/cesium-scene.ts` 中与全局样式重复的 `CreditDisplay` 引用和设置。
- 保留公共 Viewer 生命周期、Bing 影像加载、状态回调和销毁逻辑。

## 扫描结果

| 项目 | 分类 | 证据 | 处理 |
| --- | --- | --- | --- |
| `src/lib/cesium-scene.ts` | KEEP_REQUIRED | 10 个案例静态导入并调用 `createMapScene` 和 `destroyScene` | 保留 |
| `src/lib/bing.ts` | KEEP_REQUIRED | 公共场景模块静态导入 `createBingImageryProvider` | 保留 |
| `src/lib/tianditu.ts` | KEEP_REQUIRED | `src/cases/imagery-split/ImagerySplitDemo.vue` 静态导入 `createTiandituImageryProvider` 和 `createTiandituLabelProvider`（见 v2.6 审计复核） | 保留 |
| `src/lib/weather.ts` | KEEP_REQUIRED | 天气与闪电案例依赖 shader 常量 | 保留 |
| `src/lib/water.ts` | KEEP_REQUIRED | 动态多边形水面案例依赖材质常量 | 保留 |
| `src/lib/wmts.ts` | KEEP_REQUIRED | GeoServer 图层案例依赖 WMTS provider 工厂 | 保留 |
| `src/lib/geoserver-capabilities.ts` | KEEP_REQUIRED | GeoServer 案例依赖服务能力解析 | 保留 |
| `src/lib/tianditu.ts` 的敏感配置 | SECURITY_REVIEW | 文件包含第三方服务访问配置 | 仅记录风险，等待凭据迁移方案确认 |

## 收益

- Cesium Ion 标识的显示逻辑从公共运行时代码迁移至全局 CSS，后续案例自动继承。
- 公共场景模块减少一项重复的 credit API 依赖。
- 未静态引用的旧地图工具已形成可审计候选项，后续删除具备明确边界。

## 验证项

- `npm run build`
- `git diff --check`
- 开发预览中打开任一 Cesium 案例，检查 `Data attribution` 入口可见。
