# 技术栈升级立项：React 19 · AI SDK · Tailwind 4

> 状态：📋 方案待拍板
> 立项日：2026-09-06 ｜ 分支：`docs/stack-upgrade-react19-aisdk5-tailwind4-20260906` ｜ **docs-only，本文不改一行代码**
> 驱动：Agent 面板 v4 在 vendor Vercel AI Elements（上游写在 React 19 + Tailwind 4 + shadcn + AI SDK 6 上）。
> 主会话判断：升级另立项，先 React 19 + AI SDK，Tailwind 4 最后。本文是那个立项。
> 事实基线：全部实查（npm registry / 官方迁移指南 / Context7 / 本机可编译探针），实查日期 2026-09-06，逐条带出处。
> 关联：[Agent 面板 v4 lab](2026-09-05-agent-ui-a-composer.md) · AI Elements 源码解剖 `docs/research/2026-09-06-ai-elements-anatomy.md`（在 `feat/agent-panel-v4-lab-20260906` 分支）

---

## 0. 先纠正三个前提（这三条改变了整个方案的形状）

立项任务书里的三条前提，实查后有两条不成立、一条要换目标版本。**先说清楚，因为下面所有取舍都建立在这三条上。**

### 0.1 「AI SDK 5 的 UIMessage parts 和我们刚做的无损历史是一回事」—— 结构像，但**不是一回事**

本仓**根本没有引入 AI SDK 的 UI 层**：

| 事实 | 证据 |
|---|---|
| `useChat` / `useCompletion` / `useObject` / `@ai-sdk/react` 在全仓命中 **0 处** | 全仓 grep，含 `src` `electron` `tests` |
| Agent 的大脑是 **pi**，不是 AI SDK | `@earendil-works/pi-ai@0.84.3` 的依赖是 `@anthropic-ai/sdk` / `openai` / `@google/genai`，**不依赖 `ai`** |
| 无损历史的真相源是我们自己的判别联合 | `electron/shared/projectAgentContracts.ts`（626 行）：`ProjectAgentItem` 的 kind 有 `user`/`assistant`/`tool`/`proposal`/`task`/`artifact`/`failure`，还挂着 `ProposalApprovalRef`、`ProjectAgentSpendPolicy`、`ProjectAgentApprovalPolicy` |

AI SDK 的 `UIMessage.parts` **没有** proposal / approval / spend policy 这一层——那是 Nomi 的产品语义，不是聊天协议语义。所以：

- **升 AI SDK 拿不到「现成的无损历史」**，我们的那份更强，且已经在跑。
- 真要改用 `UIMessage`，等于**换掉 `ProjectAgentItem` 这个 owner**，那是一次产品级重构，不是版本升级；期间两套并存直接违反 P1。

**结论：AI SDK 升级与 Agent 面板 v4 无因果关系。** 它该不该做要另找理由（见 §4）。

### 0.2 「AI SDK 5」—— 目标版本要重选，5 已经是**两个大版本前**的东西

npm dist-tags 实查（2026-09-06）：

| 线 | `ai` | `@ai-sdk/openai` | `@ai-sdk/anthropic` | `@ai-sdk/openai-compatible` | 模块格式 |
|---|---|---|---|---|---|
| 我们现在 | `4.3.19` | `^1` | `^1.2.12` | `^0.2.16` | CJS ✅ |
| `ai-v5` | `5.0.253` | `2.0.125` | `2.0.101` | `1.0.53` | CJS ✅ |
| `ai-v6` | `6.0.277` | `3.0.109` | `3.0.116` | `2.0.74` | CJS ✅ |
| `latest` | `7.0.93` | `4.0.60` | `4.0.49` | `3.0.44` | **ESM-only** ⛔ |

两条硬事实：

1. **AI SDK 7 是 ESM-only**（`ai@7.0.93` 的 package.json 带 `"type": "module"`），而我们主进程是 CommonJS（`electron/tsconfig.json` 的 `"module": "CommonJS"`，`package.json` 无 `"type"`）。**7 现在进不来**，除非把整个主进程构建改成 ESM——那是另一个更大的项目。
   （运行时不是问题：Electron 43.4.1 内置 Node 24.18.1，满足 7 的「Node 22+」。挡路的纯粹是模块格式。）
2. **AI Elements 上游自己写在 `ai ^6.0.105` + `@ai-sdk/react ^3.0.41` 上**（源码解剖文档实读，commit `6a9d5b18`，2026-08-21）。要「和 vendor 源同代」，目标是 **6，不是 5**。

**结论：AI SDK 的目标版本是 6（CJS 尚在，且与 AI Elements 同代），不是 5，更不是 7。**

### 0.3 「React 19」的真实代价被低估了：它捆着**两个**次级迁移

`react ^18.3.1 → 19` 不是一个包的事。npm peerDependencies 实查：

