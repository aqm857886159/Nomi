# 文本任务流式化（画布文本节点 + image_to_prompt/prompt_refine）

> 状态：执行中 · 2026-06-12
> 决策：用户已拍板 **范围=画布文本节点(续写/重写/改写)+image_to_prompt/prompt_refine**、**方案 A=收口到 AI SDK**。

## 1. 背景与根因

Nomi 有两条独立 AI 文本输出路径：

| 路径 | 用在哪 | 现状 |
|---|---|---|
| A · Agent 对话 | 创作区/画布 AI 助手 | **已端到端流式**（`streamText` → `fullStream` → IPC `content-delta` → `onContent`）。不动。|
| B · 画布文本任务 | 文本节点续写/重写/改写、`image_to_prompt`、`prompt_refine` | **非流式**：`runtime.ts:615` `wantedKind==='text'` → `postJson('/v1/chat/completions')` → `await response.text()` 一次性收口，**绕开 AI SDK**。|

根因：路径 B 的文本生成是「请求/响应」式 `runTask`（`ipcMain.handle`，一次性返回 `TaskResult`），既不走 AI SDK，也没有 delta 通道。

## 2. 目标

1. 引擎层：路径 B 所有文本任务改走 AI SDK `streamText`，**删掉** `runtime.ts` 的 `/v1/chat/completions` 直 POST（P1 加新必删旧）。
2. 渲染层：文本节点的**续写/重写**逐字增量写入文档；**改写**逐字替换选区（fallback：完成时一次性替换）。
3. 通用第一（P4）：一个流式引擎产出 delta，任何消费点想增量渲染就订阅，不想就取最终值——不造并行版。

## 3. 不动什么

- 路径 A（agentChatV2 / agentLoop / agentStreamConsumer）完全不碰。
- `runTask` 的图片/视频分支、profile mapping 分支、指纹缓存——不碰。
- `onboarding` 的 `generateText`(oneshot)、`agentChatHarness` 的 repair `generateText`——按设计就该一次性，不碰。
- 设计 token / 节点视觉布局——不碰（流式只改"出现时机"，不改长相，故不出新 mockup；验收靠 R13 走查看逐字效果）。

## 4. 设计

### 4.1 核心原语（main）— `electron/ai/streamTextTask.ts`（新增）

```ts
streamTextTask(
  { vendor, model, apiKey, request },     // 与 runTask 同源解析
  opts?: { onDelta?: (d: string) => void; abortSignal?: AbortSignal },
): Promise<{ text: string; raw: unknown }>
```

- 复用 `buildLanguageModelForVendor`（从 `agentChatV2.ts` 抽到 `buildAiSdkModel.ts` 共享，两处 import 同一份 → 不留并行）。
- `image_to_prompt`：构造多模态 message `[{type:'text'},{type:'image', image: url}]`（AI SDK 官方多模态形状，Context7 已核）。
- `streamText({ model, messages, temperature, maxTokens, abortSignal })`，消费 `textStream`：每 chunk `onDelta(d)` + 累加。
- 返回 `{ text, raw }`，`raw` 合成成 OpenAI 形状 `{choices:[{message:{content:text}}]}` → `extractTextFromChatRaw` 零改动继续可用。

### 4.2 两个入口，一个核心

1. **`runtime.ts:615` 文本分支** → 改调 `streamTextTask(..., {})`（无 onDelta=收集最终），返回 `{id,kind,status:'succeeded',assets:[],raw,text}`。**删除旧 `postJson('/v1/chat/completions')`**。保持 `runTask` 非流式调用方（如缓存命中、无增量需求者）行为不变。
2. **新流式 IPC** `nomi:tasks:text:stream`（镜像 chatV2）：`ipcMain.handle` 立即返回 `{streamId}`，逐 delta 经 `webContents.send('nomi:tasks:text:event', {streamId,event})` 推送。调 `streamTextTask(..., {onDelta:push})`。支持 `nomi:tasks:text:cancel`（AbortController）。

放进 `electron/ai/textStreamIpc.ts`（新增，main.ts 只 `registerTextStreamIpc()`，保持 main 薄）。

事件：`{type:'delta',delta}` ｜ `{type:'done',text,raw}` ｜ `{type:'error',message}`。

### 4.3 渲染层

