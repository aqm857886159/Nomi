# 方向检查：失败分类只在一处判

全图：失败怎么分类（类别 / 公开码 / 原因 / 动作）。现状有三处各自在判：画布侧 `src/workbench/observability/classifyError.ts`、外部助手侧 `electron/capabilityCore/mcpToolErrorResults.ts`、内置助手侧 `src/workbench/ai/lane/laneCommandFailure.ts`（先读画布那份、再自己改判）。交接处表里：内置助手路径命中 `agent-writes-params`，结果解析命中 `result-to-project`；判定本身属表外。设计卡：`docs/plan/2026-11-18-failure-classify-one-home.md`。
复盘来源：由没参与过前几轮修补的一条只读线，在 2026-11-17 基线（origin/main `4832b523b`）上静态读码写出，再与方案对照；它没有跑过测试或真任务，下面的例子都是逐分支推导，以实现线跑出的对拍表为准。

### 0. 一句话根因
「这次失败算哪一类、说什么、能做什么」没有唯一的家：同一段原文 / 同一个码在三处各用一套判据识别（整句关键词、按表顺序的子串、再改判），每个出口各补各的，补一处就在另两处留下差异。

### 1. 归类表：bug → 直接原因 → 类
近两个月（2026-09-17 至 11-17）这四个判定相关文件共 56 个非合并提交，其中 50 个标题是 fix（是文件修复次数，不是 50 次同根因）。典型确证历史：

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| `cb2cced31` 端口 59401 被读成 401 | 关键词嗅探读了自己拼的诊断外壳 | 判据读了不是证据的文字 |
| `e0c027bb7` 上游码 / 原话、读不出产物的归因 | 状态码派生类别压过供应商自己给的码 | 判据优先序散在各处 |
| `857ca3453` unknown 不该编「额度」 | 兜底词条替供应商编原因 | 判不出就编 |
| `fcbbebd56` model not exist 收窄 | 宽匹配吞了「模板不存在」 | 子串 / 宽匹配当识别 |
| `faef843a8` 供应商原话需有来源 | 本机的话被印成「服务商原话」 | 来源与归因没分开 |
| `22eeb5760` 取回失败只取回 | 取回失败落进 unknown 配重试 | 出口不认某类码 |
| `12c9843ca` / `220d188c3` 流断线与 terminated | 内置助手出口自己改判 | 出口二次判定 |
| `cae5b7adf` 准入恢复共表 | 外部助手自抄一份指引 | 第二份表 |
| `3797fde0c` / `54bcef6de` 本机拒绝与重新生成动作 | 动作随出口各算 | 动作没有单一来源 |

仍在的三条无理由差异（外部助手侧）：U1 把 `not_node_not_found_extra` 子串认成「节点找不到」并建议刷新节点 id；U2 `unknown_model_identity node_not_found` 按登记表书写顺序抢码；U3 带确证码 `asset_not_localized` 的失败，码放在 Error.code 就丢成「未知」，塞回正文才认。

### 2. 为什么这一类会一直出现
结构层：识别是「读原文猜」，而原文有三种来源（确证码字段、机器标记、自由散文）；三个出口读不同的子集、各自带优先序。判据没有一个共享的、只返回「类别 + 公开码 + 原因键 + 允许动作」的纯函数，新出口只能抄一份或在已有出口上再套一层。现有的概念登记只拦已知同名第二定义，`forbidden_derivations` 为空；中文 `includes` 扫描拦不住英文码和改名的表。

三条铁律：落到 ⑫「点了 = 以为的」——创作者在画布上点的「去模型接入」与外部助手拿到的「刷新节点」不是同一个原因，助手照着去做就越修越偏。

### 3. 不改结构的话，接下来会冒出什么
| 预测 | 怎么验证 |
|---|---|
| 再出现一个出口（新的外部协议、新面板）又抄一份判据，同一输入在新出口给第三种答案 | 五出口对拍表：同一组输入逐个比类别 / 公开码 / 原因键 / 动作 |
| 外部助手继续把码的碎片当整码（U1），或在多码并存时按表序抢码（U2） | `not_node_not_found_extra`、`unknown_model_identity node_not_found` 两条输入 |
| 带确证码的失败因码放在别的字段被丢成未知（U3），同一类问题换一个码再来 | `Object.assign(new Error('still pending'), { code: 'asset_not_localized' })` |

### 4. 靶子独立性检查
- 没有评测分数当靶子；靶子是对拍表与既有的各出口单测，这次由实现线写，验收线另派、只核设计卡清单。
- 没有「修对了反而掉分」的先例；有「宽匹配修窄」类修复（`fcbbebd56`），对拍表保留其输入。
- 靶子本身没发现错；用户可见的说法与动作是靶子的一部分，必须修前修后逐项相同。

### 5. P0：这些是我们独有的吗
失败分类里，「失败发生在我们这一侧还是供应商那一侧、请求有没有出门、花没花钱、哪些动作不会再扣费」是我们按镜头花钱语义的领域判断，属独有；HTTP 状态到类别的初始查表、参考拉取拒绝判据、准入恢复指引已有共享主人（`vendorFailure.ts`、`referenceFetchRefusal.ts`、`admissionRejectionHints.ts`），继续复用，不再抄。没有对应的现成库能替我们做这套归因，不登记新的自写：这是把已有判据搬家。

