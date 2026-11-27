# 方向检查：拍板图与真屏差异量具类根因复盘（RW · G-6）

> 状态：📋 方案待拍板

- **触发**：PR `#1692`（协作看板 `#1586` · C-0）经首轮实现（`5bd75b468` / `d9fde1c2e`）与次轮修补（`867e08513` / `7b633f7da`）后，第 2 轮审查（`#1692#issuecomment-7200500469`）再次不通过（累计要进第 3 轮修补），且触及自写登记 `gate-family`（`docs/engineering/self-written.json:1620-1655`，状态 `under-review`）【已核实】。
- **用户原话与约束**：「先做量具再一次改完」（模型设置页 `#1665` 先有一把能算出「拍板图和真屏差在哪」的尺子，再照差异清单一次改完）；另外两处图文矛盾用户已定「都照图」【已核实：协作看板 `#1586#issuecomment-7201316929`】。

**这一处的全图在哪**：`表外`（核对 `docs/engineering/seams.json:3-133` 的 8 条交接处均未覆盖拍板对账链路【已核实】）。本处全图链条如下：

`Claude Design 拼页板源（source/*.dc.html + preview/<Board>.html，同页含 Main / M1-dark / M1-en 等多画板）` → `scripts/board-extract.mjs（按整页 DOM 顺序抽局部候选 ID → <Board>.candidates.json）` → `<Board>.board.json（elements[].candidates 跨画板扁平并集认领 + 元素级 states + 偏差 decisions）` → `采集驱动 + scripts/board-diff-page.mjs:readSurface + scripts/board-diff.mjs:pairCandidates（单画板 rootSelector 对比单轨真屏 → *.diff.json）` → `scripts/board-diff-report.mjs（令牌吸附 snapped + 文本折叠 comparisonText → differences）` → `scripts/board-diff-evidence.mjs + scripts/check-board-parity.mjs R4（离线核构建 SHA、分轨覆盖、批准抵消与 launchBase 历史欠账）`【已核实：`scripts/board-extract.mjs:44-66`、`scripts/board-diff.mjs:27-173`、`scripts/board-diff-evidence.mjs:78-156`】。

### 0. 一句话根因

