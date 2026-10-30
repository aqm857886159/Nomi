# workbench effect cleanup 普查

范围：`src/workbench` 的 `useEffect` / `useLayoutEffect`（含 `React.`），TypeScript AST 提取 377 个返回表达式，含 `undefined`、直接 setup 调用及其返回的 disposer；不是 377 个业务 cleanup。再按关闭、写状态、发事件及间接 callback 逐项核调用者。原始明细在本线外部报告的证据目录，不将用户资料入库。

| 位置 | cleanup 动作 | 判断与处置 |
|---|---|---|
| `whiteboard/InlineWhiteboard.tsx` | `closeWhiteboard(nodeId)` | 同类：setup 未开启，cleanup 却关闭项目会话；本提交删除 |
| 同上草稿 debounce | 取子 ref 后写节点 meta | 幂等保存允许，但卸载时 ref 已清空；改为变更时捕获快照，cleanup 幂等 flush；源不存在或项目失效不写 |
| 同上 finish 注册 | 注销 `registerWhiteboardFinish` | 只撤销 setup 注册，保留 |
| `nodes/nodeAttachedPanel.ts` | Map 计数、emit | 对称撤销 setup 的视图占用；不是用户会话关闭，保留 |
| `nodes/NodeVideoClipPanel.tsx` | pause、清 selection、setEditing(false) | `setEditing(true)` 的视图级预览租约；setup 重建 range，编辑会话不在外部 store；保留 |
| `nodes/render/TextDocumentNode.tsx` | onEditingChange(false) | 另一 effect 投影 editor.isFocused，清理仅撤销聚焦格式条投影，重放恢复；不是文档会话，保留 |
| `nodes/PanoramaViewer.tsx` | setViewer(null)、destroy | 撤销 setup 新建的 viewer 实例；保留 |
| 同上 fullscreen 注册 | onEnterFullscreen(null) | setup 注册 openFullscreen，cleanup 注销同一能力，保留；全屏 UI 会话统一本次不改 |
| `nodes/versionCards/NodeVersionCardsHost.tsx` | publishVersionGridCoverage(null) | setup 发布展开布局占位，cleanup 撤销；保留 |
| `ai/ProjectAgentResidentShell.tsx` | cancelReferencePick | 取消本视图发起的引用拾取，非持久编辑器会话；保留 |
| 同上 planner | setStoryboardPlannerLauncher(null) | setup 注册创作页 launcher，cleanup 注销；保留 |
| 同上 dock badge | setResidentDockBadge(null,0,0) | 撤销相邻 effect 发布的当前视图徽标投影；重放会重新发布，不结束 Agent 回合；保留 |
| `ai/pointer/NodePointer.tsx` | releaseHover(owner) | setup acquire 的 hover 租约释放；保留 |
| `creation/aiRewrite/aiRewriteBinding.ts` | created.dispose、setController(null) | 撤销 setup 创建的 controller，保留 |
| `creation/storyboard/shotRow/promptHistoryCarry.ts` | 写行历史缓存 | 幂等保留卸载编辑器历史，不关闭业务会话；保留 |
| `ai/v4/AgentPanelV4Panel.tsx` | 写 scrollMemory / paging owner | 幂等记滚动位置、作废视图分页请求，保留 |
| `NomiStudioApp.tsx` | unbind project persistence | setup bind 返回的 disposer，负责保存释放自己的绑定；保留 |
| 同上 read/write/bridge 注册 | 返回 unregister | setup / cleanup 对称能力注册，不结束项目，保留 |
| `components/useCanvasSelectionDrag.ts` | settleDrag | 收尾当前组件拥有的 pointer 手势并落定已发生移动，保留 |
| `nodes/useNodeDragResize.ts`、React Flow pointer / timelineGesture | cancel / dispose gesture、释放 lease | 释放当前视图拥有的手势捕获与暂态；不是持久编辑器会话，保留 |
| `settings/AttentionSoundSection.tsx` | stop preview | 关闭当前组件拥有的试听资源，非用户创作会话；保留 |
| `nodes/whiteboard/WhiteboardLeaferCanvas.tsx` 等绘画 hooks | destroy app / 清预览 / 撤监听 | 释放 setup 创建的实例和资源；保留 |
| `nodes/director/panels/inspector/CharacterInspector.tsx` | setSkeletonEditing(false)、清骨骼 selection | 导演台线占用，只列不改；tab setup 会设 true，但清原 selection 的重放语义建议该线核 |
| `nodes/director/panels/viewport/DirectorViewport.tsx` | setOrbitEnabled(true) | 导演台线占用，只列不改；待核与 setup 禁用 orbit 是否对称 |
| `nodes/director/useMobileCamera.ts` | cleanup 无条件 mobile.stop | 疑似同类：setup 无对应 start，远端会话由事件开启；导演台线占用，只列不改，交协调排会话统一 |
| `nodes/director/useDirectorOutputs.ts` | mounted=false，operation.cancelled=true | 导演台线占用，只列不改；异步捕获所有权取消，建议核节点虚拟化时任务是否应持续 |
| `nodes/director/DirectorEditor.tsx` | persistence.start 返回 stop/save | 导演台线占用，只列不改；对称持久化绑定，cleanup 保存符合规则 |
| `nodes/director/scene/*` | closeBackdrop、remove scene object、dispose | 导演台线占用，只列不改；按 setup 创建的场景资源释放，非项目会话 |
| 其余返回表达式 | 撤监听 / unsubscribe / clearTimeout / observer.disconnect / alive=false | 无持久业务动作；保留。`setDraft(value)`、`setFrameReady(false)` 是 setup 返回 void，不是 cleanup |

## 交协调的 TODO

- 导演台 `useMobileCamera` 无条件停止远端会话的 cleanup：建议与 0.25 编辑器会话统一一起界定主人；本线不碰导演目录。
- 导演台 skeleton / orbit / async output 的 cleanup：由占用该概念的导演台实现线核对 replay 与虚拟化，未在本线验证，不据此声称已发现或修复用户可见故障。
- 本次保留「第一下只选中」，没有新增任何 StrictMode 检测、等待、重试或关闭 StrictMode 的生产分支。
