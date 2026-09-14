# 真实闭环：外部 MCP 宿主接 APIMart 最新图/视频模型（T-MO-05 / T-MO-08）

> 2026-09-15 · 分支 `test/mcp-onboarding-acceptance-20260915`（基线 PR #754 合 main）
> 宿主 **Claude Code CLI 2.1.270**，模型 sonnet，非交互 `claude -p --strict-mcp-config`
> 被测实例：隔离 Nomi（`prepareIsolation` 拷真实 `model-catalog.json`，APIMart key 已存且能解）
> 脚本 `tests/ux/mcp-onboarding-real-host.paid.mjs`

## 怎么量的，以及两条不能省的纪律

- **入参一次写对** = 这次 `tools/call` 的结果不是 `isError`。逐条证据在每个回合的
  `transcript.json`：每次 nomi 工具调用的名字、完整入参、`isError`、返回值前 900 字，
  以及那一回合最后说的话。
- 原始的 `turn-*.stream.jsonl`（宿主原生 `--output-format stream-json` 事件流，四轮共 4.1MB）
  **不入库**：`transcript.json` 已经是它的无损蒸馏（每一次调用一行，没有取样、没有挑选），
  而 4MB 的日志会让整分支评审读不完。要重取就按本文开头那条命令再跑一次。
- **`--strict-mcp-config` 是硬约束**。这台机器上用户真实的 `~/.claude.json` 里挂着一个真的 `nomi`
  server（指向 `/Applications/Nomi.app`）。不加这一条，宿主会同时看到两个 nomi、工具名撞车，分母不可信
  —— 09-11 的 Codex 读数 31/31 就是这么作废的。跑完核 `mcpServers` 指纹，两次都未变。
- **隔离四路全设**（settings / projects / userData / capability）。capability 漏了就会抢真实 Nomi 的
  `~/.nomi/capability-core` 广告与 token；App 侧 `NOMI_E2E=1` 让 `repairStaleMcpConfigs` 短路，
  所以这次没有改写任何宿主配置。

## 三次跑的读数（同一个宿主、同一批话）

| | 09-11 基线 | run1 修前 | run2 修后 | run3 修后·带生成 flag | run4 修后·再补默认模型 |
|---|---|---|---|---|---|
| 宿主 | Codex CLI 0.153.4 | Claude Code CLI 2.1.270 | 同 run1 | 同 run1 | 同 run1 |
| 工具调用 | 58 | 20 | 30 | 33 | 21 |
| **入参一次写对** | **36/58 = 62%** | **17/20 = 85.0%** | **20/30 = 66.7%** | **23/33 = 69.7%** | **17/21 = 81.0%** |
| 回合成功 | 1/9 | 0/4 | 0/2 | 0/3 | 0/3 |
| 由**假话**造成的人工介入 | — | **3** | **0** | **0** | **0** |
| 真出片 | — | ✗ | ✗ | ✗ | ✗（图/视频都停在第 5 道闸，见下） |
| 供应商花费 | — | ¥0 | ¥0 | ¥0 | **¥0**（一次付费提交都没发出去） |

**run2 的 66.7% 比 run1 的 85% 低，不是回归。** 逐回合看就清楚：

| run | 回合 | 调用 | 一次写对 | 死在哪 |
|---|---|---|---|---|
| run1 | A1 接中转 | 5 | 5 | 自检假失败 → 劝用户去开 Nomi |
| run1 | A2 接最新模型 | 5 | 5 | 同上，kind 落成 text |
| run1 | B1 接模型 | 4 | 3 | `draft_adapter` 拒 `selections[0].kind` |
| run1 | B2 出片 | 6 | 4 | `session_open bootstrap=current_project` 未授权；`feature_disabled` |
| run2 | B1 接模型 | 23 | 16 | **自检真的跑通了**，于是走到下一道墙：`draft_adapter` 形状连拒 5 次 |
| run2 | B2 出片 | 7 | 4 | `feature_disabled`（仪器错，见下）+ 画布方案卡被无人值守宿主 decline |

run1 里 Agent 在第一道墙前就停住（它相信「Nomi 没在运行」），调用总数少、每一次都写得对；
run2 里那道墙没了，它一路走到 `draft_adapter`，在那儿连试 5 次都被同一句话拒绝 —— **分母变大、
新增的失败全部集中在一个还没修的动作上**。「走得更远」在这把尺子上表现为分数下降，这是尺子的性质，
不是产品变差了；所以两个数必须连着逐回合表一起读。

