# opt-in 频率遥测方案（T-01/T-02）

> 日期：2026-09-06 · 状态：📋 方案待拍板 · 独立轨：不进入主线实现
> 来源：`docs/plan/2026-09-05-gpt-discussion-consolidation.md` §1、现役代码盘点与 2026-09-06 Context7/官方文档检索。

## 1. 先说用户要解决的摩擦（D6）

现在 Nomi 只把播放状态写进本地项目事件：遇到“生成后没人继续用”“导出在哪一步放弃”这类问题，维护者没有总体频率证据，只能猜。用户却不应该为了获得产品改进而交出提示词、项目名或素材路径。这个方案让用户主动打开一个开关后，Nomi 只上报一小组预先列白的计数和耗时桶；用户能在本机看见待发/已发记录并一键删除。

用户要权衡的那一件事是：**用最少数据换取产品改进证据，还是完全不发送任何数据**。推荐默认关闭、可随时关闭；关闭后的产品功能与更新流程不受影响，隐私边界优先于统计完整度。

陌生概念说明：“频率遥测”只回答“某功能被用过几次、成功/失败比例和大致耗时”，不是录屏、行为追踪，也不是把创作内容上传给分析平台。

## 2. 现状与边界证据

- `src/media/videoPlaybackTelemetry.ts:3-17` 的现有 telemetry 只构造 `phase/协议 host/readyState/networkState/mediaErrorCode`；`:33-43` 通过 desktop bridge 写入项目事件，本地可追溯但不出网。
- `electron/update/autoUpdater.ts:56-80` 仅监听更新检查、可用、下载进度、安装与错误；`:107-142` 是显式更新 IPC。遥测不能复用更新请求、不能改变更新检查频率。
- 设置已有原子 JSON + trusted sender 模式，例如 `electron/settings/generationModelDefaultsSettings.ts:22-36` 与 `electron/settings/generationModelDefaultsIpc.ts:15-29`；遥测设置应沿用同一主进程边界。
- 本轨不把本地播放 telemetry 改成联网 telemetry；新增的是独立、可关闭的产品频率事件投影。

## 3. R20 build-vs-buy 闸

### 三问一：这是通用问题吗？

是。事件命名、批量发送、离线队列、退避、删除和同意状态是通用分析基础设施，不是 Nomi 的护城河。Nomi 的独特价值在本地优先创作工作流与可解释的事件白名单，应该把通用传输交给成熟方案。

### 三问二：同类产品怎么做？（Context7 + web 实查）

