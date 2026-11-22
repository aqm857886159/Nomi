协调 11-22 代批（#1586 `#issuecomment-7079407428`）：本次碰到的 6 个生产文件（`electron/agentLane/laneSkillCatalog.mts`、`electron/settings/agentApprovalPolicySettings.ts`、`electron/agentLane/laneDesktopRuntime.ts`、`electron/agentLane/laneDesktopInput.ts`、`electron/shared/agentLane/laneProjection.ts`、`electron/agentLane/laneIpc.ts`）单文件近 14 天 fix 均为 **0 次**，唯一单文件热点 `electron/agentLane/laneHost.mts` 明确未动；仅因目录 `electron/agentLane/` 口径命中，且改法是删掉发送前无谓的全盘重扫、无条件 `fsync` 写盘、目录深拷贝与 IPC 冗余大正文，不新增分支或特例。

# 方向检查：Agent 发送热路径去重扫、去无谓同步写盘与去冗余 IPC 载荷（2026-11-22）

**这一处的全图在哪**：表外（Agent 发送准入到用户气泡上屏热路径，实测归因报告见任务 O 性能录制，设计预算沿用 `docs/plan/2026-11-09-agent-conversation-stick-to-bottom.md` ★7）。

### 0. 一句话根因

Agent 发送热路径在用户看到自己刚发的消息之前，把「本应随源变更才失效」的目录/技能/权限/模型表全当成无缓存的每轮冷算，又把渲染层根本不读的成功工具大段 JSON 原样经 IPC 推送，把一次普通发送拖成千次 FS 扫描 + 同步 `fsync` + 数百 KB 重复序列化。

### 1. 归类表：命中计数里的 fix → 直接原因 → 类

本次改动的 6 个生产文件单文件 14 天 fix 均为 **0 次**；`fix-churn.mjs` 仅因 `electron/agentLane/` 目录近 14 天累计 7 个 fix 触发目录口径（集中于未动的 `laneHost.mts` 等文件）：

| 提交 / 现象 | 碰到哪个文件 | 直接原因 | 类 |
|---|---|---|---|
| 发送前每次全盘重扫技能（~1,800 次 FS + 双 YAML 解析） | `electron/agentLane/laneSkillCatalog.mts`（0 fix） | `discoverSkillRecords` 无目录树变更缓存，每轮 `refresh()` 全量重扫 | 发送热路径无缓存冷算 |
| 发送前每次无条件 `.bak` 轮转 + `fsyncSync` 写盘 | `electron/settings/agentApprovalPolicySettings.ts`（0 fix） | `writeAgentApprovalPolicy` 未比对当前生效值即原子刷盘 | 无变更重复同步写盘 |
| 发送前每次 `readCatalog()` `structuredClone` + 全量 Zod 重解析 `availableModels` | `electron/agentLane/laneDesktopRuntime.ts` / `laneDesktopInput.ts`（均 0 fix） | `selectModel` 未复用 `catalogRevisionToken()`；`parseLaneComposerContext` 未复用未变模型清单 | 发送热路径无缓存冷算 |
| 历史成功 `tool-result` 大段 JSON 每次随投影过 IPC | `electron/shared/agentLane/laneProjection.ts` / `electron/agentLane/laneIpc.ts`（均 0 fix） | `laneViewModel` 对非报错工具根本不读 `part.text`，IPC 出口未裁剪 | 跨进程冗余载荷 |

### 2. 为什么这一类会一直出现

「活数据不能读过期」是正确约束（会话中途导入技能、切换权限档、改动模型目录都必须立即生效），但先前实现直接把「保持最新」等同于「每次发消息前无条件全盘重扫 / 全量深拷贝 / 同步刷盘」，没有在唯一读写边界上做基于源真相（目录树 `lstat`/`readdir` 纳秒指纹单槽记忆、`catalogRevisionToken`、唯一写口幂等比较）的复用；同时投影契约把「主进程内断言/排障读完整回包」和「渲染层展示只需状态与信封」混在同一份 IPC 载荷里。

不适用三条体验铁律的表单/模型名条目（属性能热路径问题，不改 UI 样子与模型选型）；没有逃逸账本条目。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 内置或用户技能包数量增长后，发送前同步/异步 FS 扫描呈线性膨胀，高负载下按回车卡顿突破 1–3 秒 | 在 20+ 技能目录上跑 `electron/agentLane/laneSkillCatalogCache.test.ts`，未缓存时单次发送触发上百次 `readFileSync` |
| 50 轮带工具对话每次发送推 330+ KB 投影，工具结果越多渲染层 IPC 反序列化与 GC 越重 | 跑 `tests/perf/canvas-scale-bench.mjs --scales E10 --scenarios chat-send-visible-50-tools --runs 5 --warmup 1` |
| 每次发消息即使未改权限档仍不断轮转 `.bak.json` 并调用 `fsyncSync`，在慢盘/安全软件下直接制造发送抖动 | 跑 `electron/settings/agentApprovalPolicySettings.test.ts` 中「档位未变零写盘」用例 |

