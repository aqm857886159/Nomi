# Track D2：IPC `sendSync` 读路径异步化

## 范围

- 清点 `electron/preload.ts` 的单一 `invokeSync` 收口及其所有 renderer 调用点。
- 将可在渲染交互或懒加载时等待的磁盘/目录/配置读取改为 `ipcRenderer.invoke` + `ipcMain.handle`。
- 同步核对每个调用点的 Promise 时序，避免把 Promise 当成已解析值。
- 保留启动首帧必须同步完成的系统语言探测，以及项目仓库当前同步写/读契约；记录理由与后续拆分边界。

## 不动项

- 不做 D3（画布/时间轴瞬时态与领域态分离）。
- 不把项目创建、保存、删除等写入操作伪装成读路径异步化。
- 不为异步化保留 sendSync fallback 或双轨运行时分支。

## 验收门

- 异步读通道有单测，且先红后绿留有命令输出证据。
- 启动 + 项目库真实走查退出码为 0；走查截图时间戳晚于本次提交。
- `pnpm run gates` 退出码为 0。
- 若通用门岗新增，先注入违规证明报红，再撤销并证明回绿。

## 实查调用面（改造前）

`electron/preload.ts:14-20` 是全仓唯一 `ipcRenderer.sendSync` 字面收口。改造前共 40 个唯一 channel（40 个调用表达式）；渲染层经该收口触达的读热点为：

| channel | preload 调用 | renderer 调用时机 | 判断 |
| --- | --- | --- | --- |
| `nomi:model-catalog:vendors:list` / `models:list` / `mappings:list` / `health` | `electron/preload.ts:531-534` | 目录缓存启动预热、设置/接入抽屉、ComfyUI 工作流页、模型选择器、生成前能力判断；`models:list` 最热 | 异步化 |
| `nomi:asset-transport:channels:describe` | `electron/preload.ts:528` | 设置 → AI 模型页打开时读取状态卡 | 异步化 |
| `nomi:skill:list` | `electron/preload.ts:587` | 技能库打开、创作提示词选择器刷新 | 异步化 |
| `nomi:capability:mcp-info` | `electron/preload.ts:596` | 设置 → 自动化权限 → MCP 二级页进入时读取配置快照 | 异步化 |
| `nomi:model-catalog:comfyui:presets` | `electron/preload.ts:580` | 模型设置中的 ComfyUI 预置区挂载时读取静态清单 | 异步化 |
| `nomi:model-catalog:custom-call:config:get` | `electron/preload.ts:545-546` | 自定义调用编辑器切换目标时读取脱敏配置 | 异步化 |
| `nomi:projects:list` / `read` | `electron/preload.ts:119,122` | 启动项目库、项目 hydrate、持久化服务同步契约 | 保留同步，见下文 |
| `nomi:i18n:get-system-locale` | `electron/preload.ts:32` | i18n 模块求值阶段、首帧前解析初始语言 | 保留同步，见下文 |
| 其余 27 个 channel | `electron/preload.ts:121,126,129,535-563,567,582-584,588-590,597-598` | 创建/保存/删除/导入/导出/分析/安装等写或纯 CPU 事务 | 不属于本批读路径 |

### 保留同步的原因

- 系统语言探测发生在 `src/i18n/index.ts:33-45` 的模块初始化同步求值中；改为 Promise 会让 i18next 先用默认中文初始化，再在首帧后切换，产生语言闪烁并改变已有 E2E 语言隔离契约。它不是 preload “拿不到 await”，而是首帧初始化的明确时序约束，后续若改需单独设计异步 i18n 启动闸。
- 项目 `list/read` 仍被 `src/workbench/project/projectRepository.ts:95-172` 的同步仓库 API、创建/保存/改名事务和 `src/workbench/library/localProjectStore.ts:74-95` 的 SWR 取数契约调用；强行只替读会把同一项目仓库拆成 Promise/同步双真相源，造成启动项目库首帧空态和保存/改名竞态。本批仅将已有的“显式 async 项目”辅助口保留作未来切片边界，不在 D2 混入项目状态机重构。
- 写入、纯解析和静态合同（例如 `custom-call:contract`、Comfy workflow analyze）不属于读路径；它们仍经同步事务口，避免扩大 D2 范围。

## 实现与时序核对

异步化后的 main 端统一改为 `ipcMain.handle` 并执行 sender 校验；preload 直接 `ipcRenderer.invoke`，旧同步注册/调用在同一提交删除。调用方逐点改为 `await` / Promise 状态机：模型目录缓存与工作流页用 `Promise.all`，设置/抽屉/技能/Comfy 预置用 effect 的 alive 保护，MCP 页先显示不可用状态再异步换 ready，CustomCall 编辑器异步载入模型和脱敏配置。这样首帧不会把 Promise 当数组，也不会在组件卸载后回写旧结果。

## 通用性门岗

阻塞根因是“renderer 通过通用 preload 收口把读操作接到 `sendSync`”，可从任何新 channel 复发。因此新增 `scripts/check-ipc-send-sync-read-path.mjs` + `scripts/check-ipc-send-sync-read-path-baseline.json` 并接入 `gates`：直接 `sendSync` 必须仍只有 1 处；已异步化的 9 个读 channel 回退即红；出现未审查的新同步 channel 即红。先红后绿字面输出记录在交付说明：注入 `invokeSync("nomi:model-catalog:vendors:list")` 时测试报 `expected ... to contain invokeSync(...)`、退出码 1；撤销后同一测试 1 passed、退出码 0。
