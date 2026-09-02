# R1：现有 Agent 运行链切换实施卡

> 状态：实施中（A1、B0、B1、C 均已通过规格、质量独立审查；D/E 已接线，正在修复独立规格审查与真实 F 走查发现的生命周期问题）。R0 已在 `b4a3f466` 完成并通过独立审查、48 项兼容测试、主仓 gates 和 Electron/ASAR 验证；[PR #181](https://github.com/aqm857886159/Nomi/pull/181) 保持 Draft。
> 承接已批准的 [逐文件迁移方案](2026-08-26-pi-agent-loop-file-migration.md)；不是另一套 Agent 方案。

## 目标与边界

在现有界面中，把创作对话、画布对话、就地分镜、方向候选、镜级校验、制作文本规划六条路径切到唯一 pi AgentSession。保留 Nomi 的模型选择、Skill、项目记忆、审批和真实业务执行器。

不重画页面，不改 MCP 的权限、ProductionRun、预算或作品 Undo；不把 R1 报成三空间统一 Agent 已完成。R2-U1 仍必须交付项目级共同会话和宿主，新增 UI 先过真实布局样张门。

## 官方 SDK 文档复核（2026-08-26）

已读完用户指定的 [pi SDK 官方文档](https://pi.dev/docs/latest/sdk)，并与锁定的 `0.84.3` 类型、源码和 R0 实测对账：

- `AgentSession` 已提供工具循环、事件、压缩与停止；本方案直接使用它，不自己实现模型循环。`ModelRuntime`、内存凭证和自定义工具也是正式接口。
- `AgentSessionRuntime` 已提供 new/switch/fork/importFromJsonl；不能把“没有可直接注入 Nomi 工作缓存的存储适配器”说成“SDK 没有导入/切会话能力”。R1 用每次调用独立会话和 Nomi 绑定存储，避免把 cwd/资源发现与项目、线程混成同一身份。
- 默认资源加载会发现本机和项目的扩展、Skill、上下文；继续采用受控 `ResourceLoader` 和工具白名单，由 Nomi 注入现有 Skill 与业务工具，不额外开放 shell、文件写入或第二套资源权限。
- `preflightResult` 表示预检接受，不表示整个任务结束；已发起工具也不会因 steer 自动撤销。停止、摘要和最终状态继续按 B1 的真实生命周期测试验证。
- 文档图片示例使用嵌套 `source`，安装版 `pi-ai/dist/types.d.ts:251` 的 `ImageContent` 实际要求 `data / mimeType`。实现以锁定版本类型和三协议 wire 测试为准，不盲抄 latest 示例。文档中的默认设置、模型回退、自动发现也不直接作为 Nomi 配置。

这次复核不改变已批准的阶段顺序；SDK 提供通用运行机制，Nomi 保留项目/线程、审批、预算、MCP/Skill 和领域工具的既有权威。

## 两个必要的接缝决定

### 1. 局部 ESM，不切整个主进程

现有 `electron/tsconfig.json` 为 CommonJS；普通 `.ts` 中的动态 import 会变成 require。整个主进程切 NodeNext 的只读试编译已报 TS2835，会扩大改动范围。

采用独立 NodeNext 小项目：`electron/harness/runtime/pi/*.mts` 输出 `.mjs`，薄 `nativeLoader.cts` 输出 `.cjs` 并保留原生 import。现有 CJS facade 只加载这个已编译接缝，通过 Nomi 端口调用；SDK 类型不能越过适配层。非 Agent 的文本大脑查询不装载 pi。

构建、开发启动、类型检查、测试发现和 ASAR 都覆盖新扩展名。旧 main 存在不代表 runtime 产物齐全；启动检查要一起验证。根 Node 下限明确提高到 SDK 要求的 `>=22.19.0`，现有 CI Node 24 不另作迁移。

### 2. 完整快照不能再被气泡覆盖

当前 `conversationPersistence` 在打开项目和切历史时都调用 seed；旧 runtime key 又只有 project+area。若只改成“有快照就不 seed”，切历史会读到另一条对话的模型上下文。

R1 保留旧 area key 的字面值，但请求、恢复、清理增加显式 `threadId` 元数据，工作缓存按该 key 与 thread 寻址；不把 thread 后缀拼到旧 project 解析器里。旧历史仍分两个列表，这是 R1 的过渡边界，不是最终统一方案。

优先恢复匹配线程的完整快照。仅没有快照的旧档允许一次标明来源的历史导入；能证明归属的 v2 工作缓存保留工具对，否则保留原件并从气泡重建有限上下文，不能声称恢复了不存在的完整记忆。旧文件可恢复备份，迁移不重放工具、不恢复旧批准。

当前 v2 工作缓存实际上没有 threadId、消息时间或绑定记录；当前活动线程、相同尾句、文件时间均不足以证明归属。因此本轮现役迁移采用保守路径：先按原始字节备份，再只导入明确目标线程的气泡，标记 `legacy-limited`；未绑定 Core 历史留在备份中，不猜测合并，也不为不存在的绑定编写闲置转换器。

新工作快照以 `{sessionKey, threadId}` 的完整二元组寻址。空 seed 只确保空绑定，不删除完整快照；打开项目/切历史时的 seed 是 ensure-if-absent。新对话不得清掉归档线程；clear 必须先停止并排空同绑定运行，再保存 cleared 状态，避免迟到回调复活旧内容。单次任务完全不进入这条持久化链。

## 分片执行（同一个正式切换边界）

### A. 提取 Nomi 合同与唯一描述

- [x] Nomi 自有请求、事件、完整工具决定和结果端口，不引入第二份 Thread/Turn/Item。
- [x] 共享模型选择迁至 `electron/ai/textBrainResolver.ts`；非 Agent 调用者直接依赖它。
- [x] 身份、四层 system prompt、Skill 和项目偏好复用现有内容。
- [x] 文档/画布 Zod schema 与实际工具描述收进 `harness/tools`；删死 SDK 工具表，不复制领域规范化。
- [x] 用现有模型排序、prompt 字节、shots preprocess、camera transform 测试验证迁移；新增入口先 RED。

A1 证据：独立 AST 对账确认模型选择、提示词、11 个画布和 6 个文档描述及领域 schema/transform 等价，旧运行/历史逻辑未改；规格审查 9 文件 101 测试通过。质量审查发现当前 pi 包名前缀的测试护栏遗漏，补正反样例后先红 4 / 绿 74，再全绿 78 / 78；独立复验通过。类型检查、测试类型门（存量 111 未增加）、定点 lint 和 i18n 门通过。正式运行端口仍留给 B1，不能据此声称 pi 已进入用户入口。

### B. 迁入通过 R0 的运行核

为保持每片可独立验证，先做 B0「私有 ESM 模块与构建迁移」，再做 B1「Nomi 运行端口与事件/生命周期」：B0 把已经通过的 R0 适配和 48 项测试迁到正式私有目录，接入根构建、测试与门岗；不提前修改生产入口，也不导出带 SDK 类型的占位 API。B1 再提供真正的 Nomi 端口及原生 CJS 加载接缝。两片仍在同一个 R1 正式切换提交内完成，实验实现不保留为 fallback。

- [x] 迁入受控 session/model/tool/PDF/snapshot 适配，移除实验实现；根依赖固定同版 pi，保留非 Agent ai@4。
- [x] NodeNext 小项目及原生 CJS 接缝进入 build/dev/typecheck；新扩展名进入 lint、文件体积、测试类型门。
- [x] 唯一 SDK 事件适配：流式内容、工具结果、错误、用量和单一终态；不同时由工具桥与事件镜像重复发结果。
- [x] Nomi 8/24 步边界与首响应 90s / 空闲 120s 通过 SDK 公开接缝控制；等人确认暂停闲置计时。
- [x] 参数无效在同一个 SDK 循环内返回错误并有限纠正；新运行核不含独立 repair 模型调用（旧入口删除仍在 E）。
- [x] 压缩使用 SDK，保留摘要提示词/预算/用量；取消覆盖 prompt 预检、运行、工具等待与摘要。

B0 证据：7 个私有模块和 48 项原生测试已迁入根构建；离线安装下载 0 包。规格审查独立复跑 native 48/48、构建守卫 26/26、CJS+7 个 `.mjs` 编译、类型门（native 0 / legacy 111）和 23 项门禁链，全部通过。质量审查额外完成 8 项隔离边界探针，无遗留问题。12 个迁移文件的归一化源码和发射 JS 等价；旧实验 tracked 实现已删除、可从 R0 提交恢复，ignored 产物未删。B0 当时保留的实际 `nativeLoader.cts` 接缝已由下述 B1 完成；产品入口和正式 Nomi ASAR 仍未验收。

固定版源码与实际 SDK 探针已确认：`agent_end` 不等于整个会话结束，压缩后可能继续；唯一业务终态以 prompt Promise 稳定收尾为准。步骤上限归整次调用，不因 SDK 自动续跑重置；single-shot 必须同时零工具、一步、关闭自动重试/压缩续跑。停止代次 signal 合入每次模型请求，包含摘要；SDK 把取消包装成 error 时，Nomi 已取消状态仍优先。用量逐实际请求只记一次，摘要失败前已经消耗的 token 也不能漏掉。

#### B1 的具体接线合同

- CJS 与私有 ESM 之间只传 Nomi 的模型配置、文本/图片/PDF、Zod 工具描述、工具决定、用量、错误事实和不透明快照字符串；不输出 SDK 的 Session、Message 或 Stream 类型。既有模型档案的请求调整仍由 Nomi 提供，不在 pi 层重写供应商判断。
- 一次调用创建受控 session，恢复指定快照、执行、稳定收尾、导出工作快照并释放。跨调用的绑定、排队、落盘属于 C 片；运行层不再另做一套项目/线程存储。
- 内容与工具活动可以流式返回；最终结果只返回一次，含 `finished / cancelled / error`、文本、工具记录、实际用量和错误事实。D 片在空响应诊断和落盘完成后发一次 `result / done`，不把 SDK 的中间 `agent_end` 当用户任务完成。
- 工具原始参数先过唯一领域 Zod 解析，再交给已有宿主审批/执行；回传完整决定但不再次执行。工具错误可由同一个 SDK 循环有限纠正，拒绝不是换个通道重试授权。
- 超时适配只转发 SDK 的原生模型事件：单一消费者同时服务普通迭代和摘要的 `result()`，每次模型请求结束即撤掉计时器，等待人工确认时不计模型闲置。异常与取消必须能唤醒等待，不捏造模型成功消息；迟到事件不再转发。
- 当前轮完整作品上下文仅在模型请求时注入；持久记录保存简短用户意图及真实附件/文档内容，避免下一轮重放整张旧画布。摘要仍使用 SDK 自己的提示词和输出预算，不能被当前轮 prompt 替换。
- 用真实 SDK/本机 HTTP 验证：多步工具、单次任务、8/24 步、无效参数纠正、拒绝/停止、摘要及失败用量、三协议错误、两轮附件与完整快照；超时另外用短时钟验证预缓存事件、只读 `result()`、长审批与迟到竞态。

B1 首轮实现记录（独立审查及修复结果见后两段，不代表产品切换）：实现者 fresh 验证 native **113/113**（原 R0 48 条全部保留）、wiring **6/6**、build:electron、typecheck、check:test-types（native 0 / legacy 111 未增加）、定点 lint、diff check 均 exit 0。父代理另独立重跑上下文/压缩 **11/11，exit 0**。期间真实 HTTP 揭示并修复：压缩掉原 user 后的继续请求丢失当前作品状态、同毫秒同文本把状态注入旧 user；修后每次 normal 请求保留本轮状态，summary 与持久快照不含该瞬时全文。恢复后的请求仍计入整轮 8/24 步，摘要前已发生的用量不因后来失败而遗漏。没有修改产品入口、线程存储或正式 Nomi 打包验收。

B1 规格审查独立复跑 113/113 与 wiring 6/6，并发现错误正文先截断后脱敏会泄漏跨边界的密钥前缀。窄修的定向 RED 为 22 测 14 绿 / 8 红，修后 22/22；改为有界 lookahead 识别完整 literal，仅发布原前缀脱敏后的内容。实现者 fresh native **122/122**、wiring **6/6**、构建、类型门、定点 lint 和 diff check 全部 exit 0。规格审查已独立复验 22/22 和原复现，确认原 Response 不变、输出已脱敏，结论 PASS；随后通过下述独立质量审查。

B1 质量审查结论 **PASS，无未解决问题**。独立复跑生命周期/观察器/取消/watchdog/错误 **35/35**、端口与工具 **6/6**、选定 stop/dispose **5/5**、Vitest wiring **6/6**、原生编译及 diff check 全部通过；最初 wiring 误用 Node runner，已更正为该套件实际使用的 Vitest 并通过。B1 到此验收的是底层运行端口，不是现有产品入口或跨空间共同会话。

### C. 工作快照与线程恢复

- [x] 显式 thread 绑定及 ensure/inspect/alive/clear/run 服务；项目解析仍使用旧 key 的单一规则。start/seed 等 IPC 在 D 消费此接口。
- [x] 新快照完整落盘；旧 v2 与纯气泡导入有版本、备份和归属验证。
- [x] 绑定恢复、冷启动、两 area 同名 thread、损坏快照、迁移重试均有测试；历史工具执行次数为零。界面切历史仍在 D/F 验收。
- [x] 临时任务绕过持久存储、每次新上下文，不靠 best-effort clear 保证隔离；三个真实单次入口在 D/F 接通验证。

具体落位：`harness/context` 管工作缓存的绑定、原子落盘和同绑定生命周期；私有 pi 模块只负责把明确的旧气泡导成快照、验证或恢复快照，不接管项目目录、活动线程和批准记录。原 `agentSessionStore` 在 D 接线前仍供旧入口使用，正式 R1 提交在 E 同时删除，产品中不双写。

C 与 D 的消费接缝已确定：`AgentContextScope` 明确分持久 `{sessionKey, threadId}` 绑定和临时任务；`ensure / inspect / clear / run` 由同一服务管理。`run` 在绑定队列内执行 `prepare(signal)`，注入匹配快照，等实际运行稳定收尾后保存。`inspect` 只返回来源、ready/cleared 状态和保留消息数，不把 SDK 快照送到界面；D 的最终结果同样使用白名单字段。领域选择、工具批准和供应商调用仍由各自原有责任层负责。

- 绑定键由 `JSON.stringify([sessionKey, threadId])` 计算，记录中仍保存并核对完整二元组；文件位置复用既有项目解析器，不把 threadId 拼进 sessionKey 或文件路径。两个 area 恰好同名的旧 thread 不能串档。
- 首次改写旧 v2 文件前，按原始字节生成带摘要的独占备份并校验已有备份；备份失败、未知文件版本、无法读取或损坏的整文件都不覆盖。工作快照写入复用 `writeJsonFileAtomic`，不另写弱化的原子文件实现。
- 新记录区分 `native / legacy-limited` 来源和 `ready / cleared` 状态。导入旧气泡不冒充真实模型、用量或历史工具调用；无法绑定的 Core 历史只留原件。重复 seed、空 seed、重开项目都不能覆盖已存在的完整快照或 cleared 标记。
- 旧气泡的文本规范化提取成无 SDK 的唯一 helper，保留已有角色、操作旁注和兼容处理；操作旁注只是旧界面的文字记录，不伪造 tool-call/tool-result 或批准。C 期间旧入口可调用同一 helper，运行切换和旧缓存删除仍在 D/E。
- 同一绑定的准备、运行和落盘串行，其他绑定可以独立推进。异步恢复结束后重新检查取消代次；写回时重新读取同项目最新容器再合并，不用恢复前的旧 map 覆盖其他线程。
- clear 先关闭该绑定的新请求准入、使已排队请求失效并取消在途运行，排空后写 cleared；之后才重新开放。普通 Stop 则保留已实际完成的上下文，二者不能混为一谈。
- 某条快照损坏时，只阻止该绑定被无声续写；保留原件与其他绑定，明确返回恢复错误。单次任务不读、写、清任何持久绑定。
- 验证使用临时项目和真实快照：相同 threadId 跨 area、交错完成的双线程、seed 与 start 竞争、clear 后迟到结果、重复迁移、损坏单档、备份失败、未来版本；所有恢复测试断言历史工具执行次数为零。

C 的准备探针（不是 C 已完成）：固定 SDK 的 `SessionManager.inMemory` 可把旧文本按 user/assistant 原角色导入，并用 `nomi-legacy-import / unknown` 明确标识未知模型、独立 custom entry 标注未知时间/用量。经现有真实快照导出、恢复后 3 个 entry 与角色逐项相同，工具调用为零、临时目录无残留；后续实现不需要伪装成某个真实供应商，也不需要生成历史工具结果。

C 实现者验收记录（独立审查结论见下段，尚不代表 IPC 或 UI 已切换）：绑定、v3 原始备份/原子合并、旧气泡 helper、真实 SDK codec 和生命周期服务已冻结。定点 context + 原 seed + wiring **71/71**，完整 native **132/132**（原 122 + 新增 10）通过；build:electron、typecheck、check:test-types（native 0 / src 0 / legacy 111）、严格定点 lint、filesize、test-waits、diff check 均 exit 0。竞态测试覆盖同绑定串行、不同绑定交错、clear 期间 import/prepare/restore/运行/排队的迟到结果、普通 Stop 保存实际历史、清理写失败后保持关闭。最终持久化失败保留实际文本、工具结果与用量并明确报错，不以成功或空用量掩盖。D 的 main 宿主须持有同一服务实例，不能每 turn 新建队列。

C 独立规格审查 **PASS**：逐项阅读 17 个冻结文件，独立复跑定点 **71/71**、真实 SDK codec/storage **10/10** 与原生编译，均 exit 0。父代理也 fresh 复跑定点 **71/71** 与 diff check，通过。独立质量审查 **PASS，无可行动问题**：比对 7 个源码与实际测试产物一致，复跑真实 storage **6/6**，另验证连续 64 轮结束后外部 abort 监听为零、持久化失败保全实际结果、clear 失败拒绝准入与重试、迟到成功不复活快照。审查没有把本片报告为 UI/IPC 接入、正式 ASAR 或整个 R1 已完成。

### D. 现有入口与生命周期

能力与历史生命周期分别声明，不能复用一个模糊的 `chat` 字符串：画布 UI 的 chat 是保留对话历史的无工具问答；创作的 general.chatOnly 仍有读文稿等已有能力，不能按同名字面一并清空。方向/校验/制作文本才是无历史 single-shot。创作内就地分镜继承发起对话；外部制作流程的分镜规划只有 project/run/operation 归属、没有 UI thread，应使用独立临时上下文，但仍保留只读/产方案的多步工具循环。Skill 只提供方法，不据其名称授予工具。

- [ ] 薄 `agentChatV2` 调新 runtime；六条业务分支明确能力档，single-shot 零工具，planner 仅读/产方案。
- [ ] 保留完整工具决定的 result/effectiveArgs/overridesDelta/silent/denied/proposalId；renderer 已执行的结果不得在 main 再执行。
- [ ] IPC 确认/取消绑定所属窗口；重复确认、取消胜出、销窗、早于启动回执的停止均收敛一次。
- [ ] 订阅先于可能到达的流事件，避免首字、工具调用和终态丢失。
- [ ] 新对话、切项目/线程使旧 turn 失效；领域异步写入点检查仍属于原任务，旧回调不污染新会话。
- [ ] Stop 明确 cancelled；不将错误或取消又报 finished，不把聊天停止冒充已提交媒体任务撤销。

D 按接缝依次验收，不再把整套接线塞进一个巨文件：

1. **D1 主进程 facade**：保留模型选择、四层 prompt、模型档案请求调整、附件提取和已有厂商错误分类，调用 B1 端口与 C 绑定存储。能力档明确声明创作读/写、画布 agent/chat/refine、planner、single-shot；可用工具由档位决定，不由 Skill 名字扩权。normal prompt 与附件持久内容分别准备，不能把旧画布全文存回历史。
2. **D2 IPC 与共用客户端**：客户端先生成请求 ID、订阅并拿到取消句柄，再发 start。主进程把请求绑到发起窗口/主 frame，完整回传工具决定；取消只请求主进程收尾，不在 renderer 伪造 finished。最终结果先携带已发生用量，再发送一次 done；失败、取消和成功都经同一用量收口，不在 runner 再加一次。
3. **D3 六入口与历史投影**：发起时同步捕获 project/thread/模式/精确目标，随后才等待模型清单等异步准备。创作内 planner 继承该对话，外部 production planner 是有工具的临时任务；三个 single-shot 不读写历史。新对话/切线程/切项目使原 turn 回调失效并停止，切专业视图本身不改任务归属。seed 传显式 thread、只 ensure，不再用界面气泡覆盖完整快照。

D3 必须补一个现有错绑反例：A 项目读取延迟，用户切到 B 且 B 先加载完，随后 A 才返回。过期检查必须在投影气泡之前，seed 必须使用原请求的 project/key 和目标 thread，不能在 await 后从当前 URL/activeId 重新拼绑定。仅新增 threadId 不会自动修复这个竞态；以逆序返回测试验证。

D2 官方接口复核（2026-08-26）：Context7 `/electron/electron` 和 [WebFrameMain](https://www.electronjs.org/docs/latest/api/web-frame-main)、[WebContents 导航事件](https://www.electronjs.org/docs/latest/api/web-contents#navigation-events) 已与安装版 `electron.d.ts` 对账。接到 IPC 时立即捕获 `senderFrame`，不能等异步操作后再取；`routingId` 只在所属 renderer process 内唯一，归属验证须包含 `processId`。定向事件使用原 frame 的 `send`，并检查销毁/脱离；文档重载与进程销毁使原任务失效，但 in-page 导航不等于换了文档，不能把专业视图切换当 Stop。收尾移除该任务添加的监听器。

本阶段的目标守卫针对运行接线中的项目/线程错绑与迟到回调；跨脚本、画布、时间轴的语义 revision/合并/Undo 仍承接原 B4/E2，不能把 R1 的取消测试说成全作品并发编辑已解决。

D/E 首轮实现证据：六入口、显式能力/历史、单例上下文宿主、窗口/frame 绑定、提前订阅/停止、实际用量收口和异步写点守卫已接线；实现者定点 40 文件 **314/314**、构建、类型、严格定点 lint 均通过。测试类型存量从 111 降至 109，未新增债。父代理已将 `origin/main@7dab8ee8` 无冲突合入工作树（尚未提交），整合后完整 build exit 0。

独立规格审查另外运行 24 文件 **139/139**，但两个只读真实函数反例仍失败：确认超时/回合终态后旧文稿卡能写入；批量生成等待授权或上传同意时切项目，会把尚未提交的批次交给新项目。F 截图又发现冷重启后进程内消息序号复用，续聊覆盖旧气泡。三处均须先补 RED，再窄修、focused 复验和重跑实际界面；当前不能据上述单测宣布 D/E 验收完成。

### E. 删除旧运行实现

- [ ] 删除 `agentLoop`、`agentChatHarness`、`agentStreamConsumer`、旧 CoreMessage 工作缓存实现及死工具壳。
- [ ] 对应测试转为新行为覆盖，不为删除旧代码而删除批准、拒绝、恢复、缓存用量等断言。
- [ ] 全仓扫描只剩一个生产 Agent runtime；非 Agent 文本/编译/验证仍走原 ai@4。
- [ ] 更新目录说明、旧注释和原计划状态，明确 R1/R2-U1/B4 各自完成范围。

现有五个直接调用 `chatV2Start` 的评测脚本也随协议切换：apimart-text-brain、modelscope-expand、staging-reference、staging-agent-eval、storyboard-methodology。它们继续是只观察/拒绝执行的评测，不冒充 UI 闭环；共用一个测试侧公开 IPC 驱动，先订阅再 start、使用显式能力和临时历史、以真实 done 与用量收尾。不能保留旧请求形状或靠网络延迟避开订阅竞态，超时不得当成功。

目录职责见 [harness 导览](../../electron/harness/README.md)。通用运行和上下文集中，作品编辑、预算、MCP 与非 Agent 文本任务仍留在各自责任层；“一个 Agent”不以复制这些业务实现为代价。

### F. 真实任务与发布门

- [ ] 六条路径通过真实 Electron UI/IPC 到真实 SDK 和受控本机模型服务，不以直接调 adapter 代替产品入口。
- [ ] 文稿改动与撤销、画布提案与撤销、就地分镜、三个单次任务、切项目/新对话/停止、重开续聊。
- [ ] 本轮实际构建截图亲眼检查；界面沿用现状，没有获批新样张就不新增控件。
- [ ] 正式 Nomi ASAR 走同一 Agent 链和快照恢复；另回归现有 MCP 包装，记录平台覆盖，不把隔离 R0 当产品打包证据。
- [ ] 根 gates、runtime 测试、类型门、打包/走查分别记录字面退出码；真模型验证单独记录供应商与消耗，不与零额度 fixture 混称。

F 的入口地图已按现有代码核实；实际执行结果单独记录，不把路径存在当验收通过：

| 入口 | 从哪里真实发起 | 必须验证的结果 |
|---|---|---|
| 创作对话 | 创作 AI 输入 → 发送 → 文档应用卡 | 批准前原稿不变、批准后实际文档与持久快照改变；工具只执行一次 |
| 画布对话 | 生成助手输入 → 提案批准 | 真实节点/连线与 proposalId 对应，完整决定回传；撤销检查领域状态 |
| 创作内就地分镜 | 创作对话 → storyboard 动作卡 | 真实 planner 产出 storyboardPlan；仍在创作视图，确认前不写画布 |
| 方向候选 | 公开 productionRuns.createDraft | 真实 renderer 请求 → direction-v1.json → 任务中心候选与选择回执 |
| 制作文本 | 任务中心批准方向 | 真实脚本请求 → script-vN.json 内容/hash → awaiting_script_review |
| 镜级校验 | 分镜落画布 → 本机图片服务生成镜头 | 自动 judge 请求确含图片；刻意低分回执实际进入对应镜头 deviation |

复用 `_launchApp.mjs` 的四目录隔离和 `agent-panel-system-prompt.walk.mjs` 的本机 SSE/catalog，不复制用户真实目录。F **关闭 `NOMI_E2E_PRODUCTION_FIXTURE`**：它会直接替换 renderer 请求并返回方向/脚本/分镜静态结果，不能证明 Agent 接线。图片成功节点须有 shotIndex/result.url、文本模型声明图像能力，不能拿空 deviations 当 judge 成功。

四条 fixture 的参数已经当前纯解析器验证，仍需实际 UI/SDK 验收：inline planner 直接传 `propose_storyboard_plan` 参数而非 `{plan: ...}`，产物先处于 editing，确认前不写画布；方向响应至少两项，剧本响应为纯文本。自动镜级审片仅由批量生成完成链触发，不能以单节点生成替代；构图分数 1/2 才构成低分偏差，0 是无法判断。当前方向选择保存 `decidedChoiceKey`，而脚本请求仍仅收到 brief，因此本轮验证选择回执与真实脚本产物，不冒称已实现“选中候选内容传入剧本”的额外业务改造。

生命周期任务串起：A 对话批准一次真实写入 → 长流中 Stop → 无迟到写入 → 新建 B 且无 A 上下文 → 关闭进程 → 同隔离目录重开 → 切回 A 续聊，完整工具结果仍在、执行计数不增加。仅 reload 不等同冷重开。

正式包依次运行 `pnpm run build`、`pnpm run dist:mac:dir`，后者的 packaged MCP smoke 必须通过；再用同一包内 renderer 跑 Agent 与恢复任务。开发态 `test:mcp-journey`、R0 合成包或直接调用 adapter 均不能替代正式包证据。

真供应商另走 `agent-runtime-provider.walk.mjs`：显式评测开关 + 正式包，仅读已配置 APIMart 的供应商/单一模型/加密凭证，复制进新隔离设置目录；不启动真实用户目录、不复制作品或别家密钥。通过真实创作输入完成短问答、批准一次追加、撤销，以真实快照/事件中的模型与 token 用量记账，收尾删除临时凭证文件。官方通用接口已于 2026-08-27 复核为 `POST /v1/chat/completions`、Bearer 和 SSE（[官方文档](https://docs.apimart.ai/en/api-reference/texts/general/chat-completions)）；公开页未列工具及 stream_options 细节，不冒称文档保证，以本次真实运行结果单独报告。

F 测试设施准备记录（不是产品验收）：本机 HTTP fixture 15 条、旧公开 IPC 评测驱动 20 条、收尾/启动入口 11 条、真供应商脚本的隔离文件清理 3 条，父代理 fresh 合计 **49/49** 通过。独立审查已堵住“只验证 area 未验证父 thread”“过滤空记录漏报持久化污染”“请求先发、事后补批准”三处断言缺口。后续审查发现并以 RED→GREEN 修正：继承其他 Vite 入口、关闭期间的迟到请求漏检、临时凭据部分写入失败绕过清理、源文件变化仍报 passed。最后的定点 lint 还暴露进程收尾双重失败的 cause 链不完整，新增回归先红后绿，保留原始错误与清理错误。正式测试清空所有开发 URL 开关，两种运行模式都要求自己的 file 入口；收尾失败也必须落失败报告。实际 F 已启动，尚未花费真模型额度。

F 首轮开发态记录（**未通过最终验收**）：编辑任务确实完成批准/撤销、停止、新线程隔离和真实进程重开；`.tmp/pi-editing-development-1787762536107` 的旧断言曾通过，但父代理亲眼检查七张截图发现新回复覆盖第一条旧回复。因此该轮不能算通过，增强顺序/唯一 ID/完整历史落盘断言后，`.tmp/pi-editing-development-1787762892803/report.json` 实际 exit 1，明确复现 `F_DOC_DONE` 被 `F_RESTORED` 覆盖。制作任务已跑通父对话继承与分镜确认；批量入口按现有交互须先取消节点选择，测试路径正在修正，不为匹配测试改变产品布局。

## 回滚与交付

- 分片用于开发和审查，不在产品中长期双写、双跑或运行时 fallback。正式切换提交同时删旧实现。
- 先保留 R0 可复核提交；R1 失败时可回到该基线，用户工作缓存由备份恢复，不改生产账本。
- 在任务分支提交并提 PR，不推 main、不合并 #179 或自己的 PR。R1 阶段报告分别说明实现、测法、结果与未覆盖项。
- R1 完成后继续 R2-U1；共同宿主的 UI 样张批准是下一道产品门，不是本阶段运行层工作的前置。
