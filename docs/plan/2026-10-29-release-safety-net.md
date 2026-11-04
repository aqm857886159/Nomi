# 发版安全网：分批放量与每日版本健康

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

类别：其他（发布流程、离线脚本）；不改应用界面，不付费、不发版。负责人：发布协调。

## ★0 先查别人（2026-10-29 实查）

- https://chromium.googlesource.com/chromium/src/+show/ff8d22e/docs/process/release_cycle.md · Mac / Windows 按 5% → 15% → 50% → 100% 放 · 确认先小批再观察，不把发布等同全量（原文 format=TEXT 解码核对）。
- https://www.developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases · 七天 1% 到 100%，可暂停，手动下载不限批次 · 确认明确写出手动下载绕过比例；实际原文 developer.apple.com 同路径。
- https://slack.engineering/deploys-at-slack/ · 先内部，再 2% canary，再逐级放，指定负责人看图 · 确认每天由协调看报告，不无人值守自动全量。
- https://spinnaker.io/guides/user/canary/judge · 比较实验组与基线指标作继续/停止判断 · 确认新旧版同一日历窗口比较；实际原文 /docs/guides/user/canary/judge/。
- https://www.electron.build/docs/features/auto-update · latest*.yml stagingPercentage，坏版必须用更高版本修 · 确认复用 updater，不自写客户端分桶。
- https://contributing.bitwarden.com/getting-started/clients/desktop/update · 固定每安装 GUID，比例必须为 1–100 整数 · 确认重复检查不重新抽签，0 不是发布输入，暂停另用 Release pre-release 状态。

## 前置三项核实

1. 已安装 electron-updater **6.8.9**。`node_modules/electron-updater/out/AppUpdater.js:314-331` 读取 `stagingPercentage` 并比较持久 ID，缺失/NaN 会放行。因此发布边界必须拒绝缺省、0、>100、非整数，而不能依赖 updater 校验。
2. `gh api repos/aqm857886159/Nomi` 未返回 immutable 开关字段（null 不能证明未开启）；补查 `gh api repos/aqm857886159/Nomi/immutable-releases` 得 `enabled=false,enforced_by_owner=false`。`releases/latest`：v0.24.0 / 427420777 / `immutable=false`。可替换资产；执行脚本仍每次复查，开启不可变后拒绝全量，交协调选择独立可变 feed 或更高版本，绝不改设置。
3. `GitHubProvider.js:40-48,91-93,158-170`：先 Atom，稳定版以 `/releases/latest` 返回 tag 选元数据；`AppUpdater.js:125,218`：稳定版本默认 `allowPrerelease=false`。暂停将目标 Release 标成 pre-release（不建新通道），稳定检查回到上一稳定版本。已升级不降级、在途/缓存下载不能撤回、tag 直链仍可下载；官网 latest 入口也回到上一稳定版。暂停前要求存在较低的稳定发布。

## ★1 用户怎么用、指标与量具

当协调发一个已验收 RC，我想先让 20% 安装收到应用内更新，再每天看新旧版相同 UTC 日期窗口的结果，以便坏版不继续扩大。步骤：①验证 RC；②显式首批比例（默认20）；③同一脚本写两份元数据并重算校验和；④发布后每日 `intake:radar`；⑤读样本数/缺项；⑥通过才全量、变差就暂停；⑦更高版本修坏版。

真实任务：同一副本缓存离线比较 0.24 / 0.23；补丁号无法区分。唯一主指标为 image 失败率，量具 generation.completed 的 failure/(success+failure)，取消不进分母、未知另列。其他能力、疑似本地拒绝、更新下载/安装和 Agent 只作告警及覆盖说明，不挡全量。量具 app.started 计新版启动；事件日期计新版 UTC 观察日期；sessionId 计每指标新版失败的独立会话。停止要求新版 n≥10、95% 差值区间下界>0、点差≥5点，且失败来自≥2会话。全量要求新版窗口内≥3日有事件、启动≥10、image n≥20、image 无未知、无判停。全量同时披露 image 差值95%上界和未覆盖项，不能声称证明没变差。缓存损坏视作主指标结果不完整（缺失量未知），不能产生全量结论。安装完成无遥测；Agent 回合遥测没有这一项。

