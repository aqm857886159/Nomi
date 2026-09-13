# B2d · 可关闭的收起输入坞

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实现，Electron 与红绿夹具通过，完整 gates / 推送待收据。用户任务书已指定外观与交互：坞右上角统一图标关闭钮；默认保留，关闭后完全消失；顶栏角标展开面板；再收起仍记住隐藏。

## 先查别人
用户：「它会遮挡下面的东西，我有时候不想要那个东西。」现有避让只解决播放器控件，不能代替用户关闭权。
- `src/design/actions.tsx:124`：复用 WorkbenchIconButton 关闭按钮。
- `src/workbench/preview/editingPanelLayoutSlice.ts:96`：复用现有面板开合 owner，新增用户偏好仍在同一 slice。
- `src/ui/app-shell/CollapsedAiChip.tsx:47`：复用还原与数字徽标。
- `src/utils/canvasGesturePreference.ts:37`：复用用户级 localStorage 偏好模式。

不引入框架、协议或第二套面板。

## 范围 / 不动项 / 回滚
在现有布局 slice 添加 agentDockHidden 与 setter，并按用户落盘；常驻壳隐藏坞但保持提醒投影活跃。统一坞组件添加关闭钮，更新双语与设计约定。
不动 B2a/B2c 语义、electron/agentLane、src/workbench/ai/lane、React Flow、设计基线。过程行先检查非 hover，只有证实样张外底板才改。
回滚本次提交即可；新偏好 key 无旧数据迁移，缺省 false。

## 验收
先红后绿：关闭偏好、重建 store、项目布局/预设/开合不覆盖用户选择。
Electron 真实任务：关闭前 → 关闭后画布无遮挡 → 顶栏还原；再次收起、刷新、跨面、快捷键、未读/待确认不弹回；过程摘要非 hover 截图和样式取证。
完整 gates exit 0（等待锁）后正常 hooks 提交推送同一分支；PR #683 若已合入则新开 PR；不合并。
