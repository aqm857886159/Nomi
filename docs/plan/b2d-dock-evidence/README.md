# B2d 验收证据

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

用户任务书指定：右上角关闭图标，默认保留，关闭后完全消失；顶栏角标展开面板，再收起尊重用户关闭选择。

| 用户任务 | Electron 证据 | 结果 |
|---|---|---|
| 收起后选择关闭 | [关闭前](dock-before-close.png) → [关闭后](dock-closed-canvas.png) | 输入坞 DOM 整棵卸载，原先被盖住的底部时间轴入口完整可见；关闭钮跟着消失 |
| 顶栏还原 | [展开面板](chip-restored-panel.png) | 原有面板与待确认卡可用；再收起不显示坞 |
| 隐藏期间有新消息/待确认 | [数字徽标](hidden-with-pending-badge.png) | 两条新回复显示 2，待确认到达后显示 3；坞始终不出现 |
| 过程摘要浅灰底板 | [非悬停](process-done-non-hover.png) / [悬停](process-done-hover.png) | 非 hover 背景透明、边框 0、阴影 none；灰底仅为既有 hover，未修改 B2c 样式 |

[Electron 收据](electron-receipt.json)：快捷键展开/收起、跨创作/预览/生成、刷新偏好恢复、新项目继续隐藏全部通过。测试使用真实 Electron 与生产组件，宿主快照为确定性夹具；不声称发生真实模型生成，模型调用 0、费用 0。

[单测先红](unit-red.txt)：3 条失败 → [实现后绿](unit-green.txt)：9 条通过，包含原有面板持久化回归。用户级偏好独立于项目 revision，预设、撤销、重建 store 不重置它。

人眼对账：关闭前只有要求的右上角关闭钮新增；关闭后无坞、关闭钮或残余占位，画布底部控件恢复可见；展开后仍是 B2c 面板。过程摘要非 hover 无样张外底板。自动 feel 记录的微字号来自既有 text-micro 与导航；未改基线或扩大任务范围。

复跑：所有坞消失检查均使用 `proveProbe` 的真实可见证据 + `expectAbsent` 持续缺席窗口，Electron exit 0；截图已同步到本次复跑。
