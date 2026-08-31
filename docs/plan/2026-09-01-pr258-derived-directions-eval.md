# PR #258 拆项评估 v2（provider proxy / 即梦 CLI 模型面 / onboarding）

> 状态：📎 交接/日志（评估结论文档；三条建议若获批各自另立 📋 计划）

日期：2026-09-01 ｜ 评估对象：PR #258 `codex/feedback-radar-20260831` ｜ 只读评估，不合并/不关闭/不评论 #258。

## 0. 先把 #258 的真面目说清楚（读之前必须知道）

**PR 标题「docs: recover feedback radar」是假的。** GitHub 页面显示 +1416/-217，但那是陈旧数字——分支从一个很旧的 main 拉出，之后把 `origin/main` 反复 merge 进来（吞了 #202/#226/#241 等已合 PR）。按 `main..pr258`（两点，真实反转视图）实测是 **272 文件 / +19106 / -733**；merge-base == main tip，分支严格领先 main 22 个 commit、main 无 commit 不在分支里（即三点=两点）。

**它其实是一坨大杂烩**，混了三类东西，评估必须先拆开：
- **A｜本次真正新写的三方向**（authored commit `03a4e532` + `30c4bd5a` + 两篇 docs）：provider proxy、即梦 CLI 3.x wiring、onboarding 重构/加固。← 本文评的就是这三块。
- **B｜从已合 PR 漂回来的巨量 payload**：minimax/elevenlabs/meshy/runway/suno/lyria 一堆 archetype + 认证体系（来自 #241/#226）。**这些不是 #258 的贡献，是 merge 噪音**，不该跟着这个「反馈雷达」PR 走。
- **C｜纯反馈 docs**：`docs/fixes/*.root-cause.json`、`docs/research/2026-08-31-*.md`、`docs/plan/2026-08-31-*.md`、handoff。这是标题声称的东西，但在 diff 里只占极小一角。

真实 authored 文件清单来自 `git log --no-merges --name-only main..pr258`；下文 file:line 均指 PR 分支 tip `30c4bd5a`。

---

## 1. 方向①：provider proxy（按 API 单独走代理）

**这是什么（file:line）**：新增 `electron/providerNetwork.ts`（21 行）+ 扩 `electron/systemProxy.ts`（加 `createExplicitProxyDispatcher`/`normalizeExplicitProxyUrl`）+ 新增 `src/ui/onboarding/ProviderProxyField.tsx` + `src/i18n/locales/modelSetup.ts` 四条文案（`proxyUrl`/`proxyUrlHint`/`proxyUrlPlaceholder`/`invalidProxyUrl`）。核心类型：`ProviderNetworkConfig = { proxyUrl?: string }`，作为**单个供应商连接**的可选字段存下，产出一个只属于该连接的 undici `ProxyAgent` dispatcher，贯穿模型发现 / 连接测试 / 适配器认证 / 生产请求 / AI SDK 请求 / 产物下载。

**解决哪个真实摩擦（大白话）**：Nomi 现在的代理是**一个全局开关**（`systemProxy.ts`：system/env/custom/off，管所有厂商一刀切）。但用户常遇到「这家 API 必须挂本地代理才通、那家直连更快」的分裂需求——最典型就是**APIMart 只能走本地代理**（记忆已证：APIMart 直连 fetch failed，只有走本地代理才通），可其它官方厂商挂上同一个代理反而更慢/更容易被墙。全局开关逼你二选一。这个字段让「代理」从**全局**降到**每个连接各配一份**，APIMart 那条连接自己挂 `http://127.0.0.1:7897`，别人不受影响。

**与 main 现有代理的关系**：**互补、不重复、不违 P1**。全局 `systemProxy.ts` 继续管「没配 per-connection 字段的连接」（空值 = 走既有应用 dispatcher，行为与上线本功能前完全一致）；per-connection 只在该 vendor `network.proxyUrl` 非空时**覆盖**。本地 CLI（即梦/ComfyUI）**不继承**该 HTTP 代理（研究doc明确划界）。这是「全局默认 + 单点覆盖」的标准两层，不是两套并行代理系统。

