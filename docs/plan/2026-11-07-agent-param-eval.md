# Agent 参数 / 重试测试集（短版设计卡）

> 类别：其他（测试 / 量具）。纯新增 `tests/ux/` 下的题库、判分、走查，不改 `electron/`、`src/`。
> 起因：用户反馈 Agent 经常「参数不合法」然后反复重试。现在没有一把量具能回答「写对率多少、重试几次、会不会同一错误连发」。

## 短版设计卡

- ★1：谁在用 = 改 Agent 工具面的人（量修前 / 修后）。真实任务 = 39 句用户说法（中 19 英 20），覆盖单参数、越界取值、逐字提示词、按文稿批量、素材参考、改已有镜头、批量改、白模预演、付费确认、只问不做。三个数（量具 = 新走查 `agent-param-eval-real-model.walk.mjs` + 判分 `agent-param-eval-judge.mjs`）：
  - **工具写对率** = 写入类调用中「入参一次过准入」的条数 / 全部写入类调用条数。写入类 = `draft_shots` `write_node_text` `arrange_canvas` `stage_shot` `make_artifact` `write_script` `edit_timeline` `undo` `delete_from_canvas`；「被拒」= 工具结果带 `Validation failed for tool`、`capability_input_invalid`、`generation_input_invalid`、`Unrecognized key(s)` 等参数类拒收（与 `askback-trajectory.mjs` 同一把尺子，不另写）。`generate` 不算入（它是请示卡，不是入参）。
  - **回合成功率** = 整题通过（`expect` 全部满足）的题数 / 可判的题数。起始态搭不起来的题记「不可判」，不进分母、单列。越界取值题的「通过」= 落了合法值，或转问，或明说「做不到 X、改成了 Y」；静默改值判红。
  - **平均重试数** = Σ 每题重试数 / 可判题数。重试 = 同一工具上一次调用被拒后的再次调用。同时单列「同一错误连发 ≥3 次」的题数（判据与生产熔断同一把：工具名 + 失败正文首行，`laneRepeatedFailure.mts`）。
  - 不做：不判画质、不判提示词好坏（逐字题只比字串）；不碰真生成（跑器永远点「取消」，只有大脑模型文字费用）。已知坑：judge 里参数键别名（duration / aspect_ratio / size…）是按目录常见写法猜的，首轮基线若某类题全红，先看报告里的 `unmatchedParamKeys` 判是仪器问题还是产品问题。老用户：不适用（只加测试，不碰存量）。
- ★2：题库 / 判分 / 走查归 `tests/ux/`（测试域），不新开概念；读 App 落盘的 lane transcript 与 `.nomi/runs/*/run.json`，不写产品状态。证据：`node scripts/door-map.mjs` 对本线无涉及（不改产品符号）。
- ★3：沿用 `agent-storyboard-real-model.walk.mjs` 骨架（B 轻量版，R-agent-quality-025 §6 第 11 类）；轨迹落盘复用 `askback-trajectory.mjs` 的 `annotateRetries`；卡处理（提问 / 报价 / 不可逆）与 askback 走查同一套选择器常量。不新造跑器框架。已知重复：卡处理循环与 askback 走查各一份（~40 行），合并要重跑付费走查，留作后续。
- ★4：空 / 加载 / 成功 / 失败 / 取消中 / 过期 / 能力不可用：不适用（无用户界面）。跑器自身的状态：起始态搭不起来 → 该题「不可判」并写原因，不当成产品结论；缺 `--model` 直接拒跑；`--dry-run` 不连模型。
- ★9：验收与回滚。验收清单与反例（动手前写，实现线按它自验）：
  1. 判分器阳性对照：每类期望给一条该过的轨迹 → 过；阴性对照：被拒 3 连发、静默改值、提示词被扩写、顺带改了别的镜头、没写就说写了、写了不该写的 → 各自红。命令 `pnpm exec vitest run tests/ux/agent-param-eval-judge.test.mjs`。
  2. 全题阴性对照：空轨迹喂每一题，除只问不做类外全部红（防「恒绿」）。
  3. 题库自检：id 唯一、中英各半（差 ≤2）、每题 `fixture` 在登记表里、预演台词齐全、≥30 条。
  4. 走查门岗：`pnpm run check:walkthroughs`、夜跑排除表登记（`tests/ux/nightly-ci-exclusions.json`，付费 / 真模型走查不进 CI）。
  5. 干跑：`--dry-run` 起真 App（隔离资料目录）、读题、搭三种起始态（空 / 文稿 / 素材）、写轨迹文件和 `summary.json`，不连模型。
  6. 反例（这一类会从哪回来）：换大脑模型（跑器强制 `--model`）、目录变了（不写死合法值，只看主机是否准入）、画布格式变了（读 run.json 的字段名集中在一处）、`generate` 误点确认（跑器只点取消，judge 另判 `noGenerate`）。
  回滚：revert 本 PR，无产品影响。独立验收：不适用（非四类）。

真实文本评测复用付费走查准入：拒绝 CI、未显式开关和已运行的用户 Nomi；结束删除隔离资料与素材并核对原资料指纹。干跑不复制真实目录。
