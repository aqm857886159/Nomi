# 评测体系扩建 v2 —— 量化 + benchmark 基线 + 完整用户流程 + 生成质量

> 接 `docs/plan/2026-06-11-eval-system-master-plan.md`(v3 已落地的 L0-L4 地基)。
> 本文是 **v2 扩建** 的执行契约。用户已拍板方向(2026-06-14)。

## 背景:用户三条判断(全部成立,带证据)

现有评测体系地基扎实但**极窄**:真正花额度跑 agent 的只有一个维度——画布拆镜头 agent 终态断言,16 个**合成** case,只覆盖 J1/J2 的「拆镜头」一步。

| 用户判断 | 现有短板(证据) |
|---|---|
| 不够量化 | `score = 通过 check 数 / 总 check 数`(`evals/lib/grading.mjs:117`),等权布尔,无质量分;judge 默认不计分且单一二元 pass |
| 无可量化 benchmark | `evals/runs/.gitignore=*` 无入库基线;`cost` 恒 null;无 CI 评测门 |
| 无完整流程评测 | 只测「拆镜头」一步;J3/J4/J5、时间轴、导出、创作助手质量全盲;生成质量被 `zeroVendorCalls` 硬门挡在循环外 |

## 顶尖评测对标(四根支柱,调研结论)

- **τ-bench / τ²-bench**(arXiv:2406.12045):pass^k 可靠性 + 模拟用户多轮 + 终态 DB 状态比对。Nomi 已用 pass^k + 终态比对,缺多轮走完整旅程。警示:LLM 模拟用户不可靠(arXiv:2601.17087)→ 固定脚本为主、真实轨迹锚定。
- **WebArena / OSWorld**:端到端**功能性成功**——跑脚本验最终状态是否满足意图,不比对轨迹。警示:检查器本身会虚高(→ OSWorld-Verified),断言要审计。
- **VBench / VBench-I2V**(arXiv:2311.17982 / 2411.13503):视频质量拆成 16 个解耦维度逐维打分、对齐人类偏好。直接填生成质量盲区。
- **G-Eval / analytic rubric**(Eval Ops):CoT + 概率加权连续分;analytic rubric 逐维度打分(非 holistic 单分)→ 能定位回归在哪维;dev→prod 同一 rubric + 入库基线;规避 verbosity/self-preference bias。

## 拍板结论(用户 2026-06-14)

1. **排期 C→A→B 全做**(按序);
2. **Lane D 开**——用户提供生成额度 + VLM judge key;
3. **Lane C 用固定脚本旅程为主**(模拟用户多轮作扩展,真实轨迹锚定)。

## 范围:四条 lane

### Lane C — 完整用户流程评测 J1-J5(本轮先做,零额度)
把 `evals/lib/isoApp.mjs` 现有原语(`createBlankProject`/`sendAgentMessage`/`approveUntilTurnEnds(baselineTurnCount)`/`waitForPersistedCanvas`/终态取证)编排成**多里程碑脚本旅程**。

- 新增 `evals/journeys/` 数据集:每条旅程 = 有序里程碑列表,每里程碑一个**终态功能验证**(WebArena 风格 state-inspection,读 project.json/events,不比对轨迹)。
- 覆盖 CLAUDE.md J1-J5 的「任务成功标准」:
  - J1 产品宣传片:文案→拆镜头→每镜选好模型配好参数→**「可以生成了」终态**(zero-cost,不真生成)
  - J2 故事→漫画:拆镜头→定妆建角色卡→角色卡有提示词→可批量生成
  - J3 30 秒上手:「30 秒体验」入口→项目落盘→画布展开→三标签可见(已实现)
  - J4 参考图驱动:上传图→入素材库/画布→挂为节点参考图→参数配好
  - J5 改旧节点+导出:打开项目→改 prompt 持久化→导出面板可达(扩现有骨架)
- 主力固定脚本;**模拟用户多轮**作可选扩展(`--simulate-user`),真实轨迹锚定。
- 复用两段式:`eval:run journeys` → 终态产物 → `eval:score`。沿用 `zeroVendorCalls` 安全门。