- **preload.ts**：`tasks.runTextStream / onTextEvent / cancelTextStream`（镜像 `agents.onChatV2Event`）。
- **bridge 类型**：同步补 `DesktopBridge.tasks`。
- **taskApi.ts**：`runWorkbenchTextTaskStream(vendor, request, {onDelta, signal}) → TaskResultDto`——把 streamId+事件订阅包成 Promise，resolve 出与 `runTask` 同形的 `TaskResultDto`（`raw` 合成、`status:'succeeded'`）。
- **catalogTaskActions.ts**：`runCatalogGenerationTask` 解析出 text kind（chat/prompt_refine/image_to_prompt）且 options 带 `onTextDelta` → 走流式变体，把 `onDelta` 透传；否则维持 `runWorkbenchTaskByVendor`。
- **textActions.ts**：
  - `append`：维护 buffer，每 delta 把 `markdownToTiptap(buffer)` 作为「流式尾块」拼在原 content 之后整体 set(persist:false)；done 时 commit 持久化。
  - `replace`：每 delta 用 `markdownToTiptap(buffer)` 整体替换 doc。
  - `rewrite`：经 meta 把 buffer 喂给 `TextDocumentNode`，由其用**增量替换选区原语** `streamReplaceSelection`（首块删选区插入并记录 range，后续块替换该 range）。fallback：原语落地有风险则退回 done 时一次性 `replaceSelection`，并在结果里说明（不静默降级）。

### 4.4 数据流（流式版）

```
textActions.generateText(node, {onTextDelta})
  → runCatalogGenerationTask → runWorkbenchTextTaskStream
  → IPC nomi:tasks:text:stream → textStreamIpc → streamTextTask → streamText.textStream
  → webContents.send nomi:tasks:text:event {delta}
  ── IPC ──
  → preload onTextEvent → taskApi onDelta → textActions 增量写节点文档 → ProseMirror 逐字
  → done：resolve TaskResultDto → normalizeCatalogTaskResult（最终值兜底/持久化）
```

## 5. 实现切片（每片自带验证 + commit）

- **S1 引擎收口**：抽 `buildLanguageModelForVendor` 到共享 + 新增 `streamTextTask` + `runtime.ts` 文本分支改调它 + **删旧 postJson 文本分支**。验证：build 绿、`runTask` 文本单测不回归、真发一次 chat 任务拿到文本。
- **S2 流式 IPC**：`textStreamIpc` + main 注册 + preload + bridge 类型 + taskApi 流式 fn。验证：build 绿、单测 mock 通道收齐 delta→done。
- **S3 渲染增量**：catalogTaskActions 路由 + textActions append/replace 增量 + rewrite 原语。验证：build 绿、textActions.test 扩流式断言。
- **S4 体验走查（R13）**：真机点文本节点续写/重写/改写，截图人眼确认逐字；image_to_prompt 引擎流式（无视觉落点则只验最终值正确）。

## 执行回填（2026-06-12）

- **S1 ✅**（commit 9f254af）：抽 `vendorLanguageModel` + 新增 `streamTextTask` + `runtime.ts` 文本分支改调它，删旧 `/v1/chat/completions` 直 POST。五门绿。
- **S2 ✅**（commit 764acc9）：`textTaskRunner`（executeTextTask 单一真相 + runTextTaskStream）+ `textStreamIpc` + preload/bridge/taskApi。runtime.ts 抽出后 743 行，filesize 基线棘轮下调到 743。五门绿。
- **S3 ✅**（commit e4707f7）：`onTextDelta`/`runTextStream` 选项 + runCatalogGenerationTask 路由 + textActions 续写/重写逐 token 增量（合并旧 append/replace 为 `writeStreamingDoc`）。补 2 条流式单测。五门绿（vitest 951）。
- **改写（rewrite）的范围决定**：选区替换需 ProseMirror 位置（数据层拿不到），保持「完成时交编辑器一次性替换」，引擎仍流式。逐字替换选区 = 新编辑器原语 `streamReplaceSelection` + store→editor 桥，留作后续切片。
- **S4 ⏳ 待用户资源**：真机逐字 E2E 需配好的文本模型 + API key（用户额度）。代码层已五门绿 + 单测覆盖流式增量；真机人眼走查待用户拍板是否跑（花额度）。

## 6. 回滚策略

- 每片独立 commit。S1 即便只到引擎收口，`runTask` 对外契约（返回 `TaskResultDto`）不变 → 渲染层零感知，可单独回退。
- 流式 IPC 与非流式 `runTask` 并存为「同核心两消费模式」，非并行版；若 S3 出问题，渲染层 fallback 回 `runWorkbenchTaskByVendor`（非流式）即可，引擎层不回退。

## 7. 验收门

1. 五门全过（check:filesize / lint:ci / typecheck / test / build）。
2. `runtime.ts` 不再有 `/v1/chat/completions` 直 POST 文本分支（grep 为 0）。
3. R13：文本节点续写/重写真机逐字可见；改写逐字或完成替换且正确。
4. 无并行版：文本生成只剩一个引擎（AI SDK），`postJson` 仅服务图片/视频/资产上传。