## 修前那三句假话（run1 的全部人工介入都由它们造成）

连接建好了、`keyStatus: ready`、34 个模型就在那儿，而 Agent 读到的是：

1. 「**Nomi 没在运行**。请先打开 Nomi → 设置 → 模型 →「添加一个 AI 模型」，在那里保存「」的 key」
   —— Nomi 在跑（隔离 GUI 就是被 Playwright 起的那一个），名字是空串。
2. 「无法探测模型：**Nomi 没有找到已保存的密钥**」—— key 存着且能解，真相是自检那条路把
   `credentialResolver` 写死成 `undefined`。
3. `no_models_endpoint`（「这家没有模型清单端点」）—— 探测压根没发出去。

Agent 没有在猜：它把这三句当硬事实，连续三个回合都在劝用户去开 Nomi、去重贴 key，然后放弃任务。
根因与修法：`docs/fixes/2026-09-15-onboarding-results-claim-what-they-cannot-know.root-cause.json`。

## 修后（run2）行为侧实证

自检**真的打到了 APIMart 自己的 `/v1/models`**，并如实分开两个模型：

- `gemini-omni-1.1-flash`（视频）：在 APIMart 的清单里 → 接受 ✅
- `gpt-image-2.5`（图片）：**不在** APIMart 的清单里 → 拒绝 ❌

第二条是**供应商侧事实，不是我们的 bug**：`pnpm run radar:models` 从 APIMart 的模型目录页看到
`gpt-image-2.5` 是新增（2026-09-15 当天 6 个新增之一），但它的 `/v1/models` 端点还没列出这个 id。
按纪律如实标着，不写兜底、不改判据去让它「通过」。

整个 run2 里再没有出现过一句「Nomi 没在运行」或「没有找到已保存的密钥」。

## 出片这条路上的五道闸（四轮跑下来，一道也没绕过）

要的是「各出一张图 + 一段视频」。**没做到，供应商花费 ¥0**——一次付费提交都没能发出去。
下面是逐轮往前推、每次撞到的那道闸，按撞到的顺序：

| # | 闸 | 原文 | 是什么 |
|---|---|---|---|
| 1 | 单次生成对外宿主默认关 | `generation.single-shot feature_disabled` | **灰度状态**。`mcpGenerationPolicy.ts:9` 的 `NOMI_MCP_GENERATION_SINGLE_SHOT_V1` 不设即关，装机版不设 → 今天外部 MCP 宿主出不了片。错误码不带主语，Agent 把它读成「Nomi 没在运行」 |
| 2 | policy 快照读的是 app 进程的 env | 同上（run2 设了 flag 仍然报） | **仪器错**。`mcpGenerationPolicy.ts:144-150` 在持有会话的 app 进程里读一次 env，不在 stdio launcher 里。run3 起改成给 GUI 设，这道闸就过了 |
| 3 | 画布写入 ≥2 节点要宿主确认 | `cancelled: declined` | **产品判据不够**：`mcpProtocol.ts:540-556` 的条件是 `clientSupportsElicitation && isAppOpen()`，但「客户端声明支持」≠「有人在旁边」。`claude -p` 无人值守直接 decline。run3 起改成一次只建一个节点 |
| 4 | 隔离实例没有「默认生成模型」 | `没有配置可用的图片模型，请先在设置中选择模型`（`semanticGenerationCandidate.ts:207`） | **一半仪器、一半产品**。仪器那半：`prepareIsolation` 只拷 `model-catalog.json`，`generation-model-defaults.json` 没拷（run4 起补上）。产品那半：这句话只给了一条出路（去设置里选），而 Agent 真正能用的那条出路（显式给 `moduleId`+`providerId`+`modelId`，见同文件 `:203-206`）它一个字都没提；Agent 猜了三次 `image` / `image_generation` / `canvas`，全部回 `Unknown module: …`，而没有任何工具能列出合法的 moduleId |
| 5 | **走通用路径接 apimart，会把 apimart 的付费生成关掉** | `Provider apimart lacks required recovery capabilities: configured_provider` | **真缺陷，本轮最重的一条**（详见下一节） |

### 第 5 道闸：通用路径把内置档的 transport 顶下线，而替补从来没上场

