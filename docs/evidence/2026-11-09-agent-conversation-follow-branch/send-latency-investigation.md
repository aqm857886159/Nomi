# 发送可见回归调查（尚未结论）

当前产品代码未改。六份 branch-perf-before 原始数据是同一 HEAD 1ded6e7b5 的协调测量，每项5次；它们是待解释的修前证据，不作为达标基线。

| 发送历史数 | 旧main中位/p95 ms | 当前分支中位/p95 ms | 中位变化 |
| --- | --- | --- | --- |
| 10 | 97.9/109.8 | 133.0/136.2 | +35.9% |
| 100 | 103.5/136.4 | 135.9/136.4 | +31.3% |
| 1000 | 111.2/120.8 | 133.3/134.9 | +19.9% |

静态证据：

- AgentPanelV4Panel 的 useStickToBottom(initial/resize)、发送 submitAndFollow、切换会话和回底按钮均显式 instant；发送没有 await 滚动 Promise。
- 安装版本1.1.6的 scrollToBottom(instant) 仍在 requestAnimationFrame 中写位置；ResizeObserver 也会排帧。因此不能用“配置instant”直接证明没有额外帧延迟。
- responseTimer 的 chatBubbleVisible 要求带marker的气泡与滚动可见区相交，真实keydown起表，判据成立后再过两帧；未修改该判据。
- composer、发送动作、读侧、laneClient与preload相对22df46ad6无差异；目前未在新增贴底代码中发现100ms或相近固定timer。
- 旧main与今天分支的发送JS/layout读数有差异，但不能据此把35ms响应差归为计算成本。需要当前条件下main复测/同锁A-B结果确认可比性。

三条路：沿现方向修必须先找到具体增加的时序；可比性对照先保持产品代码和量具判据不变；删除跟随会破坏已定行为。当前选择只调查和对照，不猜测补丁，不登记欠账掩盖>20%退化。