### 6. 三条路对比表 + 推荐
| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 沿画布那份直接给主进程用 | 主进程直接 import 渲染层的 `classifyGenerationError` / `narrate` | 表面改动小 | 把 i18n 初始化、桌面桥、渲染层解析依赖拖进主进程；只是包一层，没有得到安全的共享层 | 否 |
| 抽纯共享叶子（换一种做法：换模式、不新增库） | `electron/shared/generationFailure.ts` 放判据、类别、动作、公开码；三个出口只投影；语言和 pi 瞬时作为输入事实；同提交删旧判据；扩现有概念扫描，让共享层之外自行匹配 / 构造 / 覆盖类别、公开码、词条键、动作写不出来 | 搬大约 800 行判据与解析、同提交改 ~10 处引用；词条数据留在原处，共享层只返回键 | 最容易把有意差异（401 在外部助手原样透传、阶段码优先、无任务取回改重新生成、隐私码隐藏 cause、语言）抹平；靠对拍表逐条钉住 | 是 |
| 删外部助手的解释，只回码指回 Nomi | 外部助手只透传稳定公开码 | 代码最少 | 丢掉模型自纠与现行恢复指引，违背已有的外部助手合同 | 否 |

选第二条的理由：只有它既让判定在代码层只剩一个家，又不改任何界面元素、公开码集合与返回字段形状；前后两条路要么拖进渲染层依赖，要么丢用户已在用的能力。

### 7. 用户要权衡的核心
这一刀不新增任何创作者能看见的东西，换来的是「同一个失败在所有出口是同一个原因」；代价是一次性搬动一个被修了 50 次的文件，必须靠修前修后的对拍表证明界面说法与动作一点没变。

## 特征测试清单（动结构前先锁住）
- 五出口对拍表：`src/workbench/observability/failureExits.parity.test.ts`（修前版本已在基线上录好，修后与之 diff）。
- 已有：`src/workbench/generationCanvas/runner/classifyGenerationError.test.ts`、`src/workbench/observability/generationFailureActions.test.ts`、`src/workbench/observability/retrievalStageClassification.test.ts`、`src/workbench/observability/narrateWithoutTask.test.ts`、`src/workbench/observability/noChargeClaims.test.ts`、`src/workbench/observability/legacyEvidence.test.ts`、`src/workbench/ai/lane/laneCommandFailure.test.ts`、`electron/capabilityCore/mcpToolResults.test.ts`、`electron/capabilityCore/mcpRpcError.test.ts`、`src/workbench/creation/storyboard/exec/storyboardFailureCopy.test.ts`。
- 没钉住：吞码（供应商适配层 catch 吞带码原因）与长报文正则性能，不属于这一刀，搬家不会自动修好。

用户拍板（2026-11-18）：同意，收一处——按抽纯共享叶子做

## 补：自写登记条目 gate-family

这一刀给 `check:concept-owners` 加了 `failure-decision-bypass`，属于自写登记条目 gate-family（仓库门岗族）。为什么现在不接现成方案：现成的 eslint-plugin-boundaries / no-restricted-imports 只能管「谁能 import 谁」，管不了「在共享层之外读原文再子串认码、给对象字面量的类别字段赋封闭词表里的值、拿编出来的原文重判」这类基于词表内容的写法；而词表（类别、动作、公开码）要从主人文件里读才不会手抄漂移，这是本仓库独有的约束。能用现成方案的那一半已经用上：动作表和词条表只许经界面投影读，用 ESLint 的受限导入拦（`eslint.config.mjs` 的 failure-copy-owner / failure-table-owner）。哪天换：门岗族的保留 / 合并 / 降级清单拍板后，若 concept-owners 整体迁到通用的架构约束工具，这条扫描随之迁，词表读取方式不变；不新增特例分支，扫描只认已知 AST 形状，出现新旁路时升级为只暴露一个读取入口。

## 第二轮

独立验收 V-failure-classify 找到六份绕法：原样 / 改名 / 内联动态码表找原文子串，以及按 `decision.raw` 改词条、直接给 primary 赋值、覆盖 vendorSide。修前六份逐一写进真实文件，扫描测试 / 全仓扫描 / ESLint / 类型检查共 24 次全绿；旧扫描只认已知字面量和对象形状，漏掉的是最早应拦的实现 / 推送前扫描，不是五出口行为测试没写对。

依赖结果的一方仍是创作者和读取五出口的 Agent：共享决定不能被出口改写，原文只能显示或原样交给主人。沿旧方向补六个匹配会继续漏；本轮改用现有 TypeScript 的词法绑定追原文 → 判断 → 判定字段，覆盖字符串 / 正则 / 相等 / switch 与别名；判定字段直接赋值或展开覆盖一并拦。普通字段投影、来自 failureActionsFor 的同名动作投影仍是读取主人的决定。共享人话整表不再导出，出口按确证码查询；共享码清单只给共享层和快照测试，ESLint 同时约束 src / electron（别名、命名空间、动态解构均测）。GenerationFailureDecision 定义在热点 generationFailure.ts，本轮不改它，字段写入由扫描拦。

不算改判：分镜技术详情、pi 标记、showableRaw 的显示筛选、原样传给 confirmPublicError。新测试含六种绕法、cb2cced31 的 59401 子串误认 401 旧案及这些不误伤样本；旧规则上新测试红，「任何原文使用都报错」版正例红，还原绿。全仓扫描量具为 findFailureDecisionBypass；同一规则通过 SCAN_GUARDS 在推送前扫描真实源码，报告指向原文判断/字段写入所在行；目标零命中，复查日 2026-11-18（本轮交回独立验收）重放这六份 diff，漏检或误伤就重开升档。

本轮只碰：concept-owners 扫描及 node-test、ESLint 这一段、generationFailureCopy / generationFailureWire、mcpToolErrorResults 的查询读法、SCAN_GUARDS 登记，以及设计卡 ★9.4 / ★9.5 和本节。不改交接登记、出口说法和动作、公开码集合、三个热点文件；不启动窗口、不调用供应商。外部依赖不变，无数据迁移。
