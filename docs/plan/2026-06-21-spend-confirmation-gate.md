# 付费生成统一确认守卫（主进程硬闸 + 不可伪造令牌）

> 2026-06-21 ｜ 状态：**方案，待用户拍板**（未实现）
> 起因：设计「一键出片」时用户提出两条硬要求——① 一键出片是花钱动作，点之前必须先告诉用户"会发生什么"再确认；② **所有能直接触发生成的工具必须当且仅当用户确认才能调用，哪怕 AI 不小心调了也要被硬卡住**。
> 这是横切所有付费生成入口的安全闸，范围比「傻瓜直达」大——傻瓜直达只是它的一个消费者。

---

## 0. 一句话

把「必须真实用户确认才能发付费生成请求」做成一道**主进程硬闸**，装在 AI 绝对绕不过的唯一 vendor 收口；放行凭证是**只能由真实 UI 确认事件在主进程铸造、绑定 nodeIds、一次性即焚的令牌**。AI 造不出令牌 → 任何未经确认的付费生成一律被 throw。

---

## 1. 现状（Explore 实勘，带 file:line）

### 现在 AI 能不能无确认烧钱？——**暂时不能，但防线不够硬**
- agent 的 `run_generation_batch.execute` 自己不生成，只 `await awaitToolConfirmation`（`electron/ai/agentChatV2.ts:186-209`），**无超时、不点永远卡**；该 Promise 仅渲染层 `confirmTool` 能解（`agentChatV2Ipc.ts:49-61`）。
- 渲染层决策门 `gate.ts:49 evaluateGate`：`run_generation_batch` 标 `costy:true` → 返回 `ask` → 生产面板入队 pending 卡等用户点（`CanvasAssistantPanel.tsx:403-435`）。
- 规划阶段对一切 costy/写工具直接 `deny`（`runStoryboardPlanner.ts:46-50`）。

### 三个洞（守卫必须覆盖）
1. **防线在渲染层，不是主进程不变量**：主进程只校验"渲染层回了 `{ok:true}`"，**不校验回的是不是真用户**。
2. **静默旁路 `defaultExecuteToolCall`**（`generationCanvasAgentClient.ts:114-141`）：调用方不传 `onToolCall` 时，对 costy 工具**不弹 UI 直接 `applyProposalBatch` 执行**。当前两个生产入口都传了，但这是"谁忘传谁静默烧钱"的雷。
3. **UI 直发路径无成本闸**：单节点「生成」（`NodeGenerationComposer.tsx:130`）、错误「重试」（`BaseGenerationNode.tsx:638`，单次内自动重发最多 3 次）、框选「生成 N 个」（`GenerationCanvas.tsx:355`）——一点直接烧。

### 真正发 vendor 请求的单一收口
```
（UI 直发 / agent / 一键出片 / 重试 全部汇入）
runGenerationNodesByPlan (generationRunController.ts:323)
  → generationNodeExecutor.ts:23 → runCatalogGenerationTask (catalogTaskActions.ts:190)
    → runWorkbenchTaskByVendor (taskApi.ts:85, 渲染层 IPC 出口)
      → ipcRenderer.invoke("nomi:tasks:run") (preload.ts:61)
        → ipcMain.handle (main.ts:305, 已有 runTaskIpcGuard 包装 :191)
          → runTask (electron/runtime.ts:552)   ★ 主进程唯一 vendor 收口
```
文本流式另有 `textTaskRunner.ts:14 runTextTaskStream`（同源解析）。**渲染层一切路径最终都过主进程 `runTask`——这是能卡死全部的一个点。**

---

## 2. 威胁模型

要防的是「**未经真实用户确认的付费 vendor 请求被发出**」，来源：
- T1：AI/agent 自主或被 prompt-injection 诱导调 `run_generation_batch`。
- T2：新入口/eval 忘传 `onToolCall` → `defaultExecuteToolCall` 静默放行。
- T3：渲染层任何代码（含 bug）对 confirm 回 `{ok:true}`。
- T4：（非恶意但要管）UI 直发路径无说明就烧、重试隐性放大。

