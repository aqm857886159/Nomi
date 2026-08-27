# pi 接入与统一 Agent：逐文件迁移方案

> 状态：用户已批准实施；R0 已验证并提交，R1 的职责提取、正式构建、运行端口与线程快照均已通过规格、质量独立审查。现有产品入口切换与旧链删除正在收尾测试，尚未通过正式产品验收；项目级统一 Agent 尚未实现，新增 UI 样张门仍须通过。见 [R0 验收记录](../audit/2026-08-26-pi-r0-verification.md)、[R1 实施卡](2026-08-26-pi-r1-runtime-cutover.md)与[当前目录导览](../../electron/harness/README.md)。
> 核对日期：2026-08-26。代码基线：84abca8d012cc78cf8692f929351db65a314a985（#180 合入后的 origin/main 快照）。
> 本稿是 #180 执行排期的运行层与统一 Agent 实施细化，不是另立一套总方案。下文记录本次确认的调整；实施前将改变的技术决策同步回原计划，旧手册不作为拒绝已确认 pi 方向的依据。
> 研究口径：全文核对 electron/ai 的 22 个非测试文件、src/workbench/ai 的 26 个非测试文件；跟踪两面板、6 条业务分支与权威边界。阅读代码不等于测试通过。

## 1. 先给判断：现在就能先做，但不是只替换一个函数

可以先推进 Agent，不必等三空间交互样张、完整 B2/B3、E2、D3 或 B5 全部完成。

最小完整单位是：**循环 + 模型连接 + 工具桥 + 消息/上下文 + 流事件 + 既有会话恢复**。这几个接缝不一起明确，单换 agentLoop.ts 会留下两套 SDK 类型互相缠绕，也可能丢工具结果、附件或取消语义。

已确认以受控的 pi AgentSession 为唯一运行核方向，保留 Nomi 的作品操作、项目记忆、权限与花费控制。第一项实际工作是有明确通过标准的兼容验证，然后接回现有产品入口；不是先另造一个通用 Agent 平台。

本稿明确以下阶段边界：

- 共同编辑的完整样张不是运行层验证/换芯的前置。运行层只先定必要的会话归属、取消、执行结果和权限透传合同。
- “只能在隔离 fixture 看看 pi，之后才允许接现有产品”不是技术限制。fixture 通过后，本期就接现有文档/画布与单次任务；写入仍走已有批准/执行路径。
- R1 的旧 UI 换芯不等于整体完成。紧接着必须交付 R2-U1 的项目级统一 Agent；新增界面先走样张批准，不能把统一会话/任务的工作无限推给 B5 美化。

### 1.1 已确认的最终范围：一个作品的 Agent，不是两个页面的助手

- **会话归项目，不归页面。** 同一项目的当前对话在创作、生成、预览中连续；用户可以主动新建/切换对话，但换空间本身不新建对话或重置记忆。不同项目仍严格隔离，不做跨项目的无限大聊天。
- **任务、审批和结果归同一个控制面。** 换空间不取消在途任务、不重复问一次批准、不丢候选与回执；页面只是同一状态的呈现和专业工具入口。
- **当前视图是上下文，不是新 Agent 的身份。** 工具按任务、目标和权限选择；不能只是依据 creation/generation 二选一。发送时固定任务目标，用户随后换选区不重定向已发送任务，也不静默改写正在输入的指令范围。
- **人类手工编辑仍是一等入口。** Agent 执行前读取最新相关状态并校验写入前提；不能用旧对话中的内容覆盖人刚改的对象。普通输入、拖动和素材导入不被迫先经过聊天或批准卡。
- **旧历史保留，旧分裂不保留。** R1 暂保留 area 键用于兼容；R2-U1 显式迁到项目级对话归属，不把两个独立历史直接拼成一段虚假的共同经历，不保留两套长期活跃会话系统。

整体完成不能只展示“两个面板调用同一个 pi”。必须用一条真实对话证明：在创作下达任务，去生成查看结果，再去预览继续处理，Agent 仍知道同一作品、同一任务和哪些决定待用户处理。

## 2. 为什么代码散：正常分层和真正耦合要分开

用户的模型密钥不能进 React；React 编辑器也不能直接被搬到主进程。因此下列分散是合理的：

| 所在层 | 应负责什么 | 不应负责什么 |
|---|---|---|
| electron/harness（拟对齐 #179） | Agent 运行、会话工作上下文、受控工具接线 | 直接改画布 store、另建预算账本 |
| electron/ai | 模型目录/协议、共享文本任务、供应商接入 | 再保留一套旧 Agent engine |
| src/workbench/ai | 消息/历史/附件界面、公共 renderer client | 引入 pi、持有密钥或注册任意可执行工具 |
| 文档/画布/时间轴领域 | 真正的编辑动作、确认、Apply/Undo | 各自发明 LLM loop |
| memory / productionRun / capabilityCore | Nomi 记忆、生产状态、权限与账本 | 被 SDK 会话文件取代 |

真正需要改的是：

1. agentChatV2.ts 有 703 行，把模型选择、身份/skill、工具注册、历史、附件和运行揉在一起。
2. agentLoop、stream consumer、session cache 与入口直接使用 AI SDK 的模型、消息、工具和返回类型；不是只有一个 import 可换。
3. canvasTools.ts 中旧 SDK 工具表没有生产调用者，实际表又在 V2 内定义。测试有一部分在测死表。
4. “single-shot = 无工具”目前只是前端声明：后端没有按 mode 禁用工具。
5. 前端异步生命周期不一致：创作侧有 turn token，画布侧新对话/晚到确认保护不足。
6. 创作/生成的会话键、活动历史和面板消息各自分区，预览没有 Agent；这不是只移动 JSX 就能解决的外观问题，必须统一归属与生命周期。

这是职责和合同问题，不是“文件越少越好”。本期删除重复机制、收拢运行入口，不把全部 48 个文件搬进一个巨大的 Agent 目录。

## 3. pi 用哪一层，以及哪些东西仍是 Nomi 的

固定版本：pi v0.84.3，commit 4e58f324fae8ebfa98a3d45181fb248072a2afac。独立 R0 实验的兼容、快照与 Electron/ASAR 验证已通过；产品入口尚未切换。具体通过范围和未覆盖项见 R0 实施卡及验收记录。

| 方案 | 复用什么 | 代价/判断 |
|---|---|---|
| 继续 AI SDK4，只拆文件 | 不改变运行机制 | 可整理代码，但不满足本轮复用 pi 的目标 |
| 只用 pi Agent core | 模型/工具循环、流事件、内存消息、改向/取消 | 接缝少，但持久会话/压缩仍需宿主补；若又自写这些，就没有充分复用 |
| **受控 AgentSession（已选，兼容门通过后切换）** | 循环、会话上下文、自动/手动压缩、模型/工具生命周期 | 要验证 ESM、模型/PDF、工作快照恢复；禁用默认编码资源与工具 |
| pi AgentHarness | 新的高层接口骨架 | 固定版的关键方法仍 NotImplemented，不采用 |

