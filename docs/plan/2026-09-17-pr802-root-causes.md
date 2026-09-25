# PR 802 根因修复与项目会话结构

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实施中。2026-09-17 用户批准推荐方案及最终合入。

## 目标与产品决策

- 同窗口同项目保持会话；页面切换不换身份。切项目停止未完成交互编辑/审批，已提交后台生成留在原项目运行。
- Agent 的文本、网页、表格仍在产物卡与项目文件管理，不扩展素材库 UI。
- A 修复当前失败链及项目隔离，B 完成 T-AG-16；若 A 的隔离反例失败且需要 B，则先完成 B 再合 802。两部分全部完成，不以 A 合入作为终点。

## 已复现与根因

在 802 head c4c0166b9 的真实 Electron 43.4.1 中，resident-composer-receipt 创作写入成功，切生成后 make_artifact(text) 首先被媒体存储准入拒绝 unsupported-kind。业务异常被转为 capability_receipt_unresolved，跨 contextBridge 丢 code，preload instanceof 失败后改成 surface_port_unavailable。主进程收到回包前已通过 binding 校验，所以不能据错误名称推断旧端口。

仅隔离进程放行 text 后工具成功、节点持久化，但节点不可见。DOM 360×260；框架 measured={}；调用框架重测后立即可见。共同适配层仅传 CSS size，每次新节点投影不携带框架认可的尺寸；adoptUserNodes 会重置 measured。纯上游函数对照也复现该转换。

异步产物存储从 activeProjectId 重新取项目的风险已由 renderer byte 准备期间切项目的红测试证明。另在真实存储去重等待期间替换 manifest identity，byte/native 两个入口均错误发布文件；最终节点提交守卫不能替代文件 IO 归属约束。

2026-09-17 实施证据：存储准入与显式框架尺寸修复后，原 resident-composer 完整旅程在 macOS Electron 43.4.1 首次通过。用隔离项目内真实文件系统阻塞制造保存失败，旧跨桥代码返回 surface_port_unavailable；整合普通 DTO 后返回安全执行失败并保留原节点，文稿→产物→拒绝→MCP→冷启动完整通过（12 次 loopback 请求、零付费）。Linux 与会话结构验收仍须完成。

## A：共享边界修复

1. 分开项目存储格式/容量准入与各页面展示落点。复用现有存储，支持工具已承诺的 svg/html/markdown/table/text，不冒充附件、不新增私有写盘路径。
2. 所有产物 IO 携带发起动作的 ProjectBinding；副作用前检查当前身份/取消，异步切项目不得重定向。
3. renderer 在 contextBridge 前将错误编码成普通数据；preload/main 共用白名单解析。业务拒绝、回执不确定、目标陈旧、取消、真正失联分开；全部文稿/画布/时间轴/资产/导出 handler 同修。
4. 共享 React Flow 适配显式派生框架尺寸，完整遵循 handle 测量协议，删除仅 CSS 尺寸的旧投影。尺寸单一真源仍是 resolveNodeVisualSize，不轮询重测、不覆盖 visibility。

## B：项目会话

长期身份是可信窗口 + 完整 ProjectBinding；lane/长期工厂/verified invocation 不保存 capturedPort。每次动作执行时为原窗口/项目解析临时 transport，执行前后验证，保留 actionHash、revision、owner、取消检查。读能力同样处理，但显式快照保持快照语义。真实 reload/destroy 撤销旧通道，不新增多窗口编辑产品能力。

## 先查别人

- [Electron contextBridge 官方文档](https://github.com/electron/electron/blob/main/docs/api/context-bridge.md)：Error 自定义字段跨界丢失，使用普通结果 DTO；不从 message 猜类型。2026-09-16 已实读。
- [React Flow 官方受控示例](https://github.com/xyflow/xyflow/blob/main/examples/react/src/examples/ControlledUncontrolled/index.tsx)：受控节点需要闭合更新协议；本机 12.11.5 的 adoptUserNodes/nodeHasDimensions/NodeWrapper 已实跑对照。
- [本仓媒体准入方案](2026-09-14-media-import-single-owner.md)：统一 IO 但区分落点，不另造 Agent 存储。
- [独立反方报告](../research/2026-09-17-pr802/prior-art.md)：接纳存储/展示分离、全 handler 错误协议、文件副作用隔离、owner 不放宽。

Context7 本会话不可用，使用官方源码。现有 Electron/React Flow 保留，升级退出条件为相同真实边界回归通过；升级不是修应用契约的替代。无新框架/新协议标准。

## 验收门

- 先红后绿：五种产物格式，未知格式/磁盘拒绝；同页面及跨页面真实创建。
- 真实 contextBridge 错误保真；未知码、畸形结果拒绝；各 handler 覆盖。
- 节点显示、选中/高亮结束、尺寸变更、连线、复制拖拽、分组、重启读回。
- prepare/审批/IO 期间切项目，目标新项目零副作用；旧 revision/actionHash、错误窗口、reload/destroy 拒绝。
- 原命令 `node tests/ux/resident-composer-receipt-fix.e2e.mjs` 完整走通文稿→产物→拒绝删除→MCP→冷启动；不能换 SVG 夹具掩盖文本问题。
- macOS 本机和 Linux CI 原边界；按 R22 相关单测、contracts、build、desktop/journey/canvas/performance/package。
- 独立验收与 review:branch；推任务分支 PR，按用户授权合入，再核真实 merge SHA。

## 范围、删旧与回滚

A 不重做 MCP 主进程写路、不扩素材库 UI、不改变 HTML/SVG 安全预览。删跨界 instanceof 分类、仅 CSS 尺寸投影；B 删长寿命 capturedPort。无数据迁移、不删除用户文件，独立提交可 revert。

## 六角色及反方复核

架构：身份/通道分寿命；设计：实际产物可见、错误可理解；产品：切页继续/切项目隔离；前端：尺寸与全部宿主；后端：字节归属与错误协议；真实用户：完整任务和冷启动。以上为方案审查，不宣称实现验收通过。独立代理已审，生产完成后再做独立验证。
