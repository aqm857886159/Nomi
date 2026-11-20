# 方向检查：付费确认收据门岗换成「放行只在一个家判」的扫描

命中的是自写登记 `gate-family`（仓库门岗族，`scripts/check-*.mjs`）：本刀删掉 `scripts/check-spend-confirmation-receipt.mjs` 与它的基线 `scripts/spend-confirmation-receipt-baseline.json`，由 `scripts/concept-owners-approval.mjs`（`findApprovalDecisionBypass`，挂在 `check:concept-owners`）接手。改的生产文件本身没有命中热点；改法是删旧换新，同一提交删旧，不新增分支或特例。设计卡见 `docs/plan/2026-11-20-approval-one-home.md`。

### 0. 旧门岗为什么失效
旧门岗只扫 `electron/capabilityCore/mcpGateConfirmation.ts` 一个文件，只认字面写法 `confirmed: true`：每个字面要么带收据，要么在基线里登记、并逐字核验旁边的守卫还在（`challenge.handoff?.clientAttestation !== true`）。它还有一道自检：那个文件里一个字面都找不到，就报「门岗已失效」。

这一刀把那个文件里的裸同意分支和两个布尔分支删掉了，客户端出口只转述主人给的结论（`confirmed: result.confirmed`），不再自己写字面。旧门岗于是无物可扫，必红；把注释里的字样留着骗它过，等于留一道永远空转的门。它原本守的也只是「一个文件里的字面」：改名常量、展开、属性赋值、`Object.assign`、别的文件自己判，它都看不见；签发收据的口子（铸收据、三种签证、主进程决定）在哪个文件被调，它也不管。

### 1. 新扫描覆盖什么
两半，都按 TypeScript 语法树判，遍历 `src` 与 `electron` 的全部生产文件（测试与类型声明除外）：

- 签发口：`mintReceipt`、`issueDecisionReceipt`、`createClientElicitationAttestation`、`createMainProcessGestureAttestation`、`createPolicyDecisionAttestation` 只许出现在生成门主人（`runOwnedGenerationGateAuthority.ts`）与收据权威（`approvalReceipt.ts`）两个文件。属性访问、解构（含别名）、字符串键（含 `Reflect.get`、计算属性）都算碰；只在类型里出现、同名方法定义不算。
- 结论：付费门链上的文件（提到挑战 / 收据令牌或生成门确认的文件）不许自己写出恒真的 `confirmed`——字面 `true`、`!0`、同文件常量（含改名）、展开、属性赋值、`Object.assign` 都报，带不带收据都报。只有主人说得出「算批准」。

推送前不变松：它登记在 `SCAN_GUARDS`，`src` / `electron` 任一文件改动就跑（旧门岗只在 3 个固定文件改动时跑），选择器探针对旧门岗的 3 个触发文件、主人、一个新 electron 文件、一个 src 文件、扫描本身都选中它；CI 经 `gates:contracts` 的 `check:concept-owners` 每个 PR 必跑。两条反例（写回裸同意、写回带收据的字面 `confirmed: true`）连同其余 9 种改写都已在真文件上改坏即红、复原即绿。下游「布尔值不许冒充收据」那道自检改由 `mcpGenerationConfirmation` / `mcpGenerationDispatcher` 的单测钉住，根因合同 `docs/fixes/2026-09-03-client-confirm-needs-a-real-receipt.root-cause.json` 已改指新扫描。

### 2. 为什么不接现成的
`gate-family` 现在是 under-review，登记里查过的现成方案是 ESLint 自定义规则 / eslint-plugin-boundaries、dependency-cruiser、knip。它们管的是「谁能 import 谁」或单个语法形状（`no-restricted-syntax` 一类选择器）。这里要表达的是领域约束：「花钱放行这件事只有主人文件可以写结论、只有主人和收据权威可以签发」，而且要跨文件追绑定——签发方法被解构改名、被字符串键取出、被展开到别的对象上再调，结论被同文件常量或别名对象带出来。选择器只看到一个节点的形状，看不到这个名字从哪来、这个文件是不是付费门链上的、它是不是主人；import 规则也拦不住，因为收据权威是作为对象传进来的，不经 import。所以本刀沿用仓库已有的概念归属扫描骨架（`concept-owners-scan.mjs` 的源码遍历与解析），只加这一个概念的判据，不新增门岗族的脚本（不叫 `check-*`，挂在已有的 `check:concept-owners` 下），门岗总数减一。

### 3. 什么时候复查
跟 `gate-family` 登记的 `revisitWhen` 走：门岗账本的保留 / 降级 / 删除清单被拍板后，以及之后每次周期审计重跑账本时，把这道扫描一起过一遍；登记的复查日是 2026-11-30。那时若定下用通用工具承接概念归属一类的判据，本扫描随 `check:concept-owners` 一起迁。

### 4. 连带命中的概念口径
提交前热点演练还命中概念 `delivery.test-temp-roots`（测试与走查的临时目录归属）：`scripts/pre-push-contracts.mjs` 在它的写接口里（`terminateAndReclaim`）。这一刀在那个文件里只删一行——旧门岗 `check:spend-receipt` 的推送前登记（`package.json` 里那条命令同提交删了，留着这行推送前会去跑一个不存在的命令）。`terminateAndReclaim` 与临时目录逻辑一字未动，改的不是这个概念；改法是删，不新增分支或特例。协调同日按同一条例外代批。

第一次 `gates:contracts` 之后又碰了门岗族的一份基线：`scripts/vocabularies-baseline.json` 只加一条登记（新只读结论 `ApprovalDecisionRecord.state` 的状态词，写明它和挑战库内部状态不同层）。这是语义词表门岗要求的登记动作，门岗本身一行没改，热点演练的命中项也没变（仍是上面两处）。

### 5. 用户要权衡的核心
少一道只认一个文件字面写法的门岗，换成一道看全部生产代码的扫描；代价是这道扫描仍是我们自己写的，要跟门岗族一起接受复查。

协调代批（2026-11-21）：只因自写登记口径命中，改法是删旧换新，事后报用户
