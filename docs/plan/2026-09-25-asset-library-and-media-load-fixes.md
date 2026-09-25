# 素材库交互回归 + 媒体加载失败（09-25 一张卡）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：实施中（分支 `claude/asset-library-fixes`）· 用户 2026-09-25 要求一次做完、一个分支、每个问题一笔提交。
> 说明：这份文档是边查边写的实施记录——每个问题先用真机走查复现、再定修法；产品取舍在动手前一轮问完（见「拍板」）。
> 结构评审：[2026-09-25-asset-media-structure-review](../audit/2026-09-25-asset-media-structure-review.md)。

## 范围

| # | 用户看到的 | 修在哪（唯一 owner） |
|---|---|---|
| A1 | 素材库拖不出别的项目的图 / 视频 | `src/workbench/assets/assetLibraryMaterialize.ts` 复制关口，画布 / 时间轴 / 点击追加共用 |
| A2 | 项目素材只能删一个、对勾取消不了、拖出不能复制 | `assetLibraryUsage.nextAssetSelection`；素材格子只发一种拖拽载荷 |
| A3 | 素材标签窄栏叠字、剪辑页两个叫回 Nomi 入口 | `panelLayout.editingPanelResizeEffect`；删剪辑页竖条，只留顶栏角标 |
| B4 | 引导示例图 `app.asar` / `127.0.0.1:5273/src` 地址裂图 | `electron/workspace/buildArtifactMigration.ts` 挂在清单事务遍历上 |
| B5 | Mac 上 Sora 示例视频被 COEP 拦、推特 403 | `electron/shared/crossOriginIsolation.ts`（credentialless）；`src/media/remoteExampleMedia.ts` 失效记账 |

## 拍板（2026-09-25，一轮问完）

- 跨项目拖入：**复制一份进当前项目**（不回到 0.21 那样直接引用别的项目的文件）。
- 重复入口：**只留顶栏角标**（09-01 定稿 §11.2），删剪辑页右侧 32px 竖条。
- 隔离模式：**换 credentialless**（不加主进程代理）。
- 推特失效示例：**显示「示例已失效」占位**（不删源、不走代理）。

## 不动项

- 素材库的布局与视觉（只修交互与叠字；窄栏里标签省略，工具行不改成两行——那是换布局，要先出样张）。
- 渲染层从 file:// 加载的方式（隔离在打包版拿不到是另一件事，记 T-MD-09）。
- 画布事件日志里的旧回放载荷（打开时只回放 lastSeq 之后，不回写画布）。

## 概念占用表（R33）

| 概念 | 唯一 owner | 允许谁消费 |
|---|---|---|
| 素材库落点的项目归属 | `src/workbench/assets/assetLibraryMaterialize.ts` `materializeAssetLibraryItems` | canvasStageDrop、addAssetToTimeline、AssetLibraryPanel |
| 素材格子的选择规则 | `src/workbench/assets/assetLibraryUsage.ts` `nextAssetSelection` | AssetLibraryPanel |
| 宿主跨源隔离头 | `electron/shared/crossOriginIsolation.ts` `CROSS_ORIGIN_ISOLATION_HEADERS` | contentSecurityPolicy.ts、vite.config.ts |
| 第三方示例媒体的失效 | `src/media/remoteExampleMedia.ts` `useRemoteExampleMedia` | PromptCard、PromptPreviewOverlay、SkillMedia |
| 项目数据里的构建产物地址 | `electron/workspace/buildArtifactMigration.ts` `createBuildArtifactRewriter` | workspaceManifest（分类判据在 `electron/shared/buildArtifactUrl.ts`） |
| 剪辑面板的收起状态 | `src/workbench/preview/editingPanelLayoutSlice.ts` `visibility` | PreviewWorkspace（经 `editingPanelResizeEffect`）、PreviewSourcePanel |
| 叫回 Nomi 的入口 | `src/ui/app-shell/CollapsedAiChip.tsx` | NomiAppBar |

已登记进 `docs/engineering/concept-owners.json`。

## 先查别人

- **跨项目复制不用自己写**：主进程早有 `copyProjectAsset`（源项目、真实路径、媒体类型都在主进程校验，渲染层不经手原生路径）——`electron/assets/projectAssetStore.ts:366`；工作流库跨项目复制就在用它 `src/workbench/library/WorkflowLibraryContent.tsx:39`。A1 直接复用，不另开复制通道。
- **COEP 两档的语义**：credentialless 下跨源 no-cors 子资源不带凭据发出、不要求对方返回 CORP，页面照样 cross-origin isolated（Chrome 96 起）——https://developer.chrome.com/blog/coep-credentialless-origin-trial ；两档都满足 `crossOriginIsolated` / SharedArrayBuffer——https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy 。Electron 43.4.1（Chrome 150）自带支持，另用最小探针在真 Electron 里验了矩阵。
- **「落盘前把不稳定地址换掉」仓库里已有现成的那一遍遍历**：清单事务每次写 / 加锁读都会跑 `localizeEmbeddedMediaUrls` 把 `data:` 媒体落成文件——`electron/workspace/workspaceManifest.ts:122`。B4 挂在同一遍遍历上，不另起一个迁移器；随包示例图的落盘形状照抄引导 seed `electron/onboarding/demoAssetSeed.ts:40`（onboarding-demo sidecar，可互相复用）。
- **面板折叠**：react-resizable-panels 的 `collapsible` + `collapsedSize` 在拖过最小宽度时会自己吸成收起态，并通过 `onResize` 报出收起后的尺寸——`src/workbench/preview/PreviewWorkspace.tsx:202`；所以收起只要把这次回报写回 store 的 `visibility`，不另造拖拽判定。
- **反方**：0.21 的做法是「直接引用别的项目的文件」，最省事；08-31 的方案（`docs/plan/2026-08-31-library-discovery-slice.md`）已论证它会让项目搬走 / 删源后裂图，所以不回退，改走复制。

## 回滚

五笔提交互不依赖，可单独 revert：A1 回到「跨项目只预览」；A2 回到装饰对勾与文件夹专用载荷；B5 回到 require-corp；B4 回滚后已迁移的项目仍是 nomi-local 资产（迁移是单向的、对用户无害）；A3 回到竖条。

## 验收门

- 每个问题：改前真机走查复现（红）→ 改后 zh / en 各一遍全绿，截图亲眼看过。
- 类测试先做「改回旧行为必红」变异校验。
- 根因合同三份（A1 / B4 / B5）过 `check:root-cause-contracts`；聚类门有结构评审。
- `pnpm run gates`（Windows 上逐项对照干净 main，只允许既有红）；交工前 Ponytail，PR 正文逐条表态。