正式包名是 @earendil-works/pi-coding-agent、@earendil-works/pi-agent-core、@earendil-works/pi-ai；锁定同一版本，不把新旧包名/版本混用。[固定版 SDK](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/sdk.ts)、[包声明](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/package.json)、[Harness 源码](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/agent/src/harness/agent-harness.ts)。

| 能力 | 归谁 | 具体边界 |
|---|---|---|
| 发模型请求、function/tool call 循环、流事件 | pi + 薄协议适配 | 不再维护第二个 AI SDK Agent loop |
| 会话上下文、压缩机制 | pi | Nomi 决定输入、成本/步数边界与快照放在哪里；不再抄一遍压缩算法 |
| 模型目录、用户选定模型、API key、baseURL/headers | Nomi | pi 不自动读另一套 auth、切默认模型或网络刷新目录 |
| 身份、Skill 方法、项目偏好、当前作品上下文 | Nomi | 已有项目记忆不被 pi 的默认 AGENTS 文件替代 |
| 工具名称/参数/schema | Nomi | 一份 descriptor；适配成 pi schema，最终仍执行现有 Zod 规范化 |
| 是否可写、可花钱、确认后的准确参数 | Nomi | SDK 工具可见性不是执行授权；批准后不得篡改执行值 |
| 画布/文档/时间轴实际操作、Proposal/Undo | Nomi | tool adapter 只进入现有业务路径，不自己再执行一次 |
| 预算、生成提交、任务状态、收据和恢复对账 | Nomi | pi token stats 和 session replay 都不能取代生产账本 |
| 三空间 UI 与用户交互 | Nomi | R1 不重画；R2-U1 基于获批样张统一宿主，不把内部 SDK 原语直接展示给用户 |

### 三个接入门不能掩盖

- **打包**：pi 固定版要求 Node >=22.19，ESM/import-only；Nomi 声明 Node >=20.19，主进程实际是 tsc -> CommonJS。先测开发态和真实打包产物；优先局部 ESM 接缝，不先全仓改模块系统。CI/开发最低 Node 版本若要提高，应显式记录。
- **PDF**：当前 Nomi 有原生 PDF file-part 路径；pi 的公开消息只有 text/image。若使用受控 provider/payload 适配，必须证明文本、图片、原生 PDF 的行为等价；不允许静默降级后称迁移完成。[消息契约](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/types.ts)
- **恢复**：AgentSession 没有可直接注入任意 Nomi store 的 fromSnapshot API。需验证完整工作快照导出/导入，保留 tool-call/result、压缩边界和叶子；不是把旧聊天气泡直接当全部模型记忆。[会话实现](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/session-manager.ts)

推荐受控 ResourceLoader（只给 Nomi 上下文）、显式工具名称白名单、内存 settings/session、Nomi CredentialStore 与禁用默认模型网络刷新。仅设置 DefaultResourceLoader 的几个 no* 开关不足以证明零资源发现。SDK 仍有 TUI/图像相关包依赖，“无 UI 嵌入”不等于“没有这类安装/打包依赖”。[ResourceLoader](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/resource-loader.ts)、[ModelRuntime](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/model-runtime.ts)。

ModelRuntime 显式设 modelsPath:null，避免读取默认 models.json；create 的 allowModelNetwork:false 不等于永久禁网，后续若 refresh 也须显式 allowNetwork:false。模型网络访问只通过 Nomi 已批准的配置路径，不因 SDK 初始化增加外部发现。

如果兼容门失败：记录具体不兼容项和替代成本，不把实验接入产品。回到选型讨论，不保留产品内“pi 失败自动退 AI SDK”的双引擎。

## 4. 目标目录：R1 的实际落位

```text
electron/
  harness/                         # 运行、能力与工作上下文；不复制领域业务
    agentChatContracts.ts          # Nomi 请求/事件/结果，不重定义 Thread/Turn/Item
    agentChatPolicy.ts             # 能力档、归属与精确目标
    runtime/
      runtimePort.ts               # Nomi 输入/输出端口，不泄漏 SDK 类型
      pi/                          # 唯一受控 AgentSession，私有 NodeNext 小项目
        nativeLoader.cts           # 延迟原生 import，不把主进程整体切成 ESM
        run.mts                    # 一轮运行、活动/用量、稳定收尾
        session.mts                # 受控资源与停止/释放
        model.mts                  # Nomi Catalog/凭证 -> pi 模型
        tools.mts                  # descriptor -> 现有确认/执行结果桥
        observeStream.mts          # 单一事件转发与模型请求超时
        ...                        # 附件、快照、旧气泡 codec、错误事实
    context/
      agentContext.ts              # Nomi 身份/Skill/项目记忆提示词
      agentContextHost.ts          # 主进程唯一服务实例
      contextService.ts            # 同绑定恢复、排队、运行、保存、清空
      contextStore.ts              # 项目内版本化快照与旧档原件备份
      ...                          # 绑定、路径、有限旧气泡导入
    tools/
      documentDescriptors.ts       # 文档工具的唯一描述/schema
      canvasDescriptors.ts         # 画布工具的唯一描述/schema
  ai/
    agentChatV2.ts                 # 保留名称的薄兼容入口，不留旧 engine
    agentChatV2Ipc.ts              # Electron IPC/窗口生命周期
    textBrainResolver.ts          # 从 V2 拆出的共享模型选择/状态查询
    ...                           # 非 Agent 模型/文本/接入模块继续留在这里
src/workbench/ai/                  # UI、会话投影、公共 client；不整体搬家
src/workbench/{creation,generationCanvas}/ # 真实文档/画布操作与现有确认
```

- 初始 main 没有 electron/harness；#179 的 domain 合同是另一个尚未合入的 PR。R1 不擅自合入 #179，也不复制 Thread/Turn/Item；已有运行端口与 DTO 服务本次切换，后续控制面继续对齐原合同。
- SDK 类型只留在 runtime adapter 和其私有快照编码中。main/renderer 共享的 DTO 保持 Nomi 自有、纯数据、无 SDK/Node 执行依赖；薄 facade 只组装 Nomi 模型、上下文与业务钩子，不保留旧运行引擎。
- 此树描述已实施的职责落位，不代表产品验收完成。完整文件阅读顺序和调用链以当前目录导览为准；每个新实现对应删除旧实现。
- textBrainResolver 是共享模型选择，不是第二个 Agent；保留 ai@4 给非 Agent 的文本、编译、验证路径不违反“唯一 Agent engine”。

## 5. 后端 22 个文件：逐项动作

下表是 R1 的文件处置，不是全部都改。R2-U1 的会话归属增量另见 §7；行号对应上述固定基线。