### 4. 靶子独立性检查

- 性能基准使用仓库既有的 `tests/perf/canvas-scale-bench.mjs` + `responseTimer.mjs`（`Enter keydown` → 用户气泡进入 `[data-v4-flow="true"]` 可见区 + 2 rAF），非本线自造尺子；
- 所有单测均包含修前必红与明确反例（新增技能、修改 `SKILL.md` frontmatter、替换软链、真实切换权限档、报错工具结果保留原文、模型清单变更与非法字段拒收）。

### 5. 这一整块归谁（P0）

这一整块：Agent 发送前主进程热路径的资源刷新、设置落盘与 IPC 投影裁剪
归谁：Node.js 标准 `fs/promises.lstat({ bigint: true })` + `readdir`（Node 22 标准库，见 `https://nodejs.org/api/fs.html#fspromiseslstatpath-options`）、目录只读令牌 `electron/catalog/catalogStore.ts:98`（`catalogRevisionToken`）、唯一技能发现口 `electron/agentLane/laneSkillCatalog.mts:190`、唯一权限写口 `electron/settings/agentApprovalPolicySettings.ts:45`、唯一 IPC 推送口 `electron/agentLane/laneIpc.ts:123`
我们哪里绕开了它：`laneSkillCatalog.mts` 每次丢弃上次索引重扫；`laneDesktopRuntime.ts` 每次调 `chooseTextModel`（内含 `readCatalog()` `structuredClone`）而非借 `catalogRevisionToken()` 复用；`writeAgentApprovalPolicy` 不看当前值直接刷盘；`laneIpc.ts` 未在跨进程前裁掉渲染层不读的成功 `tool-result.text`

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 选了以后同一类还会不会出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 在 `laneHost.mts` 上打补丁跳过 `skillIndex.refresh()`（仅当无 `skillKey` 时跳过） | 触碰单文件热点 `laneHost.mts`；有技能或 `systemPromptForRun` 二次调用仍全盘重扫 | 会：别的调用方与有技能回合照样全盘重扫 | 绕过 `refresh()` 易漏 `<available_skills>` 更新 | 否 |
| 换一种做法 | 在各唯一共享边界做「单套机制、源未变即零重活」：`laneSkillCatalog.mts` 用单槽 `lastSkillDiscovery` + 目录树 `lstat`/`readdir` 纳秒指纹（无 `fs.watch`、无多槽 LRU）；`agentApprovalPolicySettings.ts` 唯一写口档位未变跳过写盘（调用侧不做第二层短路）；`laneDesktopRuntime.ts` 复用 `catalogRevisionToken()`、`laneDesktopInput.ts` 复用已验 `availableModels`；`laneProjection.ts` 导出 `trimWorkspaceProjectionForIpc` 在 `laneIpc.ts` 唯一 IPC 出口裁掉成功 `tool-result.text` | 6 个零历史 fix 的文件，不碰 `laneHost.mts`，不改界面 | 不会：同一回合两次 `refresh()`、所有 `writeAgentApprovalPolicy` 调用者、所有 IPC 投影推送统一受益 | 目录树指纹漏检（已覆盖根/子目录/子文件/软链全递归 `lstat` + 4 条反例单测锁死）；首条消息冷开 `openLane` 保留给后续单独评估，避免拖慢 `project-open` | 是 |
| 删掉 | 删掉运行时技能实时发现或删掉权限落盘 | 会破坏「会话中途导入技能下回合生效」与权限持久化 | — | 直接破坏已有用户承诺 | 否 |

### 7. 用户要权衡的核心

本刀只在唯一边界删掉无谓重扫、无谓写盘与渲染层不读的 IPC 载荷（不碰 `laneHost.mts`、不把首条消息的 `openLaneNativeDesktop` 冷加载搬到打开项目以免拖慢 `project-open`），换取稳态发送显著降耗，首条消息冷开与渲染层乐观回显（D3-11）留待协调按实测数字决定是否开下一刀。

## 特征测试清单（动结构前先锁住）

- `electron/agentLane/laneSkillCatalogCache.test.ts`（修前必红：2 次无变更 `refresh` 触发 82 次 `readFileSync`；修后 0 次读盘、0 次同步遍历、0 个 `fs.watch` 句柄，含新增技能 / 改 frontmatter / 软链替换 / 改子文件 4 条反例）
- `electron/settings/agentApprovalPolicySettings.test.ts`（修前必红：默认 `request` 仍写盘；修后未变 0 写盘、真改必写 1 次盘）
- `electron/agentLane/laneIpc.test.ts` + `electron/shared/agentLane/laneProjection.test.ts`（修前必红：成功 `tool-result` 携带 10KB JSON 过 IPC；修后裁剪为 `""` 且报错原文与 `nextAction`/`failure` 完整保留）
- `electron/agentLane/laneDesktopInput.test.ts`（未变 `availableModels` 复用冻结引用，变更重解析、非法字段 strict 拒收）
- 现有 `electron/skills/skillStore.test.ts`、`electron/agentLane/laneDesktopReads.test.ts` 全量保持绿灯
