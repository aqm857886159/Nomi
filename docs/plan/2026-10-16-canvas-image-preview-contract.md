# 设计卡：画布图片预览契约（交给画布的图片一律带真的小预览）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：画布图片预览契约 + 旧图后台补预览 + 画布只吃预览   线/负责人：F-thumbs   类别：[长跑][其他]
```

依据：协调线 C-dense 只读调查（合成内存预算对照、真落盘探针、取图链路缺口表）；根因合同 `docs/fixes/2026-10-16-canvas-image-preview-contract.root-cause.json`；方向检查 `docs/engineering/direction-checks/2026-10-16-canvas-image-preview.md`。

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [x] 长跑 / 可打断（后台补预览队列；路径推出：production* / import*）
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式（画布结果新增 `previewState`）
- [x] 新增功能 / 性能

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当创作者把几十上百张图（生成、制作流程出片、上传、裁剪切图、抠图）铺在一张画布上平移缩放时，我想画布只读「卡在屏幕上那么大」的图，以便不卡、不缺块。步骤：①生成 / 导入 / 编辑出图 ②图落到画布卡上 ③平移缩放 ④打开老项目 ⑤点开大图仍是原图。不做：分级预览（按屏幕像素选中图）、合成层削减、改任何界面。已知坑：打开老项目后几秒内原图会换成小图（先解码再换，不空白）。真实任务：A 制作流程一批 8 镜出图后平移；B 九宫格切一张 4K 图；C 打开一个 0.22 时代的 120 图项目。主指标：画布走「预览缺失」分支的原图张数（`canvasOriginalImageStats`）；质量指标：小图长边 ≤ 1024、≠ 源；护栏：写回不进撤销、missing 不重试 | `electron/assets/canvasPreviewContract.test.ts`、`src/workbench/generationCanvas/canvasPreviewBudget.test.ts` |
| ★1b 连带界面 | 无新文案；素材库、Agent 回执、制作流程任务卡读到的仍是同一份 thumbnailRelativePath；节点「原图 / 下载 / 大图预览」仍读 url | 人工核：`NodeMediaPreviewDialog`、`ProductionRunTaskCard` 未改 |
| ★2 谁说了算 | 预览派生：`assetPreview.attachStoredAssetPreview`（主进程，`asset.video-cover`）；回执 → 画布结果两栏：`canvasMediaPreview.canvasPreviewFieldsFromReceipt`（新登记 `canvas.image-preview-fact`）；画布图片地址：`canvasImageSource.resolveCanvasImageSource`（新登记 `canvas.image-source`）；旧数据补齐：`resultMediaBackfillBridge`。同一份事实存一份（结果上的 thumbnailUrl + previewState，sidecar 是缓存）；不靠「东西不见了」猜意图 | `node scripts/door-map.mjs attachStoredAssetPreview canvasPreviewFieldsFromReceipt … resolveCanvasImageSource`（47 扇门，见合同 doors） |
| ★3 一致与复用 | 派生沿用已打包的 ffmpeg（现有 owner）；看过 Electron `nativeImage.createThumbnailFromPath`（官方文档：只支持 macOS / Windows，Windows 忽略高度），做不出长边约束 / alpha / 视频首帧，不换；换图不闪用 HTML 标准 `HTMLImageElement.decode()`。删除 `hostedAssetThumbnailUrl` 与三处「源地址填进 thumbnailUrl」的回落，无第二份定义 | `check:self-written`；`git grep hostedAssetThumbnailUrl` 为空 |
| ★4 全状态 | 有小图（ready）：画布挂小图；源已有界（source）：挂源；派生不出来（missing）：挂源并计数，不重试；没有事实（旧数据 / 只交 URL 的入口）：先挂源并计数，后台补成上面三者之一；补的过程中结果被换掉 / 换项目：放弃写回；小图解不出来：记 missing；能力不可用（ffmpeg 不在）：全部 missing，画面与改前一致。无新文案，不涉及 i18n | `resultMediaBackfillBridge.test.ts`、`canvasImageSource.test.ts` |
| 5 中途表 | 后台补预览 × 打断：用户停 / 平移——队列继续，空闲时做，不抢前台；关窗 / 换项目——在途那张的结果因项目不再当前被丢弃，已写回的留着；断网——不相关（本地文件）；重启——已写回的不再补，没写回的下次打开再补（每次启动每张只试一次）；连点重新生成——写回前核对 url，结果已换就不覆盖。无花费 | `resultMediaBackfillBridge.test.ts`「结果在补的过程中被换掉」 |
| 6 外部数据与失败 | 外部来源：用户 / 供应商给的图片字节。ffprobe 认不出（SVG 以外的坏图）→ missing；SVG → source（矢量，按显示尺寸栅格化）；ffmpeg 超时 60s → missing；规范：ffmpeg scale 滤镜 / HTML decode() | `canvasPreviewContract.test.ts`「派生不出来」 |
| ★7 性能 | ①新增操作：打开项目后的后台补预览（每张一次 ffmpeg 缩放 + 一次 decode）；出图入口的落盘多一次派生（制作流程 / 图片编辑以前没有）。②最坏规模：120 张 2048×3072 的老项目。③预算：打开到能操作不退化（project-open-100-nodes 预算 1000ms）；补预览并发 2、空闲时做，交互期间不新增 >50ms 长任务。④画布解码像素：120 张从约 755 MP 降到约 84 MP（约 1/9，`canvasPreviewBudget.test.ts` 确定性计数）；原图张数 120 → 0。磁盘：每张预览约 40KB（C-dense 真落盘探针：2048×3072 JPEG 的预览 38422 字节）；CPU：每张一次缩放。场景：`project-open-100-nodes`（数字见 PR 正文 `## 验收证据`，安静窗口跑） | `pnpm run perf:scenarios -- --id project-open-100-nodes --runs 5 --noisy` |
| 8 真实条件 | Windows：主进程入口矩阵用真 ffmpeg / ffprobe 真项目目录跑；英文界面 / 最小窗口：无界面改动，不适用；真规模：计数测试 120 张；真付费：不涉及（物化用 data: URL，0 次供应商调用） | 测试输出 |
| 拍板图清单 | 不适用：不改任何界面元素，画面内容不变（只是同一张图换成小尺寸版本） | — |
| ★9 验收与回滚 | 验收：另一条线跑 `pnpm exec vitest run electron/assets/canvasPreviewContract.test.ts src/workbench/generationCanvas/canvasPreviewDoors.test.ts src/workbench/generationCanvas/resultMediaBackfillBridge.test.ts src/workbench/generationCanvas/canvasPreviewBudget.test.ts`，并用一个旧项目副本（非用户真实项目）打开，读 `canvasOriginalImageStats()` 从 N 降到 0；铁律 ⑩⑪⑫ 不适用（不涉及参数、选项、点击语义）。回滚：revert 本 PR 的提交（`previewState` 是可选字段，旧版读到会忽略；已写回的小图 sidecar 与 `.preview.*` 文件留着无害）。独立验收：待验收线 | `## 独立验收` |