| 文件 | 现在做什么 | 本期动作 |
|---|---|---|
| [electron/ai/agentChatV2.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/agentChatV2.ts:578) | 703 行混合入口：身份、模型、工具、历史、附件、流输出；另导出非 Agent 也用的文本大脑查询 | 拆薄。prompt/入口能力进 harness/context；工具进 harness/tools；只调用新 runtime。模型目录查询提到共享 textBrainResolver，不能把非 Agent 调用者拖进 pi。 |
| [electron/ai/agentLoop.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/agentLoop.ts:42) | 92 行 AI SDK4 包装；生产只有 agentChatV2 一个调用；oneshot 只剩测试 | 替换后删除。唯一实现为 piRuntime；不保留旧 loop、oneshot 或运行时 fallback。 |
| [electron/ai/agentChatHarness.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/agentChatHarness.ts:69) | 旧裁剪、8/24 步上限、取消、前缀缓存、generateText 修参 | 职责拆开后删除。会话/压缩用 pi；步数和超时是 Nomi 配置；去掉第二条 AI SDK repair 模型调用。保留有价值的行为测试，不把旧裁剪算法再写一套。 |
| [electron/ai/agentStreamConsumer.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/agentStreamConsumer.ts:37) | AI SDK fullStream 翻译、首块90秒/空闲120秒、确认期间暂停计时、usage | 用 piEventAdapter 替换后删旧。保留等待确认、超时、单一终态和用量语义；禁止 SDK 事件与确认桥重复发 tool-result。 |
| [electron/ai/agentSessionStore.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/agentSessionStore.ts:20) | 项目内 v2/CoreMessage 工作缓存；不是生产账本，也不是完整审计日志 | 改为 Nomi 管理的版本化 runtime 工作快照；旧格式一次性导入。存储实现可归 harness/context，旧 facade 只在确有调用兼容需要时短暂保留，不保留第二实现。 |
| [electron/ai/agentChatV2Ipc.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/agentChatV2Ipc.ts:55) | 启动、事件、确认 Promise、取消、销窗清理、10分钟确认超时 | 保留 IPC 名称与薄壳，调用新 runtime；确认/取消校验所属 webContents，覆盖抢先停止、重复确认、晚到结果。 |
| [electron/ai/documentTools.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/documentTools.ts:59) | 6 个文档工具的描述和 Zod 参数，运行时确实使用 | 迁为 harness/tools/documentDescriptors.ts；保留业务 schema，删 ai.tool() 壳。author_skill 当前行为保持，不借换芯更改审批产品。 |
| [electron/ai/canvasTools.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/canvasTools.ts:138) | 画布/分镜/站位/运镜 schema；339–453 的旧 SDK 工具表无生产消费者 | 迁为 harness/tools/canvasDescriptors.ts；保留 schema、shots 字符串预处理、运镜 transform；合并 V2 中真正使用的描述，删死表。只保留一份真实 descriptor。 |
| [electron/ai/agentUserContent.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/agentUserContent.ts:49) | 本地图片/PDF读取、模型能力判断、文本抽取；消息形状仍耦合 SDK | 保留资产读取/能力规则；编码放 piContextAdapter。原生 PDF 是兼容门，不得静默降为纯文本或丢附件。 |
| [electron/ai/agentError.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/agentError.ts:36) | 空响应诊断、错误码；也被非 Agent 文本流使用 | 拆出 SDK 无关的错误契约与公共呈现；pi 接同一错误分类。保留非 Agent 入口，不能整文件盲删。 |
| [electron/ai/aiSdkVendorError.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/aiSdkVendorError.ts:79) | AI SDK 错误到 Nomi VendorRequestError；非 Agent 仍用 | 保留。通用 stall 构造若需要则下沉共享错误层；不复制一套用户错误文案。 |
| [electron/ai/modelProfiles.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/modelProfiles.ts:103) | 共享模型事实/兼容 quirks 和 Agent suitability | 保留事实源；旧 SDK 导致的工具能力限制需在 pi 验证后重审，不能照抄为永久模型缺陷。 |
| [electron/ai/vendorLanguageModel.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/vendorLanguageModel.ts:11) | Catalog 到 LanguageModelV1；Agent、文本节点、供应商编译共享 | 保留给非 Agent；新 Agent 用 piModelAdapter，但仍读同一 Catalog/凭证源。 |
| [electron/ai/buildAiSdkModel.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/buildAiSdkModel.ts:101) | 现有三协议 AI SDK 模型工厂 | 保留给文本/编译链；不随 Agent 迁移删除 AI SDK provider 包。 |
| [electron/ai/requestPipeline.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/requestPipeline.ts:257) | HTTP 模板、鉴权、URL、task-id；全媒体共享 | 不动。这不是 Agent Loop。 |
| [electron/ai/streamTextTask.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/streamTextTask.ts:59) | 单次文本/看图的文本节点和供应商验证 | 不动，仍使用 ai@4；它与对话 Agent 的迁移是两件事。 |
| [electron/ai/textStreamIpc.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/textStreamIpc.ts:30) | 文本节点流式输出和取消 | 不动，不并入会话式 Agent IPC。 |
| [electron/ai/promptSanitize.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/promptSanitize.ts:31) | Agent 与文本任务共享的兼容清洗 | 保留，并用原测试保证提示词字节行为。 |
| [electron/ai/onboarding/onboardingIpc.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/onboarding/onboardingIpc.ts:72) | 确定性模型接入、协议和连接探测 | 不动。现役代码没有 Agent/oneshot；不能依据旧注释迁它。 |
| [electron/ai/onboarding/modelListProbe.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/onboarding/modelListProbe.ts:66) | 模型列表 URL、鉴权和探测 | 不动，属于模型接入。 |
| [electron/ai/onboarding/modelListResponse.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/onboarding/modelListResponse.ts:11) | 识别真正的模型列表，排除 SPA 伪200 | 不动，合理的纯函数分层。 |
| [electron/ai/onboarding/vendorHealth.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/onboarding/vendorHealth.ts:126) | 主进程凭证、健康检查缓存和并发去重 | 不动，独立于 Agent 会话生命周期。 |

## 6. 前端公共目录 26 个文件：逐项动作

下表的“本期动作/不动”只指 R1 运行层切换，不是整体方案的最终处置。会话归属、历史和宿主在 R2-U1 必须继续调整，见 §7 的逐文件增量表。UI 留在 renderer，真正运行核留在 main。