| 包 | 现装版本 | 它的 react peer | React 19 下的结论 |
|---|---|---|---|
| `@mantine/core` | `7.13.1` | `^18.2.0` | ⛔ **不支持**。要一起升到 8（`^18.x \|\| ^19.x`）或 9（`^19.2.0`） |
| `@react-three/fiber` | `8.18.0` | `>=18 <19` | ⛔ **硬挡**。要升 9.7.0（peer `react >=19 <19.3`、`three >=0.156`） |
| `@react-three/drei` | `9.122.0` | 随 fiber 8 | ⛔ 要升 10.7.8（peer `react ^19`、`@react-three/fiber ^9`、`three >=0.159`） |
| `@xyflow/react` | `12.11.5` | `>=17` | ✅ 不用动 |
| `framer-motion` 12 / `@tiptap/react` 3 / `react-router-dom` 7 / `swr` 2 / `zustand` 4 / `@tanstack/react-virtual` 3 / `react-markdown` 10 / `react-resizable-panels` 4 / `react-i18next` 17 / Radix 1.2 / `@tabler/icons-react` 3 | — | 都已宣告 19 | ✅ 不用动 |

`three@0.184.0` 已装，满足 fiber 9 / drei 10 的下限。

**结论：一句「升 React 19」实际是三件事——React 19 + Mantine 8 + R3F 9/drei 10。** 后两件各自有独立的破坏面和验收成本，必须在计划里显式列成独立步骤，不能藏在「顺手升」里。

---

## 1. 事实基线（实查表）

所有版本号来自 2026-09-06 本机 `npm view`；迁移点来自官方迁移指南原文；带「探针」的来自本机可编译实验。

| 项 | 值 | 出处 |
|---|---|---|
| React latest | `19.2.8`（`@types/react` `19.2.18`、`@types/react-dom` `19.2.7`、`scheduler` `0.27.0`） | npm registry |
| React 19 破坏点 | 见 §2 | react.dev/blog/2024/04/25/react-19-upgrade-guide |
| Mantine | latest `9.6.0`；`legacy` tag = `7.17.8`；**9.x 要求 React 19.2+**；8.1.0 起把 `MutableRefObject` 换成 `RefObject` 以配 React 19 类型；8.0 的破坏项逐条对账见 §2.3(a) | Context7 `/mantinedev/mantine` 变更日志与 8x→9x 迁移指南；mantine.dev/changelog/8-0-0；npm peers |
| `@xyflow/react` | `12.11.5` 与 latest 的 peer 都是 `react >=17` | npm peers |
| R3F | fiber `9.7.0` / drei `10.7.8`；v9 要求 React 19，`Props`→`CanvasProps`，`MeshProps` 等硬编码导出改成 `ThreeElements['mesh']`，**StrictMode 现在会穿透到画布** | github.com/pmndrs/react-three-fiber releases/v9.0.0 |
| AI SDK | 见 §0.2 表；`ai@6` 的 zod peer 是 `^3.25.76 \|\| ^4.1.8`，engines `node >=18` | npm registry |
| zod | 本仓 `3.25.76` = AI SDK 5/6 接受的下限，**不用升 zod** | npm peers × 本机 lockfile |
| Tailwind | latest `4.3.3`（`@tailwindcss/postcss` / `@tailwindcss/vite` / `@tailwindcss/cli` 同版） | npm registry |
| Tailwind 4 破坏点 | 见 §5 | tailwindcss.com/docs/upgrade-guide |
| Electron | `43.4.1` = Chromium **150** + Node **24.18.1** | releases.electronjs.org/release/v43.4.1 |
| AI Elements 上游 | React `19.2.3` / `ai ^6.0.105` / `@ai-sdk/react ^3.0.41` / Tailwind 4 / Apache-2.0；`Response`·`Actions`·`MessageAvatar`·`PromptInputToolbar` 都已不存在 | 本仓 `docs/research/2026-09-06-ai-elements-anatomy.md`（读的是真源码） |
| **探针①** | `JSX.Element`（裸全局）在 `@types/react@19.2.18` + `typescript@5.6.3` 下报 **TS2503 Cannot find namespace 'JSX'** | 本机最小 tsx 探针，真跑 tsc |
| **探针②** | `MutableRefObject` 在 19 类型里**仍然存在**，只是 `@deprecated Use RefObject instead`（`index.d.ts:1668-1670`）→ 不阻断编译 | 读 `@types/react@19.2.18` 源 d.ts |
| **探针③** | 19 的 `useRef` 只有三个带参重载（`index.d.ts:1737/1749/1761`），**没有零参重载** | 同上 |

> Electron 43 无关本次升级，但记一笔：Chromium 150 远超 Tailwind 4 的浏览器下限（Chrome 111 / Safari 16.4），而 Nomi 是**单浏览器目标**——所以 Tailwind 4 的「浏览器兼容」这一整章对我们是零风险。这是 Tailwind 4 相对外部 web 项目**便宜很多**的地方。

---

## 2. React 18.3 → 19：本仓命中清单

扫描口径：`git ls-files` 下 `src/` `electron/` `tests/` `scripts/` 的 `.ts/.tsx/.mts/.mjs`，逐行正则 + 人工复核每一类的样本。

### 2.1 阻断编译的（必须改）