把**多画板探索原型的局部 DOM 节点树**当成了跨语种/跨主题通用的 1:1 生产实现契约，又把**启发式诊断尺子**直接焊成**静态 JSON 离线的全仓发版硬门岗（R4）**——中间缺「元素 × 画板分镜（状态轨）→ 显式锚点与受检属性契约」这一层，导致每降一处噪就放出假绿、每收紧一处门岗就误拦合规实现【已核实：`scripts/board-diff.mjs:27-126`、`scripts/board-diff-evidence.mjs:92-155`】。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| `d9fde1c2e` 首轮实测 277/279 条高噪（`x/y` 54 条、容器 `width` 23 条、`parentPadding*` 55 条、继承字型、示例数）【已核实：`d9fde1c2e` 双轨 `*.diff.json`】 | `5bd75b468`（`scripts/board-diff-report.mjs:331-335`）对所有节点无差别比绝对坐标、流式宽度与继承属性；子字号一变兄弟全连坐【已核实】 | A. 原型 DOM 误当视觉契约（量具高噪） |
| 审查 R1-P1a（`#7197178975`）：真屏改坏或只手改 `sourceSha256` 仍吃旧收据判绿【已核实：`5bd75b468` `scripts/board-diff-evidence.mjs:78-86`】 | 收据未强制校验 `screenRevision`，未把读数绑定到待验实现版本【已核实】 | C. 离线收据自报元数据当真（假绿） |
| 审查 R1-P1b（`#7197178975`）：声明 `zh-en` + `dark` 只交中浅单轨收据仍绿【已核实：`5bd75b468` `scripts/board-diff-evidence.mjs:88-95,114-117`】 | R4 把全部收据合成单一候选集合，未按声明状态轨分轨核覆盖【已核实】 | B. 画板候选与状态轨错层（假绿） |
| 审查 R1-P1c（`#7197178975`）：`decisions` 批过 `600→700` 后真屏变 `800` 或换轨仍绿【已核实：`5bd75b468` `scripts/board-diff-evidence.mjs:99-100`】 | 偏差批准只匹配 `candidate + property`，未绑定双边原值与轨道【已核实】 | C. 豁免口径过宽（假绿） |
| 审查 R1-P1d（`#7197178975`）：删 `<button>` 留同文普通 `<span>` 仍自动配对判绿【已核实：`5bd75b468` `scripts/board-diff.mjs:55-59`】 | 唯一文本配对只比折叠字面，未核交互角色 `role`【已核实】 | A. 启发式 DOM 配对失真（假绿） |
| 审查 R1-P1e（`#7197178975`）：旧候选改样式或改 12 字截断后文案仍享欠账豁免【已核实：`5bd75b468` `scripts/board-diff-evidence.mjs:114-117`、`scripts/board-extract.mjs:35-37`】 | 历史欠账只认截断式候选 ID，未对比 `candidates.json` 完整快照【已核实】 | B. 候选身份不稳定（假绿） |
| 审查 R1-P2（`#7197178975`）：无画布的纯清单板（`manifestOnly`）新元素永远无法标 `implemented`【已核实：`scripts/board-diff-evidence.mjs:136-139`、`scripts/check-board-parity.mjs:685`】 | R4 强绑 DOM 候选收据，未给 `manifestOnly` 留验收路径（`7b633f7da` 仍未解）【已核实】 | B. 画板候选与状态轨错层（死锁） |
| 首轮工程边界漏口（R2 确认修过的空快照、页面参数拼接、本地静态 HTTP 越界面，及 CI `check:concept-owners` 未登记）【已核实：`867e08513` `scripts/board-diff.mjs:147-188`、`7b633f7da` `delivery.board-diff-parity.json:1-27`】 | 初版自搭采集脚手架与门岗写口时漏接既有安全与概念归属约束【已核实】 | D. 采集与工程边界漏口 |
| **【前一轮修补 `867e08513` 带出】** 审查 R2-P1a（`#7200500469`）：双轨按各自画板实测完，R4 反报中文候选缺英文轨、英文候选缺中文轨【已核实：`scripts/board-diff-evidence.mjs:140-147`】 | 为修 R1-P1b，把元素级 `zh-en/dark` 硬摊给每个画板局部候选 ID（不知 `071-span-近7天花了` 与 `250-span-Last7days` 分属 `#Main` 与 `#M1-en`）【已核实：`ModelSurfaces.board.json:254-375`】 | B. 画板候选与状态轨错层（修补反噬误拦） |
| **【前一轮修补 `867e08513` 带出】** 审查 R2-P1b（`#7200500469`）：「7 天内可退」错变「30 天内可退」差异为 0、免拍板过关【已核实：`scripts/board-diff-report.mjs:69-72`、`Onboarding.board.json:1169`】 | 为消 `Image 24→26` 示例数噪音（反例 5），`comparisonText` 把全文所有 `\p{Nd}+` 一刀切抹成 `#`【已核实】 | C. 归一规则盲抹业务文案（修补反噬假绿） |
| **【首轮埋下、`867e08513` 分轨后放大】** 审查 R2-P1c（`#7200500469`）：走查未切语言/暗色，同份读数分标中浅与英暗即过关【已核实：`scripts/board-diff.mjs:130-131,164`、`scripts/board-diff-evidence.mjs:115-118`】 | 采集器与 R4 盲信调用方传参 `locale/theme`，未从真屏 DOM 读回实际语种与 `data-mantine-color-scheme`【已核实：`scripts/board-diff-page.mjs:19-20`】 | C. 离线收据自报元数据当真（假绿） |
| **【前一轮修补 `867e08513` 半截遗留】** 审查 R2-P2a（`#7200500469`）：中浅采新构建、英暗留旧构建合并算齐放行【已核实：`scripts/board-diff-evidence.mjs:99,115-119`】 | 修 R1-P1a 只验单文件 `validRevision` 十六进制格式，未锁多轨同 SHA 及当前待验构建【已核实】 | C. 离线收据自报元数据当真（修补半截假绿） |
| 审查 R2-P2b（`#7200500469`）：显式传 `--board-diff-results` 指向不存在文件仍报通过【已核实：`scripts/check-board-parity.mjs:1027-1044`】 | 迁走旧入口时 `main()` 未校验未知/废弃 CLI 参数，静默回退默认欠账逻辑【已核实】 | D. CLI 静默吞参（假绿） |
| **【前一轮修补 `867e08513` 带出】** 审查 R2-P2c（`#7200500469`）：收据与批准同填越界 `locale: "not-a-track"` 可抵消差异【已核实：`scripts/board-diff-evidence.mjs:100,125`】 | 修 R1-P1c 时只对 `locale` 做非空相等比较，未校验应用合法语言词表（`zh-CN`/`en`）【已核实】 | C. 离线收据自报元数据当真（修补反噬假绿） |
| **【原始证据与 `867e08513` 新机制暴露】** 真屏照图做成 `10px` 仍判 `off-scale` 红（33 条/轨），新增 `parts` 内格猜测把 `unmatched` 从 9 条推高到 16 条【已核实：`7b633f7da` `zh-CN.light.diff.json:3706-4453`】 | `designScales` 只认 Mantine 窄表（拒认拍板图自有 `2/7/10/14/18px`），`parts` 强求生产 React 复刻原型未认领包装 `div`（且 `unmatched` 禁批）【已核实：`scripts/board-diff.mjs:109-125`、`scripts/board-diff-report.mjs:59-60,100`】 | A. 原型 DOM 误当视觉契约（修补反噬误拦） |

