# PR #658 真实页面走查返工

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实施中。

## 根因与范围
旧 Electron 入口导航到 design-lab.html，三处同句仅在隔离组件排列成立，不能证明 App 外壳、布局与生产数据接线。归类 recurring；独立检查 process-feedback.e2e.mjs 与 process-feedback-electron.e2e.mjs 均有同类证据冒用。验收边界改为真实 App 的节点、任务中心、时间轴 DOM；组件接触表仍仅作为组件基线。

使用 tests/ux/_launchApp.mjs 的隔离目录与 NOMI_CAPABILITY_DIR，仅回环供应商；由 UI 建项目、建节点、生成与加入时间轴。请求保持至真实旁白达到 20 秒，等待使用 Playwright 信号。截图 1440 宽，逐张人工查看。已批准 C1/C2 是视觉对账依据，不新增设计方向。

不安装依赖，不读真实项目库，不访问付费模型，不改 agentLane、ai/lane、generationCanvas/reactFlow。现有 isoApp.prepareIsolation 即使 requireCatalog=false 仍复制真实 catalog，因此采用同一 launchNomiApp 隔离边界并直接写合成 catalog，避免导入真实凭据。

## 验收与回滚
真实页面阶段截图、同一任务的三处旁白原子读取、60% 和 reduced-motion；最后 gates、带 Co-Authored-By 的提交、普通 push 更新 #658，不合 PR。测试与证据按 scoped commit revert；无数据迁移。

## 先查别人
复用 tests/ux/g1/c0-fixture.mjs 的回环 catalog/mapping 与 tests/ux/_launchApp.mjs 的四目录隔离；不引入外部框架或协议。时间轴首次生成幽灵段与原 C1 范围存在差异，已向用户确认。

### 可复核来源与采用结论

- `tests/ux/g1/c0-fixture.mjs:1`：沿用仅模拟供应商、真实项目落盘的回环方式；返回内联媒体，避免扩大私网下载权限。
- `tests/ux/_launchApp.mjs:86`：复用四目录隔离及统一 Electron 启动器；不读取真实项目库。
- `src/workbench/generationCanvas/nodes/useComposerViewportPlacement.ts:166`：沿用既有翻转/平移算法，把障碍发现改为现有公共 bottom-dock 标记；不改 React Flow 内核。
- `src/workbench/taskCenter/taskCenterEntries.ts:53`：任务与节点在此投影；历史行必须读自己的结果，不能借用下一次生成的节点旁白。

## 真实走查发现与处理

1. 主进程本地化结束后才报告落盘：本地化入口先发事件，活动任务按项目/节点绑定监听并在结算后释放。逻辑从 runtime 壳搬到 assets/localizeTaskAsset，旧路径仅 re-export。
2. 画面小窗遮住重新生成：composer 使用所有已标记的底部浮层进行测量及动态观察，删除仅观察旧时间轴把手的路径。
4. 真实画布缩放没有写回旧 canvasZoom，状态条、提示词卡、浮动工具条都读到旧值：三者改读已有 categoryViewports 真相源；实验室也改种同一来源，删除旧缩放注入。
3. 上一次成功记录跟着新任务显示生成中：活动条目读实时旁白，已完成条目读自身 error/outcome。组件基线补齐与生产一致的队列 error 记录，视觉基线不刷新。

落盘截图为可重复观测，在隔离主进程为第一次真实 importRemoteAsset 调用设置释放屏障；不写节点状态、不替换 App、不伪造阶段。收到真实落盘 DOM 信号并截图后继续原始导入器完成校验、写盘和入库。
时间轴证据明确是已生成并真实加入轴的片段重新生成；不冒称首次生成幽灵段。
