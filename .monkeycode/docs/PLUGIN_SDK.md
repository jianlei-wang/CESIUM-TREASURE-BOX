# 演示产品插件 SDK

演示产品的纯函数内核与生命周期钩子通过 `src/cases/presentation-studio-lib/core/sdk.ts` 暴露。SDK 面向三类集成：自定义工程导入、保存前校验、导出前准备。

## 版本与兼容

- `STUDIO_SDK_VERSION`：插件 API 的语义版本，当前 `1.0.0`。
- `STUDIO_SUPPORTED_SCHEMAS`：宿主可读取的工程 schema 版本，当前 `[2]`。
- 插件必须声明 `id`（小写字母、数字、`.`、`_`、`-`）与 `version`（semver）。
- `minSdkVersion` 高于宿主版本时注册失败。
- `schemas` 不包含当前 schema 时注册失败；省略表示接受当前全部受支持版本。
- 重复 id 注册失败；`registerStudioPlugin` 返回注销函数。

## 生命周期

| 钩子 | 时机 | 参数 |
| --- | --- | --- |
| `onRegister` | 注册成功时 | `PluginContext` |
| `onProjectOpen` | 导入工程、加载播放器工程后 | 可修改的运行时工程 |
| `onProjectSave` | 每次写入本地存储前 | 只读 v2 文档快照 |
| `onBeforeExport` | 导出任务开始前 | `OutputProfile` |

钩子异常不会中断保存或导出：异常被捕获为 `PluginFailure`，同时写入 `orchestration/plugin-failed` 诊断事件。

## 示例

```ts
import {
  registerStudioPlugin,
  runProjectOpenHooks,
  runProjectSaveHooks,
  runBeforeExportHooks
} from './src/cases/presentation-studio-lib/core/sdk'

const dispose = registerStudioPlugin({
  id: 'acme.watermark',
  version: '1.2.0',
  minSdkVersion: '1.0.0',
  schemas: [2],
  onProjectOpen(project) {
    project.name = project.name.trim()
  },
  onProjectSave(document) {
    if (!document.presentations.length) throw new Error('工程至少需要一个演示')
  },
  onBeforeExport(profile) {
    if (profile.width > 3840) throw new Error('单边分辨率不能超过 4K')
  }
})

const project = createProjectFromSomewhere()
runProjectOpenHooks(project)
runProjectSaveHooks(runtimeToDocument(project))
runBeforeExportHooks(profile)

dispose()
```

宿主已在 `PresentationStudio.vue` 的导入、保存和导出路径调用对应 runner。独立集成方需要自行调用 runner，注册本身不产生副作用。

## Breaking-change 管理

- **major**：删除或重命名导出、改变钩子语义、改变工程 schema 且不提供迁移。发布前必须同步提升 `STUDIO_SDK_VERSION` 与 `STUDIO_SUPPORTED_SCHEMAS`。
- **minor**：新增钩子、新增导出、新增可选字段；旧插件无需修改。
- **patch**：修复实现，不改变公开签名。

新增 schema 版本时必须同时提供迁移函数、round-trip fixture、`schemas` 兼容窗口和至少一个旧版本样例。删除旧 schema 支持属于 major 变更。

## 可复用纯函数

SDK 之外，以下模块可独立导入：

- `schema.ts`：v2 文档、迁移、校验、资产清单。
- `timeline.ts`：`evaluateFrame` 确定性求值。
- `project-package.ts`：工程包与播放器包。
- `export-pipeline.ts`：实时与逐帧导出。
- `diagnostics.ts`：诊断事件与订阅。
