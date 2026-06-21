# 上下文接力 + 控制文件自迭代（A + B档2）

> 2026-06-21 · 用户拍板 A+B档2（见 [[self-improving-control-files-research-2026-06-21]] 记忆 + task whz6a4w3m/w015illuc 调研报告）。
> 本文档是该改动的单一真相源。改的是**开发工作流的控制层**（CLAUDE.md / `.claude/hooks` / `violations.log` / `memory/`），**不是 Nomi 产品功能**。

## 0. 为什么做 / 解决什么真实摩擦（D1/D6）

两个真实痛点，对应两块：

- **A（上下文接力）**：session 太长时，用户现在得手动「让 AI 吐 context → 开新 session → 粘回去」。纯人力搬运，每次都做。
- **B（控制文件自迭代）**：用户反复纠正我同一类问题（violations.log 就是证据），但「把反复信号沉淀进规则」靠人手维护；且维护得当心 CLAUDE.md 越堆越胖、丢真相源。

调研结论（剔除已过时/存疑后）定了边界：**A 有现成产品可抄、低风险；B 的最成熟产品（Cline）和最前沿论文（ACE）都刻意选「手动 + 只提议不自动改核心层」的保守档**。全自动改 CLAUDE.md（档3）的三大风险——context collapse、brevity bias、misevolution——学界都没成熟缓解，solo 没有第二人审计，故**不做档3**。

## 1. 范围（做什么）

### A. 上下文自动接力（零新依赖，纯 hook）
自研最小版，不引 claude-mem（它有学习期 + token 开销 + 跨项目隔离要自己留意，对 solo 是净负担；我们只要「接力」这一个能力）。

- **A1 PreCompact hook**（新增 `.claude/hooks/handoff-write.sh`）：仅在**自动** compaction 触发时（`trigger == "auto"`，手动 `/compact` 不触发——手动意味着用户在主动操作），把当前会话浓缩成交接卡写到 `.claude/handoff/latest.md`，带时间戳 + 归档到 `handoff/<ts>.md`。
  - **⚠️ 实现偏离原计划（2026-06-21 实测根因）**：原计划 spawn `claude -p` 生成结构化卡片，但实测本 app 环境注入了 `ANTHROPIC_AUTH_TOKEN`（会话级 scoped token），子进程 `claude -p` 拿它打 API 会 `401 Invalid bearer token`，且失败仍返回 exit 0。hook 继承同样环境必然同样失败。故**改为确定性提取**：从 transcript 抽「## 最近你提的（近 10 条 user 消息）+ ## 我上次停在（最后一条 assistant 文本）」。零认证、零依赖、100% 可靠——这正是手动「吐 context」会吐的内容。不保留 LLM 路径（P1 不留会写错误内容的并行/fallback 路径）。
- **A2 SessionStart hook**（新增 `.claude/hooks/handoff-read.sh`，matcher `startup|resume`）：session 开始时若存在 `handoff/latest.md` 且新于阈值（如 < 24h），把它注入上下文（SessionStart stdout 会被注入，调研 A2 已证三个可注入事件之一）。注入后不删除（幂等，可重复 resume）。
- 这样：长 session 自动写交接卡，新 session 自动读回——**用户不再手动吐/粘**。

### B. 控制文件自迭代（档2：自动写附属层 + 提议核心层）

- **B1 `violations.log` 升级成 ACE 式计数条目**（改 `self-check.sh` + 新 `viol-add.sh`）：
  - 每条带 `id | first-seen | hits | last-seen | 文本`（结构化，但仍是人可读的一行）。
  - self-check 注入从「按时间 tail -3」改为「**按 hits 降序 + 最近性加权取前 3**」——反复踩的坑优先顶在眼前（ACE 的 harmful 计数思路：被注入后仍复发 = 真信号强）。
  - 用户纠正我时：语义匹配已有条目则 `hits++` + 更新 last-seen；否则新增。**这把「真信号判定」从纯 LLM 黑盒变成可证伪的计数。**
- **B2 「反思→提议」手动工作流**（新增 skill `.claude/skills/reflect-and-propose/` 或 slash command）：对标 Cline `self-improving-cline.md`，**手动触发、相关性门控**（这次会话有用户纠正 OR 多步非平凡才跑），产出：
  - 自动写**附属层**（`memory/` 条目 / `violations.log`）——低影响、可回滚、git 留痕。
  - 改**核心层**（CLAUDE.md 的 P/D 原则、三闸、hooks）→ **只生成 diff + 讲清「为什么该改」，等用户 y/n**，绝不自动改。

