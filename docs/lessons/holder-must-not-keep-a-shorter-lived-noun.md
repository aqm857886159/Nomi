# 长寿命对象不许揣短寿命名词当身份证

> 📎 教训 · 首次记录 2026-09-16 · 状态：现行
> **触发场景**：同一条会话/lane/适配器第二次对着画面动手时报 `surface_port_stale` / `surface_port_unavailable`；或根因合同写了「现抓」但 Linux 真机仍红；或你准备把 `CapturedCanvasReadPort` / epoch / 快照名单塞进长寿命对象的字段里。

**结论**：A 握着 B 当身份时，B 的寿命必须 ≥ A。否则 B 不是身份证，只许在动手那一瞬间现问。把冻点从 open 挪到 prepare、再挪到 execute，是同一类症状在滑，不是结构改完。

**为什么会踩**：PR #802 内部 lane 三次都撞同一把钥匙。

- 先在 `openWorkspace` 把 `CapturedCanvasReadPort` 冻进 adapter → 切到生成面再写就 `surface_port_unavailable`
- 再改成发送时 `liveShared()` 现抓 → prepare 过了，execute 仍握着 prepare 那一帧的 `liveAdapters` / `invocation.capturedPort`
- 单测绿：`resolveCanvasWritePort: async () => canvasPort` 根本不走真 IPC；MCP 绿：`create_canvas_nodes` 走主进程 `addProjectNodes`，不是 renderer 口。两份「对照」都是假对照。

同类已修过、同一条不变量：`videoModelCandidates` 装配时快照 → 读时再算；技能/记忆当值冻住 → 当函数。每一次都看起来像「记得刷新一下」，每一次冻点都会再滑一次。

**怎么用**：

- 看见 `surface_port_*` 先问：**是谁把哪份短寿命东西揣进了比它活得更长的对象？** 不要先加 retry / 换钥匙文案 / 再抓一次。
- 动手前读 [T-AG-16 来源全文](../roadmap/sources/2026-09-16-session-identity-window-plus-project.md)，不要只拿「窗口+项目」四个字开写。那里有冻点怎么滑、哪些绿是假的、换项目/切 tab 分别该怎样。
- 长寿命对象（lane、session、adapter 工厂、transport）的构造函数不许收 `CapturedCanvasReadPort`。口只允许作为这一次 action 的参数，用完即弃。
- 假对照自检：MCP 绿、mock port 绿、prepare 绿、文稿写绿，都不能证明生成面 execute 真 IPC 绿。Linux `resident-composer-receipt-fix` 才是真对照。
- 产品结构债已经挂在 [T-AG-16](../roadmap/TODO.md)。#802 合入后立刻开独立 PR，不要再往列车里塞。

**出处**：PR #802 Linux E2E `resident-composer-receipt-fix`；合同 `docs/fixes/2026-09-15-lane-canvas-write-live-port.root-cause.json`；上下文原料 [`docs/roadmap/sources/2026-09-16-session-identity-window-plus-project.md`](../roadmap/sources/2026-09-16-session-identity-window-plus-project.md)。