共同要害：**渲染层不可信**。AI 的逻辑跑在渲染层语境里，任何"渲染层说同意了"都不可作为放行依据。

---

## 3. 方案：主进程硬闸 + 不可伪造令牌

### 3.1 守卫单一安装点
**`electron/runtime.ts:552 runTask`（+ `runTextTaskStream`）入口**，复用已有包装位 `main.ts:191 runTaskIpcGuard` 扩展。理由：渲染层绕不过的真 vendor 收口；装这里，T1–T4 全路径统一受管。

### 3.2 令牌（spend grant）设计——让"真人确认"产生 AI 伪造不了的信号
1. **主进程铸造与持有**：新增 IPC `nomi:tasks:grant-spend`，由**真实用户确认事件链**调用；主进程生成 `{ grantId, nodeIds[], maxAttempts, expiresAt }` 存进主进程 Map。渲染层永远拿不到可复用密钥。
2. **runTask 强制核验**：payload 必须带 `grantId`；主进程校验 grant 存在/未过期/本次 `nodeId∈grant.nodeIds` → 通过即**从 Map 删除（即焚）**；否则 `throw`（复用 VendorRequestError 语义）。
3. **绑定 nodeIds**：防"批准生成 A 却拿令牌生成 B"。grant 的 nodeIds = 用户确认时刻画布上的真实集合。
4. **自动重试复用同一 grant**：单节点 3 次重试在同一 grant 的 `maxAttempts` 内，杜绝"批准 1 次实发 3 次"的隐性放大。
5. **agent 路径无捷径**：agent 确认仍走"渲染层回 ok"，但回 ok 必须触发"真实用户确认 UI"那一步去铸令牌——铸令牌挂在**可信用户手势/确认 UI**（参考已有 `canvasGestureContext` 的 `source:'agent'` vs 用户手势区分），不是挂在"渲染层 JS 调了 confirm"。

### 3.3 确认 UI（满足"先说会发生什么"）
付费动作点击 → 统一确认面板：**「将生成 N 个画面 · 预计 X 额度 / Y 分钟 · 确认开始?」**，用户确认 = 铸令牌。
- 「一键出片」、框选「生成 N」、单节点「生成」、agent 受理卡，全部收口到这一个确认组件铸令牌（单一真相源，不各写各的）。
- 遵 `No fake progress`：额度/时长是真实预估（按 archetype/模型计），算不出就老实说"未知"。

---

## 4. 用户拍板（2026-06-21，已定）
- **A = A1**：全部过闸；agent 强确认卡、用户直发轻确认（可"本会话不再提示"）、一键出片带件数说明。
- **B = B1**：令牌绑 nodeIds + 一次性即焚 + 限重试次数。
- **C = C1**：确认文案先上"件数 + 预计时长"，不显金额（守卫不依赖金额）。

---

## 4-orig. 决策选项（存档）

### 决策 A：UI 用户直发路径要不要也强制确认？
| 方案 | 行为 | 取舍 |
|---|---|---|
| **A1 全部过闸，但用户直发用"轻确认"（推荐）** | agent 路径=强确认卡；用户点「生成」=一句话确认（可"本次会话不再提示"）；一键出片=带额度说明的确认 | 既堵 AI 又不烦手动党；所有付费都有令牌 |
| A2 只堵 agent，UI 直发维持"一点就烧" | 守卫只对 agent 来源要令牌 | 简单，但 UI 直发仍无成本可见性，且"来源"判断又回到渲染层不可信问题 |
| A3 全部强确认 | 每次生成都弹 | 最安全最烦 |

### 决策 B：令牌粒度
| 方案 | 取舍 |
|---|---|
| **B1 绑定 nodeIds + 一次性 + maxAttempts（推荐）** | 最严，防"批A生B"、防重试放大 |
| B2 简单"确认过一次"会话标志 | 弱，AI 一旦置位就长期放行，等于没堵 |

### 决策 C：额度预估数据源（关系到确认文案能不能显"约 X 额度"）
- 用户之前 S7 成本 gate 就 **blocked 在缺 vendor 计价数据**。本方案**不依赖金额也能成立**（确认+令牌只看"用户点没点"，不看钱）。
- 拍板：C1 先上"件数+时长"确认（不显金额，立即可做，推荐）／ C2 等你给计价数据再显"约 X 额度"。

