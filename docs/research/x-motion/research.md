# Nomi：X 交互设计研究补充

研究日期：2026-11-09（Asia/Taipei）。这是证据型参考研究，不是Nomi品牌定案、代码适配或依赖安装建议。原始检索者未访问 Nomi 仓库或修改 Page；本 v1.2 整合已更新同一 Page，未修改产品代码或发外部消息。

## 结论先行

顶尖体验更值得学习的不是特效，而是三种机制：

1. **状态变化与视觉动画解耦**：动画被跳过或取消，业务仍到达正确状态；浏览器View Transition的“跳到终态”不等于物理spring的“保留速度反向”。不能用一种API承诺两种能力。
2. **输入驱动的连续反馈**：拖动时直接跟随，放手后收敛；遮罩和主体绑定同一进度。连续性要测中途反向，不凭录屏封面推断。Motion官方Svelte说明和Emil手势文档提供了可操作规范。
3. **先删后增强，以可操作原型传递审美**：先检验任务与频率，再做基线/增强对照；AI应生成真实数据和调参工具。把理由、例外、测试写成规则，比“做高级点”可靠。

## 检索方法与局限

先以6个方向分散检索：可中断与直接操控、状态连续/共享元素、spring与语义tokens、微交互反馈预算、减少动效/键盘、AI原型工作流；再收敛到作者原帖与一手文档。共15次搜索，工具返回104条、按post_id去重102条（含不少无关/低信息量结果；超过最初30–50候选预算是为修正作者handle及稀疏检索）。最终精选12条，覆盖6主题；不重复计入既有kaolti案例。

所有X内容只用内置x公开读取。精选12条均用get_posts_by_ids再次回查，handle由author_id展开确认；长帖使用note_tweet，短摘录逐条校验为原文子串。文本中的&amp;保留源返回实体；发布时间均转Asia/Taipei。未凭点赞量判定效果。

历史日期检索及bramus查询无结果，不解释为作者没发过相关内容；emilkowalski_是初始检索变体，后以实际返回的emilkowalski确认作者。transitions.dev精确搜索只返回2条二手推荐，未找到可核实的作者原帖，故不猜作者handle，也不计入核心证据。未访问Refero（授权待完成）。

**原始检索者未观看视频；整合阶段获得三条 secondary video-analysis observations。** 下列卡片保留采集时作者文字声明和局限，不能当作所有声明已被视频验证；以本文“视频核对与纠正”及 media-review.json 中的观察/未演示项区分。没有源码行为调查、运行测试或性能/跨浏览器验证。原帖和文档可读不代表代码有权复用；商业素材与许可另审。数据只含短摘录、原创分析和媒体 URL，不含第三方图片/视频/源码。

## 搜索词（原始）

- `("interruptible" OR "interrupted") (animation OR motion) -is:retweet`
- `("view transitions" OR "shared element") (tutorial OR animation OR focus) -is:retweet`
- `("spring" "animation") (" Emil" OR "design" OR "velocity") -is:retweet`
- `("reduced motion" OR "motion tokens") (design OR animation) -is:retweet`
- `"transitions.dev" -is:retweet`
- `(from:emilkowalski_ OR from:raunofreiberg OR from:bramus) (animation OR transition OR spring) until:2026-01-01 -is:retweet`
- `("AI" "design") ("prototype" OR "workflow") (from:shadcn OR from:raunofreiberg OR from:joshwcomeau OR from:emilkowalski_) -is:retweet`
- `(from:emilkowalski_ OR from:raunofreiberg OR from:bramus OR from:joshwcomeau) -is:retweet`
- `("AI" OR "agent") ("prototype" OR "design workflow") ("interaction" OR "feedback") -is:retweet -is:reply`
- `("motion tokens" OR "spring animations" OR "animation interruptions") -is:retweet -is:reply`
- `from:emilkowalski (animation OR animations OR spring OR AI) -is:retweet -is:reply`
- `from:bramus (transition OR transitions OR focus) -is:retweet -is:reply`
- `("microinteractions" OR "micro-interactions") (source OR feedback OR tutorial) -is:retweet -is:reply`
- `("motion tokens" OR "easing tokens" OR "spring presets") (UI OR design) -is:retweet`
- `from:zoltanszogyenyi (TypeUI OR "micro" OR "interaction") -is:retweet`

