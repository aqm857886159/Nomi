# 全功能走查：九条铁律 + 剧本 + 功能状态表

> 谁读：发版前要跑全功能走查的人；加新功能 / 改了哪块、要更新对应旅程的人。
> 真相源：`tests/ux/full-walk/`（目录 `catalog.mjs`、铁律 `invariants.mjs`、监视器 `monitor.mjs`、剧本 `playbooks/`、跑器 `run.mjs`）。本文只讲怎么用。

## 为什么是这个形状

0.22.1 上正常使用一会儿就能碰到十几个看似各不相干的问题，它们更可能是水面下同几个底层设计问题的不同症状。
所以这套走查的第一产出是**证据**：违反了哪条铁律、发生在哪个模块、截图和请求报文 / 状态快照在哪——有了证据才能把问题归到底层设计上，而不是再修一个症状。

- **九条铁律**（`invariants.mjs`）：用户不管怎么用都必须成立的事。监视器在每一步收尾时全部核一遍，违反不中断剧本。
- **剧本**（`playbooks/*.walk.mjs`）：真实创作者会做的事，外加「乱用」（翻页、暂停、换家、缩窗、换语言……）。剧本只管像用户一样操作，判据全在监视器。
- **功能状态表**（`catalog.mjs`）：每一行是一条用户旅程，写清它经过的每个状态（用户看到的字、能做的动作、代码里谁决定它、非终态最长等多久）、覆盖它的剧本、核对的铁律、该上报的事件。出问题时查表修。

2026-10-05 第一批落地（[设计卡](../plan/2026-10-05-experience-iron-laws-batch1.md)）：⑪ 是单测（`tests/experience-laws/parameterReachability.test.mjs`），⑩ 宿主半是单测、模型半是 `evals/datasets/intent-draft.mjs`；**⑫ 住在走查里**：`invariants.mjs` 多一条 id 12（只在剧本显式调 `monitor.checkClickTarget` 时判），可点目标登记在 `catalog.mjs` 的 `STORYBOARD_CLICK_TARGETS`（`userExpectation` 写人话、`actualObservation` 只抄真实走查结果），剧本 `pb12-storyboard-click-expectations` 点一遍分镜表；对不上的当场写进逃逸账本 `LAW12-<id>`。剧本可以 `startPlaybook({ offscreen: true })` 把窗口放到屏幕外、不抢焦点（`offscreenWindow.cjs` 经 `mainRequire` 装进主进程），在用户桌面上跑也不打扰他；用户开着自己的 Nomi 时加 `NOMI_FULL_WALK_SHARE_MACHINE=1`，不等它也不碰它。

Phase 0 另登记三条跨任务的体验规格（不改变现有九条运行时监视器判据）：⑩「说的=摆的」——意图抽取期望与草稿参数确定性对比；⑪「能选到」——模型档案参数清单自动生成并覆盖各入口；⑫「点了=以为的」——`catalog.mjs` 的每个可点目标写 `userExpectation` 与 `actualObservation`。实际测试发现先放进 [`tests/ux/full-walk/escapeLedger.json`](../../tests/ux/full-walk/escapeLedger.json)，人工复核后再补剧本 / 回归。

## 怎么跑

```bash
pnpm run build                                   # 走查跑的是 dist 与 dist-electron
node tests/ux/full-walk/run.mjs                  # 全部零花费剧本 × 变体
node tests/ux/full-walk/run.mjs --only pb01,pb06 # 只跑几条
node tests/ux/full-walk/playbooks/pb02-reference-image.walk.mjs   # 单跑一条（缺省 base / 中文）
```