协调 2026-10-30 已定上述阈值。区间用 Newcombe (1998) 独立二项比例差方法10：两边 Wilson score 区间，差值用两个方向的距离平方和开根。原文 pp.876–877、Table II(a)：56/70 − 48/80 = 0.2，95%区间 [0.0524, 0.3339]。实查全文：[Newcombe 原文公开副本](https://www.researchgate.net/publication/13687790_Interval_estimation_for_the_difference_between_independent_proportions_Comparison_of_eleven_methods)，[出版出处](https://pubmed.ncbi.nlm.nih.gov/9595617/)。不装包，闭式计算。

★1b：不改应用界面；回执仅终端/Markdown/JSON，最后一行只能三选一。

## ★2 唯一 owner、数门

公开更新比例 → 发布脚本唯一改写边界；发布工作流只调用它。版本健康 → intake-radar 现有 flatten/split 与缓存后的纯聚合，不另拉数。`door-map prepareReleaseAssets buildIntakeReport --roots=scripts --include-tests`：4门（发布 CLI、雷达 CLI及各自测试）；默认 roots=src,electron 不含此链，不能当0门。写比例、读健康分别在发布和雷达边界拥有，事实不在第二处重拉。资产操作先计划、无 --yes 只读。

## ★3 一致与复用

复用 js-yaml、release-contract 的元数据/校验和结构、gh、intake-radar 的拉取/缓存/自动化排除/Markdown。两份 yml 均先验证再写，禁止工作流 sed/python/内联 node 再改比例。暂停只改 GitHub Release prerelease，不用非法0比例。重写元数据后同步 SHA256SUMS，安装包不动。

## ★4 全状态

空/主指标缺样本：样本不够并列观察日期、启动、image样本、image未知四项差额；其他指标不足写未覆盖；拉取中：原雷达输出；成功：可以全量并列image区间上界和未覆盖；回归：停止放量并非0退出；坏缓存：主指标未知、保持样本不够；能力不可用：拉数失败红退并指向现有凭据修复；过期：窗口由执行日显式锚定、不用最后有事件日冒充今天；取消中：进程停止，不执行公开写入回滚，部分资产更新失败须显式报错并交协调；无应用 i18n 变化。

## ★7 性能

不适用：不在应用运行时；没有新增创作交互/渲染路径。离线脚本只遍历现有缓存，网络复用现有有界重试，测试用小型合成事件。

## ★9 动手前验收清单与反例

- 两平台夹具：首批20/全量100；保留 version/files/sha512/size；暂停计划为 prerelease=true 且元数据不变。
- 拒绝缺比例、0、101、负数、小数、NaN、重复YAML键、非mapping、错tag/错version、缺平台、不可变资产；任何输入非法不能写其中一个平台。
- 无 --yes 不能调用上传或 Release edit；计划先打印目标、旧新比例、校验和；执行后读回验证。
- 发布工作流必须在 prepare-assets 后、upload 前经唯一脚本，env输入不拼入代码；工作流合约测试拦重复/旁路写入。
- 合成同窗事件覆盖三种结论；观察3日/启动10/image20边界，仅新版门槛挡全量；旧版少样本加宽区间，不加旧版样本硬门。
- 判停三个边界分别差一点：新版n=9、下界≤0、点差<5点；单会话集中单列不判停，两个会话才停；无sessionId不冒充两个会话。
- 固定种子1000次，旧n=300/新n=42，同率0.36判停≤5%，变差30点判停≥80%；实算比例写测试名及报告；原文56/70−48/80的区间保留四位小数吻合。
- 取消/未知不进分母；仅新版image未知挡全量；非主指标未知不挡全量但披露；自动化/窗外/未来排除；跨补丁同minor拒绝；输入非法拒绝、损坏缓存归入主指标未知；Agent缺遥测、安装完成缺遥测、次指标新版n<10进未覆盖。
- 雷达仍复用同一次抓取，旧增量状态行为不变；终端和Markdown最后一行同结论；停止退出码非0。
- 真数据只写聚合数字进私有报告，不提交真实事件/反馈/轨迹。第1轮缓存已删除，若协调未提供同一缓存，离线重算明确标未验证，不用聚合数重造事件。
- 跑相关测试、根因合同检查、pnpm run gates、推送前快检（不推送）；逐提交 fix-churn --staged 命中即停。
- 回滚：revert 本任务的实现提交；已发布更高版本另按正式流程，不在本任务操作线上。

独立验收：不适用：发版流程和脚本，非四类。


## 自验记录

| 反例/任务 | 结果 | 证据 |
|---|---|---|
| 两平台20/100、非法比例、坏YAML/校验和、未确认不能公开写、暂停不改元数据 | 通过 | release-rollout.node-test.mjs |
| 工作流缺首批输入/唯一写入口 | 改前红，改后绿 | 同一工作流合约测试 |
| 三种健康结论、低于样本边界、未知/取消/自动化/窗外/坏缓存/非法配置 | 通过 | health.node-test.mjs |
| 一天大样本代替三天观察 | 拒绝 | health.node-test.mjs观察日期用例 |
| 原雷达抓取/缓存链路中的回归，终端/Markdown末行及非0退出 | 通过 | intake-radar.node-test.mjs |
| 公开v0.24.0 full/pause | 只读计划通过，未公开写入 | 专用临时目录演练日志；私有交接报告 |
| 全套相关合成测试 | 88/88，0失败 | node --test scripts/release-rollout.node-test.mjs scripts/lib/intake-radar/*.node-test.mjs scripts/intake-radar.node-test.mjs |
| 完整gates | 本机design-lab为advisory：136项截图差异不阻断；本次无UI改动，不更新基线；完整结果见私有交接报告 | 私有交接报告保留失败摘要 |

GitHub latest 排除草稿与pre-release的原文核对：[GitHub Releases API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)。
