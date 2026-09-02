# 视频能力共享层与可编辑 planning 证据

日期：2026-08-24  
分支：`codex/video-generation-parameter-research-20260823`

## 本轮结论

`CameraControlStrategy` 被移除。真实模型文档没有共同的“相机控制 API”：Seedance、Veo、Runway、Kling 主要通过 prompt 和参考素材表达镜头意图；Luma 的 `video.edit.controls.trajectory` 只在特定视频编辑任务中成立，不能提升为跨模型相机控件。

共享层现在保存模式级 `expressionChannels`、参考槽、参数事实、供应商来源和核验状态。推荐器只读取这些事实，不按供应商名称分支，也不把“可以用 prompt 表达”伪装成“原生轨迹控制”。

## 动态模型目录边界

默认候选由当前 catalog 的视频模型动态构造：

- 命中已逐项对账档案：使用该模型真实的模式、参数范围、参考角色和变体约束；
- catalog 中存在但暂无对账档案：保守提供文生/单图两个基础入口，表达通道标记 `unknown`，不凭空增加首尾帧、全能参考、运动参考视频或结构化轨迹；
- APIMart 当前可检索官方目录包含 `doubao-seedance-2-0`；Seedance 2.5 详细页本轮返回 404，所以 2.5 只在用户 catalog 明确出现时参与候选，不能作为默认事实。

这保证了“供应商没有高级参数”不会把整个能力关掉，同时也不会把不存在或未核验的字段发给供应商。

## UI ↔ MCP 上下文一致性

本轮发现并修复了一个结构性缺口：GUI 已经有完整的视频档案，但 MCP 共享层最初只注册了 Seedance APIMart 两份档案，其余已接模型会退成通用 `unknown` 档案。现在所有 seeded catalog 视频档案都从同一个纯共享 owner 读取，renderer 原路径保留兼容重导出；Electron/stdio 会同时读取 catalog 的既有 `meta.archetypeId` 指针和当前 mapping。

已覆盖的 seeded 视频档案族包括 KIE、APIMart、火山、Dreamina、RunningHub 和 Agnes；APIMart 现有 14 条视频模型配方全部逐条通过。模型身份解析遵循大小写精确、普通精确、最具体匹配的优先级，避免 `seedance-2` 这类短通配符抢走 APIMart Fast/Mini 或其他供应商档案。

验证的不变量：

- 每个 seeded 视频模型都能从 GUI 已有 `archetypeId` 回到同一个 shared profile 对象；
- 每个 profile mode 都有既有 catalog mapping，声明的参考槽至少有一条真实可达 wire 通道；
- 每个 APIMart mode 可渲染出带具体 model identity 的真实请求模板，鉴权只在 header，secret 不进入 body；
- 用户切换模型时只读取新 profile 的参数和模式，不继承上一模型的专属字段；
- 未知/用户自建模型仍走保守回退，不假造高级模式。

## 真实 smoke 证据复用与本轮花费

本轮先盘点已有真实 APIMart 证据，没有重复发请求：

| 已有证据 | 覆盖的接口形态 |
|---|---|
| 2026-06-16 `apimart-params.e2e.mjs` 6/6 出片 | Sora Pro 文生变体、Veo 参考图/首尾帧有序 `image_urls`、Omni `generation_type:reference`、Hailuo Fast 单 `first_frame_image` |
| 2026-06-16 `seedance-apimart.e2e.mjs` | Seedance 首尾帧 `image_with_roles` 角色对象数组、整数 duration、异步轮询与素材落地 |
| 2026-07-29 `apimart-new-models-20260729.cjs` | Vidu Q3 图参考、Kling Turbo 文生、HappyHorse 1.1 图参考、Wan 2.7-R2V `image_with_roles` |

这些证据已经覆盖当前 APIMart 配方的不同 wire 族：纯文生、单首帧、顺序首尾帧、角色对象数组、参考图融合和异步 task 查询。H3、Seedance 2.5 等同族档案通过零额度模板/参数不变量验证；没有必要因为换一个 model 字符串而重复生成。**本轮新增付费请求数：0，新增额度消耗：0。**

