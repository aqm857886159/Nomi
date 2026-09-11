# electron/director/
> L2 | 父级: 主进程 electron/（无独立 CLAUDE.md，归属导演台 V2 手机桥）
> 导演台 V2 的手机虚拟相机桥：局域网 HTTPS（自签名）+ WebSocket，手机扫码打开页面发 32 字节 Float32 包；渲染层只经 IPC / preload / getDesktopBridge 消费，不 import 本目录实现。
> 安全四闸（2026-09-11，docs/plan/2026-09-11-director-lan-pairing-hardening.md）：没同意不 bind · 配对码一次性+有时效换出会话令牌 · 证书指纹进状态与二维码 fragment · 入站 maxPayload + schema，畸形即断开。
> 成员清单
> mobileBridgeServer.ts: HTTPS/HTTP + WS 服务（同意闸、一次性配对码与会话令牌、证书缓存与指纹、hello/record/pong、设备/延迟事件）；单测用 secure=false；事件/状态类型从 electron/shared/contracts/directorMobileBridge.ts derive
> mobileBridgeMessages.ts: 入站帧的唯一判据（纯判定、不碰 socket）：decodePacketValues 定长 32 字节 + 逐槽量程；parseControlMessage 白名单 hello/record/pong 逐字段校验
> mobileBridgeSecurity.test.ts: 四项安全不变量（未同意不监听 / 配对码复用与过期被拒 / 指纹与证书一致且进 fragment / 超限与畸形帧被断开）；时钟注入不等墙钟
> mobilePage.ts: 手机页 HTML/CSS/JS（文案由桌面端注入，页面不写可见文字）；摇杆 / 升降 / 焦距 / 陀螺仪 / 录制；配对码换会话令牌存 sessionStorage、证书指纹从 #fp= 读并显示；有效机位帧显示，断线/坏帧/释放统一隐藏，拒绝旧连接回调
> mobilePage.test.ts: 执行真实页面脚本，验证初始等待、解码、断线、重连和释放后的帧可见性与 URL 生命周期
> mobileBridgeIpc.ts: IPC 注册 nomi:director:mobile:start|stop|status + 事件推送到启动它的 webContents；窗口销毁即停；start 的 consent:true 是本次 App 运行的同意（主进程内存，不落盘）；start/status 附带 qrcode SVG（渲染层不 import 该 CJS 包）
> mobileBridgeServer.test.ts: 模拟手机客户端（无令牌拒、hello / 包 / 录制 / pong）
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
