# Nomi 统一 Agent、画布与 Skill 聚合区：执行计划

本文件承接 [研究总报告](./report-source.md)。它只回答“确认方案后怎么拆、每步怎么验收”，不表示生产代码已经实现。

## 1. 交付顺序

| 阶段 | 用户可见目标 | 关键产物 | 不做什么 |
|---|---|---|---|
| 0 | 先看懂将要改什么 | 三张真实布局 HTML/SVG 样张、Icon/状态表、6 角色评审 | 不改生产 UI |
| 1 | 新用户能开始，老用户不被挡住 | 在现有 `上手 N/4`、JourneyTour、30 秒体验基础上扩展 checklist；固定左栏、五按钮 composer、Skill 空态、版本弹窗、结果条 | 不另造 onboarding store，不改视频拆解算法 |
| 2 | 创作区、Agent、画布共用创作对象 | `分镜计划` bridge、共享 shot spec、revision/重启恢复 | 不把两张表合并 |
| 3 | 视频进入画布并得到可编辑拆解表 | 视频获取节点、视频拆解表节点、关键帧行、生成关联 | 不默认铺开图片节点、不做独立字幕节点 |
| 4 | Skill 聚合站能发现、使用、追溯 | source ledger、catalog、版权/下架、SEO 详情页、应用内投影 | 不批量镜像第三方内容 |
| 5 | 用户能控制供应商且隐私可选 | 全局 provider priority、fallback receipt、opt-in telemetry | 不静默切换、不收 prompt/媒体 |
| 后置 | 更强动效与专业编辑 | HyperFrames/Remotion、复杂表格、节点微调 | 不进入本次主线 |

## 2. Phase 0 样张包

### 样张 A：Agent 三种状态

必须包含：

- docked、collapsed、fullscreen、result-focus；
- 左侧全局栏是否保留；
- 顶部标题/项目/历史/收起/全屏 Icon；
- 结果条收纳位置；
- composer 五按钮及 hover/pressed/loading/stop；
- prompt 初始、增长、内部滚动、大屏编辑四态。

### 样张 B：画布视频拆解

必须包含：

- 左侧固定栏、画布网格、视频获取节点；
- URL 输入、解析中、视频就绪；
- 连接大加号和视频拆解表节点；
- 行内关键帧和默认列；
- 表节点折叠/展开、列设置、选中行生成；
- 禁止出现自动铺满画布的图片节点堆；
- 点击生成后，明确生成的图/视频节点从表右侧出现并带来源连接。

### 样张 C：首次进入与 checklist

必须包含：

- 空状态中央 3 张任务卡；
- “查看全部”完整 checklist；
- 未开始/进行中/完成/失败/跳过；
- 任务完成勾选、下一项提示、结果收纳入口；
- 与附件参考图相似的“告诉用户哪里开始”信息层，但使用 Nomi 自己的 token、中文文案和三工作区结构。

## 3. Phase 1 文件/模块拆分建议

先复用现有 `OnboardingChecklist`、`onboardingState`、`JourneyTourController` 和已拍板的首页 v3 规范，再按单一职责拆分；不能因为新清单需求而造平行状态源。

先读完整现有组件，再按单一职责拆分：

- `ProjectAgentResidentShell`：shell 状态和布局，不承载所有结果细节；
- `AgentShellHeader`：标题、项目、历史、收起/全屏；
- `AgentComposerControls`：五按钮和状态；
- `AgentResultStrip`：收纳入口；
- `AgentArtifactViewer`：文本/表格/媒体查看路由；
- `WorkbenchSidebar`：全局左栏；
- `WorkspaceOnboardingChecklist`：在现有四步 `上手 N/4` 之上提供“首个成功闭环 + 继续探索”两层任务状态；复用现有 localStorage/真实行为判定、默认收起、TTL 和 locked-model 诚实规则；
- `SkillEmptyState` / `SkillContextPicker`：空态卡、加载 token；
- `PromptComposerEditor`：AutoGrow + small/large；
- `workbenchStore`：只增加 dock/fullscreen/result flags 和持久化 schema，不另建 Agent store。

所有可见文案走 i18n；所有尺寸、颜色、圆角、动效走现有 tokens；图标只用 Tabler。

## 4. Phase 2 共享对象

先定义数据契约和测试，再接 UI：

```ts
type ArtifactRef = {
  projectId: string;
  artifactId: string;
  revision: number;
  kind: 'script' | 'storyboard-plan' | 'video' | 'deconstruction-table' | 'image' | 'video-output';
};

type ContextHandle = ArtifactRef & {
  label: string;
  source: 'skill' | 'artifact' | 'node' | 'asset';
};

type GenerationReceipt = {
  providerKey: string;
  modelKey: string;
  fallbackReason?: string;
  sourceArtifactId?: string;
  sourceRowIds?: string[];
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
};
```

