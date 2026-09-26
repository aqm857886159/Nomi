# 体感回归机制（2026-09-09）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：已实现并通过本地完整 gates，PR #662 交付；未合并。

## 先查别人

- Playwright Page 截图与等待：https://playwright.dev/docs/api/class-page
- Playwright Locator 根节点求值：https://playwright.dev/docs/api/class-locator#locator-evaluate
- MDN 文本范围几何：https://developer.mozilla.org/en-US/docs/Web/API/Range/getClientRects

|能力|别人怎么做|我们直接用|不做的理由|
|---|---|---|---|
|视觉/交互稳定性|Playwright locator/actionability 与截图|Playwright 页面根节点扫描|不接云服务|
|可达性/对比度|axe-core/@axe-core/playwright|保留 axe 接口位，当前离线规则|不装包（仓库未提供）|
|视觉基线|Chromatic、Percy、Argos diff|状态截图命名与 JSON 接触表|零付费、不接服务|
|交互测试|Storybook interaction/play tests|声明式旅程目录|不引入 Storybook runtime|
|布局缺陷|DOM Range / CSSOM View 几何原语|DOM rect overlap/clipping/viewport/hit|通用 DOM 规则|
|判官|OpenAI/Anthropic rubric|四问 0–3 可插拔量表|今晚离线规则跑一遍|

## 机制
`tests/ux/_feel.mjs` 接受任意 Playwright Page/Locator 根节点与数据规则，输出 findings JSON；不引用产品选择器。规则覆盖文字重叠、裁切、出视口、点击被拦、字号下限，；对比度规则尚未实现。旅程目录是声明式 JSON，夜跑只消费目录。

## 验收
首轮夜跑必须包含 Agent 面板、HTML 产物、3D 产物三条已知症状；每张截图回答舒服吗/能点吗/看得全吗/读得清吗，0–3 分并登记 owner。每个共享启动器走查通过 helper 自动扫描；豁免需登记理由。

## 接手返工范围与根因（2026-09-09）
- 症状：扫描只靠作者显式调用；跨容器漏检、正常滚动误报；夜跑未执行浏览器。
- 直接原因：扫描器把发现直接抛出、同父过滤、整页边界未经滚动裁剪；目录脚本只生成占位路径。
- 类根因：观测、策略与证据没有在共享边界闭合。分类 recurring；同类入口实扫 `_launchApp.mjs`（tests/ux 与 evals 共用）、`_assert.mjs`（显式断言）、三个 feel walk（旧目录检查）。
- 只改测试/脚本/文档；不改生产代码、不加依赖。扫描器只负责发现，共享观察器负责截图/状态等待后的整页扫描、证据与基线裁决。已有 Playwright 保留，不引入其私有 API。
- 网格分桶比较跨容器叶子文字；可见几何先与滚动祖先相交；规则逐函数展开。
- 先跑新夹具留红证据，再实现；每条规则一红一绿，加根节点隔离、滚动与共享接线测试。
- 夜跑使用声明式 HTML 复现夹具，真实截图与扫描；这些是机制证据，不能冒充当前产品旅程完成或生产缺陷已修复。
- 回滚：整体回退本任务测试机制提交；生产构建不受影响。验收：夹具、nightly、完整 gates、正常 hooks、PR #662。

## 六条通用性对账
|约束|落点与证据|
|---|---|
|断言库无产品选择器|`tests/ux/_feel.mjs` 仅 DOM tag、Text Range、几何；`check:feel` 拦产品引用|
|共享入口默认扫描、豁免棘轮|`_launchApp.mjs` 自动安装 `_feel-observer.mjs`，Page/Locator screenshot / waitForFunction / waitForSelector / waitForLoadState 完成后整页扫描；新窗口同样接入。`feel-exemptions.json` 初始空、只减不增|
|旅程声明式|`journeys/catalog.json` 声明状态 HTML、owner、已知症状；三个 walk 仅选择 journeyId；nightly 无产品分支|
|通用判官量表|目录统一四问 0–3；没有视觉判官时 score=null，明确 needs-human-or-visual-judge，不用几何规则冒充审美分数|
|不 import 产品代码|扫描器零 import；观察器只 import node 标准库与扫描器；夜跑只用已有 Playwright 与通用测试模块|
|根节点+规则→发现 JSON|Page/Locator 两类根节点均支持；规则覆盖可配置；发现不抛错，基线策略在外层|

