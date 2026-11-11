# 开源交互参考研究与接入方案

研究日期：2026-11-09，Asia/Taipei（UTC+08:00）。配套规范：[Nomi 设计工作法 v1.2](https://cursor.com/canvas/store-00762119-eb30-452e-aa01-a97199c2c1d7/6f161e79-710e-4bc3-956d-4e7678cba62c)。本文件与 design-process.md 是文档 PR 补充；入库后以仓库 Markdown 为维护主版本。

## 1. 结论与调查范围

不是找到十个库一起安装，而是建立四层参考：**交互机制配方 → 动画能力 → 可访问行为基础 → 验证工具**，外加统一 token。默认不新增运行时依赖；现有组件与 CSS 足够时不引入新库。

本轮通过内置 GitHub 工具读取十个公开仓库的身份、说明、许可证元数据和推送时间；深入七项，实际读取其 README、LICENSE 与官方资料。没有克隆仓库、运行 demo、检查深层实现、扫描 Nomi、安装依赖或自动化工具。已访问分享的官网文档；仓库链接由本轮成功读取核实。README 中的性能、可访问性与生成能力属于作者声明，不是独立测试结论。本文件保留开源项目独立核查边界；新一轮 X 与三条二手视频观察已整合到配套 design-process.md 第 12 节及 ../research/x-motion/（实际路径 docs/research/x-motion/），不把录像观察冒充开源实现测试。

**Nomi 的技术栈、真实核心任务、当前组件、依赖及品牌仍未审阅。Refero 等待授权，未访问。** 以下适配意见均有条件，不是生产选型批准。

## 2. 核心项目：Transitions.dev

- Owner/repository：[Jakubantalik/transitions.dev](https://github.com/Jakubantalik/transitions.dev)
- 官网：[transitions.dev](https://transitions.dev/)
- [README](https://github.com/Jakubantalik/transitions.dev/blob/main/README.md)
- [LICENSE](https://github.com/Jakubantalik/transitions.dev/blob/main/LICENSE)
- [网站完整条款](https://transitions.dev/terms.html)
- 本次 GitHub `pushed_at`：2026-11-08 19:03:05 Asia/Taipei；未归档。这是仓库推送活动，不等于稳定版本发布或维护承诺。

### 实际定位与声明技术

README 称它是交互式 CSS transition 集合，每张卡提供便于复制的片段；有语义 CSS custom properties、`t-*` 命名空间与 `prefers-reduced-motion` 保护，也提供 CLI 与 agent skill。仓库主要展示是 HTML/CSS；部分条目有 React/CSS/TypeScript。其生成式 reveal skill 声称有框架无关运行时；Refine 涉及本地 relay、页面注入与编辑器代理连接，不能把整个项目归结为“零运行时 CSS”。

首页现在还包含 Motion Agent、Builder、付费条目。README 内有 12 条介绍表、18 条生成文件说明，官网则写 43+；这几个数不是同一公开免费库存的核实结果。应按具体条目与版本判断可获得内容，不从总数推断。

### 许可：必须按目录与内容分开

1. **Transitions 与 skills 是自定义许可，不是整库 MIT。** 允许在个人/商业产品中复制、修改和交付；禁止把库或实质集合重新包装为竞争性 transitions 库、动效包或套件。因有再分发限制，不把它归入普通宽松开源片段库。
2. **Tooling 为 MIT。** LICENSE 列出的 agent/、cli/、cli-legacy/、refine/、build/、scripts/ 等目录受 MIT 条款约束，保留相关版权/许可声明。
3. **网站设计、品牌与 logo 明确保留权利。** 查看网页不意味着能复制它的视觉资产。
4. 免费 transitions/skills 在仓库中无需方案，公司也可按相应许可使用。Pro 内容有权益边界；LICENSE 区分个人 Pro 与公司/组织 Business、按使用者席位；商业模板/主题复用另有方案、范围和保留注释条件。
5. 网站对 Agent 托管修复、CI 自动化、自有模型密钥自动运行等另有服务方案条款。不能从工具目录 MIT 推导所有服务、recipe 或付费功能无条件开放。真正接入前逐项确认；冲突或不清楚的使用方式停在参考层。

### 怎样用、什么不做

- 优先提取 **状态文字切换、弹层来源关系、spinner 到确认状态、内容占位到实际内容** 的机制与约束，再在我们的组件中重构。
- 可复制 CSS 不代表自带完整业务状态、键盘、焦点、取消竞态或可靠退出；错误摇晃也不能代替可读错误信息。
- 不把“生成式 reveal”当真正生成进度，不为了演示动画延迟已到达的结果。
- 不安装其 skill、Refine 或 Agent，不启用评分合并门。外部 skill 是待审阅的第三方指令，不能直接变成团队规范。代码扫描评分只检验工具自己的规则，不证明体验好或适合品牌。

## 3. 深入比较的七个项目

以下“可考虑依赖”仅指满足平台、许可和验证门槛后可以评估，不代表本次推荐立即引入。

### 3.1 Transitions.dev — 机制配方/参考

详见上节。默认作为参考包；具体免费片段可在确认许可与版本后进入隔离原型。对于非 Web 平台，只迁移状态/连续性的思想，不能直接移植 CSS/React。

### 3.2 Motion — 需要复杂编排时的运行时候选

- 仓库：[motiondivision/motion](https://github.com/motiondivision/motion)
- [README](https://github.com/motiondivision/motion/blob/main/README.md)；[MIT LICENSE.md](https://github.com/motiondivision/motion/blob/main/LICENSE.md)
- 官方文档：[JavaScript quick start](https://motion.dev/docs/quick-start)
- 推送：2026-11-08 22:12:58 Asia/Taipei；未归档。
- README 声明支持 JavaScript、React、Vue；包含弹簧、手势、布局变化、滚动关联与时间线。核心仓库 MIT，复制或分发实质部分保留版权和许可。
- Motion+ 的示例源码、UI、扩展 API 与服务有独立付费边界；**核心 MIT 不等于整个网站/所有 examples 可自由复制**。
- 条件化适用：确实需要多对象编排、布局连续性，且现有平台/依赖能兼容。普通按压/淡入淡出用现有 CSS 即可时，不值得增加运行时。
- 生产前检查：受控状态、动画中反向、退出与组件卸载、减少动效、包体和输入响应。文档的体积/加速描述不作为我们产品的实测预算。
- AI 使用方式：先读与所选平台匹配的文档，再锁定具体版本；不要把 React 代码塞到 Vue 或把 JS 示例误当组件。README 公布了文档 MCP、llms.txt 与 AI Kit，存在性来自官方声明；本轮未连接、安装或测试。

### 3.3 AutoAnimate — DOM 增删/移动的局部过渡

- 仓库：[formkit/auto-animate](https://github.com/formkit/auto-animate)
- [README](https://github.com/formkit/auto-animate/blob/master/README.md)；[MIT LICENSE](https://github.com/formkit/auto-animate/blob/master/LICENSE)
- [官方文档](https://auto-animate.formkit.com/)
- 推送：2026-11-08 00:55:06 Asia/Taipei；未归档。
- 基础能力为 JavaScript，文档列多个框架适配；对指定父元素的直接子节点新增、删除、移动触发动画。官方说明会尊重减少动效设置，但仍需验证应用组合。
- 条件化适用：列表重排、筛选结果变化、错误提示加入等局部布局变化。不适合用作业务状态机或复杂全流程编排。
- 文档明确指出 parent 可能被设为 relative，部分 flex-grow 场景不能立即测得目标尺寸；这类限制比“单行代码”宣传更应进入选型卡。
- 动画不处理删除后的焦点去向、虚拟列表身份、异步结果新旧顺序；这些仍需工程规格。优先隔离父容器，避免全局开启。

### 3.4 Radix Primitives — React 行为基础，不是动效皮肤

- 仓库：[radix-ui/primitives](https://github.com/radix-ui/primitives)
- [README](https://github.com/radix-ui/primitives/blob/main/README.md)；[MIT LICENSE](https://github.com/radix-ui/primitives/blob/main/LICENSE)
- [官方 introduction](https://www.radix-ui.com/primitives/docs/overview/introduction)
- 推送：2026-10-15 05:52:47 Asia/Taipei；未归档。
- React 无样式低层组件，官方重点包括 ARIA、键盘、焦点与可组合部件，可逐步采用。
- 条件化适用：Nomi 若为 React Web 且现有弹层/菜单等存在明确行为缺口，可评估。已有可靠实现则不要为了动画重换底层。
- 不适用：不能直接当原生/Vue 组件；无样式不等于已有品牌设计；接入也不自动意味着整条任务符合 WCAG。
- 组合复测事件、portal、退出动画与焦点恢复。若多包引入，按官方建议协调版本，避免重复依赖。

### 3.5 React Aria — 交互与国际化基础

- 代码所在仓库：[adobe/react-spectrum](https://github.com/adobe/react-spectrum)
- [README](https://github.com/adobe/react-spectrum/blob/main/README.md)；[Apache-2.0 LICENSE](https://github.com/adobe/react-spectrum/blob/main/LICENSE)
- [React Aria 官方文档](https://react-spectrum.adobe.com/react-aria/index.html)
- 推送：2026-11-07 09:04:58 Asia/Taipei；未归档。
- 仓库包含不同产品：React Spectrum 是 Adobe 视觉系统实现，React Aria 是无样式 React 组件/hooks；不要混为一套固定品牌皮肤。
- 官方描述触屏、鼠标、键盘、辅助技术、国际化支持以及组件状态/slots，适合在行为层与表现层之间建立清晰分工。
- 条件化适用：React Web 的复杂选取、日期、表格、国际化或弹层行为需求，且现有基础确有缺口。
- 默认与 Radix 比较已有兼容性后选其一，不为同一控件叠两套焦点与事件管理。非 React 不直接移植。
- Apache-2.0 复用应保留许可证及适用归属声明，分发修改应标示，相关 NOTICE 若存在需处理；商标/网站图片不因此获授权。

### 3.6 Playwright — 把行为规格变成可复现证据

- 仓库：[microsoft/playwright](https://github.com/microsoft/playwright)
- [README](https://github.com/microsoft/playwright/blob/main/README.md)；[Apache-2.0 LICENSE](https://github.com/microsoft/playwright/blob/main/LICENSE)
- [官方 emulation 文档](https://playwright.dev/docs/emulation)
- 推送：2026-11-09 01:10:30 Asia/Taipei；未归档。
- Web 浏览器测试与自动化，README 声明 Chromium/Firefox/WebKit，主要 JS/TS 及其他语言入口。它属于验证层，不是产品动效运行时。
- 官方文档提供视口、触屏、减少动效、强制颜色等模拟；可用于选定原型的连续开关、状态可见性和取消/错误路径测试。
- 浏览器模拟不是实际手机，自动测试不能替代读屏实测、真实用户观察、能耗或真实访问 INP。测试证据里要注明模拟环境。
- 条件化适用：确认是 Web、已有测试设施或工程允许后评估 dev dependency。原生 App 不默认适配。本轮未安装或启动其 CLI/MCP。

### 3.7 Open Props — token 层的参考，而非重做品牌

- 仓库：[argyleink/open-props](https://github.com/argyleink/open-props)
- [readme.md](https://github.com/argyleink/open-props/blob/main/readme.md)；[MIT LICENSE](https://github.com/argyleink/open-props/blob/main/LICENSE)
- [官方文档](https://open-props.style/)
- 推送：2026-10-12 07:53:54 Asia/Taipei；未归档。
- CSS variables，覆盖大小、字体、缓动、动画等，也提供 JSON/JS 等格式。适合作为命名、分级、语义别名的研究参考。
- 条件化适用：已有 token 中存在可验证缺口时，选择少量映射或许可允许的片段；不整库加入一套竞争变量，更不直接把 normalize/reset 盖到现有产品。
- 网站列出的 duration 是该项目建议，不是跨产品标准。特殊构建、custom-media 等需要对应工具/浏览器支持；不能把所有示例认作原生 CSS 无配置可用。

## 4. 另外三项初筛与不优先采用理由

| 仓库 | 本次证据与推送时间（Asia/Taipei） | 当前处理 |
| --- | --- | --- |
| [juliangarnier/anime](https://github.com/juliangarnier/anime) | 描述为 JavaScript animation engine；元数据 MIT；2026-11-03 06:25:55；未归档 | 作为时间线/编排替代候选；没有再深读 README/LICENSE，不作采购或复用批准；不与 Motion 为同一需求重复引入 |
| [darkroomengineering/lenis](https://github.com/darkroomengineering/lenis) | 描述为 smooth scroll；元数据 MIT；2026-10-30 00:59:23；未归档 | 只有明确滚动体验需求时再查文档与许可；默认保留原生滚动，不为“高级感”改全局滚动 |
| [animate-css/animate.css](https://github.com/animate-css/animate.css) | 元数据 Other；实读 [LICENSE](https://github.com/animate-css/animate.css/blob/main/LICENSE) 为 Hippocratic 2.1；2024-07-30 03:34:21；未归档 | 包含人权用途与法律/仲裁等条件；不是普通 MIT，暂不列入宽松开源依赖。推送较旧是复核信号，不足以断言无人维护 |

维护时间均来自本次仓库 `pushed_at`，不是最新 tag、已发布 npm 版本或安全维护承诺。此次未作发行历史与供应链全面审计，不声称存在某个“最新稳定版”。

## 5. 固定接入流程与新增决策门

### 默认顺序

输入任务 → 搜索机制 → 建证据卡 → 选择一个机制 → 隔离小原型 → 映射现有 token/组件 → 边界、性能、无障碍验证 → 人审 → 才评估入库。

1. **可读门：**仓库身份、URL、具体内容、日期与证据范围可靠。README 声明不标成亲自测试。候选不因星数或展示漂亮进入依赖清单。
2. **可用门：**锁定 repo/path/tag 或 SHA；核对该版本、该目录和具体资产许可；付费访问不绕过。MIT 代码、网站素材、收费例子及服务条款分开。未知就不复制。
3. **适配门：**小原型使用我们的状态语义、内容与组件；不复制 demo 的布局、品牌和无关依赖。来源 motion token 映射为现有语义 token。优先 CSS/现有能力，再考虑单一运行时。
4. **生产门：**工程确认框架、包体、服务端/客户端边界与卸载；设计确认连续性与调性；测试确认取消竞态、键盘、触屏、减少动效、慢网/错误和低性能条件；指定维护人与移除方案。
5. **推广门：**真实任务无关键回归，证据支持再归并进现有组件目录。同一组件保持一个行为所有者和一个表现方案；不跨页拼贴不同库的默认风格。

### 参考包与实现包分开

- **参考包：**链接、机制说明、自己的观察、状态表、许可摘要与未知。这里的研究文件就是参考包，不夹带第三方源码、截图或视频。
- **实现包：**在后续获准技术工作后，才包含实际采用片段、固定上游版本、许可副本/适用 NOTICE、修改说明、token 映射、测试、性能记录和回退。禁止把不允许再分发的整个集合一起 vendoring。
- 索引字段：`owner/repo`、规范 URL、内容路径、tag/SHA（未核实则留空）、采集日期、任务、组件、起止状态、触发、输入方式、机制、技术栈、依赖、许可范围、付费边界、来源声明/亲自观察、适用与不适用、维护线索、验证结果、批准人。
- 去重键：repo + path + version + mechanism。同一条目的 React/CSS 展示是相关变体而非两个独立证据。升级不悄悄覆盖旧记录；保留版本差异和重新验证结论。
- 研究检索词：`text state swap reduced motion`、`modal open close focus restore`、`list reorder preserve identity`、`pending success cancel`、`pointer cancellation touch`；根据实际平台加 CSS/React/Vue/native，不把不兼容样例混进实现上下文。
- AI 每次输入先给产品 brief、组件/token 版本、状态规格和选定证据卡；要求先提出映射与差异，不直接运行 README 安装命令。外部 skill/Agent 需审核指令、脚本、写权限、网络/模型数据流、自动化边界，再决定是否采用。

## 6. 两个未启动的具体试点

### A. 提交输入到明确结果

通用任务而非声称 Nomi 已有功能。参考 Transitions.dev 的文字状态或 spinner→check 机制，默认现有 CSS/组件。先做 Editing/Pending/Partial（适用时）/Success/Error/Cancel requested/Cancelled 的状态规格；成功只由真实确认触发，超时结果未知不得称已失败。产物是中性原型、变量映射、对照与测试记录。

退出条件：连续触发不重复副作用，动画中反向不播放过期结果；错误保留输入；取消语义真实；键盘与减少动效仍清楚；不为动效延后结果；与无动效基线对照无关键回归。尚未写代码、运行或测得任何改善。

### B. 弹层完整开关与焦点闭环

先用现有组件，不存在可靠行为时才在 React Web 条件下比较 Radix/React Aria；只选一种基础。借鉴同一个开关机制，不混入多套默认材质。产物是状态/焦点表、小原型与用例矩阵；可后续评估 Playwright 测试支持。

退出条件：打开后焦点合理、关闭返回触发处、Escape/点击行为符合规格、连续开关不残留遮罩、触屏和减少动效可用、长内容与滚动正确。真机/读屏仍需人工验证；浏览器模拟不能替代。

## 7. 许可归档与证据缺口

本报告只写原创分析和真实链接，不打包他人代码、截图、视频或付费资产。许可摘要不是法律意见或许可授予；实际复制时保存所用版本的许可证、版权、适用 NOTICE 与变更记录，检查传递依赖及第三方资产。不能把仓库总 LICENSE 外推为整个官网内容许可。

继续保留既有来源限制：Scroll Shaders 禁止其 items 进入 AI datasets、训练、微调或评测；Scrolltide 禁止再分发其模板/提示词集合并限制营销预览再利用；Footer/CTA 截图再用许可未核实。本轮不获取它们的受限内容。

尚未验证：Nomi 平台/组件契合度、实际代码行为、上游具体版本兼容、包体/渲染/能耗、完整辅助技术支持、安全/漏洞与发行历史。发布前按具体采用项另做有限深审或交工程调查；不为这些未知安装所有候选。

研究采集时未改产品代码、未引入依赖、未创建自动化、未启用付费服务。入库后本文件只作参考，不由此启动产品审阅或试点。

## v1.2 交叉引用

新一轮 X 研究见 [research.md](../research/x-motion/research.md)；统一工作法见 [design-process.md](design-process.md)。本文件的七个深入项目与三项初筛不因视频核对自动升级为生产批准。页面交付仍以 [page-design-process.md](page-design-process.md) 的七闸为准。本文的接入顺序和决策门是参考研究，不替代七闸，也不另开第八道闸。本研究者写本文时未读那份规范；入库时补了这句。不启动产品审阅。