本轮按用户授权追加了一次最小 APIMart Seedance smoke 尝试（4 秒、480p、16:9、Fast 变体请求体）。结果没有产生任务，也没有扣额度：

- 通过系统代理直连 APIMart 返回 HTTP 401 `invalid API key`；此前直接连接因未继承系统代理超时，修正代理后才得到明确鉴权结果；
- 通过当前非交互的 Nomi MCP 测试入口时，没有可展示 `elicitation/create` 的外部确认面，付费确认闸返回“未确认”，请求在 provider 之前被取消；这不代表支持 elicitation 的 Claude/Codex/Cursor 必须跳回 Nomi；
- 因此本轮没有把一次失败的鉴权/确认结果误报成“模型参数不兼容”，也没有盲目重试或绕过确认闸；
- Nomi 当前模型目录仍显示 APIMart keyStatus=ok，但该密钥只在 Nomi 主进程钥匙串中可用，外部 smoke 不读取或打印它。

这条结果把后续问题缩小为“使用支持交互确认的 MCP 客户端，或在客户端不支持时使用 Nomi 兜底确认，再配合有效密钥完成一次真实提交”，而不是重新设计共享参数层。确认优先发生在用户正在使用的 MCP 软件里，Nomi 只负责主进程权威和不支持客户端时的兜底；若未来发现某个供应商的在线行为与现有配方冲突，只针对那一条新 wire 族做最低规格 smoke；不会把“每个模型各跑一次”当成质量证明。

### 隔离开发实例的真实 GUI smoke（2026-08-24）

为验证“用户在软件里点击一次即可完成确认，并且请求确实走到供应商”，本轮又启动了本分支的隔离 Electron 实例（独立 userData / 项目目录），没有触碰已安装的正式 Nomi 项目。通过电脑控制完成了完整的可见操作：新建项目 → 生成 → 添加视频节点 → 输入提示词 → 打开模型/参数选择 → 选择短规格 → 点击“生成素材” → 在“开始生成”对话框点击一次“生成”。

- 第一条 GUI 旅程选择了即梦 Seedance 2.0，16:9、720p、4 秒、Fast 变体；确认弹窗正常出现，点击后进入真实 provider 路径，供应商明确返回“账号权限不足”，没有生成素材。这证明失败发生在供应商权限层，不是 UI 确认闸或 MCP 共享规划层。
- 第二条旅程先在「设置 → 模型」里接入用户提供的 APIMart Key；页面显示“APIMart 已接入”，模型列表出现 28 个预置模型。随后在画布中输入同一短提示词，使用 16:9、480p、6 秒的最低规格，点击同一个确认对话框一次。生成记录明确记录了 `provider=apimart`、`model=grok-imagine-1.5-video-apimart` 和供应商 `task` ID；约 35 秒后第一次媒体显示曾短暂出现“加载超时，请重试”，但后台任务实际已经完成，MP4 已落到项目资产目录，技术检查为 6.0s、黑帧 0%、静音 0%。修复本地媒体队列/`nomi-local` 视频播放后，隔离 GUI 重开项目即可看到播放控件并实际播放，过程中没有再次提交供应商任务。
- 这次 APIMart GUI smoke 证明了“接入凭据 → GUI 模型目录 → 可编辑参数 → 一次确认 → provider 异步任务 → 本地落盘 → 重开后播放”的真实链路，也暴露并修复了慢媒体首次回载时的错误超时体验。它实际验证的是 APIMart 的 Grok wire，不把它冒充成 Seedance 在线成功；Seedance 的跨变体选择和参数约束仍由零额度真实 catalog journey + 既有 Seedance paid evidence 覆盖。
- 本轮没有重复提交、没有长视频/高分辨率，也没有把 API Key 写入仓库或文档；隔离开发实例随后已关闭。

用户价值：用户只在自己正在看的软件里点一次确认，不需要回到 Nomi 再点第二次；供应商拒绝或回载超时会落成可理解的下一步，而不是静默卡住或盲目重提。

## 用户任务测试

