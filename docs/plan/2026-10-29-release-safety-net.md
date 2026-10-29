# 发版安全网：分批放量与每日版本健康

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

真实任务：对公开 v0.24.0 做只读 dry-run；副本缓存比较请求版本 0.24.0/0.23.2；现有发布资产结构做盘点。线上写入不执行，真实发布结果 unverified。主指标：image/video 各能力 failure/(success+failure)，量具为 generation.completed；质量指标：失败中 <1s 且 unknown 的占比、Agent 回合 failure，量具为同一遥测事件；护栏：启动样本、update.action 下载/安装结果，量具为 app.started/update.action。缺样本不得报正常。补丁版本无法区分，只能诚实写 0.24 与0.23；Agent 事件有契约但样本没有时写「遥测缺这一项」。安装 success 只表示安装动作受理，不证明重启后安装成功。阈值根据0.23聚合数确定；政策值无依据则标「待协调定」，未定不许给「可以全量」。

★1b：不改应用界面；回执仅终端/Markdown/JSON，最后一行只能三选一。

## ★2 唯一 owner、数门

公开更新比例 → 发布脚本唯一改写边界；发布工作流只调用它。版本健康 → intake-radar 现有 flatten/split 与缓存后的纯聚合，不另拉数。`door-map prepareReleaseAssets buildIntakeReport --roots=scripts --include-tests`：4门（发布 CLI、雷达 CLI及各自测试）；默认 roots=src,electron 不含此链，不能当0门。写比例、读健康分别在发布和雷达边界拥有，事实不在第二处重拉。资产操作先计划、无 --yes 只读。

## ★3 一致与复用

复用 js-yaml、release-contract 的元数据/校验和结构、gh、intake-radar 的拉取/缓存/自动化排除/Markdown。两份 yml 均先验证再写，禁止工作流 sed/python/内联 node 再改比例。暂停只改 GitHub Release prerelease，不用非法0比例。重写元数据后同步 SHA256SUMS，安装包不动。

## ★4 全状态

空/缺指标：样本不够并逐项列缺数；拉取中：原雷达输出；成功：可以全量；回归：停止放量并非0退出；部分失败/坏缓存：不能全量；能力不可用：拉数失败红退并指向现有凭据修复；过期：窗口由执行日显式锚定、不用最后有事件日冒充今天；取消中：进程停止，不执行公开写入回滚，部分资产更新失败须显式报错并交协调；无应用 i18n 变化。

## ★7 性能

不适用：不在应用运行时；没有新增创作交互/渲染路径。离线脚本只遍历现有缓存，网络复用现有有界重试，测试用小型合成事件。

## ★9 动手前验收清单与反例

- 两平台夹具：首批20/全量100；保留 version/files/sha512/size；暂停计划为 prerelease=true 且元数据不变。
- 拒绝缺比例、0、101、负数、小数、NaN、重复YAML键、非mapping、错tag/错version、缺平台、不可变资产；任何输入非法不能写其中一个平台。
- 无 --yes 不能调用上传或 Release edit；计划先打印目标、旧新比例、校验和；执行后读回验证。
- 发布工作流必须在 prepare-assets 后、upload 前经唯一脚本，env输入不拼入代码；工作流合约测试拦重复/旁路写入。
- 合成同窗事件覆盖「可以全量」「停止放量」「样本不够」；停止优先于其他缺样本；新/旧任一低于门槛、取消/未知结果、无失败的条件分母、自动化/窗外/未来事件、跨补丁同minor不可区分、缺Agent、缺下载/安装、损坏缓存、待协调阈值不能放行。
- 雷达仍复用同一次抓取，旧增量状态行为不变；终端和Markdown最后一行同结论；停止退出码非0。
- 真数据只写聚合数字进私有报告，不提交真实事件/反馈/轨迹。当前副本lastRun为2026-10-28，首次刷新账号查询超时；不得声称已有0.24当前结论。
- 跑相关测试、根因合同检查、pnpm run gates、推送前快检（不推送）；逐提交 fix-churn --staged 命中即停。
- 回滚：revert 本任务的实现提交；已发布更高版本另按正式流程，不在本任务操作线上。

独立验收：不适用：发版流程和脚本，非四类。