| 破坏点 | 命中 | 文件数 | 处置 |
|---|---|---|---|
| **全局 `JSX` 命名空间被移除**（`JSX.Element` / `JSX.IntrinsicElements` 裸引用） | **652 处** | 全 `src/` 铺开 | `npx types-react-codemod@latest scoped-jsx ./src`，改成 `React.JSX.Element`；codemod 后逐文件 review diff |
| `useRef()` 零参调用 | **0 处** | — | 无 |
| `ref` 回调隐式返回赋值表达式（19 当成清理函数报错） | **0 处** | — | 无 |
| `ReactDOM.render` / `hydrate` / `findDOMNode` / `unmountComponentAtNode` | **0 处** | — | 全仓 8 个入口都已是 `createRoot`（`src/main.tsx` + 7 个 devlab 入口） |
| `react-test-renderer` / `react-dom/test-utils` | **0 处** | — | 本仓**没有** `@testing-library/react`，组件测试走结构断言 + Playwright 走查，天然免疫这一整类 |
| `propTypes` / `createFactory` / 字符串 ref / 模块工厂 | **0 处** | — | 无 |

**652 处 `JSX.Element` 是本次升级唯一的大宗机械成本。** 它不难，但它会造出一个横扫全仓的 diff——这决定了它必须**独占一个 commit**，且不能和任何行为改动混在一起（否则 review 和二分定位都废了）。

### 2.2 不阻断但要盯的

| 项 | 命中 | 结论 |
|---|---|---|
| `React.MutableRefObject<T>` | **76 处** | 探针②证明 19 里仍在、只是弃用 → **不阻断**。可另开一轮换成 `RefObject`，但**不进本次升级**（P1：别把无关重构塞进版本升级的 diff）。注意 Mantine 8.1 已在它自己包里做过这件事 |
| `forwardRef` | **17 处 / 8 个文件** | 19 支持 ref-as-prop，但 `forwardRef` **仍然工作**。**本次不动**。⚠️ 将来真要迁，`src/design/actionsForwardRef.test.ts` 是一条断言「每个按钮都必须是 forwardRef 组件」的结构测试，迁移时必须同 commit 改掉它（P1） |
| `defaultProps` | **20 处，全在 `src/theme/nomiTheme.ts`** | **假阳性**：那是 **Mantine 主题的 `defaultProps`**，不是 React 的函数组件 `defaultProps`。⚠️ **禁止**对它跑任何 defaultProps codemod |
| `element.ref` | 3 处 | 全部假阳性：`approval.ref`（proposal 契约字段）、`entry.ref !== ref`（3D 轨迹 runtime store 自己的字段） |
| `useSyncExternalStore` | 16 处 | 19 原生支持，且 `use-sync-external-store` shim 仍在 dep 里给 zustand 4 用。不动 |
| **StrictMode** | `src/main.tsx:41` 包住全应用；3 个测试显式验证双调用语义（`useCanvasViewportGestures.strictMode.test.ts`、`trajectoryRuntimeStore.test.ts`、`DeferredNodeMedia.tsx` 的注释契约）；`src/devlab/designLab.tsx:226` 刻意**不**套 StrictMode | 19 的 StrictMode 会复用 `useMemo`/`useCallback` 结果——这可能**掩盖**掉现有测试想抓的东西。三个测试都要在升级后**亲自确认它们还在真的测东西**，不是变成恒真断言 |

### 2.3 被 React 19 捆住的两个次级迁移

**(a) Mantine 7.13 → 8**（`^18.x || ^19.x`，是唯一能同时兼容 18 和 19 的档，因此也是**唯一能做"先升 Mantine、再升 React"这种可回滚顺序**的档）

8.0 的破坏项逐条对本仓命中（changelog 实读）：

| Mantine 8 破坏项 | 我们中不中 |
|---|---|
| 全局样式 import 拆成 `baseline` / `default-css-variables` / `global` 三份 | ❌ 不中。我们用整包 `@mantine/core/styles.css`（`scripts/build-tailwind.mjs:21` 直接读它拼进 `public/tailwind.generated.css`），整包已含三者 |
| `@mantine/dates` 全部改用字符串日期、`DatesProvider` 去 timezone | ❌ 不中，未装该包 |
| `Carousel` 需显式装 embla、删若干 prop | ❌ 不中，未装 |
| `Switch` 指示器默认移进 thumb | ❌ 不中。`src/ui/switch.tsx` 是 Radix 的 Switch，不是 Mantine 的 |
| `Menu.Item` 删 `data-hovered` | ❌ 不中。仓里两处 `data-hovered` 是画布连线自己的属性（`generationCanvas.css:240/246`） |
| **`SegmentedControl` 默认高度改成对齐 Input 尺寸** | ✅ **中**。`src/design/forms.tsx` 的 `DesignSegmentedControl` 直接包 Mantine 的，全仓 16 处引用 |
| **`ScrollArea` 去掉 wrapper 上强制的 `display: table`** | ✅ **中**。`BrowserAssetPopoverView.tsx:228` 那个滚动区带 `viewportRef` + 自定义 `classNames`，正好压在这条上 |
| **Notification 默认间距变大** | ✅ **中**。toast 三合一走 `@mantine/notifications`（`src/ui/toast.tsx`） |
| checkbox/radio/chip 的 `wrapperProps` 类型收紧 | ⚠️ 需 typecheck 确认 |