关键验收：

- Agent 修改分镜计划后，创作区和画布观察到同一 revision；
- 画布生成后，Agent 用 context handle 能引用它；
- 重启后 artifact/node/receipt 仍能恢复；
- 失败不覆盖之前成功版本；
- provider/model identity 不被 Skill 或批量生成路径丢失。

## 5. Phase 3 视频拆解表契约

### 节点操作

```text
create_video_source(url | assetRef)
resolve_video_source()
create_video_deconstruction_table(videoNodeId)
edit_deconstruction_cell(rowId, columnId, value)
select_deconstruction_rows(rowIds)
compile_shot_prompts(rowIds)
generate_selected_shots(rowIds, kind=image|video)
```

字幕、转写、音频识别作为 Agent capability/Skill 供表节点填充，不单独落节点。表节点持有 `videoNodeId`、`sourceVideoId`、`analysisRevision` 和每行 `sourceFrameUrl`；输出资产持有 `sourceRowIds`。

### 画布验收旅程

1. 用户打开生成画布；
2. 通过大加号创建视频获取节点；
3. 输入 URL 或从素材库选择；
4. 看到解析中和失败可恢复态；
5. 视频在画布内可播放；
6. 从视频节点右侧连接视频拆解；
7. 表节点生成并能展开；
8. 关键帧只在行内展示；
9. 用户编辑字幕/花字/情绪一格；
10. 用户选两行生成图片；
11. 图片节点在表右侧出现并带来源；
12. Agent 通过 `@视频拆解表` 修改一列；
13. 返回创作区或重启项目，表和结果仍然存在。

## 6. Skill Hub 数据和审核流水线

```text
source adapter
  → candidate record
  → author/license/rights check
  → content safety + prompt injection scan
  → preview/media permission check
  → human/curator review
  → catalog publish projection
  → app import/use + SEO page
  → feedback/takedown/revalidation
```

### 候选记录必须包含

- 搜索平台、关键词、时间；
- 原始页面 URL、作者主页 URL；
- repository URL、commit/tag；
- LICENSE、版权声明截图/文本摘要；
- 文本、图片、视频的分别授权；
- 能否复制、下载、导出、在 Nomi 中使用；
- 内容 hash 和抓取时间；
- 风险、审核人、状态、投诉入口；
- SEO 是否可索引。

### 首批目录策略

不要追求“越多越好”的低质量数量。第一批每个一级分类精选 3–7 个：

- 有明确任务和输入输出；
- 有真实示例或 Nomi 可复现 demo；
- 作者/来源/授权清楚；
- 能进入应用内 composer；
- 页面有原创说明和下一步教程。

后续再用自动发现扩大候选池，但未经审核的内容不进入推荐和 index。

## 7. 供应商与 telemetry 验收

### Provider

- 设置中拖动供应商排序；
- 默认模型单独显示；
- 项目/单次请求可覆盖；
- 供应商不可用时自动选择下一个；
- 任务收据显示实际 vendor/model 和 fallback 原因；
- 重启后偏好仍在，删除供应商后不留下死引用。

### Telemetry

- 首次选择明确接受/拒绝，默认拒绝；
- 关闭后本地队列立即清理；
- 不记录 prompt、媒体、URL、文件名、key、微信内容；
- 仅发送聚合计数/耗时桶/失败类别；
- 断网不阻塞主产品；
- 用户可以再次打开设置改变选择。

## 8. 完成标准

不能用“代码已写”“页面能打开”“测试全绿”作为唯一完成条件。每阶段完成必须同时满足：

- [ ] 改动范围和旧路径清理清楚；
- [ ] 单元/契约测试覆盖状态、权限、持久化；
- [ ] 真实用户任务在 Electron/Playwright 跑通；
- [ ] 真实失败路径能恢复；
- [ ] 重启后对象和 receipt 仍在；
- [ ] 截图人眼检查布局、密度、Icon、文案、空状态和动效；
- [ ] 与获批样张逐项对账；
- [ ] i18n/token/boundary/heavy-path/filesize 检查通过；
- [ ] 没有把 fixture、注入 store、静态 mock 当作 live 证据；
- [ ] PR 中报告 exact base/head、测试和未证实边界。

## 9. 下一步

方案获确认后，下一轮只做 Phase 0：先生成三张真实样张和一张“全量需求回勾表”的 UI 版本，邀请用户逐项确认。确认后再把 Phase 1–3 拆成独立 PR/任务，且每个任务都保留本报告的 ID（例如 `A-04`、`V-04`、`U-03`），避免实施时又把小 Icon、侧栏或引导漏掉。