实际搜索：`tests/ux` 没有 `waitForProduction` 调用；同名函数位于 `electron/productionRun/productionRunTestHelpers.ts`，是无页面的服务单测等待器。本次不改该文件；接入实际页面等待边界（上表），不宣称观测了服务层等待。

## 首轮实际执行证据
- 新规则测试在旧实现：7 tests / 0 pass / 7 fail；跨容器 missing text-overlap，Locator 参数契约也失败。原始记录 `/tmp/ux-feel-red.log`。
- 修正后：11 tests / 11 pass（六规则红绿、根节点隔离、基线增减、截图和等待自动接线）。记录 `/tmp/ux-feel-green.log`。
- 空基线夜跑先红：20 张真实浏览器夹具截图，12 条发现，8 个状态/主题发生 drift；修正文字自身裁剪后再跑：20 张、10 条、drift=0。
- 三条已知症状：Agent 跨容器文字层叠（每主题 1）；HTML 裁切与不可交互（每主题 2）；3D canvas pointer-events 禁用（每主题 1）。owner 随基线登记。
- 新发现：工具回执 9px 字号（每主题 1）；这是新增机制夹具检出，不是对当前产品的新缺陷断言。
- `artifacts/feel/nightly.json` 与 `nightly.html` 为实际发现和可打开接触表；20 张 png 路径均真实存在。
- 本任务书 `brief-ux-feel-mechanism-codex.md` 未在当前工作区找到；六项要求以本轮用户原文为准。

## 官方 API 边界核对
使用现有 Playwright 1.60.0 的公开 Page/Locator evaluate、screenshot、waitForFunction API，已读本地 `playwright-core/types/types.d.ts` 对应签名；无私有 instrumentation、无新框架层。
- https://playwright.dev/docs/api/class-page#page-screenshot
- https://playwright.dev/docs/api/class-page#page-wait-for-function
- https://playwright.dev/docs/api/class-locator#locator-evaluate
- https://developer.mozilla.org/en-US/docs/Web/API/Range/getClientRects

补充边界回归：文字 Range 必须被自身 overflow 裁剪，否则已经隐藏的字会误报与下一个按钮重叠；新增用例钉住该边界，移除基线两条误报（12→10）。

截图观察覆盖 Page 与 locator/getBy*/派生 Locator（含 all）；Locator 截图后仍扫描整页。夹具证明按钮截图也能检出按钮外的字号缺陷。整页正常滚动也有独立不误报用例。

全量测试发现旧 `_feel.test.mjs` 使用 node:test 却被 Vitest 收集，导致 No test suite found；两份 .test.mjs 统一使用 Vitest 注册，保留 Playwright expect 断言。最终窄测命令：`pnpm exec vitest run tests/ux/_feel.test.mjs tests/ux/_feel-observer.test.mjs`。

## 最终交付验证
- 验证代码 SHA：`d8a770cd5e0c26c54506ef14f4fd8105bcf09569`，已整合当时最新 origin/main，behind=0。
- `pnpm run gates` exit 0：76 contracts，73 pass / 0 blocking / 3 advisory；1292 个 Vitest 文件、12069 tests pass（1 文件、2 tests skipped）；agent runtime / janitor / stats 与 Vite、Electron 构建均通过。
- 最终窄测 11/11；夜跑 20 张截图 / 10 条发现 / drift=0。人工查看 Agent 重叠、HTML 裁切、3D 禁用交互夹具截图，与记录一致。
- 收据日志：`/tmp/ux-feel-gates-delivery.log`；后续文档收据不改变上述被验证代码。