| 文件 | 现在做什么 | 本期动作 |
|---|---|---|
| [src/workbench/ai/workbenchAiClient.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/workbenchAiClient.ts:58) | 请求/结果共同入口 | 改 typed 输入、明确 mode/entry、取消与一次终态；仍是 renderer client，不运行 pi。 |
| [src/workbench/ai/workbenchAgentRunner.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/workbenchAgentRunner.ts:63) | 面板公共运行/确认/usage 桥 | 薄化接线；保留完整确认结果字段与一次 usage 汇总。 |
| [src/workbench/ai/agentLoopMode.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/agentLoopMode.ts:46) | single-shot 包装 | 明确单次无工具能力档；main 强制执行。清历史不是禁工具的替代品。 |
| [src/workbench/ai/agentSessionKey.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/agentSessionKey.ts:22) | 项目/area/feature 会话寻址 | R1 暂保留键模板；R2-U1 迁到 project+thread，area 只作旧历史来源/视图上下文。 |
| [src/workbench/ai/workbenchAiTypes.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/workbenchAiTypes.ts:3) | 气泡/动作卡/方案卡 UI 投影 | 保留，不换成 pi 消息类型。 |
| [src/workbench/ai/agentUsageStore.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/agentUsageStore.ts:19) | 界面 token 累计 | 保留，适配后的用量只汇入一次；不作生产预算账本。 |
| [src/workbench/ai/conversationPersistence.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/conversationPersistence.ts:55) | 气泡投影持久化、回灌、线程切换 | R1 接 seed adapter/失效机制；R2-U1 版本化迁移 per-area 档案，改为项目级统一投影。 |
| [src/workbench/ai/conversationThreads.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/conversationThreads.ts:111) | project×area 活动/归档对话 | R1 保留；R2-U1 改为 project 的对话列表与 activeThreadId。UI 档案仍不由 pi 工作缓存取代。 |
| [src/workbench/ai/staleConversationDivider.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/staleConversationDivider.tsx:15) | 记忆范围提示 | 保留；新 runtime 必须兑现 alive/seed 的语义。 |
| [src/workbench/ai/AssistantMessageView.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/AssistantMessageView.tsx:54) | 消息展示 | 不动。 |
| [src/workbench/ai/AiReplyActionButton.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/AiReplyActionButton.tsx:31) | 插入文稿/复制 | 不动。 |
| [src/workbench/ai/AssistantErrorCard.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/AssistantErrorCard.tsx:13) | 错误/重试/模型设置入口 | 不动；新错误适配必须仍可分类。 |
| [src/workbench/ai/NoTextModelRecoveryCard.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/NoTextModelRecoveryCard.tsx:42) | 未配置模型的恢复入口 | 不动。 |
| [src/workbench/ai/AssistantModelPicker.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/AssistantModelPicker.tsx:21) | Nomi 模型目录选择 | 不动，不换 pi 默认模型列表。 |
| [src/workbench/ai/assistantModelPref.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/assistantModelPref.ts:9) | vendor+model 偏好 | 不动，接入要尊重现有选择。 |
| [src/workbench/ai/assistantModelIdentity.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/assistantModelIdentity.ts:43) | 双段模型身份与可用性 | 不动。 |
| [src/workbench/ai/CreationPromptPicker.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/CreationPromptPicker.tsx:40) | 提示词/流程包选择 | 不动；选方法论不等于授予任意工具权限。 |
| [src/workbench/ai/WorkbenchAiHeaderActions.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/WorkbenchAiHeaderActions.tsx:20) | 对话头部操作 | 不动。 |
| [src/workbench/ai/ConversationHistoryPopover.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/ConversationHistoryPopover.tsx:10) | 历史弹层 | 不动。 |
| [src/workbench/ai/ConversationHistoryList.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/ConversationHistoryList.tsx:30) | 归档列表/切换/删除 | 不动展示；共同生命周期负责使旧 turn 失效。 |
| [src/workbench/ai/useRafCoalesce.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/useRafCoalesce.ts:14) | 流式渲染合帧 | 不动；回归停止/终态时残留帧不再写回。 |
| [src/workbench/ai/aiComposerKeyboard.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/aiComposerKeyboard.ts:3) | Enter/输入法 | 不动。 |
| [src/workbench/ai/composer/AutoGrowTextarea.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/composer/AutoGrowTextarea.tsx:10) | 输入框高度 | 不动。 |
| [src/workbench/ai/composer/AttachmentRail.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/composer/AttachmentRail.tsx:123) | 附件 chip | 不动。 |
| [src/workbench/ai/composer/useComposerAttachments.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/composer/useComposerAttachments.ts:47) | 本地附件导入 | 不动，继续传资产引用，不向 renderer 暴露密钥。 |
| [src/workbench/ai/composer/composerAttachmentTypes.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/composer/composerAttachmentTypes.ts:7) | 附件瞬时状态 | 不动，不冒充模型消息格式。 |

### 跨目录接缝和受保护文件

| 文件 | 本期边界 |
|---|---|
| [src/api/desktopAgentsChatStream.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/api/desktopAgentsChatStream.ts:107) | 改事件/取消适配；保留现有 UI 响应形状，明确 cancelled，不把 error/cancel 又报成功。 |
| [src/api/desktopClient.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/api/desktopClient.ts:202) | 保留 facade 和 clear/seed/alive 公共入口；最多改类型导入/重导出。 |
| [src/desktop/bridge.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/desktop/bridge.ts:559) | 只改 Agent 协议段，完整覆盖实际 decision 字段。 |
| [electron/preload.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/preload.ts:436) | 同上；保持隔离桥，不把 pi 或任意执行器暴露给 renderer。 |
| [electron/promptLibrary/promptLibraryIpc.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/promptLibrary/promptLibraryIpc.ts:62) | 文本大脑状态改为直接依赖共享 textBrainResolver，不经 Agent 入口装载 pi。 |
| [electron/runtime.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/runtime.ts:104) | 核对 Agent 再导出；薄入口不得在模块加载时初始化 pi，避免非 Agent 导入路径被 ESM/资源发现连带影响。实际懒加载必须通过打包验证，不凭 TS 写了 import() 就当成立。 |
| [src/workbench/creation/CreationAiPanel.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/creation/CreationAiPanel.tsx:325) | 保留 UI/文档业务；接公共 turn/lifecycle，不重新画确认卡。 |
| [src/workbench/creation/creationTurnController.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/creation/creationTurnController.ts:80) | 复用已有 token/current 判断；补早于 cancel handle 的停止和晚到 handle 测试。 |
| [src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx:403) | 改生命周期：新对话/切项目取消旧 turn；异步批准后再次检查归属。保留 proposal/receipt/Undo UI。 |
| [src/workbench/generationCanvas/agent/generationCanvasAgentClient.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/generationCanvas/agent/generationCanvasAgentClient.ts:146) | 接明确 entry/mode 和会话归属；保留画布上下文和模型清单。 |
| [src/workbench/generationCanvas/agent/runStoryboardPlanner.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/generationCanvas/agent/runStoryboardPlanner.ts:41) | 接 planner 能力档与 turn 失效检查；只能读/产出方案，不能偷偷生成。 |
| [src/workbench/generationCanvas/agent/runDirectionPlanner.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/generationCanvas/agent/runDirectionPlanner.ts:137) | 只改 single-shot 接口，保留方向候选业务。 |
| [src/workbench/generationCanvas/agent/shotVerifyJudge.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/generationCanvas/agent/shotVerifyJudge.ts:25) | 只改 single-shot 接口，保留图片输入/失败语义。 |
| [src/workbench/capability/capabilityApplyHandler.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/capability/capabilityApplyHandler.ts:93) | 仅文本规划调用接线；不改外部批准、生成与成片的业务权威。 |
| [src/workbench/generationCanvas/agent/shotVerifyRunner.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/generationCanvas/agent/shotVerifyRunner.ts:56) | 不动逐镜取帧/结果映射。 |
| [src/workbench/generationCanvas/agent/generationCanvasTools.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/generationCanvas/agent/generationCanvasTools.ts:59) | 保留领域动作，不由 pi 重做 Zustand、边关系、时间轴操作。 |
| [src/workbench/generationCanvas/agent/applyCanvasToolCall.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/generationCanvas/agent/applyCanvasToolCall.ts:214) | 保留实际执行；在已有异步执行接缝核验所属 turn/project，不重写生成/建节点。 |
| [src/workbench/generationCanvas/agent/gate.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/generationCanvas/agent/gate.ts:56) | 保留 allow/ask/deny 与锁定政策；pi 工具白名单不替代它。 |
| [src/workbench/generationCanvas/agent/lockGateContext.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/generationCanvas/agent/lockGateContext.ts:7) | 保留锁语义。 |
| [src/workbench/generationCanvas/agent/proposalTxn.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/generationCanvas/agent/proposalTxn.ts:60) | 保留原子事务、补偿和回执。 |
| [src/workbench/generationCanvas/agent/proposalUndo.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/generationCanvas/agent/proposalUndo.ts:135) | 保留撤销/对账；SDK 会话回退不等于作品 Undo。 |
| [electron/events/agentChatTrace.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/events/agentChatTrace.ts:31) | 继续接 Nomi 事件；只补映射/关联，当前摘要 trace 不能宣称能完整重建 pi 上下文。 |
| [electron/memory/projectMemory.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/memory/projectMemory.ts:175) | 保留项目偏好及事实记忆，不迁入 pi 的默认 AGENTS/文件发现系统。 |
| [electron/capabilityCore/generationDispatcher.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/capabilityCore/generationDispatcher.ts:184) | 受保护：收据/lease 与外部生成权限，不能缩水为 approve:true。 |
| [electron/productionRun/productionRunService.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/productionRun/productionRunService.ts:529) | 受保护：批准校验、生产任务事实与状态推进。 |
| [electron/productionRun/budgetLedger.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/productionRun/budgetLedger.ts:64) | 受保护：预算与花费不由 pi token stats 取代。 |
| [electron/productionRun/submissionOutbox.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/productionRun/submissionOutbox.ts:137) | 受保护：不明提交与重复提交控制，不交 SDK 自动重试。 |

