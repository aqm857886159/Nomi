# 没进门岗的框架调研，在下一个 agent 眼里等于不存在

> 📎 教训 · 首次记录 2026-09-07 · 状态：现行
> **触发场景**：你要接入 / 升级一个框架、SDK、运行时，**或者要用它一个此前没用过的层**；或你在写一份「这个框架能干什么」的调研；或你接到的任务书只说「实现 X」，没告诉你 X 是不是框架已经有的。

**结论**：框架调研的交付物不是文档，是**四列表 + 一条门岗规则**。文档只有写它的人会读——下一个 agent 不会去 grep 一份自己不知道存在的调研。把「我们另写了 / 我们拆散了」两列翻译成 `docs/engineering/framework-boundaries.json` 的规则，跑 `pnpm run check:framework-boundary`，研究才算做完（R29）。

## 四列表模板

每格必须有 `file:line` 或文档 URL。**没有出处的格子等于没查**——凭印象填的表和不填一样危险，因为它看起来像做过。

```markdown
## <框架名>@<版本> 边界四列表

| 它提供 | 我们用了 | 我们另写了 | 我们拆散了 |
|---|---|---|---|
| `SessionManager` 会话落盘/追加/恢复<br>`pi-coding-agent/dist/core/session-manager.d.ts:184` | — | `snapshot.mts` 自研快照信封（版本锁+sha256）<br>`electron/harness/runtime/pi/snapshot.mts:64`<br>**为什么**：当时只想要一个临时工作缓存 | `SessionManager.inMemory()` 只取内存那一半，落盘与版本迁移丢了<br>`electron/harness/runtime/pi/session.mts:27`<br>**代价**：pi 升版时迁移要我们自己跟 |
| `AgentSession.steer()/followUp()` 按流式状态插队<br>`dist/core/agent-session.d.ts:377/385` | — | 宿主自建 `steering: Map<turnId, string>` + 把指令拼进下一次 prompt<br>`projectAgentExecutionCoordinator.ts:191`、`projectAgentExecutionHelpers.ts:62` | 「流式中插队 vs 排到下一回合」的区分整个没了 |

**结论落点**：以上「我们另写了 / 我们拆散了」两列 → `docs/engineering/framework-boundaries.json` 的 N 条规则；
存量登记为债（`scripts/framework-boundary-baseline.json`），绑收敛方案 `<plan>` 与到期日 `<date>`。
```

四列的分工别混：**「我们另写了」= 平行造了一份**（框架有、我们也有），**「我们拆散了」= 只用了半个**（框架的一个完整能力被我们从中间切开，只取一侧）。后者更隐蔽，也更贵——它不会在依赖图上显形，只在框架升版那天一起爆。

## 怎么踩的（2026-09-06 深夜 · #546 pi SDK 架构评审）

接 pi SDK 时**只接了最底层的 agent loop**。pi 已经提供的五件事，我们各写了一套，而且更差：

| pi 提供 | 我们干了什么 | 代价 |
|---|---|---|
| `SessionManager` 落盘/恢复/版本迁移 | `SessionManager.inMemory()` + 自研 `nomi.pi-work-context` 快照信封 | 持久化与迁移全部自持 |
| `RetryPolicy` provider 级退避 | `retry: { enabled: false }` + `maxRetries: 0` 两处开关关死 | 瞬时 5xx/超时没有分类退避 |
| `steer()` / `followUp()` | 宿主自建 steering Map + 把指令拼进 prompt 文本 | 模型看到的是追加文字，不是插队消息 |
| `DefaultResourceLoader` | 全空手写 loader + 自研 skill 发现目录 | 两份发现逻辑迟早对同一目录给出不同答案 |
| `AgentSessionEvent` 有序分段 | 把 `text_delta` 拼成扁平字符串 | UI 想还原「思考→工具→文本」只能再猜一次 |

**关键的一点：研究是做过的。** 结论只落在文档里，没进任何门岗，于是每个实施 agent 只看得见自己那一块——谁都不知道「这块框架已经有了」。这不是谁偷懒，是**信息的存放位置错了**：常驻的是门岗，不是文档。

同一夜的两个同类症状（都是「绿着但没接上」）：**#547** 内部 Agent 写画布节点的工具，真实模型 **0/18 通过**，而单测全绿——单测喂的是人手写的合法参数；**Agent 面板 v4** 57 张视觉基线全绿而 9 个组件一个回调 prop 都没有（见 [`design-lab-baselines-green-does-not-mean-wirable.md`](design-lab-baselines-green-does-not-mean-wirable.md)）。三件事共用一个根：**验收看的是产物长相，不是行为**。

## 怎么用

- 动框架前先填四列表；填不满就是还没查完，别开工。
- 派工时**把四列表贴进 brief**当硬约束——不贴，接活的人默认不知道边界在哪。
- 调研收尾问一句：**这条结论明天会被谁读到？** 答案若是「只有我」，就还没落地——翻译成 `check:framework-boundary` 的规则。
- 已经存在的自研版本按**债**登记（绑方案 + 到期日），不按豁免登记；到期不清零门岗会红。
- 判「接好了」不看基线和截图，看两个数字：工具写对率 + 回合成功率（R30）。

**出处**：#546 pi SDK 架构评审、#547 内部 Agent 工具审计（2026-09-06）；规则 R29 / R30 见 [`../engineering-rules.md`](../engineering-rules.md)；门岗 `scripts/check-framework-boundary.mjs`，登记表 `docs/engineering/framework-boundaries.json`，根因合同 `docs/fixes/2026-09-07-framework-boundary-not-enforced.root-cause.json`。