**成本/风险**：① 凭据面——代理 URL 里可能带账号密码（`socks5://user:pass@host`），要确认它和 API key 一样走加密存储、不进日志（`systemProxy.ts` 已有 `redactNetworkMessage`，需确认 per-connection 路径也覆盖）。② 私网重定向——`systemProxy.ts` 的 `appDispatcher` 每次 dispatch 都查 `isPrivateHost`，per-connection dispatcher 是否同样防「私网 URL 302 跳公网继承直连」需走查一遍（这是原 systemProxy 特意防的一族）。③ 无账号验证约束——维护者无 APIMart 之外的付费号，真实代理链路只能靠 APIMart 本地代理这一条实测 + 单测覆盖 dispatcher 选择。

**档位建议：🟢 值得接（可独立小步交付）**。它是通用能力（不是 Nomi 独有）、贴真实摩擦（APIMart 那条群里已反复提）、代码面小且边界清晰、门岗友好。**建议单独拆成一个 📋 计划直接落**，不必等即梦那摊。唯一前置：补一条「代理凭据不入日志 + 私网重定向不继承代理」的走查/断言（P2 通用性）。

---

## 2. 方向②：即梦 CLI 模型面更新（图片5pro / seedance2.5 的群反馈）

**群反馈原文**：「即梦的 cli 后续可以更新下，现在没办法用图片5pro和seedance2.5」。翻译：**Nomi 的即梦 CLI 接入把模型面接旧了**，用户要 图片 5pro 和 seedance2.5。

**#258 已接到什么程度（file:line）**：
- 新增 `electron/shared/videoCapabilities/dreaminaSeedance3.ts`：两条档案 `DREAMINA_SEEDANCE_3_I2V_ARCHETYPE`（image2video）、`DREAMINA_SEEDANCE_3_FRAMES_ARCHETYPE`（frames2video），变体 3.0/3.0fast/3.0pro/3.5pro（3.0 系时长 3–10s、3.5pro 4–12s、非 Seedance2.0 变体仅 720p），`SOURCE` 明写 `jimeng.jianying.com/cli` + `checkedAt:2026-08-31`。
- 已 wire 进 catalog：`src/config/modelArchetypes/index.ts` 的 `MODEL_ARCHETYPES` 与 `electron/shared/videoCapabilities/registry.ts` 均已注册。
- `src/config/modelArchetypes/dreaminaImage.ts`：把图片分辨率按 model_version 收窄（3.0/3.1→1k/2k，4.x/5.0→2k/4k），消除非法组合；图片变体仍到 **5.0**（未加 5.0pro）。
- 时长/多帧对齐：`electron/catalog/dreaminaVideos.ts` + `dreaminaCodec.ts` 对齐多帧单段 0.5–8s 与 `--transition-duration`（有 `dreaminaCodec.test.ts`/`dreaminaMultiframe.test.ts`/`dreaminaSeed.test.ts`）。

**离群反馈还差什么 / web 实查（即梦官方出处优先）**：
- **seedance2.5**：群里说的「seedance2.5」有歧义。研究doc已实查本机官方 `dreamina` CLI（build `2026-06-18`）`-h`：CLI 的 text2video/multimodal2video **只列 Seedance 2.0 家族，没有 2.5**；而火山方舟的 Seedance 2.5（`doubao-seedance-2-5-260628`）是**另一条 HTTP API**，不归即梦 CLI 承载。**结论：即梦 CLI 侧目前给不了 seedance2.5**——要么用户其实想要的是方舟 HTTP 那条（Nomi 已有 `SEEDANCE_VOLCENGINE_2_5_ARCHETYPE`/`seedance-2.5-apimart`），要么 CLI 后续版本才会补。#258 没伪造 CLI 版 2.5，是对的（研究doc「不动项：不把方舟 2.5 伪装成 CLI 能力」）。**给用户的诚实答复应是：CLI 暂无 2.5，方舟版可走 API 接入。**
- **图片5pro**：同样歧义。研究doc实查 CLI 图片当前列 **`5.0`，不是 `5.0 Pro`**；「Seedream 5 Pro」是 KIE/方舟侧的模型（Nomi 已有 `KIE_SEEDREAM_5_PRO`/`SEEDREAM_VOLCENGINE_5_PRO`/`SEEDREAM_5_PRO`）。**即梦 CLI 侧目前只有图片 5.0**；#258 没伪造 CLI 版 5.0pro，也是对的。**用户要的「图片5pro」大概率指的是 Seedream 5 Pro（HTTP），或把即梦图片 5.0 记成了 5pro。**