## 精选证据卡

### 1. AI设计工作流 — @emilkowalski

- 原帖：https://x.com/emilkowalski/status/2116583281332503038
- 发布时间：2026-11-01T01:29:13+08:00（Asia/Taipei）
- 短摘录：> /remove-animations → /improve-animations → /animation-performance
- 摘要：Emil提出先删除多余动效，再改善保留部分，最后检查性能。
- 证据：公开原作者文字
- 机制：先减法、再优化、再性能审查。
- 流程帮助：在既有页面七闸里先问该不该动，不把动效数量当质量；不另开一道闸。
- 局限：开源README已读；未执行这些skills，不能保证对Nomi有效。
- 商业背景：作者课程/个人品牌间接推广
- 关联资料：https://github.com/emilkowalski/skills; https://emilkowal.ski/ui/agents-with-taste; https://emilkowal.ski/ui/you-dont-need-animations

### 2. AI设计工作流 — @emilkowalski

- 原帖：https://x.com/emilkowalski/status/2113707839760089198
- 发布时间：2026-10-24T03:03:14+08:00（Asia/Taipei）
- 短摘录：> A tool to populate your UI with realistic data.
- 摘要：Emil建议让AI先造调参、性能可视化和真实数据工具，再做最终界面。
- 证据：公开原作者文字
- 机制：把AI用于构建设计验证工具，而非只生成成品。
- 流程帮助：交付参数面板、真实长内容与异常数据集；缩短调试反馈循环。
- 局限：经验建议，无对照实验或可复现性能数字。
- 商业背景：个人品牌；无直接购买CTA
- 关联资料：原帖未提供可独立打开的一手文章/源码链接；不猜地址。

### 3. spring与调参 — @emilkowalski

- 原帖：https://x.com/emilkowalski/status/2117240584897548326
- 发布时间：2026-11-02T21:01:06+08:00（Asia/Taipei）
- 短摘录：> You’ll be able to drag and interact with everything yourself
- 摘要：作者发布课程的spring/easing可交互教学预告。
- 证据：公开原作者文字；演示视频未观看
- 机制：参数变化要由可直接操作的对象解释。
- 流程帮助：用同一真实组件对比easing和spring，记录选择理由；避免凭名称选“弹簧感”。
- 局限：视频未观看；不证明保留速度或可中断；课程不是Nomi实际组件。
- 商业背景：明确课程推广
- 关联资料：原帖未提供可独立打开的一手文章/源码链接；不猜地址。

### 4. 可中断与直接操控 — @motiondotdev

- 原帖：https://x.com/motiondotdev/status/2109640479583412660
- 发布时间：2026-10-12T21:41:00+08:00（Asia/Taipei）
- 短摘录：> Interruptible, physics-based, state-responsive animations.
- 摘要：Motion发布Svelte集成官方指南；深读确认其状态变化示例说明中途反向保留当前值和速度。
- 证据：公开原作者文字；演示视频未观看
- 机制：跟随输入与松手收敛分开；重新指定目标时连续响应。
- 流程帮助：在所有可反向操作上写明中断策略，用快速开关和拖拽重新抓取测试。
- 局限：框架示例不是Nomi适配结论；未执行原型或基准测试。
- 商业背景：工具官方推广
- 关联资料：https://motion.dev/docs/svelte; https://github.com/emilkowalski/skills/blob/main/skills/gestures/SKILL.md

### 5. 减少动效与可访问性 — @motiondotdev