所以这一步**风险在像素不在 API**：三处命中全是默认尺寸/间距，编译不会红，只有视觉基线会红。另外 `tailwind.config.ts:601` 的 `darkMode: ['selector', '[data-mantine-color-scheme="dark"]']` 把我们的暗色模式**绑在 Mantine 的属性上**——它要是改了属性名，暗色会整片失效而编译全绿。

不选 Mantine 9：它要求 React 19.2+，等于把 Mantine 和 React 焊死成一步，失去中间的可回滚点。9 可以以后再走。

**(b) R3F 8 → 9 + drei 9 → 10**：**28 个文件**触及（`src/workbench/generationCanvas/nodes/scene3d/**` 全族 + `model3d/Model3DViewer.tsx` + `fencedCanvas.tsx` + 3 个 devlab 入口）。

- 好消息：全仓**没有**用 `MeshProps` / `Object3DNode` / `ReactThreeFiber.*` 这些被删的类型导出，也**没有** `declare global { namespace JSX }` 的 three 元素增补 → **v9 的类型破坏面对我们几乎为零**。
- 真风险有两条：① drei 10 自己的 API 变动（我们用到 `OrbitControls` `TransformControls` `Html` `Line` `Grid` `Environment` `Sky` `Text` `useGLTF` `Bounds` `Center`）；② **v9 让 StrictMode 穿透进画布**——3D 场景里所有 effect 会被双跑，这正是 `useScene3DFullscreenActions.ts:564` 注释里写过的那类雷（"applyCameraMovePreset 内生成随机 id，不能塞进 updater——StrictMode 双调用会得到两套 id"）。

---

## 3. AI SDK 迁移面 + 命中文件清单

### 3.1 先说结论：这块比想象的小得多

**生产代码里 import `ai` 或 `@ai-sdk/*` 的文件一共 8 个**，另有 8 个测试文件。`src/workbench/ai/` 里**一个都没有**（那整个目录是 UI，走的是 pi + 我们自己的 projection）；`electron/harness/` 里**一个都没有**（那是 pi 的宿主）。

任务书里点名的这两个目录，**不是** AI SDK 的迁移面。真正的迁移面是 `electron/ai/` 的 4 个文件 + `electron/providerAdapter/` 的 4 个文件。

### 3.2 逐文件清单（AI SDK 4 → 6）

| 文件 | 用到什么 | 4→6 要改什么 | 工作量 |
|---|---|---|---|
| `electron/ai/buildAiSdkModel.ts` | `createOpenAI` / `createAnthropic` / `createOpenAICompatible`、`LanguageModelV1` 类型 | provider 包升大版本；类型改 `LanguageModelV3` | 中 |
| `electron/ai/vendorLanguageModel.ts` | 仅 `LanguageModelV1` 类型（全文 12 行） | 改类型名 | 极小 |
| `electron/ai/streamTextTask.ts` | `streamText`、`result.textStream` / `finishReason` / `usage`、image content part | `maxTokens`→`maxOutputTokens`（:32/:138）；image part `mimeType`→`mediaType`（:50 `toImagePart`）；`usage.promptTokens/completionTokens`→`inputTokens/outputTokens`（:86） | **中，唯一有真行为的一处** |
| `electron/ai/aiSdkVendorError.ts` | `APICallError` / `RetryError` | 两个类 5/6 仍导出；但文件头注释明写「读 `ai@4.3.19` / `@ai-sdk/provider-utils@2.2.8` 源码得来的三条事实」——**这三条必须对着新版源码重验** | 中 |
| `electron/providerAdapter/compiler.ts` | `generateObject`、`NoObjectGeneratedError`、`system`、`maxTokens` | **`generateObject` 在 6 里已弃用** → 改 `generateText` + `output` 设置；`maxTokens`→`maxOutputTokens`；`system`→`instructions`（7 才强制，6 仍可用） | **中大，是 6 的主要成本** |
| `electron/providerAdapter/service.ts` / `serviceCompilation.ts` / `serviceLanguageModels.ts` | 仅 `LanguageModelV1` 类型 | 改类型名 | 极小 |

`LanguageModelV1` 全仓 43 处 / 9 个文件，**全部是类型别名用法**——我们没有手写实现过 spec（`vendorLanguageModel.ts` 只是把 `buildAiSdkModel` 的返回值标个类型）。所以 V1→V2→V3 的 spec 变更对我们是**纯改名**，不是重写适配器。这是本块最大的好消息。

### 3.3 明确的假阳性（禁止 codemod）

| 符号 | 命中 | 为什么不是 AI SDK 的 |
|---|---|---|
| `maxSteps` | 9 处 | 是**我们自己**的 `request.capability.maxSteps`，喂给 pi（`electron/harness/runtime/pi/run.mts:122`）。AI SDK 5 删掉 `maxSteps` 改 `stopWhen` 与我们无关 |
| `mimeType` | 41 处 | 绝大多数在 `electron/ai/agentUserContent.ts` / `agentChatV2.ts`，是**我们与 pi 之间**的内容契约（长得像 AI SDK 4 而已）。只有 `streamTextTask.ts:50` 那一处真的进 AI SDK |
| `usage.promptTokens/completionTokens` | `src/workbench/ai/agentUsageStore.ts` 等 | 是 **pi** 的 usage 形状，不随 AI SDK 走 |
| `defaultProps` | 20 处 | Mantine 主题（见 §2.2） |

