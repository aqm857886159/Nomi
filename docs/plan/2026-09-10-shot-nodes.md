# C73 / C74 / C75：镜头反馈、媒体加载与徽标

状态：实施与真机验收、完整 gates 已通过；进入正常 hooks 提交与 PR 交付。
基线：origin/main `5c507a5cc3ee74f5fa25706165cb94cd3d2e8165`（含 #646）。
分支：fix/shot-node-feedback-badges-20260910。
用户已明确批准原地反馈、媒体就绪边界修复和 token 浮层底；按当前完整外壳实现，不另造视觉组件。

## 先查别人

反方 prior_art 只读核实当前 main，2026-09-10；本次为既有内部组件接线，不引入库或外部协议。

1. `src/workbench/observability/generationFeedback.ts:29` 已派生四态/耗时，`nodes/GenerationStatusBar.tsx:7` 已有 action；`nodes/NodeGenerationStatus.tsx:9` 却过滤终态。复用状态原子与共享时钟，不新增状态组件。
2. `src/workbench/creation/storyboard/exec/storyboardRowStatus.ts:135` 合并镜头/首帧执行态；`shotRow/StoryboardShotFrame.tsx:143` 无证据填 12%。行内反馈必须选真实活动/失败节点，删除假百分比。
3. `src/ui/notificationPolicy.ts:27` 的 identity/reason 原地分支与 [#679 通知策略](2026-09-09-notification-policy.md) 已确定成功静默；失败动作复用原宿主和重试入口，不另发 toast。
4. `src/workbench/creation/storyboard/exec/storyboardRowStatus.ts:83` 和 `StoryboardShotTable.tsx:71` 区分免费恢复与付费重生成；加载错误不可触发付费生成。
5. `nodes/ConvertShotToVideoButton.tsx:13`、`nodes/render/ShotMountBadges.tsx:36` 仅 ink-60，无底；`nodes/NodeLabelRow.tsx:9` 当前已放媒体外。沿用位置，复用 `GenerationStatusBar.tsx:24` 的 paper/90 与 ink/line token。
6. `tests/ux/ui-driver.mjs:122` overWhite 不能证明媒体对比度；沿用 `tests/ux/_feel.browser.mjs:17` 红绿模式，徽标按透明合成后的最坏媒体底测小字 ≥4.5:1。

## 现场复盘与根因

读取用户指定 gate-r2/attempt-1UrYyt 的 station-ledger、截图及隔离项目 `.nomi/project.json`，不读取真实用户资料库。八镜均 success、result.type=video、url 为 nomi-local://asset/...mp4，八镜均无 thumbnailUrl。分镜表 resultDisplayUrl 回退到 MP4，而 StoryboardShotFrame 固定用 NomiImage，因此已落盘视频仍被图片解码器判加载失败。此证据不支持靠延时/吞错修竞态。

C73：队列状态与 node.status 分属不同 owner；表行只读 node.status，节点标签过滤终态，且单行裁剪可能挤掉反馈。复用共享反馈/队列身份，在节点与表行保留活状态；失败使用既有原因与重试。C75：文字透明覆盖复杂背景缺少可保证对比度的浮层底。三项均 recurring，修复前增加类回归与 schema-v3 合同。

## 实施与验收

- 在既有 NodeGenerationStatus / GenerationStatusBar 与表行接线，时钟仍单一，队列位次取真实队列。保留免费恢复/付费重试边界。
- 分镜结果预览按 image/video 选择已有媒体解码组件；生成就绪后才显示结果，不把视频 URL 当图片。测试无缩略图视频、图片、状态切换。
- 镜头号/挂载徽标（包括 +N）采用同款 paper 半透明底、ink 字色及 line 边框；先红后绿量测。
- 隔离 Electron 真机：排队、生成中、完成、失败及重试，light/dark；徽标改前改后。截图逐张人眼审查，记录全名。只更新直接受影响视觉基线。
- `python3 scripts/with-gates-lock.py -- pnpm run gates` 等锁并获得 exit 0；正常 hooks commit/push，开一个 PR，正文引用本方案和截图。
- 写 shot-nodes-LAST.md，复制到任务书指定 scratchpad。

## 六视角审阅与回滚

CTO：同一反馈与媒体类型边界；设计：保留真实外壳，token 双主题；PM：原地四态，成功静默；前端：不造第二时钟或假进度；后端：不改生成和付费接口；用户：知道在等谁，失败能重试，已出视频能看见。回滚本任务提交即可，无持久化迁移。未验证部分如实记录，不以单测代替真机。

## 实施收据

共享缓存改用完整 immutable node 身份；节点/首帧/队列由同一个 hook 选当前反馈。新排队任务优先于旧成功结果，error 优先 recoverable，首帧运行优先旧镜头结果。节点 full/lightweight 与分镜行都复用 NodeGenerationStatus，删除轻量分支的第二套状态文案与矛盾色条。状态独立放标签上方；选中工具栏只在状态存在时上移。失败完整原因与重试保留在原 NodeErrorReport / StoryboardFrameActions，不另造动作。

- 定向单测 4 文件 23 tests 通过；C73 完成/失败过滤及同秒缓存、C74 视频错误解码均先红后绿。
- `_feel.browser.mjs` 12/12；真实 Electron 徽标最坏背景保守对比度 light/dark 均高于 4.5（详见 contrast JSON），名称/+N 的真实 TSX 类回归也通过。
- `shot-nodes-lifecycle.e2e.mjs`：供应商 loopback，用户从新建项目→添加两节点/提示词→真实批量排队→生成→真实资产本地化→第二镜配置失败→恢复配置→既有「仍要重试」完成。付费调用 0。测试通过 supplier release 控制完成时机；没有灌生产状态。
- `shot-nodes-media.e2e.mjs`：完整分镜行 renderer 契约四态双主题，排队读真实 queue store，running 的 elapsed 确实变化，失败重试回调只指向本行，完成使用隔离 nomi-local MP4 真解码 640×360；不是新一轮付费生成。
- `shot-nodes-layout.e2e.mjs`：selected/unselected × queued/running/success/error，真实完整外壳几何证明 toolbar→状态→标签→媒体互不遮挡，长错误不横溢。
- 首轮视觉矩阵 19 项：17 绿、两张直接影响图红；先更新以下两张，无断言放宽。`sb-row-06` 旧实验室只给 exec 百分比、不含节点，已补真实 running node，并只在该图的测试 setup 固定 Date 使真实 elapsed 可稳定截图。
  - `tests/ux/design-lab/__baselines__/canvas-frame/canvas-frame-shot-label-outside.png`
  - `tests/ux/design-lab/__baselines__/storyboard/sb-row-06-generating.png`

证据目录 [shot-nodes-evidence](shot-nodes-evidence/README.md)。Frame 原有暗色序号/时长徽标不属于用户点名的画布镜头号/挂载徽标，本次未扩大；变体抽屉目前没有生产 MP4 producer，未来接线需保留媒体类型。截图中其它旧页面体感发现不称为零缺陷；本任务独立对比度/几何/真实媒体与生成闭环均有直接证据。

扩展共享节点 process-feedback 矩阵发现直接受影响图，补齐实验室取景上沿后更新实际节点图；完整基线全名见 evidence README。失败摘要复用单一原地条，NodeErrorReport 保留详情/重试且不再重复摘要；排队首位无前驱不展示无行动价值的「前面0个」，有前驱仍显示真实数。完整矩阵回归以最终日志为准。

2026-09-10 并入最新 origin/main `807c475d6`（#689），无冲突，无本任务外编辑。

最终定向视觉矩阵 45/45 通过（27张直接受影响基线更新，全名见证据索引）；四态/失败后原节点重试的真实UI闭环再次通过，未放宽原有断言。

交付前整合最新 origin/main `6afb88ae8`（含 #691/#692/#693）；分镜表行导入冲突保留 anchorsConsumedBy 与 NodeGenerationStatus 两方逻辑。完整指定 gates 命令 exit 0：阻断门岗全部通过；Vitest 1305 文件 / 11938 tests 通过（1 文件 / 2 tests 原有跳过）；agent runtime 425/425；构建通过。上一轮测试夹具缺 createdAt 已补齐并移除强制断言，check:test-types 通过。文档索引/状态及研究来源 advisory 按门岗原规则不阻断，未改相关基线。最终日志 `/tmp/shot-nodes-gates-final4.log`。