---

## 5. 不动什么 / 回滚 / 验收

**不动**：vendor 请求逻辑本身、生成执行链、现有 agent 双重确认（在其上加主进程硬闸，是加固不是替换）。
**回滚**：守卫读一个开关；令牌缺失时若需临时放行可切回旧行为（但默认严格）。
**验收门**：
- 主进程单测：runTask 无令牌 → throw；令牌不匹配 nodeId → throw；用过即焚二次失败。
- 红队：模拟 agent 直接走 `defaultExecuteToolCall`/伪造渲染层 confirm → 必须被主进程卡死（拿不到令牌）。
- 真机：一键出片/框选生成/单节点生成/agent 受理，确认后能跑、取消不烧；忘传 onToolCall 的入口也烧不动。
- 自动重试在单令牌额度内，不放大。

---

## 5.5 红队对抗评审结论（2026-06-21，动手前）—— 原设计需修正

红队逐路验证真实代码，挑出两个把原 §3 地基打穿的洞 + 一串必修配套：

**洞 A（致命）：铸令牌入口无法在主进程区分「真人点击」vs「渲染层 JS 调用」。**
Electron IPC 不传 `isTrusted`/用户手势；`canvasGestureContext.source` 是渲染层自填字段，可伪造。
→ 原 §3.2「令牌由真实用户确认事件链调用（渲染层发起 IPC）」退化成「渲染层说同意了」的换皮，等于没堵。
**唯一硬解**：铸令牌绑定**主进程拥有的原生确认 UI**（`dialog.showMessageBox`，main.ts:256 已有先例），点击在主进程侧捕获，渲染层不持有、不可调用铸造路径。
**关键澄清（降低恐慌）**：Nomi 的 AI 不是「能跑任意渲染层 JS」，它只能① 发 tool-call 让渲染层代码处理、② 生成自己的文本。AI 够不到 `ipcRenderer.invoke` 也 dispatch 不了真 click——**除非渲染层代码把 tool-call 路径接到了自动铸令牌上**。所以「小而审计过的铸造面 + 主进程硬闸 + 删自动放行」即可挡住「AI 不小心触发生成」这个真实威胁；原生弹窗只在「连我们自己的渲染层代码/供应链都不信」时才必需。

**洞 B（高危）：付费 vendor 出口不止 runTask。** 绕过 runTask 的花钱路径：
- agent 对话 LLM 本身 `agentChatV2.ts:466/521`（每轮烧 token）
- 文本流式 `textStreamIpc.ts:26 → textTaskRunner.ts:49`（`runTaskIpcGuard` 没包它）
- onboarding `list-models`/`test-connection`（`onboardingIpc.ts:120/179`，带 apiKey 真 fetch）
- `model-catalog:mapping:test`（`catalogCommit.ts:391`，不带 upstreamResponse 时真打 vendor，preload 已暴露）
→ 守卫不能只改 `runTaskIpcGuard`，必须下沉成 `assertSpendGrant(fingerprint)` 钉在**每一个持 apiKey 发 vendor 请求的出口**，并加「新增出口必须过 assert」的测试门。

**必修配套**：
- grantId 用 `crypto.randomUUID()`（勿 `Date.now()+Math.random()`，可暴力猜）
- grant 绑 `recipeFingerprint`（runtime.ts:571 已有）而非可篡改的 `extras.nodeId` 标签——否则 AI 谎报 nodeId=A 借令牌生成别的
- 校验+即焚在同一同步 tick 原子（先删再 await 发请求），防并发 TOCTOU 一令牌烧两次
- 删掉 `defaultExecuteToolCall` 对 costy 工具的无 UI 自动放行（generationCanvasAgentClient.ts:113-140）

## 6. 与「傻瓜直达」的关系
傻瓜直达的「一键出片确认」= 本守卫的**一个铸令牌入口**。先落本守卫（安全地基），傻瓜直达在其上接一个确认入口即可，天然合规。建议**守卫先行**。
