> Correction: the88 rows are feature families, not every UI control. See `control-inventory.json` for the generated production AST bindings and explicit existing-walk mapping gaps. Document duplication is unavailable; the duplication control only handles storyboard designs. Planned source bindings are not execution.

# Source/UI entry inventory — first repair batch

Source-audited entry families, not a claim that every control has been implemented. Stable IDs and full precondition/input/visible/data/budget contracts live in `entry-inventory.json`. Fine-grained controls found through full-walk catalog reconciliation must be added before full coverage is claimed.

Entries: 88; implemented: 1 (`project.open` only). Execution/pass receipts live in immutable raw runs. All full P/D/B/C/A/R journeys remain planned. Agent labels/timers alone are not behavior.

| ID | Entry / availability | Source / production door | Planned | Implemented | Executed | Passed |
| --- | --- | --- | --- | --- | --- | --- |
| project.open | 打开项目 (reachable) | `src/workbench/library/ProjectLibraryPage.tsx` / `production UI controls` | yes | yes | small cold/hot receipts | no |
| project.create | 新建空白项目 (reachable) | `src/workbench/library/ProjectLibraryPage.tsx` / `production UI controls` | yes | no | unverified | no |
| project.import-folder | 打开/导入目录 (reachable) | `src/workbench/library/ProjectLibraryPage.tsx` / `production UI controls` | yes | no | unverified | no |
| project.rename | 项目改名 (reachable) | `src/workbench/library/ProjectLibraryPage.tsx` / `production UI controls` | yes | no | unverified | no |
| project.delete | 项目删除/恢复 (reachable) | `src/workbench/library/ProjectLibraryPage.tsx` / `production UI controls` | yes | no | unverified | no |
| project.recover | 缺失素材/项目恢复 (reachable) | `src/workbench/library/ProjectLibraryPage.tsx` / `production UI controls` | yes | no | unverified | no |
| project.close | 返回库 (reachable) | `src/ui/app-shell/shell/ShellTopBar.tsx` / `production UI controls` | yes | no | unverified | no |
| project.switch | 项目A/B/A (reachable) | `src/ui/app-shell/shell/ShellTopBar.tsx` / `production UI controls` | yes | no | unverified | no |
| project.save-reopen | 保存/重启 (reachable) | `src/workbench/project/workbenchProjectSession.ts` / `production UI controls` | yes | no | unverified | no |
| workspace.creation | 工作区 creation (reachable) | `src/workbench/WorkbenchShell.tsx` / `workspace mode/stepper` | yes | no | unverified | no |
| workspace.storyboard | 工作区 storyboard (reachable) | `src/workbench/WorkbenchShell.tsx` / `workspace mode/stepper` | yes | no | unverified | no |
| workspace.generation | 工作区 generation (reachable) | `src/workbench/WorkbenchShell.tsx` / `workspace mode/stepper` | yes | no | unverified | no |
| workspace.preview | 工作区 preview (reachable) | `src/workbench/WorkbenchShell.tsx` / `workspace mode/stepper` | yes | no | unverified | no |
| drawer.docs | 抽屉 docs (reachable) | `src/ui/app-shell/shell/ShellRail.tsx` / `data-shell-rail-item=docs` | yes | no | unverified | no |
| drawer.catalog | 抽屉 catalog (reachable) | `src/ui/app-shell/shell/ShellRail.tsx` / `data-shell-rail-item=catalog` | yes | no | unverified | no |
| drawer.assets | 抽屉 assets (reachable) | `src/ui/app-shell/shell/ShellRail.tsx` / `data-shell-rail-item=assets` | yes | no | unverified | no |
| drawer.flows | 抽屉 flows (reachable) | `src/ui/app-shell/shell/ShellRail.tsx` / `data-shell-rail-item=flows` | yes | no | unverified | no |
| drawer.skills | 抽屉 skills (reachable) | `src/ui/app-shell/shell/ShellRail.tsx` / `data-shell-rail-item=skills` | yes | no | unverified | no |
| drawer.prompts | 抽屉 prompts (reachable) | `src/ui/app-shell/shell/ShellRail.tsx` / `data-shell-rail-item=prompts` | yes | no | unverified | no |
| document.create | 新增文稿 (reachable) | `src/workbench/creation/DocumentListSidebar.tsx` / `production UI controls` | yes | no | unverified | no |
| document.switch | 多稿切换 (reachable) | `src/workbench/creation/DocumentListSidebar.tsx` / `production UI controls` | yes | no | unverified | no |
| document.rename | 文稿改名 (reachable) | `src/workbench/creation/DocumentListSidebar.tsx` / `production UI controls` | yes | no | unverified | no |
| document.duplicate | 文稿复制 (unavailable) | `src/workbench/creation/DocumentListSidebar.tsx` / `duplicate exists only for storyboard` | no | no | unverified | no |
| document.delete | 删除文稿与撤销 (reachable) | `src/workbench/creation/DocumentListSidebar.tsx` / `production UI controls` | yes | no | unverified | no |
| document.edit | 文稿连续编辑/历史 (reachable) | `src/workbench/creation/CreationWorkspace.tsx` / `production UI controls` | yes | no | unverified | no |
| storyboard.create | 同文稿多方案 (reachable) | `src/workbench/creation/DocumentListSidebar.tsx` / `production UI controls` | yes | no | unverified | no |
| storyboard.switch | 竞争方案切换 (reachable) | `src/workbench/creation/DocumentListSidebar.tsx` / `production UI controls` | yes | no | unverified | no |
| storyboard.rename | 方案改名 (reachable) | `src/workbench/creation/DocumentListSidebar.tsx` / `production UI controls` | yes | no | unverified | no |
| storyboard.duplicate | 方案复制 (reachable) | `src/workbench/creation/DocumentListSidebar.tsx` / `production UI controls` | yes | no | unverified | no |
| storyboard.delete | 方案删除/撤销 (reachable) | `src/workbench/creation/DocumentListSidebar.tsx` / `production UI controls` | yes | no | unverified | no |
| storyboard.shot-edit | 镜头增改排序 (reachable) | `src/workbench/creation/storyboard/StoryboardShotTable.tsx` / `production UI controls` | yes | no | unverified | no |
| storyboard.batch | 镜头批量操作 (reachable) | `src/workbench/creation/storyboard/StoryboardSelectionToolbar.tsx` / `production UI controls` | yes | no | unverified | no |
| storyboard.commit | 方案落画布 (reachable) | `src/workbench/creation/storyboard/StoryboardWorkspace.tsx` / `production UI controls` | yes | no | unverified | no |
| canvas.navigate | 缩放/平移 (reachable) | `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx` / `production canvas/node control` | yes | no | unverified | no |
| canvas.select-drag | 多选/拖动 (reachable) | `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx` / `production canvas/node control` | yes | no | unverified | no |
| canvas.references | 混合参考连接 (reachable) | `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx` / `production canvas/node control` | yes | no | unverified | no |
| canvas.prompt | 提示词编辑 (reachable) | `src/workbench/generationCanvas/nodes/TextNodeComposer.tsx` / `production canvas/node control` | yes | no | unverified | no |
| canvas.group | 编组混合媒体 (reachable) | `src/workbench/generationCanvas/components/CanvasGroupToolbar.tsx` / `production canvas/node control` | yes | no | unverified | no |
| canvas.versions | 结果历史比较 (reachable) | `src/workbench/generationCanvas/nodes/versionCards/NodeVersionCards.tsx` / `production canvas/node control` | yes | no | unverified | no |
| canvas.media-preview | 图/视频预览 (reachable) | `src/workbench/generationCanvas/nodes/useNodeMediaPreview.tsx` / `production canvas/node control` | yes | no | unverified | no |
| canvas.generation | 生成/队列/取消/重试 (reachable) | `src/workbench/generationCanvas/runner/generationQueueStore.ts` / `production canvas/node control` | yes | no | unverified | no |
| canvas.download | 结果下载 (reachable) | `src/workbench/generationCanvas/nodes/NodeFloatingToolbar.tsx` / `production canvas/node control` | yes | no | unverified | no |
| canvas.view-mode | 画布/列表切换 (reachable) | `src/workbench/generation/GenerationWorkspace.tsx` / `production UI controls` | yes | no | unverified | no |
| node.shot_table | 节点 shot_table (projection/internal) | `src/workbench/generationCanvas/nodes/registry.ts` / `registry kind=shot_table` | yes | no | unverified | no |
| node.text | 节点 text (quick-add) | `src/workbench/generationCanvas/nodes/registry.ts` / `registry kind=text` | yes | no | unverified | no |
| node.character | 节点 character (quick-add) | `src/workbench/generationCanvas/nodes/registry.ts` / `registry kind=character` | yes | no | unverified | no |
| node.scene | 节点 scene (quick-add) | `src/workbench/generationCanvas/nodes/registry.ts` / `registry kind=scene` | yes | no | unverified | no |
| node.image | 节点 image (quick-add) | `src/workbench/generationCanvas/nodes/registry.ts` / `registry kind=image` | yes | no | unverified | no |
| node.keyframe | 节点 keyframe (quick-add) | `src/workbench/generationCanvas/nodes/registry.ts` / `registry kind=keyframe` | yes | no | unverified | no |
| node.video | 节点 video (quick-add) | `src/workbench/generationCanvas/nodes/registry.ts` / `registry kind=video` | yes | no | unverified | no |
| node.audio | 节点 audio (quick-add) | `src/workbench/generationCanvas/nodes/registry.ts` / `registry kind=audio` | yes | no | unverified | no |
| node.clip | 节点 clip (quick-add) | `src/workbench/generationCanvas/nodes/registry.ts` / `registry kind=clip` | yes | no | unverified | no |
| node.shot | 节点 shot (quick-add) | `src/workbench/generationCanvas/nodes/registry.ts` / `registry kind=shot` | yes | no | unverified | no |
| node.output | 节点 output (quick-add) | `src/workbench/generationCanvas/nodes/registry.ts` / `registry kind=output` | yes | no | unverified | no |
| node.panorama | 节点 panorama (quick-add) | `src/workbench/generationCanvas/nodes/registry.ts` / `registry kind=panorama` | yes | no | unverified | no |
| node.director | 节点 director (quick-add) | `src/workbench/generationCanvas/nodes/registry.ts` / `registry kind=director` | yes | no | unverified | no |
| node.whiteboard | 节点 whiteboard (quick-add) | `src/workbench/generationCanvas/nodes/registry.ts` / `registry kind=whiteboard` | yes | no | unverified | no |
| node.model3d | 节点 model3d (quick-add) | `src/workbench/generationCanvas/nodes/registry.ts` / `registry kind=model3d` | yes | no | unverified | no |
| node.asset | 节点 asset (import-only) | `src/workbench/generationCanvas/nodes/registry.ts` / `registry kind=asset` | yes | no | unverified | no |
| node.agent-artifact | 节点 agent-artifact (agent-only) | `src/workbench/generationCanvas/nodes/registry.ts` / `registry kind=agent-artifact` | yes | no | unverified | no |
| agent.conversations | 多对话切换 (reachable) | `src/workbench/ai/ProjectAgentResidentShell.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| agent.stream | 流式/取消 (reachable) | `src/workbench/ai/v4/AgentPanelV4Panel.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| agent.tools | 工具/失败重试 (reachable) | `src/workbench/ai/v4/useAgentPanelV4Actions.ts` / `production UI / existing walk` | yes | no | unverified | no |
| agent.concurrent | 多对话并发流/工具 (reachable) | `src/workbench/ai/ProjectAgentResidentShell.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| agent.approvals | 审批/拒绝/撤回 (reachable) | `src/workbench/ai/v4/AgentPanelV4Cards.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| agent.attachments | 引用/附件 (reachable) | `src/workbench/ai/resident/residentReferences.ts` / `production UI / existing walk` | yes | no | unverified | no |
| agent.undo-reconnect | 撤销/重连恢复 (reachable) | `src/workbench/ai/v4/useAgentPanelV4Actions.ts` / `production UI / existing walk` | yes | no | unverified | no |
| agent.form | 小球/浮窗/停靠 (reachable) | `src/ui/app-shell/shell/ShellAgentHost.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| timeline.edit | 时间轴多轨编辑 (reachable) | `src/workbench/preview/PreviewWorkspace.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| preview.playback | 播放/跳帧/停止 (reachable) | `src/workbench/preview/PreviewControlBar.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| preview.overlay | 标题/字幕/转场 (reachable) | `src/workbench/preview/PreviewControlBar.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| export.mp4 | MP4导出/取消/失败恢复 (reachable) | `src/ui/app-shell/shell/ShellTopBar.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| audio.import-play | 音频导入/播放 (reachable) | `src/workbench/assets/importAudioToLibrary.ts` / `production UI / existing walk` | yes | no | unverified | no |
| assets.import-search | 素材库导入/搜索 (reachable) | `src/workbench/assets/AssetLibraryPanel.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| library.flows | 流程库复用 (reachable) | `src/workbench/library/WorkflowLibraryContent.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| library.skills | Skill库导入/选择 (reachable) | `src/workbench/skillLibrary/SkillLibraryPanel.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| library.prompts | 提示词保存/复用 (reachable) | `src/workbench/promptLibrary/PromptLibraryPanel.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| tasks.monitor | 任务中心并发/取消 (reachable) | `src/workbench/taskCenter/TaskCenterPanel.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| browser.navigate | 浏览器导航/历史 (reachable) | `src/ui/browser/dialog/NomiBrowserDialog.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| browser.capture-import | 浏览器多媒体捕获 (reachable) | `src/ui/browser/popover/BrowserAssetPopoverView.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| onboarding.help | 首启/教程/帮助 (reachable) | `src/workbench/NomiStudioApp.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| window.interrupt | 窗口/键盘/遮罩打断 (reachable) | `src/ui/app-shell/shell/ShellFrame.tsx` / `production UI / existing walk` | yes | no | unverified | no |
| settings.file | 设置 file (reachable) | `src/workbench/settings/SettingsDialog.tsx` / `data-settings-tab-id=file` | yes | no | unverified | no |
| settings.models | 设置 models (reachable) | `src/workbench/settings/SettingsDialog.tsx` / `data-settings-tab-id=models` | yes | no | unverified | no |
| settings.ai | 设置 ai (reachable) | `src/workbench/settings/SettingsDialog.tsx` / `data-settings-tab-id=ai` | yes | no | unverified | no |
| settings.automation | 设置 automation (reachable) | `src/workbench/settings/SettingsDialog.tsx` / `data-settings-tab-id=automation` | yes | no | unverified | no |
| settings.general | 设置 general (reachable) | `src/workbench/settings/SettingsDialog.tsx` / `data-settings-tab-id=general` | yes | no | unverified | no |
| settings.about | 设置 about (reachable) | `src/workbench/settings/SettingsDialog.tsx` / `data-settings-tab-id=about` | yes | no | unverified | no |

## Reconciliation and combination policy

- ShellTopBar/ShellRail/WorkbenchShell: topbar/project menu, six drawers, four workspaces. DocumentListSidebar already has stable document/design selectors; unavailable selectors were not the true blocker.
- Node registry: 17 current kinds including import-only asset, Agent-only artifact and projected/internal shot table. No retired path silently excluded. Capability-dependent entries remain unverified until local production-boundary fixtures exist.
- `tests/ux/full-walk/catalog.mjs` owns fine-grained click targets and existing walk references; historic walk results are not this PR performance execution. `tests/ux/_shell.mjs` and `agent-runtime-walk-support.mjs` own reusable UI/runtime peers.
- Every feature first gets solo baseline at applicable scales, cold/hot, Agent idle, 1 warm-up + 5 runs. `combination-plan.json` enumerates additional pairwise scale/cache/workspace/Agent cases and mandatory higher-order cases; all planned. Pairwise supplements solo baselines.
- Independent reviewer/Mac line are read-only. This implementation line alone edits the branch.
