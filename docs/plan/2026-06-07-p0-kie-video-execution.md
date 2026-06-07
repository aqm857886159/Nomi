# P0 执行范围 — kie 主路做到极致（含视频）

> 上位文档：`docs/plan/2026-06-07-model-onboarding-final-plan.md`（R7 定稿）。
> 本文只定义 P0 的**执行边界**：动什么、不动什么、验收门、回滚。
> 决策已拍：方向认可，先做 P0(kie 极致含视频)。

## 现状结论（来自 2026-06-07 摸底）

- **协议层 / UI 层 / 档案层都已就位**。三家 kie 视频已接：Seedance 2.0 + Fast（首帧/首尾帧/全能参考）、HappyHorse 1.0（文生/图生/角色参考/视频编辑）、Kling 3.0（文生/图生）。图片 6 模型链路完整。
- **缺口分两类**：
  1. **能跑但没真测过** —— 短同步视频（20-60s 出）代码上应通，无人端到端验证。
  2. **长任务基础设施几乎为零** —— 轮询在前端 while（`catalogTaskActions.ts:418-447`），切页面/重启丢任务；任务纯内存无存盘（`tasks/taskCache.ts:13`）；300s 超时墙；进度是假百分比。

## P0 边界（做这些）

**核心原则：verify-first。先真测，再按真断点修，不在未验证的基座上抛光。**

| # | 切片 | 文件 | 性质 | 依赖真 key |
|---|------|------|------|:---:|
| S1 | **真测三家视频端到端**：配 key → 模型出现 → 点生成 → 出视频 url → 落地节点。记录每家每模式真实断点。 | 测试脚本 `tests/transport-spike/kievideo.mjs`，不改产品码 | 验证 | ✅ |

### S1 进展（2026-06-07）

- **形状层已零额度验证**：假 key 打三家 createTask，均 HTTP 200 + body.code=401 "Authentication failed" → 端点对、请求是 kie 能解析的合法 JSON、走到认证才被拒。
- **enum/键名层有意延后**：kie 先查认证再验参数，假 key 验不到 model enum（`kling-3.0/video`、`happyhorse/text-to-video`）和 input 键名是否被 kie 接受。**用户决策：零额度，停在当前层**，接受此风险。待有真 key 时用 `kievideo.mjs` 补验（enum/参数写错 → kie 立即报错码、零额度；写对 → 一条 5s 视频）。
- **后果**：S3/S4 在"形状已验、enum 未验"的基座上做。若日后真测发现 enum 错，属 S2 范畴，单文件修对应 `kie*.ts`。
| S2 | 修 S1 暴露的真实断点（mapping/参数/响应路径错） | `electron/catalog/kie*.ts` 对应文件 | 修根因 | — |
| S3 | **kie 错误人话层**：余额不足 / 任务失败 failMsg / 轮询超时三类，从原始英文→人话 | `generationRunController.ts`（classifyGenerationError）+ catalog 错误透出 | 内容 | — |
| S4a | **状态归一根因修复**：默认状态词表补 kie 动词（waiting/generating/**fail**），删 Kling 冗余 statusMapping | `responseParsing.ts` + `kieKling.ts` | 修根因 | — |
| S4b | 可见进度 UI（耗时/真实阶段） | BaseGenerationNode | 新 UI（延后） | — |

### S3 / S4 进展（2026-06-07，已实现+单测）

- **S3 完成**：`classifyGenerationError` 拆出「余额不足」（与限流分开，用户动作不同：充值 vs 等待；只匹配「余额/欠费/balance/arrears/402」，不误伤 OpenAI 的 `insufficient_quota`），并给我们自己的「轮询超时」专属文案（不再误归「网络超时」）。NodeErrorReport 已渲染 reason+hint，**用户可见**。测试见 `classifyGenerationError.test.ts`（+4 例）。
- **S4a 完成（含一个真 bug 根治）**：旧默认状态词表无 `fail`（只有 `failed`），而 kie 失败态正是 `fail`，且 Seedance/HappyHorse 无 statusMapping → **失败视频被误判 queued、傻等 300s 超时**。补 `fail`/`generating`/`waiting` 进通用默认词表（供应商无关），失败视频现在即时带 failMsg 终止。顺手删掉 Kling 独有的 `KIE_STATUS_MAPPING`（已被默认覆盖，三家 kie 视频统一，消并行版）。测试见 `responseParsing.test.ts`（+1 例 4 断言）。
- **S4b 延后**：节点徽标已显示「生成中」，但 `progress.message` 当前不在节点渲染。要做"耗时/真实阶段"可见进度是**新 UI**（须 R8 样张），且没真视频长任务跑不能验证，故延后，和 S1 enum 真测 + 节点 UI 样张一起做。穿透 onProgress 回调在没有渲染面的前提下是看不见的无用功，本期不做。

## 不动项（P0 不碰，留给 P1）

- **任务持久化 / 后台轮询 / 重启续跑** —— R7 划定的 P1 独立期（5-8 周）。P0 不动 `taskCache.ts` 的内存实现，不把轮询挪进主进程。
- **描述符化重构**（6 个 kie 文件→数据）—— P2。
- **新增 Veo/Runway/Sora 等视频模型** —— 超出 kie 主路。
- **运镜 camera_motion 槽** —— 现接入三家无此参数，等接有运镜的模型再加。
- **取消/中止 in-flight 任务** —— 评估后视情况，默认不进 P0。

## 验收门（P3：全绿 ≠ 完成）

1. **真体感**：三家视频各至少一个模式，真 key 端到端出视频，人眼确认是真视频文件（非占位/报错）。
2. **错误可读**：故意用错 key / 空余额，节点显示的是人话（"API Key 无效"/"余额不足"），不是 HTTP 状态码或英文原文。
3. **进度可读**：生成中节点显示"排队中/生成中"，不是静默 spinner 或假 99%。
4. CI 五门全过：`check:filesize` → `lint:ci` → `typecheck` → `test` → `build`。

## 回滚

- S2/S3/S4 均为局部修改，单 commit 粒度；任一切片出问题 `git revert` 该 commit 即可，不影响图片链路。
- S1 是测试脚本，不入产品码，无回滚风险。

## UI 样张需求（R8）

- S3/S4 改的是**既有节点内的文案/状态标签**，不新增组件、不改布局 → 属内容修订，不单独出样张；但实现后纳入验收门 #2/#3 的人眼走查。
- 若 S2 发现需要新参数控件（如某视频模式缺槽），那是**新 UI**，须先出样张再做。

## 执行顺序

S1（真测，需 key）→ 据结果定 S2 → S3 → S4 → 验收门走查 → commit/push。
S3/S4 不依赖 key，可在等 key 期间并行起草。
