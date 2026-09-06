# 参考实现不拆开逐层对照 = 没研究

> 📎 教训 · 首次记录 2026-09-07 · 状态：✅ 已固化（`check:framework-boundary` 的 `referenceConformance` 接管）
> **触发场景**：要接/升/换一个框架、SDK、运行时，或第一次用它某一层；写四列表（R29）时；收框架题调研班的货时。

**结论**：四列表**不够**。它按我们自己列的能力清单走，只覆盖已经想到的那些。凡框架自带参考实现（pi 的 coding agent、React Flow 官方 examples、AI Elements demo、Mantine demo），必须**另出一张逐层对照**：按九层（工具/转录渲染/会话/上下文/模型与花费/控制流/扩展 API/观测与测试/安全）把它拆开摆在我们旁边，每层判 `一致` / `有意不同(理由)` / `没想到`。**目标不是一致，是每一处不同都是看过它的做法之后有理由地不同。**

**为什么会踩**：四列表的两列——「我们另写了」「我们拆散了」——都建立在**「我们列得出来」**之上：要判「我们另写了一份」，先得知道框架有这个能力；要判「我们拆散了」，先得知道这是一个完整能力。于是它照得出「重造了已知的东西」，照不出**「压根没想到还有这一层」**——没人会给自己不知道存在的东西列一行。

2026-09-06 #546 的 pi 评审就卡在这个边界上：会话持久化、重试、steer、资源加载、有序转录五项都是**已知能力被重造**，四列表照得出（也确实照出来了，落成了 14 条债）。但那次评审是拿着我们自己的能力清单去比对的，pi 自带的 coding agent 整个应用从没被拆开摆过一次——它在上下文管理、观测、扩展 API 这些层上的分层，我们至今没有一份逐层对照说得清「我们是有意不同还是没想到」。

**两个失败模式一样危险，长得却不一样**：

- **全是 `一致`** = 抄了它，没在想我们的领域约束（桌面本地优先、花钱要用户审批、产物是画布/分镜/时间轴）。
- **全是 `有意不同`** = 根本没看，只是把现状逐条正当化了。

**「有意不同」的理由必须是领域约束，不是偏好。** 自检一句：**这句理由换个框架还成立吗？** 成立 = 它是偏好（「我们这样更简单」「当时就这么写的」），偏好不是理由，写上去等同于判 `没想到`。

**怎么用**：
- 派框架题时把对照文档路径**写死进任务书**（`docs/research/<date>-<框架>-reference-implementation-conformance.md`，模板 `docs/research/TEMPLATE-reference-conformance.md`）——不写路径，交回来的就是一段散文。
- 收货抽查两件：① `有意不同` 的理由是不是领域约束；② `没想到` 清单清零没有。**`没想到` 清单是实施阶段的前置门，不是待办**——那格没补，对应阶段不许开工。
- 登记进 `docs/engineering/framework-boundaries.json` 的 `referenceConformance: { doc, verifiedAt, upstreamVersion }`。缺登记门岗红，还没做就登记进 `referenceConformanceDebt` 绑到期日——**债不是豁免**。
- 上游发版时门岗会拿 `upstreamVersion` 比实装版本报 warning：**改过分层的参考实现读起来和旧的一模一样**，只有版本号看得出来。

**出处**：2026-09-07 用户拍板「把框架的东西完整拆开、逐个对照分析」；规则 `docs/engineering-rules.md` R29「第二份必交物」；门岗判据 `scripts/framework-boundary-lib.mjs` `evaluateReferenceConformance`；测试 `scripts/check-framework-boundary.node-test.mjs`；上一层的教训（研究只写在文档里 = 下一个 agent 眼里不存在）见 `docs/fixes/2026-09-07-framework-boundary-not-enforced.root-cause.json`。