### Lane A — 量化打分:断言占比 → 分维度质量分(零额度)
- 升级 `evals/lib/judge.mjs`:单一二元 pass → **analytic rubric**,每维度独立 0-1(忠实文案/可生成性/叙事连续/主体一致/参数正确),CoT + 结构化输出。
- judge 用**不同模型家族 + 随机序**避 self-preference/verbosity bias。
- 沿用「未校准(P/R≥0.8)不计入 pass」铁律(`eval-score.mjs:56-76`);校准达标后维度分计入。
- `scores.json` summary 增 `qualityByDimension`(各维均分),report.md 出**质量分卡**。

### Lane B — 可量化 benchmark 基线 + 回归门(零额度)
- 入库 **golden 基线快照**:`evals/baselines/<dataset>.json`(分维度质量分 + pass@k/pass^k + 成本 + 时延 + 数据集 hash + commit)。**仅基线入库,runs 仍 gitignore**。
- `eval:diff` 默认对入库基线比(不再手指两个本地目录)。
- 接 harness S7 cost 写回(`eval-ops-report.mjs:207` 现 null)。
- `eval:diff` 做成**可选 CI 门**:改 agent prompt/工具触发,回归(pass→fail 或 meanScore 漂移≥0.1 或任一维度跌≥0.1)即非零退出。
- 审计现有断言别虚高(WebArena 教训)。

### Lane D — 生成质量评测(独立预算 lane,用户给预算/key)
- 新增预算受控 golden 生成小集(10-20 代表镜头),周期性**真生成**。
- 按 VBench 维度打分:I2V 用 VBench-I2V 协议(图-视频一致性 + 时序质量);图用审美 + 4 类硬伤(扩 `eval-review-images.mjs`)。
- **与主循环物理隔离**,绝不破坏 `zeroVendorCalls`;独立命令 `eval:generate-quality`,显式预算上限。

## 不动什么

- 不推翻现有 L0-L4 地基与两段式(run→score)架构;
- 不改 `zeroVendorCalls` 主循环安全门(Lane D 物理隔离另起);
- 不动现有 storyboard 数据集的 16 个 case(只增不改);
- runs 产物仍 gitignore(只新增 baselines 入库)。

## 回滚策略

每条 lane 独立 commit、独立可回滚。Lane A 的 rubric 升级保留旧二元 judge 为校准前的 fallback 路径(校准达标才切),不达标行为与今日一致 → 零回归风险。

## 验收门

- 每条 lane:`typecheck + test + build + check:filesize + lint:ci` 五门全过;
- Lane C:J1-J5 脚本旅程能在隔离实例跑通,终态验证有真证据(读 project.json),冒烟档 ≤5 分钟;
- Lane A:rubric judge 校准脚本能跑,P/R 报告产出;维度分进 scores.json;
- Lane B:基线入库 + `eval:diff` 对基线比 + 回归非零退出实测;
- Lane D:真生成 + VBench 维度分产出(用户给 key 后);成本不为 null。

## 进度回填

- [x] **Lane C — 完整流程评测 J1-J5**(commit 0b7edb9):旅程框架(journeyRunner+eval:journey)+ J1/J3/J5 落地;
      J3/J5 零额度真机 2/2 绿;删旧 journeys.e2e.mjs、test:journeys 重指新框架;
      抓修旧 e2e 三处 stale 选择器。J1 需用户 catalog 实跑;J2/J4 待补(框架就绪)。
- [x] **Lane A — 分维度质量分**(commit 2874a71):judge 升级成四维 analytic rubric(忠实原文/画面可生成/
      叙事连续/跨镜一致,各 1-5 档带锚点);eval-score 出质量分卡;防长度偏袒+异家族避 self-preference;
      沿用未校准只展示铁律。需用户 judge.config key 实评 + 标注校准转正。
- [x] **Lane B — benchmark 基线 + 回归门**(commit 47e8d47):evals/lib/baseline.mjs + eval:baseline 入库 golden 基线;
      eval:diff 单参对基线比(纳入质量维度回归);正反向端到端验证;已入库首份真基线 journeys.json(零额度)。
- [x] **Lane D — 生成质量评测**(commit 5a07f30):evals/lib/vbenchRubric.mjs(图 3 维/视频 5 维 VBench 分卡)+
      eval-review-images 升级(图+视频抽帧+资产映射提示词);离屏结构全验;需用户 vision key 实评。

**总结**:四条 lane 全部落地。零额度部分(C 的 J3/J5、A/B 机制、D 结构)已真机/实跑验证;
需用户资源的部分(J1 agent catalog、A/D 的 judge/vision key、质量分校准标注)代码就绪待用户接入。
唯一真相源 = 本文档 + 各 commit。
