# 导演台手机监视器与录制回执补齐

> 状态：✅ 本地实现与验收完成，未提交。16:20 冻结后重新构建，16:31 真实 Electron + Chrome 手机页通过画面、录制回执、停止服务和断线持续隐藏验证；最终截图亲眼核对。收据见 `docs/audit/2026-09-07-director-functional-interaction-audit.md`，物理手机传感器未实测。

## 范围与方案

现状手机能发体感/摇杆与录制指令，页面没有画面，录制按钮也自行猜状态。补齐为手机显示当前导演台机位的低分辨率预览，按钮只按桌面真实录制状态显示。

复用现有带令牌 WebSocket，主进程只向通过验证的连接发送 PNG 二进制帧和录制状态；新增的桌面反馈 IPC 需可信来源及当前服务 owner 校验。复用真实 captureFrame，最长边 480px，每帧完成后 250ms 再采下一帧，同刻仅一帧在途；帧大小最多 1MiB，慢连接不积压旧帧，断开/关闭清理定时器、socket和临时图片URL。图像只活于传输，不进工程/store。

## 不动项与回滚

不新增 transport、WebRTC、录像编码器或模型依赖，不改 ViewportApi 的位姿含义，不改场景持久化，不向真实用户工程写测试数据。回滚只恢复本扩围的 mobile server/page/IPC/preload/bridge/hook 块和专属测试，保留其他代理改动。

## 验收

原服务 start/stop 并发及令牌拒绝测试继续通过；新协议验证录制真实状态、PNG传输、超限/坏帧拒绝、慢连接不排队及停止后拒绝广播。手机页面用本机浏览器模拟验证能看到实际场景帧和录制同步；这不等价于物理手机陀螺仪真机验收。

收据：`.tmp/director-full-audit-20260907/assets-findings.md`。协议增加坏 JSON 对象形状校验，真实 WS 的 null 红例与后续正常控制绿例均保留。机位监视器按导出画幅，自由视角按窗口画幅；手机控制区的提示在横屏可见。

最终截图补修：停止服务后空 img 仍占据显示层，出现破图图标/边框。只在现有手机页修复：初始隐藏，当前连接的有效解码帧才显示，断线/坏帧/页面释放统一隐藏并释放 URL，拒绝旧连接迟到回调。先执行真实页面脚本的 5 项红例，再补同构建手机走查的「已见帧→持续不可见」断言；不改变布局和控制。回滚只恢复这次 page/test/合同块。

## 先查别人

- 依赖里已有？`ws` 8.21.3 已是主进程依赖（`package.json:280`），局域网桥继续用它，不加 WebRTC 栈。
- 仓库里已有？手机桥服务端与截帧接口已存在：`electron/director/mobileBridgeServer.ts:91`（WebSocketServer）、`src/workbench/generationCanvas/nodes/director/useMobilePreview.ts:38`（复用 captureFrame）。
- 生态里已有？WebRTC（https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API）需要信令与 ICE，局域网单向监视帧用 WS 传 JPEG 更简单，OBS 一类监视方案同理。
- 结论：复用现有 WS 桥推最长 480px 的 JPEG 帧，限制在途数与大小，录制状态只回桌面真相；不引 WebRTC。
