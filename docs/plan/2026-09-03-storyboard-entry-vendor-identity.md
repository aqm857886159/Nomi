# 分镜表：入口贯通 + 供应商身份 + 三栏骨架

状态：✅ **S1/S2/S3 已实现**（待真实付费闭环复验才能称「已解决」，R19）；原文状态：🚧 实施中（2026-09-03；来源=分镜表 v5 首次真实付费闭环走查，报告 `/tmp/e2e-report.md`）

> ⚠️ 本文档是**方案**，不是现状。现状见 `docs/ARCHITECTURE-NOW.md`。

## 0. 为什么是现在

分镜表 v5 四段（A/B/C/D）全部合入 main 后，做了**第一次真实付费闭环走查**（真实 Electron、
`isolate:false`、真实资料库、APIMart 真扣额度）。此前四段的 R16 情绪日志全部跑在零额度
fixture 上——**名字对上了、实质没有**（playbook §15：判据是形容词就会被同名替代物满足）。

真跑一次的结论是：**小白目前做不出一条片子**。三个高危缺陷全部是 fixture 结构上抓不到的。

## 1. 三个根因（主会话逐条查实，非报告猜测）

### Bug 1（高）创作页「新建分镜方案」点击无反应
`DocumentListSidebar.tsx:117` 调 `storyboardPlannerLauncher?.()`；`WorkbenchEditor.tsx:237` 同样依赖它。
`setStoryboardPlannerLauncher` 全仓零注册方 —— launcher 恒 `null`，`?.()` 静默跳过。

**追到底：注册者不是「没写」，是「被删了」。** `git log -S` 定位到 `d270d34e`（agent-host M1 移植）：
它用 `ProjectAgentResidentShell` 换掉旧的创作 AI 面板 `WorkbenchAiPanel.tsx`，而那个面板里
`React.useEffect(() => setStoryboardPlannerLauncher(launchStoryboardPlanning))` 是**唯一注册点**，
随文件一起消失，新壳没补。加新删旧时把旧实现的一项能力一并删掉了（P1 的反面）。

**类根因**：可空回调 + 可选链 = **失败被设计成静默**。缺口存活两天且 49 个门岗全绿。

### Bug 2（高）创作 Agent 报「文稿为空」且没有分镜工具

> ⚠️ **本条最初写的根因（「`creation-editor` 能力不含 `propose_storyboard_plan`」）已被实测推翻。**
> `nomi_canvas_plan` 本来就在 `canvasCore` 里（`agentToolCatalog.ts:57`），创作页拿得到。
> 留此更正是因为：读码得出的猜测和实测长得一模一样，区别只在有没有跑探针。

**真根因（探针实测，`agentToolsForRequest` 直接打表）**：工具 profile 由一张手写正则猜用户措辞——

| prompt | profile | 拿到 `nomi_canvas_plan` |
|---|---|---|
| 「拆镜头」 | creation | ❌ |
| 「把这个故事拆成 8 个镜头」 | creation | ❌ |
| 「生成分镜方案」 | storyboard | ✅ |

`STORYBOARD_INTENT` 里有「镜头卡/镜头设计」，偏偏没有「镜头」——而「拆镜头」正是产品自己的
按钮文案。**词表与产品文案脱钩**，用户点自己的按钮触发不了自己的功能。

**「文稿为空」是另一条独立根因**：正文只能从**挂载中的** tiptap 桥读（`NomiStudioApp.tsx:283`），
分镜页/生成页不挂载编辑器，读一律 `surface_port_stale`；而正文本来就持久化在
`workbenchDocuments[].contentJson` 里没被用。真相源绑在了 UI 组件的挂载生命周期上。

### Bug 3（阻断）UI 选 APIMart，请求发去 code-newcli-com
**这不是新 bug，是 2026-08-18 已登记、已被测试固化的缺口**：
- `StoryboardBulkBar.tsx:59` 注释：「⚠️ 已知缺口（2026-08-18 实查，不假装修好）：PlanShot 没有
  vendor 字段…落地厂商 = 目录里第一家，与用户所选无关」