| 现役同类 | 观察到的做法 | 对 Nomi 的借鉴 |
|---|---|---|
| PostHog | SDK 提供 opt-in/opt-out；Context7 `/posthog/posthog.com` 文档示例说明 `optOut` 可停止采集并清理队列，隐私模式与数据最小化是官方原则；[隐私模式文档源码](https://github.com/PostHog/posthog.com/blob/master/contents/docs/ai-observability/privacy-mode.mdx)。 | 同意状态必须是发送前的硬闸，关闭时清空本地发送队列；不要把 prompt/输入文本作为默认事件。 |
| Aptabase | 面向桌面/移动端、无设备标识；官方说明每次 `track` 才产生一个事件且不自动追踪，[官网隐私说明](https://aptabase.com/)；Context7 `/aptabase/aptabase` 列出事件字段与不含 raw IP/唯一设备 ID 的系统属性。 | 事件显式调用、匿名短期 session、白名单 props；很贴合 Nomi 的 opt-in 与本地优先边界。 |
| Plausible | 轻量、无 cookie；Context7 `/plausible/docs` 展示自定义事件 props 与 `transformRequest` 删除自动 URL，[官方文档仓库](https://github.com/plausible/docs)。 | 只发预定义计数，明确删除自动 URL/页面上下文；若自建端点可复用其最小事件思想。 |
| Umami | 无 cookie、可自托管；Context7 `/umami-software/umami` 的 tracker 在 `trackingDisabled()` 时直接返回、网络错误静默丢弃，[官方仓库](https://github.com/umami-software/umami)。 | 关闭时零网络调用；网络失败不影响创作主流程。 |

### 三问三：这是护城河吗？

联网遥测本身不是护城河，却触及信任。结论：**买标准传输/看板能力，自己掌握同意、事件白名单、本地审计和删除**。推荐 Aptabase（可托管或自建，事件模型简单）作为后端/SDK候选；PostHog 只作为需要更复杂分析时的备选，不默认引入其录屏、会话回放或自动采集能力。

## 4. R3 方案对比

| 方案 | 用户看到什么 | 代价 |
|---|---|---|
| A. 不联网，只扩充本地 playback telemetry | 设置里没有遥测开关；维护者只能拿用户手工导出的日志 | 隐私最强，但无法回答总体使用频率，T-01 未完成。 |
| **B. Nomi 事件白名单 + Aptabase 传输/看板（默认关，推荐）** | 设置→隐私与诊断里一个“帮助改进 Nomi”开关；打开后可查看、删除本地待发/历史摘要，状态写明“仅发送匿名频率” | 需维护同意合同、批量队列、端点/保留策略和自建或托管账单；收益与复杂度平衡最好。 |
| C. PostHog 全套 SDK | 用户看到同意开关；产品可用漏斗、远程配置、回放等平台功能 | SDK 面大、误配会采集输入，供应商数据治理和费用更重；超出本期需要。 |

## 5. 推荐设计（只写方案，不实现）

### 5.1 同意与设置

新增 `telemetrySettings` 版本化合同（建议 `electron/telemetry/telemetrySettings.ts`，目标 <220 行）：

```ts
{
  schemaVersion: 1,
  enabled: false,
  endpointMode: "aptabase",
  consentedAt: null,
  installSessionId: null
}
```

- 默认 `enabled:false`；首次启动不弹模态，不以功能可用为条件诱导同意。
- 设置页现有“隐私/诊断”分组放开关、说明、查看本地数据、删除本地数据；关闭立即停止发送并清空待发队列。
- `installSessionId` 为本地随机值，按 24 小时或应用重启轮换；不上传账号、机器序列号或长期设备指纹。若审计认为 session 仍属个人数据，改为每批随机 ID。
- 同意状态只由主进程保存与判断；renderer 传入事件必须经过白名单校验，不能自报 enabled。

### 5.2 事件白名单

只允许以下事件（事件名和字段固定在 `electron/telemetry/telemetryEvents.ts`，目标 <300 行）：

| 事件 | 字段（示例） | 不包含 |
|---|---|---|
| `app.started` | app major/minor、OS family、locale、install age bucket | 用户名、路径、IP、完整版本日志 |
| `feature.used` | `featureId`（枚举）、result（success/failure/cancel） | prompt、项目/素材名、节点内容 |
| `generation.completed` | capability slot、duration bucket、result、attempt count bucket | modelKey、vendorKey、API 响应、花费金额 |
| `export.completed` | format enum、duration bucket、result | 输出文件名、绝对路径、媒体内容 |
| `update.action` | `check|download|install`, result | 更新 URL、release notes 全文、网络错误原文 |

- `featureId` 只能来自代码内枚举；未知事件丢弃并计本地审计计数。
- 不采集 prompt、聊天、模型/供应商身份、项目 ID、文件名/路径、素材 URL、缩略图、剪贴板、精确地理位置、完整错误堆栈、API key、token、金额。
- 数值只发桶（例如 `<1s/1–5s/>5s`），时间戳取日粒度；本地事件仍可保留现有播放 telemetry，但不自动复制到联网队列。

### 5.3 队列、查看与删除

- 主进程维护限长、加密与原子写入的 outbox（建议 `electron/telemetry/telemetryOutbox.ts`，目标 <260 行）；网络不可用时最多保留 100 条或 7 天，超出先进先丢。
- 批量发送仅在 `enabled=true`、应用空闲、网络请求超时有界时进行；失败退避，不阻塞生成/导出/更新。
- “查看本地数据”显示脱敏 JSON 摘要与队列大小；“删除本地数据”删除 outbox、session id、发送失败记录并返回删除计数。删除不影响项目事件与生成结果。
- 服务器端选择 Aptabase 托管或自建；实施前必须写明 endpoint、区域、保留期、管理员访问与删除响应时间。SDK 不得自行附加 URL、设备指纹或广告标识。

### 5.4 与 autoUpdater / 设置页的关系

- `autoUpdater` 继续按现有显式检查/下载/安装流程工作；更新请求不携带 telemetry consent 或产品事件，遥测也不借更新请求“顺便发送”。
- `update.action` 只有在用户已 opt-in 时入队，且不改变更新检查时机；关闭遥测后更新仍完整可用。
- 设置页将“更新”与“隐私与诊断”分成两个卡片；更新错误只在更新面板展示，遥测网络错误只记本地诊断计数，不混成一个 toast。

## 6. 范围与不动项

**本轨范围**：同意合同、白名单事件、主进程 outbox、Aptabase adapter/端点配置、设置页查看/删除、数据保留说明、静态脱敏测试与真实 opt-in/off 旅程。

**不动项**：不改变现有本地 playback telemetry 语义；不加 session replay、录屏、自动页面采集、远程配置、广告归因；不让遥测决定模型、供应商、更新或生成重试；不在默认关闭时发送任何联网探测事件。

## 7. 分层与文件拆分（R9，单文件 ≤800 行）

| 层 | 计划文件（实施时） | 责任 |
|---|---|---|
| 合同 | `electron/telemetry/telemetrySettings.ts`、`telemetryEvents.ts` + tests | schema、白名单、桶化与脱敏 |
| 存储 | `electron/telemetry/telemetryOutbox.ts` + test | 原子队列、限长、删除、退避 |
| 传输 | `electron/telemetry/aptabaseAdapter.ts` + contract test | 仅发送已验证 envelope；可替换端点 |
| IPC | `electron/settings/telemetryIpc.ts`、bridge 类型 | trusted sender、读/写/查看/删除 |
| UI | `src/ui/settings/*Telemetry*` + i18n | 开关、说明、查看/删除；不直接 fetch |
| 事件接线 | `electron/projectAgentHost/*`、生成/导出边界 | 只调用白名单 emitter，不读取 prompt/路径 |
| 旅程 | `tests/ux/telemetry-consent.walk.mjs` | 默认关、开关、删除、离线、更新独立性 |

## 8. 回滚

回滚顺序：先关闭远程 endpoint 与 `enabled` 默认值，再删除 adapter/IPC/UI 接线；保留并忽略本地 outbox 文件，下一版启动时可安全删除该文件。回滚不删除项目内既有 `preview.video.state` 事件，不触碰 autoUpdater 配置、下载缓存或用户设置的其它字段。

## 9. 验收门

- **默认关闭**：新 profile 启动、更新检查、生成、导出均无 telemetry 网络请求；设置写入后重启仍为关。
- **同意/撤回**：打开后只发送白名单事件；关闭立即清空队列、停止重试；重新打开生成新的 session id。
- **隐私**：静态扫描与单测证明 prompt、项目/素材路径、URL、model/vendor、key、完整错误不会进入 payload；端点只接收 schema 版本和桶化字段。
- **本地可见可删**：UI 可查看脱敏队列，删除返回计数且文件不存在；删除不改变项目数据和 autoUpdater 行为。
- **可靠性**：离线/5xx/超时不阻塞创作主流程；队列有 100 条/7 天上限；恢复联网后按退避批量发送。
- **真实旅程**：Playwright/Electron 跑默认关→打开→使用一个功能→查看→删除→关闭；同时验证 update check 仍可用且无遥测耦合，截图保留在 `artifacts/telemetry/`。
- **静态门**：`pnpm run check:docs-index`、`pnpm run check:doc-status`、`pnpm run check:boundaries`、`pnpm run check:heavy-path`、`pnpm run typecheck` 与 `pnpm run gates` 全绿（实施 PR 另按 R22 触发 unit/journey）。

## 10. 六角色预审记录（R7）

| 角色 | 关键审查结论 |
|---|---|
| CTO | 采用标准分析后端，Nomi 自己掌握 consent/outbox；默认关闭是硬合同。 |
| 设计 | 一个开关、一个本地查看/删除入口；不把隐私说明写成教程。 |
| PM | 先回答使用频率与失败率，暂不做回放和远程实验。 |
| 前端 | 设置页复用现有卡片与 i18n；更新设置不与隐私设置混排。 |
| 后端 | 事件 schema 固定、可脱敏验证、端点可替换且有保留期合同。 |
| 真实用户 | “我能随时关掉并删掉”比“你们以后可能更懂我”更重要。 |

## 11. 研究记录

- Context7：`/posthog/posthog.com`（opt-out、privacy mode、数据最小化）；`/aptabase/aptabase`（桌面事件字段、无 raw IP/设备 ID）；`/plausible/docs`（自定义事件与删除 URL）；`/umami-software/umami`（trackingDisabled、失败静默）。
- 官方网页：PostHog [privacy mode source](https://github.com/PostHog/posthog.com/blob/master/contents/docs/ai-observability/privacy-mode.mdx)；Aptabase [privacy/event tracking](https://aptabase.com/)；Plausible [docs repository](https://github.com/plausible/docs)；Umami [repository](https://github.com/umami-software/umami)。检索日期均为 2026-09-06。
