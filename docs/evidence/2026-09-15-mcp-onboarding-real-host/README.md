# 真实闭环：外部 MCP 宿主接 APIMart 最新图/视频模型（T-MO-05 / T-MO-08）

> 2026-09-15 · 分支 `test/mcp-onboarding-acceptance-20260915`（基线 PR #754 合 main）
> 宿主 **Claude Code CLI 2.1.270**，模型 sonnet，非交互 `claude -p --strict-mcp-config`
> 被测实例：隔离 Nomi（`prepareIsolation` 拷真实 `model-catalog.json`，APIMart key 已存且能解）
> 脚本 `tests/ux/mcp-onboarding-real-host.paid.mjs`

## 怎么量的，以及两条不能省的纪律

- **入参一次写对** = 这次 `tools/call` 的结果不是 `isError`。逐条证据在每个回合的
  `turn-*.stream.jsonl`（`--output-format stream-json`，宿主原生逐调用事件流，不是我们自己记的）。
- **`--strict-mcp-config` 是硬约束**。这台机器上用户真实的 `~/.claude.json` 里挂着一个真的 `nomi`
  server（指向 `/Applications/Nomi.app`）。不加这一条，宿主会同时看到两个 nomi、工具名撞车，分母不可信
  —— 09-11 的 Codex 读数 31/31 就是这么作废的。跑完核 `mcpServers` 指纹，两次都未变。
- **隔离四路全设**（settings / projects / userData / capability）。capability 漏了就会抢真实 Nomi 的
  `~/.nomi/capability-core` 广告与 token；App 侧 `NOMI_E2E=1` 让 `repairStaleMcpConfigs` 短路，
  所以这次没有改写任何宿主配置。

## 三次跑的读数（同一个宿主、同一批话）

| | 09-11 基线 | run1 修前 | run2 修后 | run3 修后 + 出片 |
|---|---|---|---|---|
| 宿主 | Codex CLI 0.153.4 | Claude Code CLI 2.1.270 | 同 run1 | 同 run1 |
| 工具调用 | 58 | 20 | 30 | 见下 |
| **入参一次写对** | **36/58 = 62%** | **17/20 = 85.0%** | **20/30 = 66.7%** | 见下 |
| 回合成功 | 1/9 | 0/4 | 0/2 | 见下 |
| 人工介入 | 10 | 3（全部由假话造成） | 0 | 见下 |
| 真出片 | — | ✗ | ✗ | 见下 |

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
