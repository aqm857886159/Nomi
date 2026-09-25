# 集成分支收尾任务书（2026-09-23）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 先查别人

**问题**：238 commits 的集成分支已完成开发和测试，但 3 个门岗失败阻塞合入。如何清理这些门岗？

**依赖里已有？** 无现成方案。gates 脚本和具体门岗检查器是项目自有的工程纪律实施：
- scripts/gates.mjs:1 - 门岗入口脚本
- scripts/check-design-lab.mjs:1 - 视觉回归门岗
- scripts/check-symptom-cluster.mjs:1 - 根因合同聚类门岗
- scripts/check-ponytail-deferred.mjs:1 - 代码评审门岗

**仓库里已有？** 有类似案例。历史门岗清理提交记录了标准操作：
- ab027e3f1 "chore: clean gates - vo-11 baseline + electron/ai audit" - 视觉基线 + 结构审计
- 893ad17ac "fix(门岗): 补先查别人报告、i18n 层结构评审、清掉本 PR 引入的 lint 警告"
- b84eab32d "test(design-lab): 五个尾巴之后重录卡族基线" - 批量视觉基线更新

**生态里已有？** 不适用。门岗系统（design-lab 视觉回归、symptom-cluster 根因合同聚类、Ponytail 代码评审）是项目特有的质量保障机制，无对应开源实现。

**结论**：用已有流程。本 taskbook 基于项目既有的门岗清理操作（`design-lab:update` / 审计文档 / `--accept`），文档化了清理步骤和两条可选路径（先清理再合入 vs 先进 PR 边 review 边清理）。无需自研新方案。

## 背景

集成分支 `integration/core-a-salvage-20260921` 已完成主体开发和测试：
- 238 commits 领先 origin/main，全部已推送到远程
- Spend 走查 9/9 全绿
- 核心冒烟阳性对照通过
- 版本 0.21.0

**当前状态**：代码修改已提交（commit `46094f908` + merge `0ba06536b`），gates 验证 97/103 通过，3个阻塞性失败。

## 两条路径对比

### 选项 A：清理门岗后直接合并

**目标**：让集成分支满足所有合并前置条件，作为一个完整包合入 main。

**要做的事**：
1. **vo-11 视觉基线** — 运行 `pnpm run design-lab:update` 为新增的 `vo-11-picker-unlisted` 生成视觉基线截图
2. **electron/ai 结构审计** — 写 `docs/audit/2026-09-23-electron-ai-structural-review.md`，解释该模块 7 天内累积 3 份根因合同的结构性原因
3. **Ponytail 评审** — 用户决定：
   - 等 runner 可用后补审，或
   - 用 `node ./scripts/check-ponytail-deferred.mjs --accept 46094f908` 接受 deferred 状态

**优点**：
- 一次性清完所有工程债，合入时 100% 符合项目纪律
- 后续分支可以干净地基于这个 merge 点开工
- T-CV-19/T-CV-20 作为独立 follow-up，不挡主线

**代价**：
- 需要额外 1-2 小时完成审计文档和视觉基线
- Ponytail 如果等 runner 可用可能再拖几小时到几天

**验收标准**：
- `pnpm run gates` 100/103 通过（3 个 advisory 不计）
- 有 Ponytail 收据或 accepted deferred 状态
- PR 创建后 CI 全绿

---

### 选项 B：先创建 PR，门岗在 review 时处理

**目标**：让代码进入 PR review 流程，工程债在 review 过程中按需清理。

**要做的事**：
1. **立即创建 PR** — 基于当前状态（97/103 门岗通过）创建 PR
2. **PR 描述中明确列出 3 个待清理项**：
   - `check:design-lab`：需要运行 design-lab:update
   - `check:symptom-cluster`：需要 electron/ai 结构审计
   - `check:ponytail-review`：deferred 状态，待补审或 accept
3. **在 PR review 期间**（或合入前）补齐这 3 项

**优点**：
- 立即进入 review 流程，不阻塞其他人看代码
- 3 个门岗问题都有明确解法，可以并行处理或在 review 反馈后一起做
- T-CV-19/T-CV-20 在 PR 描述中明确标记为「已知但本 PR 不修，follow-up 处理」

**代价**：
- PR 打开时 CI 会红（3 个门岗失败）
- 需要在 PR 描述中清楚说明「这 3 个红是预期的，会在合入前修」
- 如果 reviewer 不熟悉流程，可能误以为 PR 未就绪

**验收标准**：
- PR 创建，描述清晰列出 3 个待清理项和处理计划
- T-CV-19/T-CV-20 明确标记为 follow-up
- 合入前 3 个门岗问题全部解决

---

## 核心区别

| 维度 | 选项 A | 选项 B |
|---|---|---|
| **合入时机** | 清完债再合 | 先进 review，边 review 边清债 |
| **PR 打开时状态** | Gates 全绿 | Gates 有 3 个预期红 |
| **工程纪律** | 严格：合入即 100% 合规 | 实用：合入前达到 100% |
| **适用场景** | 独立开发，时间充裕 | 多人协作，想尽早拿到 review 反馈 |
| **T-CV-19/T-CV-20** | 明确延后，不进这个 PR | 明确延后，不进这个 PR |

两条路**最终结果相同**（都是 gates 全绿 + T-CV-19/T-CV-20 作为 follow-up），只是**合入前清债的时机**不同。

---

## 推荐

**如果只有你一个人在推进发版**：选 **A**，一次性清完债再合，干净利落。

**如果需要其他人参与 review 或并行准备 RC**：选 **B**，先进 PR 让大家看代码，3 个门岗在 review 期间补齐。

---

## T-CV-19 / T-CV-20 的处理方式

无论选 A 还是 B，这两条都**不在本集成分支处理**：

**T-CV-19**：小窗下批量生成栏压住缩放条  
**T-CV-20**：浮框被小地图/小窗挤到左缘 clamp

**原因**：
1. 需要先出样张、用户拍板取舍方案（批量栏让开 vs 浮框改侧放）
2. 涉及 UI 重新布局，不适合塞进已有 238 commits 的集成分支
3. 当前 `used` 夹具不稳定（5 跑 1 绿）的根因是这两条，但**不影响代码功能正确性**

**处理路径**：
- 本集成分支合入后，立即开新分支 `fix/cv-19-cv-20-ui-layout-20260923`
- 或派给 Codex 做样张 + 实现 + 真机验证
- 修完后 `used` 夹具升绿，再打 RC（T-RL-09）

---

## 概念占用表（R33）

本任务涉及的概念与 owner：

| 概念 | 唯一 owner（文件·符号） | 允许谁消费 |
|---|---|---|
| 设计实验室视觉基线 | `tests/design-lab/baselines/` + `scripts/design-lab.mjs` | design-lab 测试套件 |
| 根因合同结构评审 | `docs/audit/*.md` + `scripts/check-symptom-cluster.mjs` | 审计流程、symptom-cluster 门岗 |
| Ponytail 评审收据 | `.claude/ponytail-receipt.json` + `scripts/check-ponytail-deferred.mjs` | pre-push hook、check:ponytail-review 门岗 |

---

## 下一步（用户决策点）

**请决定走选项 A 还是选项 B**，我会按你的选择执行：

- **选 A**：我立即派 agent 完成 3 个门岗清理，全绿后报告
- **选 B**：我立即创建 PR，在描述中列出 3 个待清理项

两条路的 T-CV-19/T-CV-20 处理方式相同（作为 follow-up）。
