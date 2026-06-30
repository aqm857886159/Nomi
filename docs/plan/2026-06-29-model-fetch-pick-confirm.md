# 拉取模型 → 第二屏勾选确认 → 只接入选中的

日期：2026-06-29
状态：已拍板（用户确认方向 + 方案 A 默认不勾 + 换屏）
触发：用户痛点——添加自定义 API 拉取模型时「一股脑全自动加进来」（109 个），污染所有模型下拉；
希望拉取后弹第二屏，按 文本/图片/视频/配音 自动归类，勾选确认真正要用的几个；并在接入口加「来源名称」区分不同上游（抗断供）。

## 一句话

把现有「拉到即全量灌库（opt-out，删多余）」改成「拉到列清单 → 用户勾选 → 只接入勾的（opt-in）」，并露出来源名称字段。

## 现状（钉到行号）

- `src/ui/onboarding/OnboardingWizard.tsx:185-191` — 拉取后 `applyModelIds([...所有])` 全量灌进 `models` state，无勾选步骤。
- `src/ui/onboarding/OnboardingWizard.tsx:283-290` — 失焦自动拉取，同样直接灌。
- `electron/catalog/modelKindHeuristic.ts:35` — `guessModelKind` 只输出 `text|image|video`，**音频（TTS/配音）被错塞进 text**。
- `src/ui/onboarding/OnboardingWizard.tsx:54` — `vendorName` state 已存在但无输入框；commit 链路（`catalogCommit.ts:303`）早已支持 `vendor.name`。
- `electron/catalog/catalogCommit.ts:281,325` — 后端 commit **已支持 per-model `kind`（含 audio）**，无需改后端类型。

## 改动范围

### A. 音频判类（治「配音塞进文本」· 后端）
- `electron/catalog/modelKindHeuristic.ts`：`GuessableModelKind` 加 `"audio"`；新增 `AUDIO_PATTERNS`（tts/speech/voice/audio/whisper/realtime/cosyvoice/sovits/vocal/sing/tortoise/elevenlabs/musicgen/suno…）；判定顺序 video → audio → image → text（音频词独立，避免被 image/text 吞）。更新文件头注释（删「暂归 text」那段，P1）。
- 同步加宽返回类型三处：`electron/ai/onboarding/onboardingIpc.ts:113`、`electron/preload.ts:173`、`src/desktop/bridge.ts:275` 的 `Record<string,'text'|'image'|'video'>` → 加 `'audio'`。

### B. 第二屏：模型勾选器（新组件 · 前端 · R9 防巨壳）
- 新文件 `src/ui/onboarding/ModelPickerScreen.tsx`（无 wizard state 的展示+本地选择组件）：
  - props：`candidates: Array<{id,kind}>`、`initialSelectedIds: string[]`、`sourceName`、`host`、`onConfirm(selected: Array<{id,kind}>)`、`onBack()`、`onRefetch()`、`fetching`。
  - 复用 `groupModelsByKind`（`modelChipGrouping.ts:29`）+ `MODEL_CHIP_KIND_LABEL` 分组（文本/图片/视频/配音/3D）。
  - 顶部：返回箭头 + 标题「选择要添加的模型」+ 来源行（sourceName · host · 拉到 N 个）+ 重新拉取。
  - 搜索框（按 id 过滤）；「已选 N / 共 N」计数 + 清空。
  - 每组：标题 + 数量 + 「全选本组 / 取消本组」；每行 checkbox + mono id。
  - **方案 A：默认不勾**（`initialSelectedIds` 为空时全不选）。
  - 底部：取消 + 「添加 N 个模型」（filled accent）。
  - 单文件 ≤800 行（实际预计 ~180）。

### C. 接起来：改 Wizard（前端）
- `src/ui/onboarding/OnboardingWizard.tsx`：
  - 新增 `vendorName` 输入框（`Field` + `DesignTextInput`），置于「接入地址」之上，hint「给这个上游起个名，方便区分不同 API」。
  - 新增 state：`candidateModels: Array<{id,kind}>`（拉到的池）、`screen: 'form'|'select'`、`fetchAttempted: boolean`。
  - 改 `handleFetchModels`：拉到 → guessKinds 预填 → `setCandidateModels(...)`，**不再** `applyModelIds` 灌 `models`、**不再**自动跳屏（失焦自动拉取只静默填池）。
  - **删旧（P1）**：移除表单内 `TagsInput`（438-444）+ fetchModelsMsg 手填块。模型录入唯一入口收口到 picker（picker 底部留「手填未列出的 id」补充，保留手动能力，不丢逃生口）。
  - 表单「模型」区按状态渲染：未拉取→hint；拉到且未选→「拉到 N 个 · 选择模型 →」按钮开 picker；已选→`已选 N 个` + per-model 行（id + 类型 Select + 删除，保留改类型能力）+「修改」开 picker。
  - `screen==='select'` 时模态 body 渲染 `<ModelPickerScreen/>` 取代表单（换屏，非新弹窗）。
  - `onConfirm` → `setModels(selected)` + `setScreen('form')`。

### D. 测试
- `electron/catalog/modelKindHeuristic.test.ts`：加 audio 用例（doubao-tts/cosyvoice/gpt-realtime/whisper/elevenlabs → audio；确保 seedance 仍 video、flux 仍 image、deepseek 仍 text）。
- picker 若抽出纯函数（如「按 candidates+selected 算各组选中数/全选态」）加 node 单测；否则靠 modelKindHeuristic + 现有 groupModelsByKind 测试覆盖。

## 不动项

- 后端 commit / catalog 类型（已支持 per-model kind + audio）。
- vendor 归属逻辑（`deriveVendorKeyFromBaseUrl`，仍按 hostname；name 只作显示）。
- 「已接入/可接入」分层面板（`OnboardingDrawer`）——本次只改 Wizard 内部流。
- 测试连接 / 高级设置 / 接口协议探测逻辑。

## 回滚

纯前端 + 一个启发式表扩展；revert 这批 commit 即回到「全量灌库」。无数据迁移、无持久化结构变更。

## 验收门（R11 + R13）

1. 五门全过：`pnpm run gates`（filesize→tokens→lint→typecheck→test→build）。
2. 与获批样张逐项对账：两屏流、默认不勾、按四类分组、搜索、全选本组、来源名称、已选摘要。
3. R13 真机走查（NOMI_E2E=1）：打开添加模型 → 填地址+Key → 拉取 → 第二屏出现且默认不勾 → 勾 2-3 个 → 回表单看摘要 → 改一个类型 → 保存 → 截图人眼确认只接入了选中的、配音模型归到配音组。