**命名雷（合入前必须改，否则目录里出现一个不存在的产品名）**：#258 把这两条 image2video/frames2video 档案命名为 **`dreamina-seedance-3` / label「即梦 Seedance 3.x」**。这是**错名**：即梦 CLI 里 `--model_version 3.0/3.5pro` 是 **即梦自家的视频模型版本（即梦视频 3.x）**，`image2video`/`frames2video` 命令下根本没有「Seedance」；即梦 CLI 的 Seedance 只有挂在 text2video/multimodal2video 下的 **Seedance 2.0 家族**。把「Seedance」和「3.x」拼一起 = **凭空造出一个「Seedance 3」产品**（即梦没有、方舟也没有 Seedance 3.0——那正是第三方 SEO 站造的假名）。**修正方案**：档案 id/family/label 去掉「Seedance」，改为 `dreamina-video-3-i2v` / `dreamina-video-3-frames`、label「即梦视频 3.x 图生视频 / 首尾帧」；`identifierPatterns` 同步。（注：ARK 现役真名是 Seedance 2.5 `doubao-seedance-2-5-260628`，与此无关，别混。）

**无账号验证约束下怎么交付**：维护者无即梦会员登录态，**真实生成验不了**。可交付的等级 = **契约级 + 社区验收**：① 单测锁 CLI help 矩阵（模式×变体×时长×分辨率），非法组合在 UI/请求构造前不可达（#258 已具备大部分）；② 真实即梦生成走查若缺登录态，**标 blocked、不伪报成功**（研究doc验收门已写死这条）；③ 真实生成留给有会员的社区用户验收（对齐记忆「付费验收只能靠社区/契约级」）。这套是对的，照走。

**档位建议：🟡 值得接但必须先改名 + 先对齐用户预期**。技术实现质量高（有源、有测、边界清、没伪造 CLI 不存在的变体），但**命名雷是硬阻断**（会往目录塞假产品名）。且要同步给群里一个诚实回复：**CLI 侧给不了 2.5/图片5pro，那两个在方舟/KIE 的 HTTP 线上，Nomi 已支持**——否则接完用户仍会说「还是没有」。**建议拆成 📋 计划**：先改名 → 再把「即梦视频 3.x 图生/首尾帧」作为真实新增交付 → 群里回执讲清 2.5/5pro 的正确出处。

---

## 3. 方向③：onboarding 改法

**改了什么（file:line）**：主要是**重构 + 穿线**，不是新做一套卡片。
- `src/ui/onboarding/OnboardingWizard.tsx`：把原来内联的 `handleTestConnection`（约 80 行探测逻辑）**抽成新 hook** `src/ui/onboarding/useOnboardingConnectionTest.ts`（旧内联块同 commit 删除 = P1 干净）；把 `ProviderProxyField` 塞进表单，`proxyUrl` 贯穿发现/测试/保存。
- `src/ui/onboarding/CodexLocalImageCard.tsx`：给本地图片开关的 toggle **补 catch**——旧安装包打开新版目录时主进程为防降级拒绝写盘，这个错以前会穿过 React 事件处理器变成「按钮点了没反应」，现在弹 toast（根因层修，配 `docs/fixes/2026-08-31-codex-local-toggle-version-skew.root-cause.json`）。
- `src/i18n/locales/onboardingProviders.ts`：加 `clearTask`/`clearRecord` 文案（清除接入记录）+ minimax/elevenlabs/meshy 的 promo 文案（**后者属 B 类 payload，非本方向**）。

