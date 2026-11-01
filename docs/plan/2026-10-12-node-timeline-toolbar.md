# 节点加入时间轴入口迁移

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

实现线：T-node-timeline；独立普查 / 验收线：toolbar_census。类别：现有界面单一动作迁移。

拍板：2026-10-12，用户查看 `node-timeline-interaction.html` 后确认「看到了 没啥问题」。

用户指令：把图片、视频节点中间 hover 刘海的「加入时间轴」变成现有节点工具栏 icon，注意不要遗漏。按此明确方向迁移，不重设计节点或新增操作模式。刘海 hover 异常未确定复现，本次通过删除该入口退出此机制。

| 设计卡 | 决定 / 验证 |
| --- | --- |
| ★1 用户任务 | 选中本地导入图片 → 点时间轴 icon → 片尾出现图片 → 撤销；选中真实视频 → 从同 icon 拖入指定位置 → 播放 → 撤销；切换主版本 → 再加入 → 使用新主结果。主指标：上述三条零遗漏；质量：中英 / 明暗 / 窄窗可见且不遮图；护栏：不生成、不新增花费、保持幂等。基线是点击 / 拖拽两种旧操作。 |
| ★1b 连带界面 | 保留现有中英加入时间轴 tooltip、采纳回执、自动展开与 Undo；剪辑节点仍接受原 MIME；版本宫格的设主图 / 下载 / 删除 / Alt 拖出不变。 |
| ★2 唯一 owner | 落轴事实归 adoptGenerationNode；UI 入口归 FloatingToolbarShell，按 nodeId 读取当前节点；可用性归 canDragGenerationNodeToTimeline。门表见本次 root-cause 合同。 |
| ★3 一致与复用 | 复用 ToolbarIconButton、已有 IconTimeline、现有采纳桥与拖拽载荷；删除 TimelineNotchDragHandle，不留双入口。图片 / 视频 / 音频工具栏共享动作。 |
| ★4 全状态 | 空 / error / queued / running / readonly / panorama / 非媒体：不显示可落轴动作；有可采纳结果：显示；主版本变化：即时读取；本机裁剪忙态沿用现有主结果约定；多选沿用现有不显示单节点浮条约定。中英 aria 与 title 均复用已有词条。 |
| 5 打断 | 同步拖拽起手无外部任务；连点由采纳桥幂等；关闭 / 断网 / 重启沿用原本地持久化及 Undo 边界，无新增费用或取消生命周期。 |
| 6 外部数据 | 真实本地图片 / 视频沿用现有 result URL 与载荷解析；不接入供应商。 |
| 7 性能 | 仅已选中工具栏订阅一个节点；不为全画布逐节点新增订阅。 |
| 8 真实条件 | macOS Electron 中英 / 明暗 / 窄窗 / 键盘 / 原生拖拽40项通过，38张截图；60/300节点规模各3次实测见性能报告。Windows / 打包安装 / 多种高分辨率素材压力 unverified；无付费操作。 |
| ★9 验收回滚 | 单元测试覆盖共享门、入口结构和事件；Electron 走查图片 / 视频 / 素材 / 音频 / 主结果切换、点击与拖放；toolbar_census 独立复查。按任务 commit revert。 |

### 功能分类
- [x] 新界面 / 改交互
- [x] 大数据量 / 画布 / 长列表
- [ ] 花钱
- [ ] 长跑 / 可打断
- [x] Agent 行为
- [ ] 生成效果
- [ ] 数据格式

## 旧功能普查与去处

图片生成、导入素材、角色 / 场景 / 关键帧 / 画板图、图片编辑与切图、截帧、全景截图、产物固化图 → 图片工具栏；视频生成 / 上传 / 裁切 / 深度衍生 / 导演台录像 / 剪辑导出 → 视频工具栏；音频 → 结果下载工具栏。所有入口统一在 FloatingToolbarShell 装配，按当前结果判定，不按 kind=image/video 分别实现。