### 3.4 为什么不去 7

`ai@7` 是 ESM-only，我们主进程编译成 CommonJS。理论上可以在 8 个文件里改用动态 `import()` 兜过去——但那是给一个版本号加一层**逃生口**，正撞 P1。要去 7，正解是先把主进程构建整体迁到 ESM，那是独立立项。

---

## 4. R3 决策对比表

三个候选。**"用户看到什么"这一列对全部三个方案都是「一模一样」**——这是一次纯内部升级，没有任何一条能让用户看见的收益。所以这张表真正在权衡的是：**我们愿意为「和 vendor 源同代」付多少墙钟和多少回归风险。**

| | 方案 A · 一次全升 | 方案 B · 分四步（推荐） | 方案 C · 不升，继续 vendor 改造 |
|---|---|---|---|
| **做什么** | 一个分支里同时升 React 19 + Mantine 8 + R3F 9/drei 10 + AI SDK 6 + Tailwind 4 | 四步四个 PR，每步独立验收、独立可回滚：① AI SDK 6 ② Mantine 8 ③ React 19 + R3F 9/drei 10 ④ Tailwind 4 | 不动任何版本；继续把 AI Elements 的源码往 React 18 + Tailwind 3 + Mantine 上翻译（`aiElementsContract.ts` 已经在这么做） |
| **用户看到** | 无差别 | 无差别 | 无差别 |
| **墙钟** | 名义最短，实际最长——四类回归（3D 画布 / Mantine 像素 / Tailwind 像素 / AI 出站报文）同时红，无法二分 | 最长但**可预测**；每步都能停 | 零 |
| **回滚粒度** | 只能整体回滚 | 每步一个 revert | — |
| **风险集中点** | 652 处 `JSX.Element` 的机械 diff 和 45 张视觉基线的红**混在一个 PR 里** | 机械 diff 独占 commit；视觉基线只在步骤 ②④ 动 | 无新增风险，但**翻译层永久存在**：上游每改一次组件，我们要重翻一次 |
| **付出后拿到什么** | 与 AI Elements 上游同代，vendor 时可直抄；R3F/Mantine 脱离已停更的大版本 | 同 A | 省下全部成本；代价是 §0.1 说的——AI SDK 那部分**本来也拿不到东西** |
| **不做的代价** | — | — | Mantine 7 和 R3F 8 会持续落后（Mantine 已到 9、R3F 已到 9）；越晚升，一次要跨的版本越多 |

**推荐 B。四步的顺序（①AI SDK 6 → ②Mantine 8 → ③React 19 + R3F 9 → ④Tailwind 4）不是随意排的，三条理由：**

1. **AI SDK 排第一不是因为它最重要，恰恰因为它最独立。** 它只碰主进程 8 个文件，和 React / Tailwind / Mantine 零交集，也不动任何一张视觉基线。先把这条腿从依赖图里摘出去，后面三步的红就一定不是它。
2. **Mantine 8 必须排在 React 19 前面。** 它是唯一同时兼容 18 和 19 的档；先升 Mantine（React 还是 18）→ 验一遍视觉基线 → 再升 React，出问题时你知道是哪一层。反过来做，Mantine 和 React 的像素红会缠在一起。
3. **React 19 和 R3F 9 必须同一步。** R3F 8 的 peer 是 `>=18 <19`，物理上不能分开。

⚠️ **但在拍板 B 之前，请先回答 §7 的那个问题**——因为如果答案是「AI Elements 我们本来就要翻译成 Mantine」，那方案 C 才是诚实的解，B 是在为一个我们不打算收的收益付四步的账。

---

## 5. Tailwind 3 → 4：命中清单与门岗改造

放最后是对的——它是四步里**唯一会改变渲染结果**的一步，且我们有 45 张像素基线正好能接住它。

### 5.1 类名命中（口径：只扫「看起来是 class 列表」的字符串字面量，避开 JS 的 `blur()`、CSS 的 `flex-shrink:` 属性等假阳性）

| 破坏点 | 命中 | 文件数 |
|---|---|---|
| `outline-none` → `outline-hidden` | **111** | 63 |
| `backdrop-blur-sm` → `backdrop-blur-xs` | 5 | 5 |
| `ring` → `ring-3` | 4 | 4 |
| `rounded` → `rounded-sm` | 4 | 4 |
| `shadow-sm` → `shadow-xs` | 4 | 4 |
| `shadow` → `shadow-sm` | 3 | 2 |
| `rounded-sm` → `rounded-xs` | 1 | 1 |
| `space-y-*` / `divide-*` 选择器语义变化（`~ :not([hidden])` → `:not(:last-child)`，且方向从 top 改成 bottom） | 5 + 6 | 5 |
| `*-opacity-N`、`flex-shrink`、`flex-grow`、`overflow-ellipsis`、`decoration-slice` | **0** | — |
| `[--var]` → `(--var)` 箭头语法 | 0（6 处 `[--x]` 全在非 class 上下文） | — |
| `@apply` | 2（`src/styles/animations.css`） | 1 |