### 依赖和构建文件（额外范围）

| 文件 | 本期动作 |
|---|---|
| [package.json](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/package.json)、[pnpm-lock.yaml](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/pnpm-lock.yaml) | R0 先用独立 fixture 验证；正式采用时锁定 pi 版本及依赖，保留非 Agent 的 ai@4；明确最低 Node 与构建命令变化。 |
| [electron/tsconfig.json](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/tsconfig.json) | 当前 CommonJS 是已知接缝；只有验证证明必要时才做有界调整，不先全仓切 ESM。 |
| [electron-builder.preview.cjs](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron-builder.preview.cjs) 及 package.json 中打包配置 | 核实 ESM、资源和可选/原生相关依赖在真实产物里可用；按验证结果改，不能只依赖开发机 node_modules。 |
| [tsconfig.test.json](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/tsconfig.test.json) | 新 adapter/fixture 测试必须被测试类型门覆盖；不通过排除测试让迁移变绿。 |

## 7. 先做什么、后做什么：换芯后必须交付统一 Agent

### R0：先证明能接，不改产品运行入口

这不是前置产品设计项目，而是运行层自身的第一步。

执行清单见 [R0 兼容验证实施卡](2026-08-26-pi-r0-compatibility.md)。独立 fixture 放在 `experiments/pi-agent-runtime/`，不从任何产品入口导入；R1 通过后迁入正式 adapter 并删除实验实现，不留下双运行核。

- 对齐最新基线，记录 #179 合同差异。兼容验证用独立 fixture、临时目录、测试模型/模拟工具；默认不接真实项目写入或生成。
- 锁 pi 版本；验证受控配置确实没有默认 read/bash/edit/write、自动资源/凭证发现、模型偷偷切换。
- 验证三类既有协议、自定义 endpoint/headers、auth:none、选定 vendor+model、图片/PDF、工具结果及错误语义。
- 验证 CommonJS -> ESM 接缝、Electron 启动、真实安装包资源/依赖；不能只凭 Node/Vitest import 成功。
- 验证会话导入与恢复：可将完整私有工作快照物化为受控临时 JSONL，交给 inMemory SessionManager 的公开加载接口，再恢复保存的叶子。此路径是源码可行性推断，必须 round-trip；不调用私有构造器，不冒充官方 snapshot API。
- 只在任务稳定点保存完整快照；SDK message_end 通知可能早于内部 append，不能在该回调读到半份上下文。崩溃/中断场景独立验证。[Session 事件与压缩](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/agent-session.ts)

**出口：** 交出逐项成功/失败证据、实际依赖/包体影响、需要的兼容代码，而不是“demo 能聊天”。若原生 PDF/打包/恢复等不能等价，不能进入 R1 正式切换。这个包不受 B5 样张阻塞。

### R1：完整替换现有 Agent 运行链，在现有 UI 中交付

实施时可以按下列顺序开发，但产品切换作为一个完整边界验收，不长期保留两个 runtime：

1. 从现有代码提取 Nomi 入口合同、descriptor、prompt/context 和模型选择；不借机全做 B2/B3。
2. 接 AgentSession、模型/消息/工具/事件/快照 adapter，保持现有 IPC 外观。
3. 覆盖下面 6 条业务分支；统一处理生命周期、无工具模式、确认结果和用量。
4. 通过单测/契约/真机任务回归，同次删除旧 loop/consumer/harness 和死工具表。
5. 修正过期注释/测试/计划：明确已完成 runtime 换芯，不能把 B4 其他层一起划勾。

| 业务分支 | 本期必须保持的行为 |
|---|---|
| 创作对话 | 同一编辑器读文档、批准后修改；旧会话可继续，项目偏好还在 |
| 画布对话/定妆 | 既有节点/批量操作、确认、回执、一步 Undo 可用 |
| 就地分镜规划 | 使用工具产出方案；只允许规划/读取，不自动生成；它不是 single-shot |
| 方向候选 | 独立 feature 上下文，只回文本/结构结果，工具集合为空 |
| 镜级校验 | 图片输入、独立上下文和原失败语义，工具集合为空 |
| 制作文本规划 | 覆盖初稿、修改剧本、修改分镜 JSON，工具集合为空 |

**R1 的完成定义：** 用户在原有页面能继续完成上述任务，旧会话/模型/附件/确认/停止不退化；新对话不被旧回调污染；生产链只使用一个 Agent runtime。这不是产品“全局共编”完成。

### R2：继续原 #180 的 Nomi 专属工作，不重写整个方案