### 2. 为什么这一类会一直出现

追到「量具把什么当成真」，四处地基同时错位：

1. **板上的值**：Claude Design 拼页预览（`ModelSurfaces.html` 含 `Main`、`M1-dark`、`M1-en`、`M1-narrow`、`M1-old-user` 等 18 格）混着两样东西——**拍板视觉意图**（圆角 10、字重 600、通边分隔线）与**探索原型的临时壳子**（随手套的 `.row/.col` 空 `div`、示意数 `Image 24`、Mantine 窄表外的 `10px/14px/18px`）【已核实：`docs/design/boards/2026-11-07-model-surfaces/ModelSurfaces.board.json:8-27,3121`】。量具反着信：把原型的空包装 `div` 和局部候选序号当成跨语种/跨画板通用的硬结构（配不上判不可批准的 `unmatched`，跨画板缺席判缺轨），却不信板上已获批的像素值（`078-div` 板 `10` = 屏 `10` 仍判 `off-scale` 红灯，违背用户「都照图」决定）【已核实：`zh-CN.light.diff.json:4319-4364`、`scripts/board-diff-evidence.mjs:122,140-147`】。
2. **真屏读回来的值**：`readSurface` 读了 27 项样式，唯独**不读真屏当前实际生效的语种与明暗主题**，反而拿调用方传进来的 `theme` 去造离线 shadow 调色板（`host.dataset.mantineColorScheme = theme`）【已核实：`scripts/board-diff-page.mjs:19-20`】；遇到英暗轨时，因 `#M1-en` 是浅色稿，驱动拿浅色 `#M1-en`（`boardTheme: "light"`）跨主题比暗色真屏，而真正的暗色拍板稿 `#M1-dark` 一次没量【已核实：`en.dark.diff.json:4-7`】。
3. **调用方传进来的参数**：静态收据架构让门岗与真浏览器脱节（为迁就 CI Contracts 无浏览器，`design-pipeline.md:101`），于是 `locale`、`theme`、`screenRevision`、CLI 旗标全靠「调用方自报」，离线 R4 无法自证收据真来自当前构建的对应状态轨【已核实：`scripts/board-diff-evidence.mjs:98-129`】。
4. **归一规则**：不在清单或走查入口显式声明「哪几个节点是动态造数」，而是靠全局函数 `comparisonText` 猜——不抹数字时示例数报警（第 1 轮），一抹 `\p{Nd}+ → #` 就把「7 天内可退 → 30 天内可退」的产品承诺抹掉（第 2 轮）【已核实：`scripts/board-diff-report.mjs:69-72`】。

#### 三条体验铁律（适用性说明）