全景本体沿用不落轴约定；导演台 / 剪辑卡本体无原刘海。版本宫格不新增每版本落轴动作：先设主图，主工具栏消费当前主结果。产物浮条 lockNodeId=null，不广告落轴。原图片快捷动作、下载 / 全屏 / 生成记录、视频抽帧 / 剪辑 / 拆解 / 深度、锁与变体完整保留。

## 系统改进

旧可用性只判断 URL，queued / running 持有旧结果时仍广告可用，而落轴构建拒绝；非媒体 URL 也被放行。将 UI 可用性绑定现有 clip 构建边界和媒体类型，事件执行时再读取 live node，避免主结果切换与状态变化后使用陈旧载荷。

### 图标修正（2026-10-12）

用户在确认交互后指出图形不一致，并提供折线四点截图。用户随后明确指出编组中的现有入口；已核 `CanvasGroupToolbar.tsx` 同操作使用 `IconTimeline`，最终直接复用该组件，不使用最初探索中的 `IconTimelineEventPlus`。原有工具栏的其他图标和顺序不改；视频预览也直接使用生产工具栏，避免另绘。

### 真实走查中的连带修复与性能审查

真实 Electron 验证先证明 baseline 存在，点击确实从60帧贴尾，但自动适应宽度改变 scale 后，既有内容 revision 将视图变化误认为编辑，导致成功/Undo回执立即失效。新增根因合同 `docs/fixes/2026-10-12-timeline-content-revision.root-cause.json`；在唯一 kernel revision 边界区分内容与顶层 scale/playheadFrame，所有媒体、批量采纳与 Agent 共用。先红3项（内容revision两项、真实采纳Undo一项），后绿；不删除回执安全检查，真实编辑仍令旧Undo失效。

用户另要求审查是否新增卡顿。新按钮读取复用现有节点索引，避免每次状态通知全表find；按钮仅随选中工具栏挂载，旧每节点hover刘海删除。撤销回执订阅同一content投影，以zustand shallow阻断视图tick：先红测试证明100次播放头更新触发100次整轴有效性检查，优化后实测0次，同时点击Undo仍回到真实baseline。Agent回执另外订阅Undo栈引用，完整保留顶部token失效条件。拖拽仍仅dragstart序列化一次既有载荷，不改协议、不在hover/render重复编码。最终生产代码的真实大画布采样见[性能报告](../evidence/2026-10-12-node-timeline-performance.md)：60/300节点、各3次，约120FPS，P95 9.9–10.6ms，长任务0；无改动前A/B，Windows和不同高分辨率素材压力未验证。

原生拖拽通道诊断证明：只有pointer/mouse事件、stage dragging=true、无dragstart/drop，实际执行canvasDragWriteback并从200px/16落到帧12而碰撞。共同浮条缺少框架native mousedown过滤；复用版本宫格既有nodrag/no-pan类，先红共享壳守卫再修复。验收必须证明生产MIME原生事件、默认贴尾、Alt指定帧75、源节点不动；不能只凭落轴结果当成按钮原生拖拽。

最终独立验收线 V-20261012-TIMELINE：真实 Electron zh/en 全40项通过，38张截图；主实现线亲眼核对中文指定位置成功/Undo和英文窄窗视频工具栏截图，确认复用折线四点图形、无刘海、原按钮保留。见[独立报告](../evidence/2026-10-12-node-timeline-toolbar-independent.md)。

## 审查修订（协调 10-12）

- 用户拍板「悬停也能拖」：浮条只在单选时出现，所以未选中 / 多选的节点悬停时在节点上边缘正上方（节点外、底边贴齐、靠右）显出同一个时间轴按钮（`NodeHoverTimelineHandle`，复用 `ToolbarTimelineButton` 与同一拖拽载荷，不常驻、单选且浮条在场时隐藏）。
- 图片快捷工具条恢复原来的 kind 条件（image / asset / 图片类）；旧版 shot / output 节点没有浮条，入口走悬停把手（点击贴尾、拖拽自选落点、键盘 Enter / Space 同前）。
- 时间轴按钮两处可用性判断补回 `{ readOnly }`。