**与现有卡片的关系**：main 上已有 `CustomVendorCard`/`ComfyuiLocalCard`/`CodexLocalImageCard`/`DreaminaMemberCard`/`VendorOnboardCard` 等一整排卡（含 A+B 本地模型卡 P0）。#258 **没有新增竞争性卡片、没有另起一套 onboarding 心智**——它只是①往既有 `OnboardingWizard` 表单里加一个字段（proxy）、②把测试逻辑抽 hook、③修一个既有卡的静默失败。**是互补/加固，不是重复**，不违 P1。

**档位建议：🟢 低风险，直接随对应能力走**。这块本身没有独立产品决策，是①和「本地图片卡加固」的附属。`useOnboardingConnectionTest` 抽取 + CodexLocalImageCard catch 属**纯工程加固/bug 修复**，可直接并入；`ProviderProxyField` 跟着方向①走。**唯一注意**：`ProviderProxyField` 是用户可见 UI 改动（表单多一个字段），按 R8/R13 需**先出样张或对既有 OnboardingWizard 真实外壳走查一次**再交付（本文只做评估，不代替走查）。

---

## 4. #258 本体处置建议

**核心判断：#258 不该按现状合入**——它把「反馈雷达 docs」当标题，实则夹带 272 文件的三类混合物，其中 B 类是从已合 PR 漂回来的 merge 噪音。按三档拆：

| 部分 | 内容 | 去向 |
|---|---|---|
| **C 纯反馈 docs** | `docs/research/2026-08-31-dreamina-and-per-api-proxy.md`、`docs/plan/2026-08-31-dreamina-cli-and-provider-proxy.md`、`docs/fixes/2026-08-31-*.root-cause.json`、handoff | **保留**。质量高（研究doc实查了 CLI help + 划清即梦/方舟边界），是①②的依据。可单独归档为一个小 docs PR，或并进②的计划。 |
| **A①provider proxy** | `providerNetwork.ts`/`systemProxy.ts` 扩展/`ProviderProxyField.tsx`/modelSetup 文案 + onboarding 穿线 | 拆到**独立 📋 计划 + PR**（🟢），补代理凭据/私网重定向断言后直接落。 |
| **A②即梦 CLI 3.x** | `dreaminaSeedance3.ts` 两档 + `dreaminaImage.ts` 收窄 + `dreaminaVideos/Codec` 对齐 + 各 test | 拆到**独立 📋 计划 + PR**（🟡）：**先改名去掉「Seedance」**，再交付 + 群里回执 2.5/5pro 正确出处。 |
| **A③onboarding 加固** | `useOnboardingConnectionTest` 抽取 + `CodexLocalImageCard` catch | 跟着①走（proxy 字段）或作为独立小修（catch/抽 hook）；UI 字段过 R8/R13 走查。 |
| **B merge 噪音** | minimax/elevenlabs/meshy/runway/suno/lyria archetype + 认证体系 | **不该跟着 #258**。逐条对照 `origin/main`：已在 main 的就是 diff 幻影（合 #258 会无害地重述）；未在 main 的应回到其原始 PR（#241/#226 线）评审，别借「反馈雷达」这个壳夹带入库。 |

**给 #258 的一句话建议**：以现状**不合并**；把它当「三方向 + 反馈 docs 的暂存点」，按上表把 A 拆成 2–3 个聚焦 PR、C 归档、B 退回原 PR 线。命名雷（②）是合入前的硬阻断项。

---

## 附：本评估未做的事（诚实边界，D4）
- 未跑真实即梦/APIMart 生成（无账号；付费验收留社区）。
- 未对 `ProviderProxyField` 出样张/走查（本文=拆项评估，非 UI 交付；样张/走查在②③各自计划里补）。
- B 类 payload 未逐文件与 `origin/main` 做 present/absent 比对（超出本次三方向评估范围；拆 PR 时按上表逐条核）。