`outline-none` 那 111 处要**逐个判断**，不能无脑改名：v4 里 `outline-none` 变成了真的 `outline-style: none`，而 v3 的语义（透明描边、给强制高对比度模式留位）改叫 `outline-hidden`。我们绝大多数用法是「去掉默认焦点环、自己画一个」，两种语义在视觉上都对——但可访问性上不等价。**这一步必须过设计系统，不是纯机械替换。**

### 5.2 构建管线改造（这块比类名更硬）

本仓的 Tailwind 不走 PostCSS，走的是**预编译成静态 CSS**：

- `scripts/build-tailwind.mjs` 直接 spawn `tailwindcss/lib/cli.js`，输出 `.tmp/tailwind.generated.css`，再和 `@mantine/core/styles.css` **拼成一个** `public/tailwind.generated.css`；
- `vite.config.ts` 用一个自写中间件（`nomiStaticAssetPlugin`）把 `/tailwind.generated.css` 喂给 dev server；
- `postcss.config.js` 里**只有 autoprefixer**，没有 tailwind。

v4 的改动：

| 要改 | 现状 | v4 |
|---|---|---|
| CLI 入口 | `require.resolve('tailwindcss/package.json')` → `lib/cli.js` | CLI 搬去独立包 `@tailwindcss/cli`，`build-tailwind.mjs` 的解析逻辑必须重写 |
| 配置形态 | `tailwind.config.ts`（740 行，含一个注入全部 `--nomi-*` token 的 `addBase` 插件 + `darkMode` selector + `safelist` + `content`） | v4 是 CSS-first。**但 v4 仍支持 `@config "./tailwind.config.ts"` 加载 JS 配置** ← 这是本次的关键退路 |
| **`content` 扫描面** | 显式列 `./src/**/*.tsx` **和** `./src/**/*.ts`（2026-09-06 才补上 `.ts`，此前 4 处类名一直静默失效） | v4 改成**自动检测**（尊重 `.gitignore`、跳过二进制），显式白名单换成 `@source` / `@source not` |
| 入口 CSS | `src/styles/index.css` 开头三行 `@import 'tailwindcss/base' / 'components' / 'utilities'` | 合成一行 `@import "tailwindcss"` |
| `autoprefixer` | postcss 里显式挂 | v4 内置，应当删掉（P1：加新必删旧） |

**强烈建议第一版走 `@config` 保留 JS 配置**，理由是两个门岗**直接文本解析 `tailwind.config.ts`**：

- `scripts/check-dangling-tailwind.mjs:146` —— `fs.readFileSync('tailwind.config.ts')`，然后手写括号匹配去抠 `theme.extend` 的键名，双向校验「类名引用了不存在的 token 键」和「定义了 token 却没出口」。
- `scripts/check-design-tokens.mjs:95/137` —— 把 `tailwind.config.ts` 和 `.css` 一起扫，做 `color-mix(in oklch)` 色相漂移检查和「语义 token 困在作用域里」检查。

还有第三条，比门岗更硬：**`.ts` 扫描面这个不变量必须原样活过去。** 2026-09-06 刚发现 `content` 只列 `.tsx` 时，住在 `.ts` 里的类名会**完全静默地**不生成——全仓盘出 4 处一直失效的真样式（浮窗八个 resize 手柄的定位、画布分组的半透明底与拖放描边、生成钮禁用底色、预览控制条禁用态 hover），教训见 `docs/lessons/tailwind-content-ts-classnames-silently-dropped.md`。守它的是 `scripts/build-tailwind.test.ts`（真跑一次 Tailwind，断言只在 `.ts` 里出现的哨兵类进了 CSS，并带 vacuity 守卫）。**v4 换成自动检测后，这条测试必须继续绿**——它是判断「新扫描面有没有偷偷缩回去」的唯一信号，且这个坑没有别的信号。

把 token 搬进 `@theme` 会让前两个门岗**同时失明**。它们各自都是从真事故里长出来的（`text-nomi-ink-70` 静默失效、`--workbench-success-ink` 全 App 10 处绿字掉色、accent 色相被 oklch 插值拽成粉/橄榄绿）。所以顺序必须是：**先让 v4 在 JS 配置下跑绿 → 再单独立一项把配置搬进 CSS 并同步重写这两个门岗**。绝不能一步做完。

### 5.3 Tailwind 4 对我们意外便宜的地方

- 浏览器下限（Chrome 111 / Safari 16.4）对 Electron 43 = Chromium 150 是零风险，**这一整章跳过**。
- `*-opacity-*` 命中 0：我们早就用 `color-mix` + `<alpha-value>` 的路子（`tailwind.config.ts` 的 `tokenColor()`），v4 的透明度修饰符本来就是我们已经在用的写法。
- 全局 CSS 只剩 4 个文件、`@apply` 只有 2 处：R10 那条「`src/styles/` 只可减不可增」的纪律，正好让 v4 的 CSS 面小到可以人工读完。

---

## 6. 分步执行：范围 / 不动项 / 回滚 / 验收门

每一步 = 一个 PR = 一次 revert。**任何一步没过它自己的门，不许开下一步。**

### 步骤 ① AI SDK 4 → 6