- `storyboardPlan.test.ts:80` `it('厂商在 plan→canvas 落地路径上被丢弃…')` —— **测试把错误行为钉住了**
- 链路：`storyboardPlanToCreateNodesArgs` 只透传 `modelKey` → `buildPlannedNodeMeta` 用
  `entryByKey.get(modelKey)` 反查厂商 → `buildAgentModelEntries` 按 modelKey 去重、**首家胜出**
- 真实后果：选 APIMart Qwen-Image 3.0，出站 `code-newcli-com /codex/v1/images/generations` HTTP 400
  （项目 `.nomi/events/log-0.jsonl` seq 55/64/68/69）
**类根因**：**模型身份的唯一键是 `(vendor, modelKey)`，而链路上只带了 modelKey**——一旦两家供应商
提供同名模型，身份即坍缩。不限于分镜表：画布 Agent 的模型清单同样按 modelKey 去重。

### 4（设计缺口）分镜页是孤岛
`StoryboardWorkspace.tsx:10` 注释：「全宽…**无文档侧栏无 AI 栏**」。对照创作页
`[240 文档目录 | 1fr 编辑器 | 340 AI 助手]`。后果：进分镜页后切不了文档/方案；**最需要 AI 的地方
反而没有 AI**；而顶栏 stepper 仍高亮「创作」（`identity.tsx:137`），用户不知道自己换了页，
只发现左右两栏凭空消失。当初「必须全宽」的理由（中列 856px 太窄）在删掉 1264 上限后已不成立。

## 2. 机制层教训（playbook §15 同类扫描已做）

**「诚实记录」变成了免罪符。** Bug 3 三件事都做得规范——注释写「不假装修好」、测试固化、缺口登记——
**但没有任何机制强制清偿**，它安静躺了 16 天，直到真花钱才炸。

**同类**：`check:tokens` / `heavy-path` / `walkthroughs` / `dangling-tailwind` / `dangling-tokens`
全是棘轮基线——**防恶化，不推清偿**；51 处悬空类里「已完成绿字一直没上色」正躺在基线里；
R16 四段「合理推迟」同形状。
**通用处置**：债务登记必须写**到期条件（谓词）**——如本条应写「用户能选到第二家供应商时即成阻断」，
而不是无限期挂账。有到期条件才可能有门岗在条件满足时报红。→ 落 playbook §16。

## 3. 做什么

### S1 供应商身份贯通（阻断级，先做）
- `PlanShot` / `PlanCreatedNode` 增 `modelVendor?: string`；`storyboardPlanToCreateNodesArgs` 透传；
  `buildPlannedNodeMeta` 优先用显式 vendor，缺省才回落反查
- `buildAgentModelEntries` 去重键从 `modelKey` 改为 `(vendor, modelKey)`；`BulkModelPicker` 选项
  携带 vendor 并写回 plan
- **把 `storyboardPlan.test.ts:80` 那条固化错误行为的测试反转为正确断言**（P1：加新必删旧，
  错误行为的「留痕」不能继续冒充规格）
- `resolveStoryboardImageDefault/VideoDefault` 返回值带 vendor

### S2 入口贯通
- 注册 `setStoryboardPlannerLauncher`（在创作 AI 面板挂载处），并**去掉静默失败**：
  launcher 缺失时按钮禁用 + 说明为什么（§1.6 C4 禁用不做沟通死路），不再 `?.()` 吞掉
- `creation-editor` 能力补 `propose_storyboard_plan`；修「文稿可见却报为空」的上下文注入

### S3 三栏骨架（用户可见 → 先出样张拍板 R8）
分镜页复用 `[DocumentListSidebar | 分镜表 | CreationAiPanel]`，**全部复用现成件不重造**。
宽度核算：1680 − 240 − 340 − gaps ≈ 1100px 中列 > 原创作中列 856px。
形态契约补一条：分镜页三栏骨架与创作页同构。

## 4. 不动项 / 回滚 / 验收门

**不动**：画布/时间轴/导出；`AssetReference` 内核；顶栏 stepper 共享高亮（另议）。
**回滚**：S1 的 vendor 字段可选、向后兼容；S2/S3 独立 revert。
**验收门**：五门全绿 · S3 与样张逐项对账 + 形态契约 · **S1/S2 必须由一次新的真实付费闭环证明
（真出图、真出片），fixture 不算数**——本单的存在理由就是 fixture 证不了这些。