#### R2-U1：项目级统一 Agent（必交，不是可选 UI 优化）

归属 B4 的会话/工具/任务控制与 B5 的最小贯穿宿主，不新开第二个 Agent 系统。数据合同和样张可与 R0/R1 并行准备；生产接线在 R1 后推进，不必等完整 E2、全部 B5 或外部第三确认宿主。

| 文件/边界 | R2-U1 必须完成的变化 |
|---|---|
| [agentSessionKey.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/agentSessionKey.ts:22)、[conversationThreads.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/conversationThreads.ts:8) | 建立 project+thread 的共同归属；每个项目一个跨视图共享的 activeThreadId。保留主动新建/切换对话，view/area 不再决定会话身份。单次后台任务有独立上下文，不伪装成另一位页面助手。 |
| [conversationPersistence.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/conversationPersistence.ts:55) 与 main 会话快照/IPC 档案边界 | 两处旧历史通过版本化、幂等映射导入统一项目的独立历史线程，标明原来源；旧格式只作迁移读取，不双写。备份后保留全部已存记录，不因合并列表套用旧数量上限而裁掉历史。 |
| [conversationsStore.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/conversations/conversationsStore.ts:82)、[eventLogRepository.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/events/eventLogRepository.ts:68)、[agentSessionStore.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/electron/ai/agentSessionStore.ts:33) | 旧 threadId 可能跨 area 重复，导入映射须包含 project+legacyArea+oldThreadId。新身份显式传递 projectId/threadId，并同步唯一旧键解析/兼容入口及 local 项目策略；不能只给 key 加后缀而把 threadId 误当 projectId，造成记忆/trace/快照丢盘。 |
| [workbenchAgentRunner.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/ai/workbenchAgentRunner.ts:63)、[workbenchStore.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/workbenchStore.ts) 及 runtime context/tool registry | 面板专属消息、当前 turn、确认等待和生命周期收进一个项目级 owner；用 project/thread/task/target 关联结果。视图提供当前上下文，任务冻结自身目标；业务执行器仍留领域层，不能靠当前页猜执行对象。 |
| [runStoryboardPlanner.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/generationCanvas/agent/runStoryboardPlanner.ts:28)、[generationCanvasAgentClient.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/generationCanvas/agent/generationCanvasAgentClient.ts:165)、[fixationLauncher.ts](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/generationCanvas/agent/fixationLauncher.ts) | planner 显式继承父 thread/task 归属并限制能力，不再因复用 generation client 把创作气泡与模型记忆分到两桶；跨空间定妆交接改为有任务关联/确认收件的请求，不依赖切页后定时发事件接力。 |
| [WorkbenchShell.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/WorkbenchShell.tsx:247)、[CreationAiPanel.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/creation/CreationAiPanel.tsx:325)、[CanvasAssistantPanel.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx:403) | 在现有外壳提供同一 Agent 宿主；两面板中可复用的消息/提案/结果卡转为共同宿主的呈现或领域适配，删除各自的 Agent 会话和运行状态。不能保留两个活跃 owner 只同步气泡。 |
| [PreviewWorkspace.tsx](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/src/workbench/preview/PreviewWorkspace.tsx:11) 与三 Workspace 布局边界 | 预览同样接入共同宿主，保留素材、播放器和时间轴的专业形态。先提供已有能力与同一任务状态，不虚构 E2 尚未实现的剪辑工具；具体落位先基于真实外壳出样张。 |
| 历史弹层、头部动作、用量和任务中心 | 全部读取同一项目/对话归属；新对话、Stop、确认、重试不随页面各发一份。生产任务仍读现有生产真相，以关联键呈现，不复制为另一份可推进任务状态。 |

**历史迁移规则：** 不按时间把两条旧独立对话拼成模型“共同经历”。每条保留为可打开/继续的项目历史线程；能证明归属的旧工作快照随线程导入，缺失的模型上下文明确标记并重新读取作品，不能宣称已恢复不存在的记忆。迁移不重放工具、不复用失效审批；断点重试不重复建线程，失败可以从备份恢复。首次活动线程使用可核实的最近活动记录，无法判定则打开新的项目对话并保留两份历史，不伪造最后任务。

**可见交互规则：** 切创作/生成/预览只切工作视图，不中断在途 Agent、不清空输入、不重新申请同一批准。主动换项目/对话仍按既定生命周期收尾或失效，结果绝不落错归属；已受理的媒体生成继续由任务中心管理。人改同一目标后，Agent 结果保留为待检查候选或明确冲突，不静默覆盖；这不承诺任意字段自动语义合并。

**R2-U1 出口：** 三空间同一活动对话、连续消息/上下文、同一任务和待确认结果；旧历史可找回；页切换期间任务只执行一次；目标不随选择漂移；切项目不串作品。SDK 换芯成功但仍有两个 area Agent，不算此阶段完成，更不算总体交付。

#### R2 的其他原队列工作

| 原队列 | 与本次的关系 |
|---|---|
| B1 | 会话键、提示词合成、项目偏好已存在；复用。single-shot 的后端语义缺口在 R1 补齐 |
| B2 / B4-1 | R1 做接入必需的 descriptor/能力档/输入收敛；全量 registry 与所有残余入口清理继续按原合同验收 |
| B3 / B4-3 | R1 保留现有政策与批准链；后续才统一批准语义/控制面。不能说现在已统一 |
| B4-2 | 后续完善会话、作品事务、ProductionRun 的关联；两类日志不物理合并 |
| B4-4 | R1 的模型上下文恢复不是完整生产恢复；后续补停止/重启/重试/receipt 对账、未知提交恢复 |
| E2 | 时长/音频基础可并行；编辑计划卡需自身样张和必要的 revision/Proposal 合同，不等 B5 全量 |
| B5 | 最小全局宿主与会话/任务连续性已列 R2-U1 必交；其余交互深化继续原队列，不作为 R0/R1 的完整前置 |
| D3 | 瞬时播放头/选区/viewport 与内容版本分离，可独立；不是换 SDK 的前置 |
| L6 / Track C / E3 | 保持原依赖。第三确认宿主、Pack、审片智能不装进第一包 |
| SDK7 spike | 不与 pi 同时迁第二个 Agent engine；仅当独立文本链有明确收益再另议 |

原手册“保持 ai@4、不引入 pi”的选型结论已被本次用户确认调整，实施前需同步原文；仍保留 ai@4 给非 Agent 生产调用。总体统一 Agent 目标未变，改变的是通用运行层采用 pi、将项目级会话/宿主统一列为明确交付。不要把这次变更写成“完全沿原方案无需变更”。原 B4-1 的代码量估计也不能直接套到整个 runtime 迁移包。

## 8. 第一包必须遵守的最小合同

### 8.1 工具结果桥：特别防止执行两次

现有协议不是“主进程收到允许后再执行工具”：renderer 收到 tool-call 后，先按现有门控执行，再把 result/effectiveArgs 等回给 main。

