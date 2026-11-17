# 设计卡：「这个镜头现在算哪一个任务」只在一处选

状态：2026-11-17 动手前批准；一个提交。代码锚点：productionShotJobs.ts:51、productionShotPhase.ts:157、productionQaVerdict.ts:71、canvasShotResult.ts:7、canvasShotHandover.ts:189、shotLandingAdmission.ts:200、shotProviderHandover.ts:27（修改前）。
类别：不是四类（不改界面、不改花钱流程、不改数据）。行为会变，★ 五格写全。
来历：同一个判断几个入口各做一份。只读准备查到 7 处各自在挑「这个镜头当前的任务」，7 类差异找不到依据（静态推演，未在真实数据里复现）。

## ★1 用户怎么用

当我让一个镜头生成、返工、再生成之后，我在画布角标、任务中心、助手回话里看到的「这一镜现在在干什么」必须是同一个答案，后台的调度、返工、取回也按同一个任务办事。

现在可能出的事（静态核查推演出的例子）：
- 一镜已经出完片、正在自动检查：调度认为「生成完成」，画布角标却显示「生成中」。
- 返工过一次的镜头：一处认第 2 次的任务，另一处因为第 1 次的记录时间更晚而认第 1 次——取回的可能是旧片。
- 返工挑父任务时按「最后更新时间」，别处按「创建时间」，同一镜挑出两个不同的任务。

真实任务（主进程集成测试，Run 账本用夹具构造，不连供应商、不花钱）：
1. 多镜 Run，一镜 generate 完成 + qa 轮询中：七个出口都指向 generate 那个任务。
2. 一镜两次尝试，第 2 次完成但创建时间早、第 1 次仍在轮询：七个出口都指向第 2 次。
3. 两个任务尝试号和时间完全相同：七个出口取同一个（固定次序）。
4. 旧单镜 Run（没有 shotId，只有 candidateId）：照旧找得到它的任务，提交 / 查询 / 晚到结果 / 交接回写不变。
5. 旧的只有 nodeId 的 QA 记录：返工照旧找得到父任务。

指标与量具：
- 七个出口对同一份账本、同一镜的答案一致 · 量具：`electron/shared/productionShotJobSelection.test.ts`（同一夹具喂七个真实出口，逐个比任务号）。
- 旧形状（旧单镜、旧 QA node-only）找不到任务的次数 = 0 · 量具：`electron/shared/productionShotJobSelection.test.ts` 的旧形状夹具。
- 账本外自己挑任务的地方 = 0 · 量具：`node scripts/check-concept-owners.mjs --concept production.shot-jobs`（见 ★9）。

### ★1c 老用户

不改任何存储，不改 IPC。旧 Run 账本里的三种形状要照旧读得出来：多镜（shotId）、旧单镜（candidateId）、旧 QA（只有 nodeId）。实现者先从已发版本的代码核对这三种形状确实存在、字段是什么，核不到的写「未查」。
任务可以没有 `job.nodeId`：节点地址复用计划里的 `nodeId`→镜号 / `candidateId`；无映射或无生成记录的旧 QA 仍按任务 `nodeId` 读取。阶段文件重导出原地址读口，不留第二份映射。
花钱方向从严：某个出口现在靠「拿整个账本最后一条」判断「这一镜发过了」（旧单镜）。删这个兜底之前，先确认主人按旧单镜地址能认出同一条；**认不清时一律按「已经发过」处理，不许因为收口让旧镜头被重复提交**。

## ★2 谁说了算

- 「这个镜头当前的任务是哪一个」：`electron/shared/productionShotJobs.ts`，唯一一处。输入是 Run + 地址（shotId / nodeId / 旧单镜 candidateId），次序固定：只看生成段 → 尝试号 → 创建时间 → 固定的末位次序。
- 其余六处（画布阶段、QA 返工、单镜结果、交接回写、逐镜发送事实、批内等待受理）只问主人，不自己筛、不自己排、不拿首末项。
- 有意保留的差异只通过「地址」和「合同 / 指定尝试号」这两种参数表达，不开放任意排序选项。
- 门数由实现者用 `node scripts/door-map.mjs jobsForShot`（及相关符号）重数。

## ★3 一致与复用

- 以前定过：`productionShotJobs` 已登记为主人；概念基线里有两条明文豁免的债，这次还掉并从基线删除。
- 三条路：沿主人扩（选这条：7 个生产文件，不改数据和 IPC）；新抽一个不暴露账本的只读结果（结构更强，但要迁 Run 读接口和所有消费者，范围没数清，留作以后）；只删两份（剩四处仍自算，不算收完）。
- 复用现有 `check:concept-owners` 的扫描，不新增检查命令。