1. 角色参考图 → preview 推荐全能/参考模式；
2. 将参考图替换成首帧+尾帧 → preview 改为首尾帧模式；
3. 修改时长并加入当前模型未声明的 `trajectory` → revision/hash 变化，合同明确返回 `droppedFields: parameters.trajectory / unsupported_parameter`；
4. 整个 create/edit/preview JSON-RPC journey 中 `runTask`、provider submit、gateway、spend 均为 0；旧 sealed draft 不会被原地编辑。
5. 真实 GUI catalog MCP journey：从内置 APIMart catalog seed 读取 Seedance 2.0、Veo 3.1 Fast、Hailuo 2.3 的基础 model row 和既有 mapping；同一 operation 依次切换 Seedance 的 standard → fast → mini 变体，再切换 Veo/Hailuo 的模式、参考角色与参数。验证 context 暴露 GUI 同源的变体列表及各变体参数约束，别名会标准化、非法变体和 Fast/Mini 不支持的清晰度会在 preview 前拒绝；preview 的全部候选都绑定当前 model/variant，不会在用户切换后跳回别的模型；模型未出现在当前 catalog 时才保留兼容回退。

## 验证命令

```bash
pnpm exec vitest run electron/shared/videoCapabilities src/config/modelArchetypes electron/capabilityCore/mcpGenerationTools.test.ts electron/capabilityCore/nomiMcpGenerationPlanning.test.ts --reporter=dot
# shared/MCP focused suites 通过；包含真实 GUI catalog 的 Seedance → Veo → Hailuo 编辑旅程
pnpm exec vitest run electron/shared/videoCapabilities/index.test.ts electron/catalog/apimartVideoSharedContracts.test.ts electron/catalog/curatedVideoSharedContracts.test.ts --reporter=dot
# 3 files / 10 tests passed
pnpm exec vitest run src/config/modelArchetypes electron/catalog --reporter=dot
# 87 files / 833 tests passed
pnpm run test
# 699 files passed, 1 skipped / 6175 tests passed, 1 skipped
pnpm run test:mcp-journey
# real Electron stdio journey passed: 45 assertions / 10 steps; 6 mock-vendor requests, zero provider quota
pnpm run typecheck
pnpm run build
pnpm run check:filesize
pnpm run check:tokens
pnpm run check:i18n
pnpm run check:archetype-sources
pnpm run lint:ci
```

本轮完整门岗结果：`check:filesize`、`check:tokens`、`check:i18n`、`check:archetype-sources`、`lint:ci`（95 warnings，低于 98 棘轮）、`typecheck`、`test`、`test:mcp-journey`、`build` 和 `git diff --check` 均通过。结构性验证没有新增 APIMart/provider/spend/Canvas/Timeline 副作用；真实 MCP 旅程仅使用本地 mock vendor。

本轮随后补齐了离散数值/布尔下拉的合同约束：例如 Hailuo `duration` 的 `[6, 10]` 会保持为数值 enum，`7` 会在 provider 之前被拒绝；这不改变已有字符串 enum，也不要求用户额外学习新格式。

## 当前还没有替用户做的决定

模型档案和零额度请求契约的范围已经自主完成，不需要用户在“只做 Seedance 还是全做”之间再选择。剩余决策只在真实付费 smoke 的成本/覆盖面上：

| 选择 | 用户看到的价值 | 代价 |
|---|---|---|
| 复用已有真实成功证据，只补未覆盖的接口族 | 花费最少，验证重点放在真正不同的请求形态 | 某些同形态模型不再重复生成 |
| 每个模型/变体都各跑一次最低规格 | 每个具体入口都有独立在线证据 | 可能重复花费，且不能额外证明共享代码正确 |
| 继续只做零额度契约验证 | 零成本、最快 | 不能证明供应商当前在线端点仍接受请求 |

当前规划与参数层已完成；真实 provider smoke 的剩余前提是发起调用的 MCP 软件能展示确认，或 Nomi 兜底确认可用，并且使用当前有效 APIMart key。用户无需在模型覆盖面上做选择；只有当需要更换/重新配置供应商凭据，或要扩大到多供应商在线生成时，才是新的重要决策点。