## PR #662 CI 根因修复（2026-09-09）
- 分类 recurring：测试运行环境的能力没有在收集边界声明；同类入口实扫 `_feel.test.mjs`、`_feel-observer.test.mjs` 与 design-lab `*.visual.spec.mjs`。前两份为唯一启动 Chromium 的 `tests/**/*.test.mjs`，后者已有独立 Playwright 车道。
- 为什么本地绿 CI 红：本机有缓存的浏览器；Unit CI 不安装浏览器。沿用专用后缀分道：两份迁为 `*.browser.mjs`、node:test runner，`test:feel:browser` 显式执行；Linux desktop 安装 Chromium 并执行，Unit 不加安装步骤。
- smoke 待核实：run 34275108604 的 linux-walkthrough-evidence 已下载，但旧上传清单漏掉 artifacts/feel，无法取到 13 条 DOM 发现。补上传证据；本地 smoke 正排队复现，不能把 macOS 参数模拟当成 Linux 执行。
- 先查同类：`docs/lessons/canvas-perf-budget-calibrated-on-macos-fails-on-linux.md` 只允许延迟预算按平台校准，计数/正确性不能据此放宽；design-lab 视觉道明确校准平台。需看实测元素再决定 A/B。
- 范围仅测试、CI 接线与本计划；不改生产代码、依赖、.gitignore。回滚本次提交恢复旧机制；验收 browser 11/11、Unit 不收浏览器测试、本地 smoke、完整 gates、正常 hooks 推送原 PR。
- **选择 B，排除 A**：macOS `pnpm run test:e2e` 同样在 `smoke:waitForFunction` 检出 font-size 13/0，故不是平台差异。13 个元素依次为 span「1/4」「素材库」「分组」「提示词」「技能」「流程」「镜头 1」「生成方式」、div「用即梦会员积分，纯文字生成图像」、span「D」「变体」「N」、summary「—」。CI 没上传 DOM JSON，不能声称逐元素验证了 Linux；本地同计数同阶段、CI 截图与日志是目前证据。
- B 的登记边界：扫描器补 `fontSizes` 证据；豁免只匹配指定 checkpoint 下的 rule + tag/text/fontSizes，逐条消费（重复增加仍红）。记录全部原始发现，只有已登记发现免计；删除原有“整个 checkpoint 有豁免就不判红”的宽豁免。owner/reason 必填，merge-base 已有登记只减不增；首次登记允许本次用户明确授权的 B 校准。不改 baseline allowed，不关观察器。
- 设计依据：`docs/design/nomi-design-system.md` §字号允许 micro=11px，`tailwind.config.ts` fontSize.micro=11px；此为既有小字号被新机制检出，产品整改/设计判定留给对应 owner，本 PR 只建立精确机制登记。

- 第二次实测补录：上述 13 个元素 `fontSizes` **全部为 [11]**；精确登记在 `feel-exemptions.json`，owner=design-system，baseline 仍为原值。纯策略回归证明同文案额外节点、变成 10px、换文本/标签/规则/状态都会继续红。
- 修复后本地 `pnpm run test:e2e`：**SMOKE PASS: 17 assertions**。`artifacts/feel/smoke/contact-sheet.json` 保留 findings=13 / exempted=13 / drift=[]；截图人工核对侧栏、镜头标签和生成方式区域，扫描没有停用。原始红记录 `/tmp/ux-feel-smoke-details.log`；绿记录 `/tmp/ux-feel-smoke-green.log`。
- `vitest list --filesOnly` 实际收集清单不含两份 browser 文件，仅收纯策略 `feel-policy.test.mjs`。浏览器原 11 个用例与纯策略 2 个用例均通过；CI 接线检查 13/13。
- 本轮完整 `python3 scripts/with-gates-lock.py -- pnpm run gates` **exit 0**：76 contracts / 73 pass / 0 blocking / 3 advisory；Vitest 1291 files pass + 1 skipped，12060 tests pass + 2 skipped；agent runtime / janitor / stats 及 Vite/Electron build 通过。日志 `/tmp/ux-feel-ci-fix-gates.log`。未提交其他运行报告，UF-LAST.md 仅取消跟踪（.gitignore 不变）。

## 第三次 CI 红：未登记面与零基线分离（2026-09-09）

已获裁决：只在已登记的旅程/截图/规则组合阻断增长；未登记组合 record，保存完整发现和截图到 new-surfaces.json 与接触表，夜跑汇总。已登记减少写入 drift 提醒同步基线但不阻断（仅 actual > allowed 阻断），显式 0 与未登记必须不同。不修改生产代码、扫描阈值或已有发现。回滚边界仅 observer/nightly 策略与本次登记；验收为策略先红后绿、browser、7/7 loopback、smoke、完整 gates、原分支 push。

根因分类 recurring：截图、wait checkpoint 与 nightly 都调用 compareFeelBaseline；缺少“登记存在性”不变量，所有新旅程和新规则均可复发。策略由共享比较器拥有，第三方依赖不控制此语义，无需升级。首轮录数以同套真实旅程的原始 contact-sheet 为证，不使用最大值或人为上调。