| 铁律 | 类根因要回答的问题 | 本处适用性与最小证据 |
|---|---|---|
| ⑩ 说的=摆的 | 意图抽取写下的期望是否与草稿参数一致？ | 不直接适用：本处是仓库工程门岗与拍板样式量具（`scripts/`），不碰生成草稿参数【已核实：`docs/engineering/direction-check-template.md:45`】 |
| ⑪ 能选到 | 模型档案参数清单是否自动生成并覆盖各入口？ | 不直接适用：不碰模型档案与参数入口【已核实：`docs/engineering/direction-check-template.md:46`】 |
| ⑫ 点了=以为的 | 每个可点目标是否写了用户预期并记录点击结果？ | 边界互补：静态样式量具只管「长得像不像图」，不能替代 `design-pipeline.md:42` 与 ⑫ 的真实点击闭环；R1-P1d 曾把删掉的按钮当普通 `span` 放行，正是越界替代交互语义的表现【已核实：`scripts/board-diff.mjs:56-60`】 |

### 3. 不改结构的话，接下来会冒出什么（3 个可验证预测）

| 预测 | 怎么验证（命令或步骤） |
|---|---|
| 1. **就算 `#1665` 逐像素照图改到 100% 一致，标 `implemented` 时 R4 仍爆 187 条错死锁**（板上拍板值触发 42 条 `off-scale` + `#Main`/`#M1-en` 候选互缺对方语种轨 72 条 + `#M1-dark`/`#M1-narrow`/`#M1-old-user` 同元素候选未采 73 条；真屏只要少一层原型空 `div` 再加 32 条不可豁免的 `unmatched`）【已核实】 | 在 `#1692` 分支运行：`node --input-type=module -e "import fs from 'node:fs'; import { checkBoardManifest, boardEvidence } from './scripts/check-board-parity.mjs'; import { buildDiffReport } from './scripts/board-diff-report.mjs'; const d='docs/design/boards/2026-11-07-model-surfaces'; const m=JSON.parse(fs.readFileSync(d+'/ModelSurfaces.board.json','utf8')); const c=JSON.parse(fs.readFileSync(d+'/ModelSurfaces.candidates.json','utf8')); const p=f=>{const r=JSON.parse(fs.readFileSync('docs/evidence/2026-11-26-c0-board-diff/'+f,'utf8')); return buildDiffReport(r,r.samples.map(s=>({...s,screen:s.board,parts:[]})))}; m.elements.find(e=>e.id==='settings.account-card').status='implemented'; console.log(checkBoardManifest({board:'ModelSurfaces',manifest:m,candidates:c.candidates,evidence:{...boardEvidence(d,'ModelSurfaces'),reports:[p('zh-CN.light.diff.json'),p('en.dark.diff.json')]}}).length)"` → 输出 `187`【已核实】 |
| 2. **为修 R2-P1b 撤回 `\p{Nd}+` 折叠，会立刻打爆无锚点文本自动配对**（`board-diff.mjs:13` 配对共用 `comparisonText`：撤回后 `Image 24` 与真屏 `Image 26` 不只报 `text` 差异，未手绑 `data-board` 的含数字节点会直接变 `unmatched`；改写正则白名单则每逢新板单位词又开第 4 轮修补）【已核实】 | 将 `scripts/board-diff-report.mjs:71` 的 `.replace(/\p{Nd}+/gu, '#')` 删掉后跑 `node --test scripts/board-diff.node-test.mjs`：反例 5 与无 `data-board` 的动态计数文本配对立即转红【已核实：`scripts/board-diff.mjs:13,55-60`】 |
| 3. **真暗色拍板稿 `#M1-dark` 被浅色 `#M1-en` 顶替，暗色专属设计偏差漏检假绿**（驱动测 `en.dark` 时挂的是 `boardTheme: "light", boardRoot: "#M1-en ..."`；凡 `#M1-dark` 专调的暗色底色/边线层级均不在样本里）【已核实】 | 运行 `node -e "const r=JSON.parse(require('fs').readFileSync('docs/evidence/2026-11-26-c0-board-diff/en.dark.diff.json','utf8')); console.log(r.theme, r.boardTheme, r.boardRoot)"` → 输出 `dark light #M1-en ...`，`#M1-dark` 候选 `139..167` 覆盖数为 `0`【已核实】 |