- 原帖：https://x.com/motiondotdev/status/2112906836173300065
- 发布时间：2026-10-21T22:00:20+08:00（Asia/Taipei）
- 短摘录：> If an animation *should* have a reduced motion version but doesn't
- 摘要：官方发布Motion Studio reduced-motion替代版本及缺失提示机制。
- 证据：公开原作者文字；演示视频未观看
- 机制：把替代版本缺失变成显性检查项，而非最后关闭全部动画。
- 流程帮助：每个motion token绑定reduced-motion替代和必保留的信息；键盘焦点另测。
- 局限：视频未看；警告不等于可访问性合规，实际替代仍需人工测试。
- 商业背景：商业工具推广
- 关联资料：https://motion.dev/docs/react-accessibility

### 6. 状态连续与共享元素 — @westonruter

- 原帖：https://x.com/westonruter/status/2114089753452937464
- 发布时间：2026-10-25T04:20:49+08:00（Asia/Taipei）
- 短摘录：> Comparison with animation slowed 4× &amp; Slow 4G emulation:
- 摘要：WordPress核心贡献者展示后台跨文档过渡对照，声明减少不必要cross-fading。
- 证据：公开原作者文字；演示视频未观看
- 机制：保持稳定导航，集中变化在用户目标区域。
- 流程帮助：原型评审提供正常速度、慢放、慢网三种对照；先检验终态再评价动画。
- 局限：视频未看；WordPress版本、性能提升和具体效果只为作者声明，不能外推。
- 商业背景：未见直接商业推广
- 关联资料：https://developer.chrome.com/docs/web-platform/view-transitions; https://developer.chrome.com/docs/web-platform/view-transitions/same-document

### 7. 微交互与反馈预算 — @GrapheneOS

- 原帖：https://x.com/GrapheneOS/status/2112077432643805538
- 发布时间：2026-10-19T15:04:35+08:00（Asia/Taipei）
- 短摘录：> moving to an interruptible loop without an outro
- 摘要：GrapheneOS回顾放弃更花哨启动动画，采用无尾声可中断循环以免延长启动。
- 证据：公开原作者文字
- 机制：业务完成就结束等待，不让装饰尾声阻挡任务。
- 流程帮助：把“装饰不得延长可操作时间”加入等待状态验收；不伪造任务进度。
- 局限：启动动画与一般UI不同；仅为维护者回帖，没有测试或源码审阅。
- 商业背景：未见商业CTA
- 关联资料：原帖未提供可独立打开的一手文章/源码链接；不猜地址。

### 8. 可中断与直接操控 — @Nil_phy_dreamer

- 原帖：https://x.com/Nil_phy_dreamer/status/2116435252318961852
- 发布时间：2026-10-31T15:41:00+08:00（Asia/Taipei）
- 短摘录：> Click opens photos large on an interruptible spring.
- 摘要：组件作者声明dock邻居让位、照片展开、光标变化协同，并声明多输入与减少动效支持。
- 证据：公开原作者文字；演示视频未观看
- 机制：一个对象的多个视觉反馈协调；中途反向不失上下文。
- 流程帮助：只作为协同反馈拆解样本；把连点、触控、键盘、reduced-motion分别列实测项。
- 局限：未看视频未审代码；60fps/零重渲染/键盘可用均未独立证实；自定义光标不可替代语义。
- 商业背景：明确组件产品推广
- 关联资料：https://www.craftui.space/

### 9. 可中断与直接操控 — @animate_ui

- 原帖：https://x.com/animate_ui/status/2111882483159662674
- 发布时间：2026-10-19T02:09:55+08:00（Asia/Taipei）
- 短摘录：> Springs, interruptible animations, reduced motion respected
- 摘要：Animate UI 2.0线程列出动效原语、React Aria和可中断支持；主页可访问。
- 证据：公开原作者文字
- 机制：优先保留原有语义原语与组件体系，再增强动效。
- 流程帮助：进入依赖评估前先核对语义、焦点和可中断矩阵；不因演示好看更换基础组件。
- 局限：此条是同作者发布线程子帖；功能、许可和兼容性尚未逐项核实；不建议现在安装。
- 商业背景：开源产品推广
- 关联资料：https://animate-ui.com/