### 首轮扫到的疑似真缺陷

- j3 text-overlap 1：`j3-first-success-t1-guided-canvas.png`，CI run 34279293883；元素待本轮 DOM 证据补齐，交总账。
- j3 blocked-interaction 3：同截图；元素待本轮 DOM 证据补齐，交总账。此任务不改生产代码。


### 本轮取证与边界

- 原 Linux run 34279293883：j3 guided-canvas 1/45/3/4（text-overlap/font-size/blocked-interaction/clipped-content），j5 modify-project 14/1（font-size/clipped-content）。采用原数，不混用 macOS 最大值。日志 `/tmp/uf-ci-failed.log`，下载目录 `/tmp/uf-ci-34279293883/`。
- j3 两项疑似缺陷共同截图：`/tmp/uf-ci-34279293883/evals/runs/2026-09-08-21-15-journeys-ci/screenshots/j3-first-success-t1-guided-canvas.png`。旧 observer 把 j3 接触表覆盖成 j5，因此 Linux 元素身份无法从 JSON 恢复，不能编造三个命中元素。macOS 同流程 DOM 佐证：text-overlap 命中 `span 风格` 与 `button ×`，另命中 `span 小孩` 与时间轴 `span 0 段 · 0:00`；blocked-interaction 命中工具栏 `button 图片` 与 `button ×`。本地 raw：`artifacts/feel/eval-iso-b62e1cf7-8481-4878-9192-40084c0db7aa/contact-sheet.json`。Linux 1/3 与本地 2/2 不等价，待 Linux 下一轮独立目录证据补齐元素归属。
- 首轮新增 22 条规则基线：j1=2、j2=2、j3=7、j4=2、j5=9；每条记录来源，owner 为 design-system/canvas，理由统一“首轮基线，待清账”。原 10 条基线计数未改。新面归零后保留 count=0，不允许删登记后重新掉回 record。
- **覆盖缺口**：j1/j2/j4 当前旧驱动仍寻找 `给生成助手发送消息`，真实面板已是 Resident Composer，三条在 setup 阶段报 infra；登记的是实际错误现场而非成功里程碑，不能称 j1–j5 全流程录全。j3 两里程碑通过；j5 前三里程碑通过，export 阶段 Electron 关闭，完整链路未获证。报告 `evals/runs/2026-09-08-21-25-journeys/report.md`。未为补数伪造页面或修改生产代码。
- 独立验收阻碍：loopback 6/7；production-mcp 的 document_not_found 结构化错误码实际为 null（message=Creation document not found），重建后重跑仍红。原断言未放宽；证据 `/tmp/uf-production-mcp.log`。本次生产代码禁令内不能修这个生产协议缺陷。
- 策略先红后绿 `/tmp/uf-record-red.log` → `/tmp/uf-policy-final.log`（5/5）；browser `/tmp/uf-browser-final.log`（11/11）；smoke `/tmp/uf-smoke.log`（17 assertions）。完整 gates 在 `/tmp/uf-third-gates.log` 排锁。

- 补 smoke 的显式零登记 1 条：13 条精确豁免后实际剩余 0；防止本轮缺省语义变更使额外重复元素逃回 record。真实登记文件的回归测试证明原 13 条通过、追加第 14 条仍阻断。总新增为 23 条（j1–j5 22 条 + smoke 1 条）。
- 7/7 阻碍已定位到最早传输边界：`electron/capabilityCore/documentSurface.ts:34` 抛的是 `Object.assign(new Error(...), { code: 'document_not_found' })`；`electron/capabilityCore/mcpRpcError.ts:36` 只为 `instanceof RpcError` 保留结构，普通带 code 的 Error 被降成纯 message。跨进程后 errorCode 丢失，单进程 operation-matrix 测试不能覆盖这条路径。生产文件未修改。

- Linux 接触表仍保留 j5 modify 与 error 两张截图；error 的 font-size=14/clipped-content=1 也逐条录入，未丢弃错误现场发现。

### 本轮交付验证

