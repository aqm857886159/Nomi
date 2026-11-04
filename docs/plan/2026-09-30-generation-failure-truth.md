# 生成失败要说真话（0.22.1 走查 pb06 + 付费真机验收，一条线收完）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 背景

0.22.1 全功能走查（pb06）和付费真机验收报的是同一类事：**界面说的话，没有按「谁的事、什么证据」来说**——

- 供应商已经出了图（已计费），Nomi 判「解码失败」还劝换供应商；
- 供应商说「模型已下线」，界面说「参数不被接受，请检查比例 / 尺寸」；
- 点了「切到另一家」，提示点名新家、说的却是旧失败；节点已经成功，「失败，换一家」的提示还挂着；
- 提示伸出窗口、× 点不到、同一次失败叠 ×3、中文界面顶着英文原话；
- 不认识的失败被说成「可能是服务商临时故障或额度问题」（其中「额度」是猜的）；
- 一个不认识的失败被说成「API Key 无效」（分类器把我们自己拼的诊断串里随机端口的「401」读成了鉴权失败）。

不是修七个症状，是把每一个「谁来决定」收成一个 owner：判定进 owner，其余入口只读。四份根因合同（带数门的门表）：

- `docs/fixes/2026-09-29-generated-media-decode-verdict.root-cause.json`
- `docs/fixes/2026-09-29-failure-reason-from-upstream-evidence.root-cause.json`
- `docs/fixes/2026-09-29-failure-belongs-to-the-dispatched-attempt.root-cause.json`
- `docs/fixes/2026-09-29-toast-identity-withdrawal-and-window-fit.root-cause.json`

## 先查别人

- 生态 LobeChat：一张表声明每一类运行时错误的归属（`attribution`）、能否重试（`retryable`）、是不是兜底桶（`isFallback`），`packages/model-runtime/src/errors/specs.ts:63`，https://github.com/lobehub/lobehub/blob/main/packages/model-runtime/src/errors/specs.ts ——与「失败目录 + narrate 穷举表 + unknown 是明示的兜底桶」同一个形状。
- 规范 OpenAI 错误信封 `error{code, message, param, type}`，`code` 才是上游自己说的原因，https://github.com/openai/openai-openapi/blob/main/openapi.json ——所以「上游自己的码」只收字符串形标识码，不写任何「某某家」的分支。
- 依赖 Mantine Notifications：`notificationMaxHeight` 是容器自带的公开属性，`node_modules/@mantine/notifications/esm/Notifications.mjs:19`，https://v8.mantine.dev/x/notifications/ ——不自造滚动 / 截断，所有者只给一个随窗口的值。
- 依赖 ffmpeg：`-xerror` / `-err_detect explode` / framehash muxer，https://ffmpeg.org/ffmpeg-all.html ——旧判据问的是「有没有一句抱怨」，新判据问「出没出画面」。
- 仓库里已有上游话的键优先级表 `electron/jsonUtils.ts:94`（`pickUpstreamMessage`）与唯一的失败目录 `src/workbench/observability/classifyError.ts:548`（`classifyGenerationError`）、提示所有者 `src/ui/toast.tsx:47`：扩它们，不另起第二份。
- 完整报告：[prior-art.md](../research/2026-09-30-generation-failure-truth/prior-art.md)
- 结论：用已有——框架与规范自带的能力，把判定收进已有的 owner，外加一个新的解码判定 owner（`electron/assets/generatedMediaDecode.ts`）；不新写通用能力。没做：Cherry Studio 等其他客户端的近邻检索（这是一次收口，不是新方案）。

## 范围

1. **解码判定**归 `generatedMediaDecode.ts`：三态（能解码 / 读不出来 / 没能核实），判据是「第一帧拿出来、宽高为正」；超时随文件大小放宽；统一带机器码 `output-unreadable`；`projectAssetStore` 内联的 `spawnSync` 删除。
2. **失败原因**只有 `classifyGenerationError` 一张目录：证据顺序 Nomi 机器码 → 上游自己的码 → 供应商说的话 → 状态码派生的类别；上游码经 `pickUpstreamCode` 走三条传输通道（vendorHttp / AI SDK 文本 / Agent 的 pi 运行时），三通道对等测试钉死；每一类在 `narrate` 的穷举表里声明 vendorSide；标题永远是界面语言；认不出的失败如实说认不出并带码；关键词嗅探只读认得出来源的话（`legacyEvidence`）。
3. **失败属于发出去的那一次**：运行开始时把 (供应商, 模型) 写进运行记录（`attempt`，可选字段，随项目落盘）；切家提示与模型健康记账读它。
4. **提示的身份、撤回、位置**归 `src/ui/toast.tsx`：`occurrence`、`validWhile`、容器列宽与随窗口的高度上限；提示句子只在 `useNodeModelAutoSelect` 一处拼。
5. **提示版面补两刀（验收页复核）**：动作按钮上的字永远完整——正文至少 12.5rem，放不进同一行的长动作折到正文下面、长标签折行不截断（`src/ui/toast.tsx`，设计系统 §4.5 同步改）；提示点名供应商用显示名不用内部 id；目录里「这次失败不计费」这类话只有请求没发出去的类别才许说（`NEVER_SENT_KINDS` + `noChargeClaims.test`）。
6. 概念登记（`concept-owners.json`）、结构评审（`docs/audit/2026-09-30-vendor-transport-and-ui-toast-structure-review.md`）、全功能走查 pb07（零花费，真 Electron）。

## 不动项

- 制作流程（`productionShotActions`、`electron/productionRun/*`）、Agent 付费卡（`*Spend*`、`spendCard*`）、`electron/agentLane/*`：别的线持有的概念，不碰。
- 供应商接入、价格、额度相关的任何东西；不新增 IPC、不改窗口最小尺寸、不动设计 token。

## 回滚

单 PR 单合并，回滚即 revert 合并提交。数据无迁移：`attempt`、`upstreamCode` 都是可选字段，旧记录没有它们照常加载、照常分类；`output-unreadable` 是新增的机器码与两条文案，不改已有 key。

## 验收门

- 测试表（零花费的行全在真 Electron 里按用户动作走，改之前 / 改之后截图并排，「改之后」全部来自同一个最终 head）：`D:\tmp\failure-truth-test\验收.html`，用户看截图打勾。
- 全功能走查监视器里与本次相关的六条规则（`failure-reason-misstated`、`failure-blamed-on-wrong-vendor`、`stale-failure-toast`、`overlay-out-of-viewport`、`close-button-unreachable`、`9c-repeated-toast`）在本分支零触发，干净 main 上每遍 12 处。
- 门岗：contracts 红名单与干净 main 逐项相同；相关单测全绿；46 个「改回旧行为」的变异全部被抓红。
- 真实付费：Seedream 5.0 已在隔离副本上跑过一张（`tests/ux/full-walk/playbooks/pb90-seedream5.paid.mjs`，图落地、供应商只收一笔、没有误判）；Z-Image Turbo 不在本次范围。
