# 分镜 v6：编辑态与生成态双状态设计

## 目标与用户摩擦

分镜表要把“准备一镜”和“审阅一镜”分开。准备时用户需要选模型、模式、提示词和参考素材；生成后用户需要看清楚结果、播放视频、引用结果并送入时间轴。当前两类信息挤在一行，具名首帧/尾帧槽只有虚线入口，锚卡也没有完整的模型模式配置，文本编辑器还必须保持为拆镜的来源。

## 现状证据与设计依据

- `StoryboardShotRow.tsx:260-337` 同时放置参考区、模型/画幅/时长和提示词；`StoryboardShotRowExpand.tsx` 才放绑定和参数，导致主流程隐藏。
- `shotRowModel.ts:41-133` 已从 `ArchetypeMode.slots` 派生参考区，但 `missingRequiredSlots` 对 `image_ref` 以外的必填槽只能恒报缺失，具名槽没有上传实现。
- `StoryboardAnchorCard.tsx:180-300` 编辑态只有名称、类型、载体和描述；`StoryboardPlanEditor.tsx:343-356` 固定传 `imageModelOptions`，锚没有 mode/params/reference draft。
- `electron/shared/videoCapabilities/types.ts:31-61` 已定义 `first_frame/last_frame/image_ref/video_ref/audio_ref/source_video`、`min/max/inputKey/asArray`；`src/config/modelArchetypes/types.ts:92+` 定义 mode 参数与传输类型。这些是唯一能力真源。
- 结果引用和预览已有 `StoryboardPlanEditor.tsx:230-315`；时间轴采纳由 `sendStoryboardToTimeline.ts`、`adoptStoryboardBatch.ts` 提供；预览/导出由 `TimelinePreview.tsx:45-125`、`exportTimelineToMp4.ts` 提供。
- 样张 `docs/design/mockups/2026-09-01-storyboard-table-image-first.html:78-106,160,345,381-453,527,692-696` 规定行骨架、56px 参考 tile、悬停/双击预览、结果动作、多选、锁定与比例放大。
- commit `680e0289` 恢复 `CreationWorkspace` 中 `WorkbenchEditor` 为文本源；`4c8063eb` 修复无图模型选择；PR #223/commit `b90a0aa4` 确立 Agent/画布能力边界。

## 状态与数据模型

每镜状态为 `draft → queued → generating → ready | failed | stale`。`PlanShot.generationDraft` 保存 `modelKey/modeId/params/prompt`；`referenceBindings` 是 `slotKind/inputKey → 有序 AssetRef[]`，保留未知键以便前向兼容；结果保存 `resultNodeId/resultAssetId/contentHash/acceptedRevision`。锚增加 `generationProfile:{modelKey,modeId,params}`，旧 `anchor.modelKey` 迁入其中。

编辑态只写 draft；生成成功先写不可变结果资产。用户显式点击“引用到下一镜/设为首帧/采纳时间轴”才写 binding 或 adoption receipt，避免隐式污染。失败保留 draft 和错误诊断，重试生成新 attempt；stale 表示引用内容 hash 已变化。

## 布局与交互

编辑态左侧为固定比例的结果格，右侧依次为模型→模式→动态参考槽→提示词→参数；每个槽显示 label、必填标记、已用/上限计数，并提供上传、素材库、@ 引用。视频槽只接受视频，图片槽只接受图片；超过 max 或缺必填在生成前阻断并说明原因。

生成态将结果合并为大卡：视频使用原生播放控件，图片 `object-contain`，宽高比来自 mode 的 `aspect_ratio`。卡下提供重生成、变体、锁定、放大、保存为锚、设为后续首帧、采纳时间轴。编辑态与结果态可展开/收起；旧有复制、移动场景、删除、台词、转场、拖拽、多选、键盘和撤销全部保留。镜头结果格按样张 land 变体至少 176px；锚缩略图保留 108×144，但编辑空态必须直接出现“选模型/写描述/上传”。

## 能力槽矩阵

| 槽 | UI 形态 | 输入 | 约束 |
|---|---|---|---|
| `first_frame` / `last_frame` | 单独具名槽 | 单张图片、结果或上传 | `min/max`，按声明映射 |
| `source_video` | 单独具名槽 | 单个视频 | 禁止图片，按声明映射 |
| `image_ref` | 可追加数组槽 | 图片/视觉锚/@引用 | `min/max`，保序 |
| `video_ref` | 可追加数组槽 | 视频/素材库 | `min/max`，保序 |
| `audio_ref` | 可追加数组槽 | 音频 | `min/max`，保序 |

mode 切换不删除 flat binding；请求构造只发送当前 mode 声明的槽，统一走 `inputKey`、`asArray`、`combineSlotsInto`，不为 Seedance 等供应商写分支。

## 自动引用、迁移与兼容

默认不自动引用；提供显式“生成后自动引用下一镜”开关，写入 `sourceNodeId/contentHash/provenance`。旧 `anchorIds` 映射到 `image_ref`，无法映射的保留锚并显示警告；旧 `modelKey/modeId/params` 迁入 generationDraft/profile；结果节点反向 hydrate accepted 状态。空项目仍先显示文本编辑器，拆镜是显式动作。

## PR 拆分与验收

A：契约、迁移、序列化与单测；B：slot 上传/素材库/@引用和模型模式选择；C：结果卡、播放、引用与时间轴采纳；D：锚卡双状态；E：设计系统、真实 Electron 旅程和视觉修正。每个 PR 先写根因合同和计划。

真实验收必须在同一隔离项目完成：WorkbenchEditor 写剧本→显式拆分镜→Seedance 等模型选择→按能力上传图/视频→逐字段核对请求体→真实 provider 生成→结果卡播放和比例检查→显式引用下一镜→批量采纳时间轴→剪辑/预览→ffprobe 可播放 MP4→关闭重启后恢复剧本、分镜、bindings、结果、receipt/revision。另测不支持槽、超过 max、失败重试、stale 引用、拒绝和部分完成。截图需与样张并排人工检查；fixture/loopback 只能作低层回归，不能冒充 live 产物。

## 风险与不动项

风险是 provider 对同一模型的字段、数量和传输桶不同；只能扩充档案声明与映射，不能复制模型 UI。上传失败、额度、超时和未知提交必须可见且可恢复。保持 React Flow 为唯一画布内核、Zustand 为业务真源、Agent/MCP 共用 capability 与 receipt；不重建时间轴、导出或第二套参考抽象。