完整 `python3 scripts/with-gates-lock.py -- pnpm run gates` 已 exit 0；76 contracts 的阻断项全部通过（3 项 advisory），Vitest 1291 files / 12063 tests pass、2 tests skipped，运行时测试与 Vite/Electron 构建通过。日志 `/tmp/uf-third-gates.log`。推送前再次读取远端：main 仍为 `4886cdde3b4f49e9279de62476c56971edf5f1e0`，已合入本分支。此结果不覆盖上文仍失败的真实 loopback 旅程与 j1/j2/j4 基线覆盖缺口，不能声称全部验收完成。

## 第四次 CI 红：阻断范围按旅程所有权收窄

裁决已获授权：仅 catalog.json 声明的机制旅程与 smoke 可 ratchet；eval-iso、real-user-test-gates 及其他真实旅程统一 record，即使存在旧登记也不能阻断。共享策略从实际 observer name 判定所有权，基线显式使用 journey / screenshotName / rule 三字段；等待检查点使用稳定的 `<wait API>.png` 截图名，不能按随机序号录数。现有 catalog 数字原样迁移，22 条非 catalog 真实旅程登记移入 artifacts/feel/first-sweep-ledger.json 种子，smoke 零预算保留。

record 每次保存完整发现、平台、截图、接触表与 new-surfaces.json，并打印一行汇总；nightly 将所有运行的 record 证据合并入首轮总账，保留种子原始 owner/count/evidence，重复运行不得叠加同一来源。以后扩基线只能取 Linux feel:nightly 产物，在同平台 Linux 数字上登记；macOS 本地扫描仅是观察证据，不可转为 Linux 门岗。真实旅程发现仍是总账，不因录数自动升级成 ratchet。j3 两条疑似真缺陷保持上文独立记录、不改生产代码。

分类 recurring：缺失的不是更多数字，而是机制所有权与观察证据之间的策略边界。已检查 observer screenshot/wait、nightly、eval-iso 共用启动器与 real-user-test-gates 子进程入口。范围只限 tests/scripts/证据/文档，不改 UI、生产代码、依赖、阈值；回滚本次策略与数据迁移。验收先红后绿覆盖 catalog 增长、跨截图隔离、真实旅程已登记超出仍落盘不红；再 browser、nightly、loopback 7/7、smoke、完整带锁 gates、正常 hooks push 原分支。

第四轮窄验证：旧比较器复现 j3 text-overlap actual=6 / allowed=3 的错误阻断（`/tmp/uf-fourth-real-red.log`）；三字段策略红测 4 fail / 2 pass（`/tmp/uf-fourth-red.log`）→ 6/6 绿，浏览器 12/12 绿。nightly 20 张截图、10 条发现、drift=0，收集 66 条已有 record；总账 seeds=22 保留原始来源与平台（本机 darwin 的历史取数不冒充 Linux）。总账聚合回归证明重跑不重复、后续部分输入不丢既有记录。迁移逐项比对原 33 条登记：22 条转 seeds、11 条保留且计数不变。当前旧 label 实际已带截图名，本轮仍显式拆字段并加截图隔离测试；第四次误阻断的核心是错误的阻断范围，不能再靠录基线处理。

第四轮完整 gates：`python3 scripts/with-gates-lock.py -- pnpm run gates` exit 0；76 contracts = 73 pass / 0 blocking / 3 advisory；Vitest 1295 files pass、12083 tests pass、2 tests skipped；运行时测试、Vite/Electron 构建全部通过。日志 `/tmp/uf-fourth-gates.log`。本次完整验证基于合入 main 后的工作树；新增代码仅在测试与脚本层。

第四轮最终旅程验收：`node scripts/real-user-test-gates.mjs --provider loopback` **7 passed / 0 failed / 0 blocked**；production-mcp 58 assertions 通过并导出 MP4，#661 已消除跨 RPC 错误码丢失的上轮阻碍。报告 `tests/system/runs/2026-09-08T22-40-57.173Z-real-user-journeys/report.md`，日志 `/tmp/uf-fourth-loopback.log`；smoke **17 assertions PASS**，日志 `/tmp/uf-fourth-smoke.log`。随后的 nightly 再次通过，完整总账快照留在 `/tmp/uf-fourth-nightly-final-ledger.json`，提交只保留 22 条原始种子。推送前 fetch 确认 origin/main behind=0。j3 两条疑似真缺陷继续单列，未改生产代码；本地验收不冒充尚未执行的新 Linux CI。