### 10. AI设计工作流 — @rahulluthra22

- 原帖：https://x.com/rahulluthra22/status/2112525816718561448
- 发布时间：2026-10-20T20:46:18+08:00（Asia/Taipei）
- 短摘录：> a working prototype with actual functionality, realistic data and business logic.
- 摘要：设计师回顾真实项目，主张AI帮助并行探索真实用户旅程及功能原型，更早获得反馈。
- 证据：公开原作者文字
- 机制：把可操作原型当研究媒介，而非把截图当完成。
- 流程帮助：相同任务做基线与增强版，用真实数据、慢请求、失败及业务规则进行任务测试。
- 局限：是反事实经验反思，不是实际AI节时实验；不引用其“days vs weeks”为效果保证。
- 商业背景：个人专业服务间接推广
- 关联资料：原帖未提供可独立打开的一手文章/源码链接；不猜地址。

### 11. 微交互与反馈预算 — @zoltanszogyenyi

- 原帖：https://x.com/zoltanszogyenyi/status/2113333393543106814
- 发布时间：2026-10-23T02:15:19+08:00（Asia/Taipei）
- 短摘录：> I launched over 113+ interactive UI examples:
- 摘要：TypeUI作者发布按行为分类的微交互及实现提示词；官网可读类别与113示例说明。
- 证据：公开原作者文字；演示视频未观看
- 机制：用具体任务分类找参考：copy反馈、撤销、进度、未保存内容、焦点。
- 流程帮助：新增任务→行为→状态→参考机制→AI规格的检索表；不要整页照搬。
- 局限：113为站方声称数量；未逐条计数或操作；部分提示词需解锁，许可未审。
- 商业背景：明确商业产品推广
- 关联资料：https://www.typeui.sh/micro-interactions

### 12. motion tokens — @pegecoelho

- 原帖：https://x.com/pegecoelho/status/2117625345679487351
- 发布时间：2026-11-03T22:30:00+08:00（Asia/Taipei）
- 短摘录：> Every transition tells the user where something came from, where it went, and why it happened.
- 摘要：产品动效设计师分享GoalCard案例的设计系统与motion tokens，并解释token应承载状态关系。
- 证据：公开原作者文字；演示视频未观看
- 机制：token不仅是时长曲线，还包括用途、来源去向与语义。
- 流程帮助：建立feedback、disclosure、navigation、direct-manipulation等语义槽；每槽绑定中断、输入方式与替代模式。
- 局限：只读原帖完整note；未找到并打开其GoalCard下载链接，token文件与视频未核实。
- 商业背景：明确设计服务获客CTA
- 关联资料：原帖未提供可独立打开的一手文章/源码链接；不猜地址。

## 深读的一手资料与验证结论

以下链接本轮已成功打开（GitHub仅内置工具有限读取README与一份手势文档；未克隆）：

