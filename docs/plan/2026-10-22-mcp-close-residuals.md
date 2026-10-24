# MCP 收口残留 R1 / R2 / R3（设计卡 + 方向检查）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

来源：V-mcpfix 验收（#1273 有条件通过）留下的三条非阻断残留。不新增功能、不改界面、不改任何按镜头的花钱语义。
四类判据（花钱 / 长跑 / 可打断 / 新界面）均不命中，只写 ★ 5 格。

## 设计卡 ★ 5 格

1. **要解决什么、给谁**：连接卡上「已调用 N 次」不被虚增（R1）；端口被占时「测试连接」不写配置这条防线有行为级测试守着（R2）；发给规划 LLM 的分镜说明不再说假话（R3）。给用 MCP 助手的创作者，以及维护这几处的人。
2. **现状里的问题**：
   - R1：`mcpUsageRegistry` 用「最多 256 条的历史」去近似「一次工具调用的生命周期」。一次调用（一个 `callRef`）可发多跳，跳与跳之间（等真人确认，可达分钟级）没有任何一跳开着，号会被别人的调用挤出历史；第二跳进来又记一次。
   - R2：全仓没有测试数过 `installMcp` 的调用次数；变异 M8（`handleTest` 里偷偷 `handleInstall()`）全绿。`REASON_I18N` 是 `Partial`，新增原因时正文静默回落到 handshake-failed 的文案。
   - R3：`planShotSchema` 的 describe 写「defaults to image」，落画布实际省略 = video，且这份说明原样进了内置规划 LLM 的提示词。
3. **方案（补 / 换 / 删）**：
   - R1 = **换**。删掉 `COUNTED_CALLS_CAP` + `trimCounted`（按条数挤），换成「按调用生命周期释放」：号在任一跳开着时永不释放；最后一跳结束后保留 `MCP_CALL_IDLE_RELEASE_MS`（30 分钟，大于 elicitation 5 分钟与 Codex 单次工具超时 10 分钟）再释放。调用号是每次调用现生成的 UUID，过了这段空闲时间该调用必已结束，不会再来。无界增长的收法：释放按时间（每分钟最多扫一次），在跑的号由 HTTP 响应 `close` 一定会触发结束（Node 保证），永不结束的号与 `running` 同生同灭。
     - 为什么不用「dispatchTool 给出整次调用结束信号」：`dispatchTool` 在 mcpProtocol 里，三条传输（HTTP / Electron stdio / 裸 Node 启动器）里有一条跑在另一个进程，要新增一条回环 RPC 才能把「结束」送到主进程账本，是新协议面；展示用的次数不值得。时间释放不加任何跨进程接口。
     - 为什么不是把 256 调大：只是把同一个 bug 推到更大的并发才出。
   - R2 = **补测试**（不动现有行为）：新增 `connectAssistantCard.behavior.test.tsx`，真卡 + 记账的桌面桥，数 `installMcp` / `verifyMcp`。`REASON_I18N` 的穷举：见「待协调」。
   - R3 = **换**。说明里的默认值改由 `LEGACY_OMITTED_SHOT_KIND`（`electron/shared/storyboard/storyboardPlan.ts`）生成；落画布构造器与有效时长换算同用这一个常量，删掉两处手写的 `=== 'image'` 缺省判断。行为不变（省略仍按 video）。
4. **怎么验证**：
   - R1：跨跳空档 300 个其它调用后计数 = 301；空档内持续混入其它调用且总时间小于释放时间仍成立；超过释放时间后释放（内存按时间有界）；在跑的号永不释放；原 255/256/257、并行长调用、取消后重复关闭、不同身份交错仍过。变异：结束即释放 → 3 条红。
   - R2：端口被占：主按钮 = 测试连接、`installMcp` 0 次、`verifyMcp` +1；修复类原因主按钮 → `installMcp` +1；过时形状主按钮 = 升级接入、+1；「测试连接」次按钮任何原因都 0 写。变异 M8 / 主按钮恒写 / 删正文表项 / 主按钮恒测试，各自变红。
   - R3：对账测试：已发布 schema 说明里写的默认种类 = 省略 `shotKind` 时落画布真正建出的节点种类；显式种类不被覆盖；变异（手写字面量 image）红。
9. **边界与回退**：不碰按镜头花钱语义（省略仍建 video）；只影响展示数据（R1）、测试（R2）、发给 LLM 的一句话说明（R3）。回退 = revert 本 PR。若 `check:model-face-frozen` 基线因 R3 的说明文字变化，按门岗更新并在 PR 正文点名（本次跑下来未变）。

## 方向检查（命中说明）

- `node scripts/fix-churn.mjs electron/capabilityCore/mcpUsageRegistry.ts`：命中自写登记 **`mcp-client-usage-status`**（30 天内第 2 个 fix），文件本身未命中。
- 这一刀**是换，不是补**：删旧的「按条数挤出」机制、换成按生命周期释放，不新增特例分支。按任务书属「只因登记口径命中、改法是换」，协调可代批（#1274 口径）。
- P0：这段是「按助手记工具调用次数」的展示账，登记在案；通用的部分（HTTP 响应关闭、SDK）已用现成的，没有成熟库替「展示用的调用计数」，登记里 alternativesChecked 已写。
- `src/ui/onboarding/ConnectAssistantCard.tsx` 命中硬热点（14 天 7 个 fix，这一刀是第 8 个）：**本 PR 不改这个文件**，只加行为测试（复盘前先钉住现状，正是方向检查要求的第一步）；`REASON_I18N` 改穷举要动该文件，等协调批。

- R3 动到 `src/workbench/generationCanvas/agent/storyboardPlan.ts`：只因**目录** `src/workbench/generationCanvas/agent/`（14 天 3 个 fix、同概念）口径命中，文件本身未命中；改法是**换**（删两处手写的 `=== 'image'` 缺省判断，改用同一个常量），不新增分支、不改行为，按任务书属协调可代批。特征测试：`storyboardPlan.test.ts`（现有，全绿）+ 新增 `storyboardShotKindDefault.test.ts`（对账）。

### 复盘要点（精简版，R1 类根因）

0. 一句话根因：用「有限条数的历史」去近似「一次调用的生命周期」。
1. 归类：D1（跳还开着被挤出）→ #1273 修；R1（跨跳空档被挤出）→ 同一类，本 PR 修到类。
5. 现成方案：无（展示用计数）；登记 `mcp-client-usage-status`，状态 justified，理由未变。
6. 补 / 换对比：补 = 再加一层「空档保护」→ 第三个特例，否；换 = 生命周期释放 → 推荐；删 = 去掉去重 → 会让多跳调用虚增，否。
7. 用户要权衡的核心：无（展示数据，不涉及钱和审计）。
特征测试：`electron/capabilityCore/mcpUsageRegistry.test.ts`（D1 全部用例保留）。