## ★4 全状态

- 没有任务：各出口照旧回「没有」，不拿别的镜头的任务顶。
- 生成中 / 轮询中 / 完成 / 失败 / 已取消：按主人次序取一条。
- 只有检查段的任务、没有生成段：主人回「没有生成任务」；「发没发过」这类花钱判断按 ★1c 从严。
- 多次尝试、时间相同、时间倒挂：见真实任务 2、3。
- 旧形状：见真实任务 4、5。

## ★9 验收与回滚

应该通过：
1. 上面五条真实任务，七个出口逐个对拍。
2. 静态核查的 7 类差异（U1–U7）各一条同输入用例，七个出口答案一致；U7（旧单镜只有检查段、带任务号）结果是「按已发处理、不重复提交」。
3. 旧单镜、旧 QA node-only 的现有测试全部照旧绿，一条不删。
4. 概念基线里那两条豁免删掉，登记补上。
5. 不改存储、IPC、界面：`git diff` 里没有这三类文件。

故意改坏必须报红（实现者交「反例 → 改坏后哪条检查红 → 还原后绿 → 日志」表；独立验收者只按这张表和上面五条核）：
- 把画布阶段那处恢复成不筛生成段。
- 把某一处恢复成只按创建时间比。
- 把 QA 返工恢复成按最后更新时间比。
- 在单镜结果里恢复自己排序取第一条。
- 在发送事实里恢复「拿整个账本最后一条」。
- 在一个新文件里换个函数名重写一遍「按镜筛任务再取一条」（改名复制）。
- 主人里把尝试号和创建时间的先后对调。
- 旧单镜地址认不出时判成「没发过」。

这一类还会从哪里回来：新出口直接读账本自己挑；有人给主人加「可选排序」参数。由扫描和「主人不接受排序参数」的测试守。扫描只能认已知形状，拦不住所有写法——这一条照实写在 PR 里，更强的做法（出口根本拿不到账本）记为后续。

回滚：一个 PR，`git revert` 合并提交即可；不改数据。
独立验收：另一条线按本格清单验，报告链接放 PR 正文。

## 实现锚点

- `electron/shared/productionShotJobs.ts:60` · export function productionShotIdForNode(run: Pick<ProductionRun, "generationPlan">, nodeId: string): string | undefined {
- `electron/shared/productionShotJobs.ts:71` · export function jobsForShot(run: Pick<ProductionRun, "generationPlan" | "jobs">, address?: ProductionShotAddress): ProductionJob[] {
- `electron/shared/productionShotJobs.ts:85` · export function latestJobForShot(run: ProductionRun, address?: ProductionShotAddress): ProductionJob | undefined {
- `electron/shared/productionShotJobs.ts:92` · export function hasUnresolvedShotSubmission(run: ProductionRun, address?: string): boolean {
- `electron/shared/productionShotPhase.ts:191` · export function deriveProductionShotState(run: ProductionRun | null | undefined, shotId: string | undefined): ProductionShotState | null {
- `electron/productionRun/productionQaVerdict.ts:84` · export function buildQaRetryPlans(run: ProductionRun, verdicts: readonly QaShotVerdict[]): QaRetryPlan[] {
- `electron/capabilityCore/canvasShotResult.ts:1` · export { latestJobForShot as latestJob } from '../shared/productionShotJobs'
- `electron/capabilityCore/canvasShotHandover.ts:172` · export function settleFromRun(input: {
- `electron/productionRun/shotLandingAdmission.ts:217` · export function shotLandingFacts(run: ProductionRun): ShotLandingFacts {
- `electron/productionRun/shotProviderHandover.ts:25` · export function shotHandoverPhase(run: ProductionRun | null, shotId: string | undefined): Phase {

## 通用门岗取舍

自写登记 `gate-family`：接入现成方案是第一选项；本次沿用已接入的 TypeScript compiler API（`scripts/concept-owners-scan.mjs` 的 `typescript` 导入，出处为仓库既有依赖），语法树解析不自写。镜号、生成段和指定执行身份属于现役 Run 的领域约束，通用解析器不能代替这条领域判据；因此扩原 AST 扫描并删两条豁免，不新增检查命令或框架。2026-11-24 按七出口对拍与旁路数量复查；若已知语法外再次逃逸，优先改为消费者拿不到原账本的只读边界，再评估门岗合并，不继续叠同类特例。