因此新 pi 工具 execute 只是进入这个确认/执行结果桥并等待结果；收到 ok/result 后直接反馈模型，**不能再调用一次 executor**。完整透传：

- toolCallId、result、effectiveArgs、overridesDelta、silent、denied、proposalId；
- 所属 project/session/turn/window 和固定任务目标；R1 兼容 area，R2-U1 改用 project/thread 归属，area 仅作为视图/历史来源；
- 拒绝/取消/错误，不压成一个批准 boolean。

最终响应仍支持 id/text/raw（含 cancelled）/toolCalls/artifacts/usage/finishReason；raw 保持 Nomi 响应语义，不直接倾倒 SDK 会话/凭证对象。既有 initial/content/tool/tool-call/tool-result/tool-error/step-finish/result/error/done 事件按原调用契约适配，不丢非文本产物或取消状态，也不要求每轮强行发全部事件。

Nomi Zod 中的 preprocess/transform 是领域行为。工具 schema 从同一 descriptor 转换，执行边界仍跑同一规范化；用户改参后在实际写入/记账之前复验并冻结。不能只在 pi 入参处校验一次，不能维护一份手写 TypeBox 和一份 Zod。

内部画布生成现走 mintSpendGrant -> runPlanWithToasts；外部语义生成走 lease/receipt -> ProductionRun。第一包保留这两条现役权威链，不谎称它们已经统一，更不把合并两条链偷偷塞进换芯。

### 8.2 上下文和会话：复用机制，不搬走业务真相

- R1 暂保留 project+area/feature 寻址以缩小换芯回归；R2-U1 必须迁到项目级对话归属。不能因兼容要求永久保留两个页面 Agent，也不能在 R1 无声合并历史。
- Pi 工作快照包含完整模型上下文，使用量/压缩信息不能只存聊天文本；UI 对话档案、项目记忆和生产账本各有明确职责。
- 打开项目/切线程优先恢复其完整工作快照，不能沿用现有无条件 seed 把 tool pairs 和压缩状态覆盖成纯气泡。仅旧档且无匹配快照时允许一次明确标记的 legacy seed，并重新读取相关作品状态；迁移后不再走旧 seed 覆盖新快照。
- 快照是工作上下文缓存，不是作品、资产、批准或付费事实。恢复不得重放已发生的工具副作用。
- 旧 v2 快照导入后只写新格式；旧文件先做可恢复备份。若无法无损导入特定条目，明确报告，不默默清空会话。
- 不为“单一事实源”把不同职责的记录强行合成一个文件，也不新建第二个 ProductionRun。
- Nomi 当前 agentChatTrace 是摘要轨迹，并不能完整重建旧模型历史；B4 事件恢复仍是后续工作。

### 8.3 模式、取消、并发与错误

- main 根据明确入口解析能力档。single-shot 工具集合必须为空；planner 只读/提案；renderer 不能自带可执行工具或抬高权限。
- single-shot 每次调用创建独立工作上下文，不继承上一次对话；保留 feature key 和 Nomi 项目上下文，但不能仅依赖 best-effort clear 达成隔离。
- 同一会话同一时刻只推进一个 turn；R1 测旧 area/session 隔离，R2-U1 测同一项目对话跨视图连续且不同 project/thread 隔离。首包写/花费工具按串行策略运行；不沿用 SDK 默认并行而不审查。
- 新对话、切项目/线程、窗口销毁、Stop 都使旧 turn 失效；早于 session/cancel handle 建立的停止不能丢。
- 任何 await 之后的实际写入点复验当前会话/目标归属；错误窗口不能确认/取消别人的 session。
- 这层归属保护不等于同一作品所有字段的语义冲突合并。脚本选段稳定锚点、全作品 revision/CAS 和跨域 Undo 仍归后续合同，不能拿换 SDK 宣称解决。
- Stop/steer/Undo 是不同事。steer 等当前轮工具处理结束后改向；abort 不保证已提交远端任务已取消。首包聊天 Stop 沿已有语义停止后续 Agent 动作；已受理生成由现有任务中心取消，不擅自扩大为停全部生成。
- 若启用压缩/后台队列，停止要覆盖 abortCompaction、abortBranchSummary、clearQueue，再等待 abort/idle；固定版 session.abort 自身不取消压缩。不能只 abort 一段流后仍继续发模型请求。
- 首块/空闲/确认超时、8/24 步上限与错误分类都有明确测试。模型重试不是付费工具提交重试；提交未知先对账。
- 无效 JSON/schema 参数通过同一 pi 运行核返回工具错误，允许模型在剩余步数内纠正；纠错计入同一轮步数/成本、随 Stop 取消。验证通过前零副作用；不重建独立 repair 模型旁路，达上限则明确失败。
- 每轮只产生一个终态；错误不能先发 error 再 finished，cancelled 不能伪装为正常作品完成；usage/缓存/压缩 token 不重复汇总。

pi 的校验/调度/steer 行为依据固定版本，而不是官网一句“中断”宣传。[工具执行循环](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/agent/src/agent-loop.ts)、[Agent 控制接口](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/agent/src/agent.ts)。

## 9. 哪些测试保留、替换、新增

下表定位 R1 迁移责任；哪些基线/新测试已实跑、最终退出码分别记录在 R0/R1 实施卡，不能因表里列出测试就视为已通过。

| 已有文件/测试组 | 迁移动作 |
|---|---|
| electron/ai/agentLoop.test.ts、agentLoopIntegration.test.ts | 改为新 runtime 的真实工具往返测试；保留批准/拒绝/步数断言；删旧 SDK mock 后不能删行为覆盖 |
| electron/ai/agentChatHarness.test.ts | 策略测试移到新职责；旧手写裁剪测试被 pi 上下文/压缩往返测试替换，不再维护旧算法 |
| electron/ai/agentStreamConsumer.test.ts | 改事件适配测试；现有 cache usage 覆盖不等于超时/取消已覆盖 |
| electron/ai/agentSessionStore.test.ts、agentChatV2.seed.test.ts | 加 v2 导入、完整 tool pairs、压缩边界、重开、损坏快照、area 隔离与不重执行 |
| electron/ai/canvasTools.test.ts | 测真实送模型的同一 descriptor，保留 shots preprocess/运镜 transform；不再测死工具表 |
| electron/ai/composeAgentSystemPrompt.test.ts、agentUserContent.test.ts | 保留提示词字节/项目记忆、图片/PDF/文档行为；改编码接缝 |
| electron/ai/agentError.test.ts、aiSdkErrorWire.test.ts | 同一错误契约覆盖 pi 与保留的非 Agent SDK 路径；后者不是旧 Agent fallback |
| electron/ai/buildAiSdkModel.test.ts、aiSdkVendorError.test.ts、modelProfiles.test.ts、requestPipeline.test.ts、promptSanitize.test.ts | 保留，防非 Agent 文本/供应商链受损 |
| electron/ai/onboarding 下现有测试 | 保留；它们不是 Agent loop 测试 |
| src/workbench/ai/agentLoopMode.test.ts | 从“请求带 chat 字段”升级为 main 真正零工具/零确认等待的集成断言 |
| src/api/desktopAgentsChatStream.test.ts、src/workbench/ai/workbenchAiClient.test.ts | 加 error/cancel/finish 竞态、早停、重复停止、断连清理与一次终态 |
| 会话键、assistantModelIdentity、conversationThreads、creationPromptPicker 现有测试 | 保留原键、模型身份、历史和 UI 结构；必要的 facade 变更仅改导入 |