### 4. 靶子独立性检查

- **尺子 / oracle 是否同线自写**：9 组必抓问题（§1.1–§1.9）来自派工单独立列出【已核实】；但 `scripts/fixtures/model-settings-board-diff.json` 的 50 条断言值由实现线从自身宿主 HIT 日志提取固化，且 R4 门岗单测由同一实现线编写【已核实：PR `#1692` 正文「验收证据」】。
- **「修对了反而掉分 / 被拦」的先例**：已发生两处【已核实】——① 实现线在 `scripts/board-diff.node-test.mjs:230-233` 测 `ModelSurfaces` 时手造单候选假清单 `{ candidates: ['052-div'], states: ['selected'] }` 绕开真实多画板清单，又在 `:369-382` 把「同一候选 ID 须跨全轨出现」错当正例锁进单测，导致真实双轨收据反而必红（R2-P1a）；② 真屏照拍板图做成 `paddingTop: 10px`（`078-div`、`083-div`），反而被 `off-scale` 判红【已核实：`zh-CN.light.diff.json:4319-4344`】。
- **结论**：靶子本身把「单页找茬尺子」与「跨画板候选离线门岗」混成了错靶子；动代码前须先改掉 `:369-382` 这条错靶子，改用真实多画板清单做基准。

### 5. 这一整块归谁（P0）

这一整块：拍板设计稿到生产界面的计算样式测量、视觉快照比对与拍板清单认领对账
归谁：通用浏览器样式断言与截图比对归已装的 `@playwright/test` `1.60.0`（`package.json:331`，https://playwright.dev/docs/api/class-locatorassertions 与 https://playwright.dev/docs/test-snapshots ）及仓内组件多态回归门岗 `scripts/check-design-lab.mjs:1`；Nomi 独有的拍板清单认领与逐态对照合同归 `scripts/check-board-parity.mjs:1` 与 `docs/engineering/design-pipeline.md:31`
我们哪里绕开了它：在 `scripts/board-diff.mjs:27-127`、`scripts/board-diff-page.mjs:52-156`、`scripts/board-diff-report.mjs:51-135`、`scripts/board-diff-evidence.mjs:16-156` 自写了约 600 行的跨异构 DOM 启发式配对器（LCA 容器反推、`parts` 未认领内格猜测、全文 `\p{Nd}+` 数字抹除）和 git 历史快照离线收据账本，绕开了 Playwright 显式 `locator` 断言与 `design-pipeline.md:31-33` 的「元素 × 画板状态 → 生产组件」显式对照表