`generationProviderBootstrap.ts:62-67` 的 `hasSafeDirectKeyScope('apimart')` 要求
`!hasCertificationOwnedConnection(...)`；`:47-50` 的判据是「这个 vendor 或它的某个 model 的
`meta` 上有 adapter」。而 Agent 走**通用接中转**路径 `connect_provider` 之后，apimart 这条连接
正是 certification-owned。于是：

```
通用路径接 apimart
  → 连接变成 certification-owned
    → 内置直连 transport 主动让位（`:53-57` 写清了理由：certification-owned 的行必须由
       认证适配器来服务，拿它的 published metadata 当 APIMart 执行会静默强推 Bearer 与
       APIMart 的固定路径）
      → 而认证适配器**从来没编出来**：`draft_adapter` 的声明形状与校验器对不上（上表第 2 条缺陷），
         Agent 连试 5 次都被 `proposal.candidates must contain 1 to 100 items` 拒绝
        → 没有任何 transport 能服务它 → 付费提交被 `configured_provider` 挡住
```

让位那一步是**有意的、且理由正当**；真正的缺口是「让位之后替补上不来」。
两个已知缺陷（`draft_adapter` 形状、`choose_models` 丢 kind）在这里合成一个用户可感知的后果：
**用户让 Agent「把 APIMart 当中转接一下」，APIMart 的生成就用不了了。**
这条不在本 PR 修——它跨了钱/信任边界（`hasSafeDirectKeyScope` 是安全判据），该单独出方案。

## 截图证明了什么、没证明什么（别把它当画布证据）

四轮跑共拍了 12 张截图，**逐字节一模一样**（md5 全等），拍的都是隔离实例那个窗口当时的样子：
停在「Nomi 项目库 · 还没有项目」。所以只留一张 `gui-was-running.png`——同一张图存 12 份
不会多证明任何东西。它只证明两件事：
① 那个 GUI 实例确实在跑（这正好是「Nomi 没在运行」那句假话的反证）；
② 这个窗口从头到尾没有被导航到 MCP 新建的那个项目。

**它们不是画布状态的证据。** 节点确实建出来了——证据是 `nomi_canvas_edit` 与
`nomi_read target=canvas` 的返回（见 `run4-media/turn-2-*.stream.jsonl`），不是这几张图。
顺带记一笔**未确证**的观察：MCP 新建了项目（`nomi_project_create` 成功、`nomi_session_open`
拿到了 lease），而同一实例的 GUI 项目库仍显示「还没有项目」。可能只是这个列表不实时刷新
（窗口是在建项目之前打开的），也可能是真的不同步——本轮没有进一步探针，不下结论。

## 走不通的地方，分成两堆

### 我们的（工具面 / 说明书 / 发现流程）

| # | 现象 | 位置 | 处置 |
|---|---|---|---|
| 1 | 三句没有证据的结论 | `mcpCredentialElicitation.ts`、`modelOnboarding/dispatch.ts` | **本分支已修**，行为侧已复跑验证 |
| 2 | `draft_adapter` 的 `adapterDraft` 形状对不上：声明说 `{"sources":[],"models":[]}`，校验器要 `candidates`/`selections` | `declarations.ts` draft_adapter 的 params 槽 vs `integrationProposalValidation.ts` | 记录：O4「描述与运行时同一份」没覆盖「字段里那段 JSON 的形状」。run1 拒 1 次、run2 连拒 5 次，Agent 无法自纠 |
| 3 | `choose_models` 收下的 `kind` 被丢掉，两个模型都落成 `kind: "text"` | `modelOnboarding/dispatch.ts` chooseModels | 记录：字段必填、模型写对、值被无声丢弃 |
| 4 | `nomi_session_open` 广播了 `bootstrap.mode="current_project"`，外部宿主恒 `project_selection_denied` | `mcpProjectSessionTool.ts` | 记录：两次跑都在这上面浪费一跳 |
| 5 | 单次生成对外宿主**默认关**（`NOMI_MCP_GENERATION_SINGLE_SHOT_V1` 不设 → `feature_disabled`） | `mcpGenerationPolicy.ts:9 / :169` | 记录：装机版不设这个 env，所以**今天外部 MCP 宿主出不了片**。这是灰度状态不是 bug，但它是「MCP 外部宿主出片」的头号闸门；而且那个错误码不带主语，Agent 把它读成了「Nomi 没在运行」 |
| 6 | 画布写入 ≥2 个节点走 elicitation-first 递进宿主，`claude -p` 无人值守直接 decline | `mcpProtocol.ts:540-556` | 记录：判据是 `clientSupportsElicitation && isAppOpen()`，但「声明支持」≠「有人在」。run3 改成一次只建一个节点绕过去 |