## 2. 反问闸：自动写 vs 反问用户的判定规则（⚠️ 学界无现成答案，本项目自研）

调研明确：主流框架几乎没有「写入确认闸」，且无任何消融实验。故此规则是**我们设计的工程经验法则**，按三维判定。落地为 B2 工作流里每条候选信号过一遍：

| 维度 | 自动写（不打扰用户） | 提议 + 反问 y/n |
|---|---|---|
| **目标层** | `memory/` 或 `violations.log`（附属层） | CLAUDE.md 的 P1–P5/D1–D6/三闸、`.claude/hooks/`、settings（核心约束层） |
| **可逆性** | 可回滚（git / 易删） | 改了影响每一轮、波及面大 |
| **置信度** | 高：明确纠正 / 明确偏好 / 已反复出现(hits≥2) | 低：一次性、模糊、可能是情绪 |
| **是否冲突** | 不与既有约束冲突 | **覆盖/推翻**已有明确约束（必须复述确认，对标 ChatGPT 产品做法） |

**铁律**：核心约束层（P1–P5 / D1–D6）= **人类-only 编辑区**，自迭代永远只能对它提议 diff，不能自动改（这是 misevolution 的最低防线，也和 CLAUDE.md 现有「新坑默认进 memory，不塞 L1」纪律一致）。

## 3. 不动项（明确不做）

- ❌ **不做档3**：不让任何 loop 自动改 CLAUDE.md 核心层 / 自动重写整块（context collapse 入口）。
- ❌ **不引 claude-mem / Mem0 / Letta 等外挂记忆框架**（solo + Claude Code 宿主下是净负担，调研结论）。
- ❌ **不碰 Nomi 产品代码 / UI**：这是开发工作流工具，与 `src/` 无关。
- ❌ **不动现有 4 个 hook 的既有行为**（self-check 只扩注入排序，pre-push/stack-currency/completion 不碰）。

## 4. 与现有体系的接法（加新必删旧 P1）

- self-check.sh 的注入逻辑**就地升级**（tail-3 → hits 排序），不新建并行 hook。
- violations.log **原地改格式** + 写一次性迁移把现有 5 条补上 id/hits（默认 hits=1，2 条已知反复的手动标高）。
- handoff 读写是**纯新增能力**（PreCompact/SessionStart 此前无 hook），无旧实现可删。
- `.claude/` 被 gitignore → 在 CLAUDE.md L2 维护纪律处补一行「换机/新 worktree 需手动复制 handoff 脚本」（已有同类提示）。

## 5. 回滚

- 全部改动集中在 `.claude/`（gitignore，本地）+ CLAUDE.md/docs（git）。
- handoff 出问题：删两个 hook 的 settings.json 注册即停，`handoff/` 目录可删。
- violations 格式回退：保留迁移前快照 `violations.log.bak`。
- B2 是手动 skill，不跑就零影响。

## 6. 验收门（R13 + R11）

这是脚本/工具改动，五门里 lint/type/test/build 主要覆盖不到 shell hook，故**主验收=真机走查**：

1. **A 真触发**：人为把 session 顶到自动 compaction（或临时降阈值），确认 `handoff/latest.md` 生成且字段完整、内容准确；开新 session 确认交接卡被注入且读得懂。
2. **B1**：构造一条「重复违规」，确认 hits++ 且下一轮 self-check 把它顶进前 3。
3. **B2**：真跑一次工作流，确认：附属层信号自动写对了、核心层改动**只给 diff 不自动落**、反问闸分类符合 §2 表。
4. CLAUDE.md/docs 改动过 `check:tokens`（若涉及）；shell 脚本过 shellcheck（若装）。

## 7. 排期（切片）

- **S1**：A 上下文接力（handoff-write + handoff-read + settings 注册）→ 真机走查验收门1。
- **S2**：B1 violations.log ACE 化（格式 + 迁移 + self-check 排序）→ 验收门2。
- **S3**：B2 反思→提议 skill + §2 反问闸规则 → 验收门3。
- 每片独立可用、可单独回滚；S1 先做（解当下痛）。

## 8. 开放难题（诚实标注，不在本期解）

- 跨机器同步 auto-memory：无官方方案，仍靠手动提升进 git。
- 触发可靠性：path-scoped rules / hook 注入的实际召回率无公开数据，靠 S 验收门人工抽验。
- stale 记忆识别（高相关但已过时）：公认未解，本期不碰，靠 B1 的 last-seen 给个粗略衰减信号。