- **自写登记 `gate-family` 说明**（`docs/engineering/self-written.json:1620-1655`）：`check:board-parity` 属 `gate-family`（`status: "under-review"`，`reviewBy: "2026-11-30"`）【已核实】。Playwright 截图比对与未装的 Storybook / Chromatic（https://storybook.js.org/docs/writing-tests/visual-testing ，`package.json:279-411` 未引入【已核实】）比的是同一组件前后两版渲染，答不了「拍板元素有无主人、推迟有无用户原话」这项 Nomi 流程约束，故 `check-board-parity.mjs` 结构检查暂留，在 `2026-11-30` 随 `gate-family` 门岗账本一并裁决去留；但**通用样式读取与断言不应在 `gate-family` 里再长出第二套自研 DOM 配对引擎**【已核实】。

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 选了以后同一类还会不会出现、从哪出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 在 `#1692` 上打第 3 轮补丁：为候选反查所属画板分镜再算元素轨覆盖、拆掉 `\p{Nd}+` 改为清单标注动态槽、从真屏实读 `lang` 与 `colorScheme`、锁多轨同 `screenRevision`、拒收废弃 CLI 参数、加 `locale` 词表，并修 `off-scale` 误拦拍板值与 `parts` `unmatched` 死锁。**模型设置页（`#1665`）怎么验收、要等多久**：须先等量具完成第 3–4 轮修补与再审（约 1–2 天【推测】），再跑隔离宿主重采双轨 + 补齐 `#M1-dark` 轨，并为原型空包装 `div` 逐个挂 `data-board` 或写 `decisions` 后才能标 `implemented`。 | 高（~600 行自写配对与收据账本继续膨胀；每张旧板迁入都要手工消解原型空 `div`） | **会**。继续从「Claude Design 原型临时 DOM 层级 ≠ 生产 React 组件层级」冒出：下一张板只要有文本合并、flex gap 替代 padding 或伪元素分隔线，仍会出 `unmatched` 死锁或归一假绿。 | 把「一次改完 `#1665`」拖成长期维护自研 DOM 等价引擎；`gate-family` 继续增重。 | 否 |
| 换一种做法 | 由实现线在合入前按「画板分镜 + 显式锚点」收口，接仓库已装的 `@playwright/test` `1.60.0`（`package.json:331`，https://playwright.dev/docs/api/class-locatorassertions ）：① **删掉** `scripts/board-diff-evidence.mjs`（静态 `.diff.json` 离线门岗与 511 元素欠账快照）、`parts`/LCA 猜测、全文 `\p{Nd}+` 折叠及 `board === screen` 时的 `off-scale` 报错；② 保留约 150 行纯读取助手供走查现场调用：在真实走查（如 `tests/ux/t6a-model-settings.walk.mjs`）里先用 Playwright `toHaveAttribute` 实核真屏 `lang` 与 `data-mantine-color-scheme`，再按画板分镜（`#Main`↔中浅、`#M1-dark`↔中暗、`#M1-en`↔英浅/英暗文案）对**显式锚定**节点比对确定性计算样式与精确文案（仅对调用处点名的动态计数字段豁免数字）；组件多态像素回归仍归既有 `scripts/check-design-lab.mjs:1`（不新装 Storybook/Chromatic）；`check:board-parity` R4 只核走查文件存在实测断言调用与 `design-pipeline.md:40` 并排图索引。**模型设置页（`#1665`）怎么验收、要等多久**：`#1665` **现在即可直接照 `#1692` 已核实的 9 组差异清单开工一次改完（0 等待）**；量具瘦身约半天（1 轮小改）【推测】，改完的 `#1665` 在 `t6a-model-settings.walk.mjs` 现场跑 `Main`/`M1-dark`/`M1-en` 三轨显式锚点样式核对 + 交三轨「拍板图 \| 真截图」并排图与真实点击核签，约半天内闭环。 | 中低（删掉约 2/3 自写配对与离线账本代码，零新依赖，保留后续新板的自动读板尺子） | **第 1 节 B/C/D 三类离线收据与文本盲折 bug 根绝**（无静态收据、无跨画板 ID 混算、无全局抹数字）；仅剩显式锚点漏挂这一处窄边界，由走查必含元素锚点列表直接拦住。 | 需在受测生产组件上挂稳定的 `data-board`（或复用已有 `data-model-*` 测试钩子），但本来走查定位就需要稳定选择器。 | **推荐** |
| 删掉 | **最小删除单位**：撤回 `#1692` 整套自动样式尺子与 R4 改动（删 `scripts/board-diff*.mjs` 4 个文件并还原 `scripts/check-board-parity.mjs` R4），仅把 `#1692` 本次实测产出的 `#1665` 差异清单当作一次性人工对账单保留；保留原有的 `check:board-parity` 清单认领门岗与 `design-pipeline.md` 并排图验收，存量 56 张板原样通过、零迁移。**模型设置页（`#1665`）怎么验收、要等多久**：**0 等待（最快，约 2–3 小时【推测】）**——直接照本次已算出的 9 组差异 + `$5.23` + `· 本机` 在 `#1665` 一次改完，在 `tests/ux/t6a-model-settings.walk.mjs` 用现成 Playwright `1.60.0` `expect(locator).toHaveCSS()` / `toHaveText()` 手写锁住这 9 组属性，交 `Main`/`M1-dark`/`M1-en` 并排截图与真实点击记录由独立验收线核签。 | 最低（净增代码 0，立解门岗阻塞） | 量具自身的配对/收据类 bug **不再出现**；但**下一张新板**（`Onboarding`、`M6-ai-policy` 等）回到靠人对照并排图手挑属性写 `toHaveCSS`，「漏看圆角/字重/`tabular-nums`」的旧漏检仍会从肉眼对图处重现。 | 满足了 `#1665` 本次「照清单一次改完」，但后续 17 张 `ModelSurfaces` 分镜与 `Onboarding` 缺少自动读板样式尺子。 | 次选（若优先极速结清 `#1665` 可选） |