- **范围**：`electron/ai/{buildAiSdkModel,vendorLanguageModel,streamTextTask,aiSdkVendorError}.ts` + `electron/providerAdapter/{compiler,service,serviceCompilation,serviceLanguageModels}.ts` + 8 个对应测试；`package.json` 四个 `ai`/`@ai-sdk/*` 版本。
- **不动**：`src/workbench/ai/**`（不是 AI SDK）、`electron/harness/**`（pi）、`ProjectAgentItem` 契约、zod（`3.25.76` 已满足 peer）、`agentChatV2.ts`（它对接 pi 不对接 AI SDK）。
- **回滚**：`git revert` 单个 PR；无数据/无持久化格式变更，无迁移债。
- **验收门**：
  1. `pnpm run typecheck`（三份 tsconfig 全绿）+ `pnpm run check:test-types`
  2. `pnpm run test`（全量单测，不是 focused——这一步动的是出站报文）
  3. **真实出站报文对账**：`electron/ai/aiSdkVendorError.ts` 头部那三条「读源码得来」的事实，逐条对着 `ai@6` / `@ai-sdk/provider-utils@4` 的源码重验并更新注释
  4. **付费冒烟**：走 APIMart（本机唯一可用的付费通道，见 lessons `paid-smoke-apimart-only`），至少各跑一次 openai-compatible / anthropic 两条线的真实文本生成
  5. `pnpm run gates`

### 步骤 ② Mantine 7.13 → 8

- **范围**：`@mantine/core` `@mantine/modals` `@mantine/notifications` 三个包；`src/theme/nomiTheme.ts` 若有 API 漂移；`tailwind.config.ts:601` 的 `darkMode` selector 若 Mantine 改了属性名。
- **不动**：React 仍是 18（Mantine 8 的 peer 是 `^18.x || ^19.x`，这一步刻意保持 React 不变，好把像素红归因到 Mantine）。
- **回滚**：单 PR revert。
- **验收门**：typecheck → 全量单测 → **45 张设计实验室视觉基线**（`pnpm run check:design-lab`，darwin 已校准，容差 `threshold 0.2` / `maxDiffPixelRatio 0.002`）→ 光/暗双模式各走一遍（Mantine 的 `data-mantine-color-scheme` 是我们暗色的挂钩点）→ 真实旅程 J1–J5 → `pnpm run gates`。

### 步骤 ③ React 18.3 → 19 ＋ R3F 8→9 / drei 9→10

- **范围**：`react` `react-dom` `@types/react` `@types/react-dom` `scheduler`（`0.23.2`→`0.27.0`，它是直接依赖且被 `vite.config.ts:198` 的 `dedupe` 和 `resolve.alias` 钉着，必须同步）；`@react-three/fiber` `@react-three/drei`；652 处 `JSX.Element` codemod；scene3d 那 28 个文件。
- **子步（在同一个 PR 里分成三个 commit，顺序不可换）**：
  1. `types-react-codemod scoped-jsx` —— **纯机械，独占一个 commit，零行为改动**
  2. React 19 + scheduler 升版 + 修编译错
  3. R3F 9 / drei 10 + 修 3D
- **不动**：`forwardRef`（17 处，19 仍支持，见 §2.2）、`MutableRefObject`（76 处，仅弃用）、`src/theme/nomiTheme.ts` 的 Mantine `defaultProps`。
- **回滚**：单 PR revert；三个 commit 的切分让「到底是 codemod 还是 R3F 炸的」可二分。
- **验收门**：
  1. typecheck + `check:test-types` + `lint:ci`（`--max-warnings=82` 棘轮不许涨）
  2. 全量单测，**外加**：三个 StrictMode 相关测试（`useCanvasViewportGestures.strictMode.test.ts`、`trajectoryRuntimeStore.test.ts`、`DeferredNodeMedia.tsx` 的契约）必须**人工确认它们还在真的测东西**——19 的 StrictMode 复用 memo 结果，可能把它们变成恒真断言（本仓有过「四个会话把恒真断言判成 flake」的前科，见 lessons `repeated-timeout-means-check-the-assertion`）
  3. `pnpm run test:canvas:acceptance` + `pnpm run test:canvas-perf`（React 19 的调度变化直接打画布；性能预算按平台校准，只在 darwin 判定）
  4. **3D 手工走查**：scene3d 编辑器 / 全屏 / 轨迹录制 / 运镜预设 / 模型库 五条，人眼看
  5. 45 张视觉基线 + 真实旅程 J1–J5 + `pnpm run gates`

### 步骤 ④ Tailwind 3 → 4（仅换引擎，配置留在 JS）

