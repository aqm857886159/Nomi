# 规则执行审计 — 可机器化分诊表（2026-09-03）

> 本文件由家规瘦身执行班在 `docs/claude-md-slim-20260903` 分支产出。
> 分诊依据：「已被门岗/hook/skill 完全覆盖 → 可从 L1 删；纯靠判断 → 保留」。
> 逐条标注「删减来源/覆盖者」，确保可追溯。

## 判据

| 类别 | 处置 |
|---|---|
| 纯靠判断（P0–P5, D1–D6, 决策自治边界, 并行纪律中靠人裁的部分） | 保留 L1 |
| 已被门岗/hook/skill 完全覆盖 | 从 L1 删/降级到 L2 |
| 同一族多条说同一件事 | 合并最锋利措辞 |
| 细节无需 always 加载 | 移位到 L2，L1 保留一句索引 |

## 分诊表

### 已删/降级条目（可追溯）

| # | 原位置 | 内容摘要 | 被谁覆盖 | 处置 |
|---|---|---|---|---|
| A1 | CLAUDE.md 文件头 preamble（L2触发才查行、查现状行） | L2/L3 层指针的详细说明 + ARCHITECTURE-NOW 存在的故事 | 指针本身保留，verbose 解释移除；新 AI 看 preamble 能找到所有文件 | 压缩：保留层指针，删 2026-08-27 故事句 |
| A2 | CLAUDE.md 维护纪律段（hook 安装机制说明） | postinstall 自动装、换机不需手动复制、worktree 要先 pnpm install、旧戳 TTL 细节 | `check:claude-hooks` 门岗 + postinstall 脚本；hook 安装机制是实现细节属 L2 | 压缩：保留「真相源 scripts/claude-hooks/，check:claude-hooks 验同步」一句，删机制细节 |
| A3 | CLAUDE.md 维护纪律段（AGENTS.md 漂移故事） | 2026-08-25 双份手工维护撞号故事（完整案例） | check:agents-sync 门岗 已硬拦漂移；故事属教训应在 docs/lessons/ | 保留「禁止手改 AGENTS.md，改纪律只改 CLAUDE.md + gen:agents」，删故事 |
| A4 | CLAUDE.md 三闸段（三闸详细展开） | 动手前/报完成前/push 前的详细 inline 规则（与 hook 几乎逐字重复）| self-check.sh hook 每轮注入三闸全文；L1 重复只增加上下文长度 | 压缩为 2 句：「三闸由 hook 自动注入，不在此复述。细节见 self-check.sh + CLAUDE.md §P1–P5。」 |
| A5 | CLAUDE.md 每日雷达「抓的时候不是随便抓」（4 维细节） | 论文雷达的 4 维筛选标准（最新/火不火/有没有用/成熟度）| nomi-research-radar skill 内已包含筛选逻辑；L1 无需重复维度列表 | 删 4 维列表，保留「维度见技能」一句 |
| A6 | CLAUDE.md 并行纪律（ponytail/force-push 长注释） | 「评审钩子按远端旧 tip→新 tip 算…重建一律走新分支，见 R25」注释块 | R25 行的索引已指向详细规则；实现细节属 L2 | 删括号内实现细节，保留「不 force-push main / 不向已存在远端分支 force-push 重建内容」核心约束 |
| A7 | CLAUDE.md P1 段（搬家不留转发壳·现存29个反例） | re-export 壳细节 + 现有数量 | check:filesize + 代码审查；数量会过期；具体规则在 L2 R1 | 删「搬家不留转发壳」段落，L2 R1 已有 |
| A8 | CLAUDE.md P2 段（schema-v3/recurring 细节） | recurring/高风险交 schema-v3 合同、旧 v1/v2 只读 | check:root-cause-contracts 门岗 + R21 行已索引 | 保留 P2 的判断部分，删 schema-v3 合同细节（属 L2 R21）|
| A9 | CLAUDE.md 三闸段 inline 控件层级规则 | §1.5 控件层级规则·手法优先级·先分组→再去重→再归位 | 设计系统文档 docs/design/nomi-design-system.md §1.5；P5 已指向 | 删 inline 展开，P5「加/挪控件先过设计系统 §1.5」保留 |
| A10 | CLAUDE.md 三闸段 inline derive/hardcode 三次前科 | 「含门岗断言：不许在测试/门岗里手抄真相源…栽过三次：账本/CI/>=22工具数」| check:vocabularies + check:heavy-path 硬拦；前科属 docs/lessons | 删 inline 前科罗列，保留「随输入 derive 不 hardcode」原则 |
| A11 | CLAUDE.md 工作目录 worktree 政策（两点视图长注释） | 「评审/对账/打捞任何分支先算 merge-base——对 main 两点视图里的大片删除…见 R22」| docs/lessons 教训文件已覆盖；R22 行索引 | 删括号内实现细节，保留「评审任何分支先算 merge-base」核心规则 |

### 合并条目

| 合并后 | 原来多条 | 合并理由 |
|---|---|---|
| R1 行精简（删「搬家」附注） | R1 行 + P1 段搬家附注 | 同一规则两处说 |
| 三闸合并为 2 句 | 三闸段 + P5 的 inline 展开 | hook 已全覆盖 |
| 维护纪律段压缩为 3 句 | 原 preamble 中维护纪律两段（hook 安装 + AGENTS 故事） | 机器门岗覆盖实现细节 |

### 保留条目（及理由）

| 保留 | 理由 |
|---|---|
| P0–P5 全文 | 纯判断，机器替代不了 |
| D1–D6 全文 | 纯判断，用户决策逻辑 |
| 决策自治边界（自己定/才问用户/遇到矛盾） | 纯判断 |
| 并行纪律（worktree 基本规则） | 靠人裁的操作规范 |
| 规则索引表（所有 R# 行） | 指针，新 AI 需靠它找 L2 细节 |
| 每日雷达触发逻辑（今天有没有 → 跑/跳过） | 纯判断逻辑，无法机器化 |
| 项目概览、常用命令表 | 项目事实，must-load |

## hook 瘦身草案

### 目标

三闸注入文本压到核心三行以内；「近期坑」保留 Top 2（当前 Top 3）。

### 瘦身原则

- 「动手写码前」行：删冗余 inline 控件层级规则 + R8 大括号展开（link 到 docs/design）
- 「报完成前」行：删「眼见链四问」冗余细节（保留 P3 引用 + R13 引用）
- 「push 前」行：保持一句「pnpm run gates」
- violations.log 取前 2 条（从 3 改 2）

## 结论

可安全删减的文本约 3,500 字符（约 875 tokens）。
删减后 CLAUDE.md 仍能让新 AI 正确干活：P0–P5 完整、D1–D6 完整、规则索引完整、指向 L2 的指针完整。