### 7. 用户要权衡的核心

你只要判断：这把尺子后续还要不要用来自动量 `Onboarding`、画布模型选择器等下一批新板——**要复用**就选「换一种做法」（砍掉启发式猜 DOM 层级与离线 `.diff.json` 门岗，改成走查现场按画板分镜 + 显式锚点用 Playwright 实读对比，花半天收口换后续每张板都能自动量准）；**只为结清当前模型设置页（`#1665`）**就选「删掉」（零等待直接拿 `#1692` 已算出的 9 组差异清单今天一次改完，后续板靠并排截图 + 手写 Playwright `toHaveCSS` 验收）。

## 特征测试清单（动结构前先锁住）

- **已钉住的测试路径**（均在 `#1692` 头 `7b633f7da` 存在【已核实】）：
  - `scripts/board-diff.node-test.mjs`：覆盖配对角色校验、历史欠账快照失效、`#1665` 9 组真实差异重算（配黄金夹具 `scripts/fixtures/model-settings-board-diff.json`）、反例 4（子字号变化不连坐兄弟坐标）。**注意**：其中 `:369-382`（`同一候选须在声明的轨道上逐个出现`）与 `:264-271`（`comparisonText` 全数字抹除）锁住的是本次被判错的旧假设，动结构时须先替换为「按画板分镜核轨」与「保留『7 天内可退』业务数字」的反例【已核实】。
  - `scripts/check-board-parity.node-test.mjs`：覆盖 R1–R17 清单认领、边界表、同类产品先例、跨日期同名板【已核实】。
  - 既有板清单消费方回归：`src/workbench/generationCanvas/nodes/director/directorFunctionCensus.test.ts`、`tests/ux/reference-entry-board.test.mjs`、`tests/ux/whiteboard-refactor.walk.mjs`【已核实】。
- **尚未钉住、动结构前须先补的反例**（当前未锁原因：第 2 轮审查刚检出，`#1692` 停在 RW 待拍板【已核实】）：
  1. `7 天内可退` → `30 天内可退` 必须判红（不能被数字折叠抹平）；
  2. 真屏实际 `lang` / `data-mantine-color-scheme` 与声明轨道不符时必须拒收；
  3. 拍板图与真屏同为 `10px`（`board === screen`）时不得因 `off-scale` 判红；
  4. 多画板元素（`Main` + `M1-dark` + `M1-en`）按各自画板交齐对应状态轨即通过，不跨语种索要异画板候选 ID。

## 和原方案对照

对照对象：`#1692` 自带的 `docs/plan/2026-11-26-direction-check-board-diff.md`（为 `#1665` 第三次验收仍差 11 处所写，即催生 `#1692` 量具方案的原复盘；在首笔盲写提交 `134262a1c` 完成后首次读取【已核实】）。

### 1. 一致之处

- **全图归属与铁律边界一致**：两份复盘均核实 `docs/engineering/seams.json` 未覆盖拍板对账链（`表外`），均判定体验铁律 ⑩⑪⑫ 不直接覆盖静态样式对账，且视觉尺子不能替代真实点击验证（原方案 `:11,79-82`；本复盘开头与 `§2`）【已核实】。
- **旧 R4 失效判据与基础引擎选型一致**：均指出旧 `check:board-parity` R4 只搜断言名字符串、手挑维度必漏圆角/字重/`tabular-nums`/图标/英文文案，均选定复用仓内已装 Playwright 在浏览器内读计算样式、不引外部视觉 SaaS 或未装的 Storybook/Chromatic，且门岗同归 `gate-family`（原方案 `:54-69,108-138`；本复盘 `§5`）【已核实】。
- **`#1665` 可见差异靶标一致**：原方案列出的 A/B 类 9 组视觉与文案偏差（原方案 `:38-46`），经 `#1692` 实测与协调机复跑 `9/9` 命中印证【已核实】。

