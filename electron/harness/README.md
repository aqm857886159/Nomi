# Nomi Agent 代码导览

这里集中的是 **Agent 的运行、能力边界和工作上下文**。文稿、画布、时间轴仍由各自的编辑器负责修改；预算、生成任务和 MCP 仍由各自的业务模块负责。集中 Agent 不等于把视频业务再复制一套进来。

实施与验收状态以 [R1 切换计划](../../docs/plan/2026-08-26-pi-r1-runtime-cutover.md) 为准；本导览描述职责，不代表全部阶段已经交付。

## 先看哪几个文件

```text
electron/harness/
├── agentChatContracts.ts     主进程、preload、界面共用的请求/事件/结果
├── agentChatPolicy.ts        本轮能力、项目归属和精确目标的校验
├── context/
│   ├── agentContext.ts      Nomi 身份、Skill、四层系统提示词
│   ├── agentContextHost.ts  主进程唯一的上下文服务实例
│   ├── contextService.ts   同一对话的恢复、排队、运行、保存、清空
│   ├── contextBinding.ts   sessionKey + threadId 绑定
│   ├── contextPaths.ts     复用已有项目目录规则
│   ├── contextStore.ts     原子落盘、版本检查、旧档原件备份
│   └── legacyBubbles.ts    旧聊天气泡的有限导入，不伪造历史工具执行
├── tools/
│   ├── documentDescriptors.ts  文稿工具的唯一说明与 Zod 参数定义
│   └── canvasDescriptors.ts    画布工具的唯一说明与领域规范化
└── runtime/
    ├── runtimePort.ts       Nomi 自有端口，不向外暴露 SDK 类型
    └── pi/                  唯一 pi SDK 适配目录
        ├── nativeLoader.cts  CJS 主进程到私有 ESM 的延迟加载
        ├── run.mts           一轮运行、活动映射、用量、稳定收尾
        ├── session.mts       受控 AgentSession 与停止/释放
        ├── model.mts         三协议、字面凭据与请求参数适配
        ├── tools.mts         参数解析与 Nomi 宿主决定的桥接
        ├── observeStream.mts 单一事件转发、首响应/闲置超时
        ├── attachments.mts   图片与原生 PDF 的输入桥
        ├── resources.mts     只加载 Nomi 明确提供的资源
        ├── snapshot*.mts     完整 SDK 快照与结构验证
        ├── contextCodec.mts  旧气泡导入及快照检查
        └── errorFacts.mts    有界、脱敏的供应商错误事实
```

最短阅读顺序：`agentChatContracts` → `agentChatPolicy` → `contextService` → `runtimePort` → `pi/run`。只改文稿或画布工具参数时，通常不需要读或改整个运行核。

## 一次指令怎么走

```text
现有界面/制作入口
  → 共用客户端（先订阅，固定请求 ID 和任务归属）
  → electron/ai/agentChatV2Ipc.ts（窗口/frame 归属、确认、取消）
  → electron/ai/agentChatV2.ts（模型、Skill、作品上下文的薄接线）
  → contextService（恢复该 thread 或创建临时上下文）
  → runtimePort → pi AgentSession（模型/工具循环与压缩）
  → Nomi 工具宿主（既有审批与编辑/生成权威）
  → 实际工具结果回喂 pi → 稳定收尾 → 保存 → result / done
```

renderer 已经执行的工具结果只回喂模型，主进程不能再执行一次。流式文字、一次工具结束、SDK 的 `agent_end` 都不单独代表整轮已完成；最终结果须等 SDK 稳定收尾和工作上下文保存。

## pi 管什么，Nomi 保留什么

| 责任 | 唯一归属 |
|---|---|
| 模型/工具循环、原生消息与压缩、SDK 会话 | pi AgentSession；本目录只做公开接口适配 |
| 工具可用范围、线程归属、当前作品输入、停止与保存合同 | Nomi harness 和薄入口 |
| 文稿编辑、画布 proposal/Apply/Undo、时间轴编辑 | 原编辑器及领域工具宿主 |
| 花费授权、预算、异步生成、重复提交防护 | 原生成/ProductionRun 权威链 |
| 对外 MCP 协议、外部客户端权限与确认 | `electron/capabilityCore`，不另造 pi 版本 |
| Skill 内容与项目偏好 | 原 Skill/项目记忆系统，经 `agentContext` 注入 |
| 非 Agent 的编译、文本任务与验证 | 原 `ai@4` 链；不因 Agent 换芯强制重写 |

Skill 是做事方法，不是扩大工具权限的许可证。pi 不自动发现用户机器上的编码工具、扩展或配置；Nomi 明确提供自己的资源与工具。把一个请求改称 `chat` 或换一个 Skill 名字，不能绕过能力和付费审批。

## 会话与界面不是一回事

- 持久任务明确绑定 `{sessionKey, threadId}`；显示在哪个专业视图不应改变已经发出的任务归属。
- 临时任务不读取、清空或写入持久历史。`single-shot` 是零工具的一步任务；临时分镜规划仍可使用受限工具多步执行，二者不是同一种模式。
- 正常 Stop 保存实际完成的上下文；clear 先排空并阻止迟到写入，再记录清空。新对话不能删除归档对话。
- 恢复优先使用该线程的完整快照。旧气泡仅在无快照时一次性有限导入，不能覆盖工具结果和压缩记录；旧缓存无法证明归属时保留原件，不猜着拼接。

**R1 仍保留创作/生成两份历史列表作为迁移边界。** R2-U1 才负责项目级线程、跨空间常驻助手、统一任务呈现与旧列表迁移。仅让两个面板使用同一个 SDK，不能称为这一层产品统一已经完成。

## 怎么验证

- `pnpm run test:agent-runtime`：真实固定版 SDK、本机 HTTP、附件、快照、压缩、取消与工具边界。
- `pnpm exec vitest run electron/harness`：能力描述、绑定、存储及排队等 Nomi 合同。
- `pnpm run build:electron`、`pnpm run check:test-types`：CJS/ESM 产物与两套测试类型检查。
- `tests/ux/agent-runtime-editing.walk.mjs`：真实文稿/画布审批、写入、Undo、Stop、新对话与冷启动恢复。
- `tests/ux/agent-runtime-production.walk.mjs`：父线程分镜、批量图片后的校验、方向审批与制作文本的临时任务隔离。
- `tests/ux/agent-runtime-provider.walk.mjs`：另行显式启用的小额真模型验证，和本机受控接口结果分开报告。

前两类测试不能代替正式 Nomi ASAR、MCP/Skill smoke 和真实界面走查。详见切换计划的 F 阶段验收记录。