- 输出：每一场的证据在 `tests/ux/shots/full-walk/<时间>/<剧本>--<变体>--<语言>/`，汇总报告在 `tests/ux/full-walk/reports/<日期>-<版本>-<提交>.md` 与同名 `.json`——两处都是跑出来的产物，**不进 git**（`.gitignore` 已排除）；要留档就把结论贴进 PR / 发版说明。
- 只重出报告不重跑：`node tests/ux/full-walk/run.mjs --report-only <时间>`（归类改了之后用；报告头写明证据是哪一版代码跑的、报告由哪一版重出）。
- 退出码：0 = 全部走通且零违反；1 = 有违反；2 = 有剧本没走通（它的「没违反」不作数，先修走查）。
- 机器上有别的 Nomi / Electron 进程时，剧本会等它结束再起（不关别人的进程）。
- 零花费：Agent 的大脑与供应商都是本机夹具（`tests/ux/agent-runtime-fixture.mjs`）；主进程里装的是全仓唯一的走查网络闸 `scripts/walkthrough-network-guard.cjs`（fetch / http / 连接 / Chromium 四层，只放行本机），公网代理再指到一个只记账的黑洞；打向真实供应商域名的一律记成违反（「隔离漏网」单列，不算产品违反）。闸少装一层，这一场的「没漏」就不作数。
- 付费小额组（`*.paid.mjs`）：只在 `NOMI_SPEND_OK=1` 时跑，护栏、凭据副本与收据全走 `tests/ux/_paidRun.mjs`；没开就在报告里记「跳过（付费）」。
- 目前只支持开发构建：网络闸靠启动器的 `mainRequire`（`-r`）在 App 入口之前装进主进程，打包版不接受；`--packaged` 会被明确拒绝，不假装支持。
- 界面上的话（「预算已用完」「可能已经提交」「某某家：失败原因」……）监视器一律从 `src/i18n/resources.ts` 的中英文案生成认法，不在走查里另写原话——文案改了，认法跟着变。
- 界面露出检查（规则 `ui-leaked-internals`，`outcomeText.mjs`）：Agent 面板、提示条、状态行、任务卡里**可见**的文字不许出现原始 JSON 形状、内部 id（`apimart/…`、`cand-op-…`、`op-<uuid>`、`[nomi-classified:`）、价格 / 预算字样；用户自己的内容（`[data-user-content]`、用户那一条消息）取文字时就剔掉。main 上已有的违例登记在 `outcomeDebts.json`：带到期日、绑修它的 PR，未过期记进报告的 `knownDebts`、不算红，过期即红；修掉的 PR 同时删掉那一行。**这道检查只在全功能走查里跑（验收走查和发版走查），CI 的 E2E Walkthroughs 不跑**：CI 那边的每步钩子是 feel 观察器，它只记录不判红、有自己的基线与豁免账，硬接会让一批无关旅程被这批已知违例拖红，所以没接。

## 加一条剧本 / 改了一块功能

同一个 PR 里：

1. 在 `playbooks/` 写剧本：`startPlaybook()` 起 App（核心冒烟那只夹具），每个动作包在 `monitor.step(label, action, { user, surfaces })` 里；用户点头的那一下之前调 `monitor.consentSpendCard / consentNodeGenerate / consentDialog / consentFullAuto`，按暂停时调 `monitor.revokeConsents`；「此刻用户发起的事都该收场了」调 `monitor.settle(label)`。
2. 在 `catalog.mjs` 的 `FULL_WALK_PLAYBOOKS` 登记它，并挂到至少一条旅程的 `scripts` 上。
3. 改了哪条旅程经过的界面 / 状态 / 时限，就改那条旅程的状态行（owner 写成 `文件#符号`，时限只引用登记处；没有登记就写 `gap`——那本身就是一条发现）。
4. `pnpm run check:full-walk-catalog`：owner 符号在、每条旅程有剧本、每个非终态有 deadline、visibleText 在中英词典里都在、上报事件已登记。
5. 用户新报的问题加进 `userReports.mjs`（写它应该被哪条规则抓到），报告会自动标「复现 / 没复现」。

## 发版前

- 在候选版对应的提交上 `pnpm run build && node tests/ux/full-walk/run.mjs`，把报告里的结论（每条铁律几条违反、用户问题复现表）贴进发版说明。
- 产品违反必须处理，或者写明为什么这一版可以带着它发；「走查故障」必须先修走查再跑。
- 付费小额组由维护者在发版前显式开 `NOMI_SPEND_OK=1` 跑，只用最便宜的档，花费记在收据里。
