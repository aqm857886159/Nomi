# 交接卡 · P4 收官 → P5/Track D 推进中（2026-08-25 晚）

> 给下一个会话（重启后 Opus 子 agent 应已恢复，见 §0）。读完这份就能接着干，不用回溯对话。

## 0. 第一件事：确认子 agent 能派

本会话踩了一整轮：主会话 `--effort max` + Opus 5，**thinking 关闭时 effort max 非法**，导致所有 Agent 派发（显式 opus / 继承 / sonnet / Workflow 通道）秒挂 400。

**已改好的设置（重启后生效，本会话内改不生效）**：
- `Nomi/.claude/settings.json` → `env.MAX_THINKING_TOKENS = "10000"`
- `~/.claude/settings.json` → `alwaysThinkingEnabled: true`

用户要求**保留主会话 effort=max**，所以走的是「开 thinking」这条路，不是降 effort。

**开工前先探针**：派一个「回复 OK、不用工具」的最小 agent 判活。若仍 400 → 用 Codex CLI 兜底（见 §4）。

## 1. 已完成（都在 origin/main）

- **P4「小说/剧本→一集」生产段全部完成并宣告**：验收门 §5.1-§5.5 逐项打钩（`docs/audit/2026-08-25-p4-acceptance-checklist.md`），含真金付费验收（真视频 submit→慢轮询→completed→materialize 全程落盘）。
- **体验走查 J1 专项**（`docs/audit/2026-08-25-experiential-walkthrough-j1.md`）：8 条摩擦，6 修入 main、1 撤案（F16 是我的测量误诊，护栏见 PR #168）、1 进样张队列。
- 当日合入的关键 PR：#153 S6 返工链 / #155 S6.5 生产入口 / #154 走查六摩擦 / #156 锚检查点决议链 / #158 调度器慢供应商三洞 / #161 锚复用 E2E / #162 F15 冻结门操作者 / #163+#173 术语人话化 / #165 S7a 门岗 / #167 形象确认卡 / #168 防误诊护栏 / #171 全应用地基审计 / #169 P4 宣告。

## 2. 在飞（本会话派出、可能尚未落地）

**Codex CLI 三路**（独立额度池，日志在 `/tmp/codex-*.log`）：

| 分支 / worktree | 内容 | 交付物 |
|---|---|---|
| `claude/mcp-ipc-lifecycle-hardening` @ `~/Desktop/nomi-mcp-hardening` | **Track D1**：MCP 取消绑定在飞操作、付费确认与 request 一一绑定、tools/call schema 运行时校验、版本交集协商、stdio 行上限、IPC 绑 sender/origin | 已建 `mcpRequestRegistry.ts` / `mcpConfirmationBinding.ts` / `mcpArgValidation.ts` + plan 文档 |
| `claude/p5-e1-adoption-bridge` @ `~/Desktop/nomi-e1-adoption` | **P5 E1 采纳桥**：产物→时间轴收敛为唯一受控通道（EditProposal / 幂等键 / 原子 apply+补偿 / 一步 Undo）；顺带交付验收门「时间轴连片」证据 | 已建 `src/workbench/adoption/` + plan 文档 |
| `claude/ux-f3-f16b` @ `~/Desktop/nomi-ux-friction` | **F3 + F16b**（样张已获用户批准）：拆镜入口进选中浮条；花钱卡与托管卡合并成一张 | 全新开工 |

**若 Codex 那边没交付**：进对应 worktree 看 `git status` 的未提交改动 + 读它的 `docs/plan/*.md`，**接着做别推倒重来**。

## 3. 已获批样张的实施规格（F3 / F16b）

用户 2026-08-25 已看过交互样张并批准。规格（含真机实测几何，viewport 1440×842）：

**F3 拆镜入口**：选中态浮条外框 (337,103) 210×40，内含 6 钮 y=108：加粗(342) 斜体(373) H1(404) H2(435) | 生成图片(478) 生成视频(511)。「拆成镜头 · 落画布」现在孤悬右栏 (998,217) 162×28——**隔了 660px**，这是不可发现的根因。规格：在「生成视频」后加第三个动作钮「拆成镜头」（纯图标 + aria-label，与同组两钮形态一致）；**右栏那个保留**（对话驱动 vs 选区驱动是两个起点），但**必须调用同一 handler**，禁止复制逻辑。

**F16b 双确认卡合一**：今天点完「生成」还会再弹一张「KIE 视频上传 / 公共托管确认」，且**每次生成都问**。规格：需匿名托管且设置为 `'ask'` 时**不弹第二张卡**，把托管披露并进花钱卡的信息块（**所有风险披露一字不少**：素材离开本机、链接短期有效、隐私风险、KIE 免费且优先），加勾选「记住我的选择，以后不再问」→ 写既有设置 `anonymousAssetHosting='allow'`（`src/workbench/settings/AiModelsSection.tsx:225`，**不新建设置项**）。不需要上传时卡形态零变化。加新必删旧：原独立托管卡弹出路径要删。

## 4. Codex CLI 兜底用法（子 agent 被挡时）

```bash
nohup codex exec -C <worktree 绝对路径> --dangerously-bypass-approvals-and-sandbox "<完整 brief>" > /tmp/codex-x.log 2>&1 &
```
一个 worktree 一路，可多路并行；brief 里必须写清：读 CLAUDE.md、门禁 `pnpm run gates` 真退出码（**别用管道接 test/build，会吞退出码**）、commit 尾 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`、**不要自己 merge PR**。实测有效：#173 就是 Codex 接手被砍 agent 的半成品交付的。

## 5. 下一步路线（已终审 Master Plan §6）

- **Track A**：E1 落地后 → **E2 结构化粗剪**（从分镜结构派生排列/字幕/音乐，**零模型调用**）→ E3 理解式剪辑（贵，最后）。
- **Track D**（地基，来自 #171 审计的 owner 裁定）：**D1 在飞** → D2 IPC `sendSync` 读路径异步化 → D3 画布/时间轴瞬时态与领域态分离（**改完「换不换成熟内核」才从必答题变选择题**）→ D4 可选换内核。**保护项**（账本/预算/一致性/权限）永不被反向改写。
- **Track B**：B4 harness 核心（事件账本/审批信道/策略引擎/单循环）→ B5 Agent 主栏（**大 UI，样张必须用户亲眼拍板**）。
- 债务：S7b（`driveGeneration` 收编，删 ~120 行）、复用徽标投影补齐、`/design-sync` 把 `src/design/` 同步成可浏览组件库（建议在 B5 动工前做，能根治「样张凭脑补」）。

## 6. 工作纪律（本会话新增/强化）

- **R20 造轮子前先过 build-vs-buy 闸**（已进 CLAUDE.md + `docs/engineering-rules.md`）：写通用能力前三问，四类判据表。
- **PR 攒批**：文档搭车、小修按主题合并、**每天 ≤3 个 PR**、只有大切片独立。用户明确嫌 PR 太碎。
- **主会话只做判断**：走查驱动/截图/合并列车/PR 收尾全派 agent；主会话留给判断、拍板、写 brief、看关键证据。agent 报告限 15-25 行。
- 改 `CLAUDE.md` 后**必须** `node scripts/gen-agents-md.mjs` 重生成镜像，否则 `check:agents-sync` 门岗必红（本会话栽了一次）。