必须新增的验证矩阵：

| 场景 | 通过条件 |
|---|---|
| 6 条业务入口 | 都经新 runtime，产物落在原对象，不只跑一个聊天 demo |
| 批准、拒绝、重复确认、确认与取消竞态 | 现行政策要求确认的操作须有有效批准；原有 allow、方案产出、author_skill 不新增确认。一次批准只执行一次；取消胜出不再产生新副作用 |
| 切项目/新对话/窗口销毁/错误 sender | 旧结果不能写入新项目或新对话；无挂起 Promise/按钮卡死 |
| single-shot/planner | 三个单次分支零工具；同一 feature 连续调用、清理失败仍不串旧历史；planner 只能读/提案 |
| 参数失败/纠错/上限 | 无效 JSON/schema 不执行，不弹付费执行；同一运行核有限纠错，达到步数/成本上限结束，Stop 能中止 |
| 长历史、压缩、重开、旧缓存 | 当前上下文可恢复、压缩成本可计、历史工具不重复执行、项目/area 不串 |
| 模型/附件/协议 | 当前真实支持的文本、图片、PDF、自定义协议配置不退化；模型不偷换 |
| 流、错误、用量 | 有序/唯一终态，等待确认不被闲置超时误杀，usage 不漏不重 |
| Electron 真入口/打包 | 开发态和安装包均可启动、使用、停止、重开；不以 mock 代替 |
| 非 Agent 回归 | 文本节点、提示词优化、供应商编译/验证、模型接入照常可用 |

真机任务至少包括：选一段文稿让 Agent 修改并撤销；让画布 Agent 提案、批准后写入并撤销；执行就地分镜方案；运行三个 single-shot 分支；执行期间切项目/停止；重开接续旧对话。涉及真实生成测试按项目规则用批准的测试供应商与有界额度，记录实际消耗；不能把拿到模型回复算整个生成/导出闭环通过。

R1 发布仍需原 gates、check:test-types、独立 Electron 走查和亲眼截图。本期不改 UI 布局，现有界面是回归基线；若实现中需要新增可见交互，单独走样张批准，不借本方案自动获得重画授权。

R2-U1 另需真实跨空间用例：同一对话从创作发送指令，执行/待批准期间切到生成，再到预览继续；断言 thread 不变、在途 turn 不重启、任务目标不漂移、确认与结果不重复、下一条指令读取最新相关作品状态。补主动切线程/项目、冷启动恢复、两份旧档案幂等导入且无丢失（含同名 threadId、30+30 条和迁移中断）、新身份解析/落盘、planner 父会话归属、生成中人手修改同一目标的保护测试。截图必须来自该构建的三空间共同宿主；两处相同外观的聊天栏不能冒充统一。

## 10. 删除、回滚和交付口径

- 正式切换的同一交付边界删除旧 Agent loop、旧 stream consumer、旧 harness 机制和死工具表；生产不能双写/双跑。
- ai@4 和其非 Agent 调用保留；这不是并行 Agent 实现。
- 升级旧工作缓存先备份；回滚采用可恢复提交和匹配的缓存版本，不让旧程序误读新缓存。恢复不覆盖生产账本或用户作品。
- 用独立 task 分支/工作树交付，只提交本期文件，验证后提 PR；不直接推 main、不自动 merge #179 或自己的 PR。
- 当前实施工作树为独立 `codex/unified-agent-pi-20260826`，由刷新后的 `origin/main=84abca8d` 创建；共享工作树存在别的分支/冲突，未切换或清理它。后续交付前仍须检查远程是否推进。
- 用户已授权实施，R0 独立实验本地验收通过。只有阶段实际出口通过才更新状态；不能把“兼容验证通过”报告为“产品接入成功”或“Agent 已统一”。

### 六角色桌面复核

已做只读复核并收回修订；这是方案一致性审查，不是兼容测试、实际用户试用或产品交付证据。

| 视角 | 主要检查与已收口项 |
|---|---|
| CTO | 同意运行层先行；完整运行边界替换、保留非 Agent ai@4、不重复建设 domain 合同 |
| 后端 | 补同核有限纠错；共享模型查询直连 resolver；阻止非 Agent 导入时初始化 pi；确认结果不二次执行 |
| 前端 | 补完整响应/事件和单次上下文隔离；覆盖六入口、早停/晚到 handle 与会话失效 |
| 设计 | R1 不重画 UI、不因迁移给原有 allow 操作新增确认；R2-U1 共同宿主须走真实布局样张门 |
| PM | 不把完整 B5、B2/B3 或生产状态迁移塞成第一包前置；明确 R1 不是全部 B4 完成 |
| 用户任务代理 | 能继续旧会话、完成既有任务、手工接管/撤销；停止不谎称撤销已受理生成 |

额外 SDK 事实复核已补 modelsPath/refresh 网络边界、压缩/队列停止接口和工作快照加载限制。

## 11. 与原方案的证据连接

- [#180 手册 Part 6](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/docs/handoff/2026-08-26-codex-execution-handbook.md:310)：原队列；B4-1 是清理剩余入口，不是从零再造 B1。
- [统一 Agent 总计划](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/docs/superpowers/plans/2026-08-24-unified-agent-master-plan.md:40)：旧 pi 不引入结论，需要显式修订。
- [#179 B4 分期合同](https://github.com/aqm857886159/Nomi/blob/f7c23f8e3fb20e709622d88c00cf50d79ff6dfab/docs/plan/2026-08-26-b4-harness-implementation-plan.md)：固定 PR head 的 domain 合同，不是已在 main 的 runtime。
- [原运行时阅读/适配指南](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/docs/guide/agent-runtime-source-reading-and-adaptation.md:95)：已有可替换端口思路；SDK 具体能力仍以本次固定版源码为准。
- [总排期讨论稿](/Users/aoqimin/Desktop/Nomi-codex-execution-20260826/docs/plan/2026-08-26-pr180-execution-sequence-discussion.md)：本稿细化运行层和项目级统一 Agent；完整 B5 样张不阻塞 R0/R1，但统一交付不可省略。

**已确认方向：R0 兼容验证 → R1 替换六条现有业务分支的运行核 → R2-U1 项目级统一会话/任务/宿主并安全迁移历史 → 结合 E2 完成真实作品闭环。总体目标始终是贯穿三个空间的同一个 Agent；不是换完 pi 后继续保留两个页面助手。**