- https://github.com/emilkowalski/skills — README确认prototype、break-ui、remove/improve/review/performance、gestures等分工；不是效果验证，也未安装。
- https://github.com/emilkowalski/skills/blob/main/skills/gestures/SKILL.md — 原作者方法文档：跟随与松手两阶段、释放速度、同一进度驱动遮罩、focus trap与Escape。其“所有CSS keyframes都不能中断”等绝对表述不提升为平台事实；采用可测验收规则，不照抄绝对结论。
- https://emilkowal.ski/ui/agents-with-taste — 审美决定写成有理由的规则、情境表、选择树；文中300ms等是作者启发式而非通用标准，blur/will-change建议也不能一律照用。
- https://emilkowal.ski/ui/you-dont-need-animations — 用途、使用频率、输入方式决定是否动；高频/键盘操作应优先直接响应。课程推广背景已知。
- https://motion.dev/docs/svelte — 明确描述状态反向保留当前值/速度；Svelte附件示例需要5.29+，并说明没有官方Svelte组件API。未知Nomi技术栈，不能据此引入。
- https://motion.dev/docs/react-accessibility — reducedMotion=user会关闭transform/layout而保留opacity/backgroundColor；可自定义替代，处理自动播放与视差。不是焦点、语义或读屏的完整合规方案。
- https://developer.chrome.com/docs/web-platform/view-transitions — SPA/MPA共同快照模型；跨文档需同源并双方opt-in。不要从单一浏览器文档推断Nomi目标兼容。
- https://developer.chrome.com/docs/web-platform/view-transitions/same-document — 新transition会让旧transition跳到终态；重复name可能跳过；skipTransition不跳过DOM更新。长异步等待会冻结页面，网络获取宜在transition之前；ready失败不应等同业务失败；支持特性检测与替代。错误的旧路径same-document-view-transitions本轮404，已修正为此有效URL，不纳入来源集。
- https://www.typeui.sh/micro-interactions — 已见按按钮、输入、选择、弹窗、提示、toast、步骤、列表、slider、卡片分类；包括undo、promise toast、drag-linked backdrop、unsaved/focus等任务。113为站方自述，非独立逐项清点；提示词有解锁门槛。
- https://animate-ui.com/ — 官网确认原语/AI审查方向。没有实测其可访问性或许可证。
- https://www.craftui.space/ — 官网确认shadcn/ui、Tailwind与Motion组件定位。未据营销宣称背书“production-ready”。

## 建议放进七闸之内讨论的决策问题

这些是研究合成提案，尚非 Nomi 批准规范；不把某个作者的偏好当硬性标准。它们不是 [`docs/design/page-design-process.md`](../../design/page-design-process.md) 的第八道闸，也不替代那七道闸。页面交付仍走七闸；下表只讨论交互契约。

| 门 | 必须回答 | 产物/不通过条件 |
|---|---|---|
| G0 产品与任务 | 产品平台、受众、高频任务、真实状态和品牌边界是什么？ | 未知时只定机制，不定风格/库。先补Nomi定位与技术信息。 |
| G1 动效必要性 | 动效解释反馈、来源去向、层级，还是仅装饰？频率与键盘操作是否使其烦人？ | 删除/保留/品牌时刻三档；不能以“更高级”为唯一理由。 |
| G2 状态连续性 | 同一对象如何从A到B？取消动画与取消业务是同一回事吗？中断后保留速度、跳终态还是回滚？ | 状态图+中断策略；快速A→B→A、返回、并发结果不会错落状态。 |
| G3 语义motion契约 | 每个用途的曲线/物理参数、方向、跟随值、使用频率、触发输入、替代模式是什么？ | 少量语义槽而非散落魔法数；不预设Nomi统一具体时长。 |
| G4 等价可操作性 | 键盘、触摸、pointer、reduced-motion各自如何完成任务？ | 焦点进入/退出、Escape、可见焦点、读屏结果反馈、取消/撤销、无动效版本；缺项不进入最终评审。 |
| G5 真实原型对照 | 能否用同任务同数据比较无装饰基线与一个增强机制？ | 真实长内容/空态/失败/慢网/连点；优先任务成功率、错误、可操作等待、主观打扰，不先看炫酷。 |
| G6 工程与权利 | 是否只是参考机制，还是复制代码、安装依赖？版本、支持平台、许可、维护成本如何？ | 性能trace与目标设备测试、特性检测/回退、出处和许可；不从原帖“60fps”放行。 |

### 一条操作的motion契约模板

任务与用户目标 → 基线状态/目标状态 → 即时反馈 → 真实异步结果 → 动效用途 → 输入方式 → 是否可中断及策略 → 来源/去向与焦点去向 → 慢网/失败/返回/取消/撤销 → reduced-motion等价版本 → 语义token → 参考证据与未证实项 → 可运行测试。

### AI协作的更具体顺序