- **范围**：`tailwindcss` → 4.3.3；新增 `@tailwindcss/cli`；重写 `scripts/build-tailwind.mjs` 的 CLI 解析；`src/styles/index.css` 开头三行 `@import 'tailwindcss/base'/'components'/'utilities'` 合并成 `@import "tailwindcss"` + `@config "./tailwind.config.ts"`；删 `postcss.config.js` 里的 autoprefixer（v4 内置）；§5.1 那 132 处类名。
- **不动项（这是本步最重要的一条）**：`tailwind.config.ts` **不搬进 `@theme`**。两个门岗在文本解析它（见 §5.2），搬家=让它们失明。搬家另立项。
- **回滚**：单 PR revert；`public/tailwind.generated.css` 是产物不是源，回滚即重建。
- **验收门**：
  1. `pnpm run check:tokens` + `check:dangling-tokens` + `check:dangling-tailwind` 三个 token 门岗**必须仍然工作**——不是「跑绿」，是**先故意写一个 `text-nomi-ink-70` 验证它会红**，再撤掉（R17 那条「加规则必须先验它会红」的同款要求）
  2. `scripts/build-tailwind.test.ts` 必须绿，且同样验一次会红：把 v4 的扫描面故意缩回只认 `.tsx` → 三个哨兵类应当从 CSS 里消失、测试报红
  3. **45 张视觉基线逐张过**，这一步是四步里唯一预期会红的；每一张红都要拿 `-diff` 图判断是「预期的重命名后果」还是「真回归」，判完才更新基线
  4. 光/暗双模式 + 真实旅程 J1–J5 + 163 条走查里的可视一族
  5. `pnpm run gates`

---

## 7. 需要用户拍板的（只有一个真问题）

其余全是实现细节，我按 §4 的推荐自己定。这一个不行，因为它决定**要不要做这个项目**：

> **Agent 面板 v4 最终要不要长得像 AI Elements？**
>
> - 如果**要**（直接用它的组件结构、抄它的源码）→ 走方案 B，四步升级，付这个账。
> - 如果**不要**（只借它的信息架构和状态机，外观走 Nomi 设计系统 + Mantine）→ 走方案 C，一步都不升。
>
> 判断依据：`aiElementsContract.ts` 目前的做法**已经是"不要"** —— 它只留下 7 个 tool 状态和 12 个构件名当契约，明写「React 18、Tailwind 3、Mantine 在本仓仍是权威」。而源码解剖文档也说了，AI Elements 的组件本身是「薄包装，有意思的逻辑很少，依赖的 shadcn 原语很多」——抄过来的主要是 Radix 原语的依赖，不是设计。
>
> 所以我的判断偏向 **C，但把 Mantine 8 和 R3F 9 单独留着做**（那两个和 AI Elements 无关，是我们自己的版本债，Mantine 已到 9、R3F 已到 9，越拖越贵）。

---

## 8. 不做项（本次立项明确排除）

| 不做 | 为什么 |
|---|---|
| AI SDK 7 | ESM-only，主进程是 CJS。要做先立「主进程迁 ESM」项 |
| Mantine 9 | 要求 React 19.2+，会把 Mantine 和 React 焊成一步，失去中间回滚点 |
| `forwardRef` → ref-as-prop | 19 仍支持；且要同 commit 改 `actionsForwardRef.test.ts`。与版本升级无关的重构不进升级 diff |
| `MutableRefObject` → `RefObject`（76 处） | 只是弃用，不阻断。同上 |
| Tailwind 配置搬进 `@theme` | 两个门岗在文本解析 `tailwind.config.ts`。搬家必须和门岗重写同项做 |
| 引入 `@ai-sdk/react` / `useChat` / `UIMessage` | 见 §0.1：会和 `ProjectAgentItem` 形成并行版（P1） |
| `@testing-library/react` | 本仓刻意没有；组件行为靠结构测试 + Playwright 走查。不借升级夹带 |

---

## 9. 分层与文件拆分

本次升级**不新增运行时模块**，所以分层的问题只有一处：`scripts/build-tailwind.mjs` 的 CLI 解析。

现在它把「找到 tailwind 可执行文件」（`require.resolve('tailwindcss/package.json')` → `bin.tailwindcss`）和「拼 Mantine + Tailwind 两段 CSS + watch」写在同一个文件里（93 行）。v4 把 CLI 挪进独立包后，前者要重写。拆法：

- `scripts/lib/tailwindCli.mjs` —— 只负责「解析出当前 Tailwind CLI 的可执行路径」，一个导出函数。
- `scripts/build-tailwind.mjs` —— 保留拼接与 watch 逻辑，从上面那个库拿路径。

已有的 `scripts/build-tailwind.test.ts` **不要拆**：它守的是「扫描面覆盖 `.ts`」这个端到端不变量（真跑一次构建再断言 CSS 内容），拆成对 CLI 解析函数的单测就把它降级了。两者是不同层的防线，都留。

其余全部文件保持原分层，无一超 800 行。`tailwind.config.ts` 740 行不在 `check:filesize` 的扫描目录（只扫 `src`/`electron`）内，但已越过那条线的精神——v4 迁移**不许**让它继续变长。

---

## 10. 交付纪律

- 本文 docs-only，`pnpm run gates` 全绿后开 PR。
- 每一步各自开 PR、各自跑该步的验收门，不攒。
- 步骤 ③ 的 652 处 codemod 必须独占 commit——它会产生一个横扫全仓的 diff，混进任何行为改动都会让 review 和二分失效（lessons `json-baselines-need-surgical-edits` 是同一类教训：大机械 diff 会淹掉真改动）。
- 步骤 ②③④ 都会动 45 张视觉基线。**更新基线前必须逐张看 `-diff` 图**，不许因为「反正要更新」就整批 `--update-baseline`。