### 供应商 / 网络（如实标，不改代码兜底）

- `gpt-image-2.5` 在 APIMart 的目录页有、`/v1/models` 端点没有（见上）。
- `radar:models` 的 `apimart-llm` 车道今天**没查成**：本机 APIMart 凭据是 safeStorage 密文，
  脚本侧要 `APIMART_API_KEY` env 才能查。这不是「没有新模型」。

## 顺带核的三条群反馈（2026-09-11）

- **T-MO-10「验证扣积分没过报价卡」：仍然成立。** 三处：App 内 测试连接 按钮走
  `electron/ai/onboarding/onboardingIpc.ts:50/53/56` 三条裸 POST（`/v1/messages`、`/responses`、
  `/chat/completions`；autoProbe 下一次点击最多三条），自定义调用的测试运行
  `electron/catalog/customCallIpc.ts:37-42` 是一次真的 `text_to_image` / `text_to_video`，
  ComfyUI 自检在 `electron/integrationCertification/integrationSession.ts:412` 自铸
  `mintSpendGrant` 而 `electron/tasks/taskSpend.ts:12-15` 的 ComfyUI 分支跳过报价。
  **本轮不改**：这是钱的闸的改动，该单独一条 lane。
  另外 `IntegrationSelfCheckPanel.tsx:22-24` 的「自检不花钱、没有报价」文案在 hosted Comfy 上是假的。
- **T-MO-03「供应商切换跳回 ApiMart」：仍然成立，根因已定位。**
  `src/workbench/creation/storyboard/shotRow/ShotComposerBar.tsx:93-97` 调
  `useDedupedModelSelect` 时既不传第 4 个 `vendor` 参数、`onChange` 又把 `onProviderPick` 给的
  第二个 `vendor` 参数丢掉，于是重渲染时 `resolveProviderSelectValue(...)` 的 `locked` 恒 undefined、
  回落到目录顺序第一家；`sortModelProviders` 在用户没排序时按 tier + 名字排，"APIMart" 排在最前。
  画布节点那个选择器是对的（`InlineParameterBar.tsx:248-253` 传了 vendor）。
  同一个坑 `storyboardPlan.ts:149-153` 的注释里已经写过（2026-09-03 付费走查：选 APIMart 却发去
  code-newcli-com），字段 `PlanShot.modelVendor` 存在但 ShotComposerBar 从不读写它。**本轮只记录**。
- **T-MO-04「这个大页面干嘛的」：只记录。** 最可能指
  `src/ui/onboarding/OnboardingWizard.tsx`（758 行，`{type:'add'}` 手动接入表单：预设、baseUrl、key、
  authType/header/query、协议自动探测、额外 header、代理、模型发现、逐模型 kind 猜测、测试连接）。
  同一个首页上有三条并列的入口都通向「加一家供应商」：AI 辅助接入区、
  `{type:'platformConnect'}`（`KnownVendorKeyConnectPage.tsx`，已适配厂商只填 key）、
  `{type:'add'}`（这个 758 行的表单）。

## 另外记一笔：用户真实 `~/.claude.json` 已被别的测试污染

`mcpServers.nomi.env.NOMI_SETTINGS_DIR` 现在指向 `/Users/aoqimin/Desktop/Nomi-ver…`（一个旧的测试
worktree），不是真实资料库。**不是本轮造成的**（跑前跑后 `mcpServers` 指纹未变）。
写入方是 `electron/capabilityCore/mcpConfig.ts` 的「接入 Codex/Claude Code」流程：`NOMI_E2E` 只守住了
开机自修那条（`:502`），面板那条（`readMcpInfo` → `clientInfo` → `jsonInstall`，`:438`）没有任何守卫，
而 `readMcpInfo` 是 模型接入 首页挂载时就会调的
（`src/ui/onboarding/AiAssistedOnboardingSection.tsx:55`）。
**后果**：任何隔离实例只要打开一次 模型接入，就会把开发者真实的宿主配置改成指向那次测试的二进制。
用户侧修法是从真实 Nomi.app 重新连一次 Claude Code；产品侧修法（按实例身份拦隔离实例的全局写）
不在本 lane，记在这里。