1. AI先列问题、检索任务机制，不产视觉；研究者给每条证据标文字/截图/视频/实测/源码。
2. 人选主要机制，说明拒绝哪些表面效果。再让AI产状态图与motion契约。
3. AI做无装饰基线、单机制增强版、调参工具和真实数据种子；并排而非先后凭记忆比较。
4. 人实际任务测试，再让AI按契约审查缺陷，不让AI以自己的截图自评“顶尖”。
5. 对稳定机制固化为组件规范及AI规则；每条规则保留用途、例外、来源、测试，而非直接安装网上所有skills。

### 和transitions.dev研究流的接口

将其示例按任务/输入/状态变化/中断策略/替代模式/许可整理进相同证据卡；X用于发现与作者设计意图，官方文档用于API约束，真正原型用于证实行为。三种来源不能互相替代。此轮未声称transitions.dev已经具备任一机制或授权。

## 视频核对与纠正（v1.2）

证据标签统一为 **secondary video-analysis observations**：由协调研究流回传，整合者未独立运行演示、设置网络或调查实现。不能推断 60fps、技术栈、spring 参数、OS 联动或生产无障碍支持。

### 2112906836173300065

- 原帖：https://x.com/motiondotdev/status/2112906836173300065
- 媒体：https://video.twimg.com/amplify_video/2112905862817673216/vid/avc1/960x720/6eM2sEGLTOrywRpn.mp4
- 看到：用户主动点设置/魔法棒选择 Adapt for reduced motion。 正常版方块水平位移；替代版起点淡出、目标淡入。
- 未证实：未展示系统主动警告。 未展示 OS 设置联动。
- 纠正/适用边界：作者的缺失提示机制属于文字声明；录像只证实主动选择替代方案，不能据此证明自动检测或无障碍合规。

### 2114089753452937464

- 原帖：https://x.com/westonruter/status/2114089753452937464
- 媒体：https://video.twimg.com/amplify_video/2114087908215013376/vid/avc1/1346x720/GnfLYgA2Bch2FRQc.mp4?tag=14
- 看到：Before 点击出现白屏闪烁。 After 黑色侧导航和顶部工具栏保持稳定，只有主内容区 cross-fade。
- 未证实：未展示慢网设置。 未展示中断或显式等待状态。
- 纠正/适用边界：原帖的 Slow 4G 是作者声明，不能算本次独立慢网验证；不据录像断言 SPA 或动画本身解决网络等待。

### 2116435252318961852

- 原帖：https://x.com/Nil_phy_dreamer/status/2116435252318961852
- 媒体：https://video.twimg.com/amplify_video/2116162908027502592/vid/avc1/1412x720/uFSKkR9JKRAs0Xh_.mp4
- 看到：点击照片放大居中，邻居平移，标题上移。 View/Close 随指针变化。
- 未证实：无法确定动画中途反向。 未展示键盘、触摸或 reduced-motion。
- 纠正/适用边界：可中断 spring、多输入、60fps 等仍是未验证作者声明；不能由录像确定实现栈或 spring 参数。隐藏系统光标不推广为默认生产方案。

## 文件

posts.json、posts.csv为精选12条短摘录与原创分析；search-method.json为检索元数据；media-review.json 为二手视频观察与来源清单，已去除本机绝对路径，未打包媒体。没有授权重新分发第三方媒体/代码，也没有自动抓取或安装依赖方案。

## v1.2 整合说明

配套规范：[Nomi 设计工作法 v1.2](https://cursor.com/canvas/store-00762119-eb30-452e-aa01-a97199c2c1d7/6f161e79-710e-4bc3-956d-4e7678cba62c)。JSON/CSV 保留原始声明、短摘录与采集字段，新增独立视频观察字段；旧 kaolti 十条不改。项目许可不由 X 帖子授予，不将 Animate UI、CraftUI 或 TypeUI 的宣传转为开源许可批准。

入库交叉引用：本整合者写到这里时未读 `docs/design/page-design-process.md`。入库时已写明，页面七闸仍是交付流程，本文的决策问题只作补充，不替代七闸，也不另开第八道闸。Nomi 产品与代码未审阅，Refero 等待授权。