### 2. 不同之处及谁的依据更硬

| 对照维度 | 原方案（`2026-11-26`） | 本独立复盘（`G-6`） | 谁的依据更硬及原因 |
|---|---|---|---|
| **DOM 配对机制** | 主张自写配层，「配对靠候选文字，再加少量 `data-board` 标记」（`:136,151`） | 主张**砍掉跨异构 DOM 启发式配对**（LCA、`parts`、折叠字面自动配对），只对显式锚点比对（`§2, §6`） | **本复盘更硬【已核实】**：`#1692` 两轮实跑已证伪原假设——首轮无锚盒比对出 277/279 条噪音且删按钮留 `span` 假绿（R1-P1d）；次轮补 `parts` 内格猜测把不可批准的 `unmatched` 从 9 条推高到 16 条（`zh-CN.light.diff.json:3939-4453`），补 `\p{Nd}+` 文本折叠又把「7 天内可退 → 30 天内可退」抹成 0 差异假绿（R2-P1b）。 |
| **R4 门岗形态与多画板模型** | 设想「`implemented` 元素的候选必须出现在某张离线差异清单里」，并断言此后「A、B 类都做不出来」（`:145,152`） | 指出多画板拼页候选 ID 是画板局部身份，主张**删掉 `board-diff-evidence.mjs` 离线收据账本**，改在真实走查现场按「元素 × 画板分镜（`Main`/`M1-dark`/`M1-en`）」实读核对（`§0, §2, §6`） | **本复盘更硬【已核实】**：原方案 `:69` 虽看到 `settings.account-card` 有 121 个候选，`:152` 却仍按候选全集设计离线门岗；实测导致离线自报 `locale/theme/screenRevision` 屡出假绿（R1-P1a、R2-P1c/P2a/P2c），补分轨覆盖又立即触发跨语种候选互锁（R2-P1a）与 `#M1-dark` 漏测，连 `screen === board` 完全相等时仍爆 `187` 条 R4 错误（`§3` 预测 1）。 |
| **板上非窄表像素值的裁决** | 要求板值先吸附令牌，「吸附不上的，清单 `decisions` 里必须有一条」（`:150`） | 主张已拍板图的像素值即期望值，`board === screen` 绝不因 `off-scale` 拦实现合并（`§2, §6`） | **本复盘更硬【已核实】**：实测每轨 33 条 `off-scale`（含 `078-div`/`083-div` 拍板图与真屏同为 `10px` 仍判红，`zh-CN.light.diff.json:4319-4344`），证明在实现验收端罚拍板稿自有像素直接违背用户「都照图、一次改完」决定。 |
| **`#1665` 非样式遗留项覆盖** | 单列了第 10 项（`41 次` 与 `用量与单价` 间的点，C 类图文矛盾）与第 11 项（`data-first-seen` / `localStorage` 残留，D 类 P1 死状态）（`:47-48`） | 聚焦 `#1692` 量具与 R4 自身的 15 条故障，未展开 `#1665` 内部不可见状态残留 | **在 `#1665` 清理清单上原方案更硬（两者互补）【已核实】**：原方案直读了 `#1665` 代码，指出 D 类隐藏状态是任何视觉量具在原理上都测不到的盲区；`#1665` 执行「一次改完」时须把第 10 项（按用户「都照图」去点）和第 11 项（删净 `first-seen` 状态与存储）并入同一张施工单。 |
| **`§5` 机器校验格式** | 用粗体 `**归谁**：` 且出处另起缩进行（`:106-121`），`wholeBlockOk` 实测返回 `false`【已核实：PR `#1692` 正文第 181 行】 | 严格按行首无粗体、同行附库版本与 URL / `file:line` 编写 | **本复盘更硬【已核实】**：`check-direction-trailer.mjs` 的 `wholeBlockOk` 与 `check-doc-status.mjs` 实跑均通过。 |

