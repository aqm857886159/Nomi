# 工作模式：一个协调会话 + 执行体

> 谁读：担任协调会话的 Claude（用户只和它说话，见 [编排手册](agent-orchestration-playbook.md) §19）。
> 第一版 2026-10-08（用户：「把这个放入仓库作为以后类似的工作模式……收集数据持续更新这些注意要点和规则」）。本文讲「怎么选模式、怎么跑、怎么用数据改规矩」；Codex 的规矩和画像在 [codex/](codex/) 目录。

## 1. 两种模式

| | 模式 1：协调会话 + Claude 子 agent | 模式 2：协调会话 + Codex |
|---|---|---|
| 执行体 | Agent 工具派的子 agent（nomi-worker / nomi-light / nomi-deep / Opus / Explore） | `codex exec` 命令行会话，经派工队列并行 |
| 强项 | 判断、取舍、架构、界面审美、跨模块推理；工具生态全（浏览器、设计画布） | 量大、便宜；查事实和独立验收很稳 |
| 弱项 | 吃协调会话同一个额度池 | 实现类首轮通过率低（2026-10-08 实测 6/20），常见毛病见 [质量画像](codex/quality-profile.md) |
| 适合 | 架构评审的判断与终稿、结构改动的合同与必红测试、界面方向、疑难诊断 | 查事实、独立验收、对抗评审、有机器判据兜底的实现、证据与文档 |

**默认用混合**：判断归 Claude，执行与核验归 Codex。范例：2026-10-08 架构评审——9 条 Codex 只读调研线查事实，Opus 子 agent 分两阶段做判断（先出草稿和「待核实事实清单」，事实到齐再写终稿），协调会话审后给用户拍板。

额度：开新线前看协调会话的额度（5 小时窗口 ≥ 80% 不开 Claude 新线）；Codex 额度充足时，执行类优先派 Codex。

## 2. 每个改动走的流水线

1. **任务书**（协调会话写）：引用户原话；写清根因或合同、「别动什么」、交付物；结构改动附必红测试清单。模板见 [codex/templates/](codex/templates/)。
2. **实现**：结构改动必须两个提交——提交 1 只有测试且必须红，提交 2 实现。
3. **对抗评审**（另一条 Codex 线，模板 `adversarial-review.md`）：对照任务书、测试有没有被削弱、含义有没有被改、门岗有没有被放宽、批量改动抽样、并行版、CI 同款门岗、正文与 diff 是否一致。
4. **独立验收**（花钱 / 长跑 / 可打断 / 新界面四类必须；与实现线不同的线，模板 `independent-acceptance.md`）：用户视角真跑、变异必红、还原核 SHA。
5. **协调会话审**：含义变化（共享模块的语义改动 100% 亲自看）、界面截图亲眼 Read、规矩解释。
6. **推送 → CI → 合并前扫描**（`scripts/merge-preflight.mjs`）→ 合并 → 合并 SHA 上的收据；收据红立刻停。落后 main 的代码 PR 合并前先同步 main。

## 3. 模式 2 的机械部分（协调会话本机）

- **派工队列**：一个只追加的队列文件，每行 `名字|强度|worktree|new 或 resume:<会话 id>|任务`；一个单实例循环按「同时最多 5 条、同一 worktree 同时只跑一条（占用标记，跑完删）」派出。
- **OpenAI 容量中断**：日志尾部出现 `at capacity` 就自动以 `resume` 续跑同一会话，最多 3 次；大任务拆成几条新开的中等任务，比反复续跑一个长会话可靠。
- **盯队列**：用轮询（`wc -l` + `sed` + `sleep`），不用 `tail -f`——Windows 上 `tail` 管道会留孤儿进程，攒多了桌面堆耗尽，新进程起不来（0xC0000142）。
- **worktree**：每条线一个 sibling worktree（同盘），合并后交用户脚本清理；不在共享主仓切分支。
- **只杀自己启动的 PID**，绝不按进程名杀；开发服务器用完即停。

## 4. 红线（所有执行体都适用）

密钥只进进程环境；公开仓库不写本机绝对路径、私有数据、价格与供应商商务；不 push main、不 force push；不用 `--no-verify`；不起可见窗口、不连用户真实的 Nomi 资料目录；子 agent / Codex 不认转述的花钱同意；删除一律交用户。

## 5. 用数据持续改规矩

1. **记账**：每条 Codex 交付在 [codex/delivery-ledger.jsonl](codex/delivery-ledger.jsonl) 记一行：`date, line, kind（research / implementation / acceptance / review / design / gate-fix / release）, pr, outcome（accepted-first-pass / returned-by-coordinator / ci-red-after-push）, defects（问题类别）, note`。
2. **触发**：同一问题类别累计 ≥ 2 次 → 在 [质量画像](codex/quality-profile.md) 补对策，并在 [公共规矩](codex/rules.md) 加一条（写明日期和起因 PR）。
3. **升级**：规矩加了仍复发 → 改成机器判据（门岗、lint、类型、必红测试、对抗评审检查项），补法优先级：删 > 结构 > 门岗 > 文字。
4. **复盘节奏**：每周看一次首轮通过率和「推送后 CI 才红」率，按类型调整分工（哪类该收回给 Claude、哪类可以放心交给 Codex）。
