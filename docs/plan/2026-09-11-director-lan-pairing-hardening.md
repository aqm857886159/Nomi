# 手机虚拟相机局域网配对：四项安全加固

状态：🚧 实施中（2026-09-11 用户拍板）。分支 `fix/director-lan-pairing-hardening-20260911`。

导演台 V2 的「手机虚拟相机」（#721 合入）在用户点开对话框那一刻，就在 `0.0.0.0` 上起了一个 HTTPS + WebSocket 服务，
并把一个 12 字节随机令牌塞进 URL 与二维码。这个形状有四个洞，全都属于「网络入口没有同意、没有时限、没有上限」这一族：

| 洞 | 现状（file:line） | 用户那一刻会怎样 |
|---|---|---|
| ① 没问过就监听 | `useMobileCamera.ts` 的 `openDialog` 打开即 `void start()`，`mobileBridgeServer.ts:open()` 直接 `listen(0, '0.0.0.0')` | 只是想看看这功能长什么样，机器已经在整个咖啡馆的 Wi-Fi 上开了一个口 |
| ② 令牌长生不老、可复用 | `mobileBridgeServer.ts` 的 `this.token` 一起服务就固定，URL/二维码里明文带着，直到 stop 才换 | 截图发群里、投屏时被拍到、二维码留在屏幕上没关——任何看过一眼的人在服务活着期间随时能接管机位 |
| ③ 自签证书无从核对 | 证书只在主进程里生成，指纹不出现在任何界面；手机端只能闭眼点「继续」 | 同一个 Wi-Fi 下有人伪造一个同名服务，用户照样点「继续前往」，分不出来 |
| ④ 入站消息无 schema、无上限 | `ws` 的 `maxPayload` 用默认 100 MiB（`node_modules/ws/lib/websocket-server.js:74`）；JSON 坏了只 `return`，二进制只判 `< 32` 就放行 | 一个恶意/发疯的客户端一帧 100 MB 就能把主进程内存顶上去，畸形包被静默吞掉不留痕 |

本次把这四条各自修在「谁决定这件事」的那一层，不逐处打补丁。

## 先查别人

- **Electron 官方安全清单**（<https://www.electronjs.org/docs/latest/tutorial/security>）：第 5 条 *Handle session permission requests from remote content*、第 17 条 *Validate the `sender` of all IPC messages*、第 1 条 *Only load secure content*。清单**没有**一条讲「主进程自己开监听端口」——也就是说这块没有现成规范可抄，同意闸得我们自己定，但「特权动作前先过一次显式许可」这个形状是官方的，我们照它做（同意决定只从一条受信 IPC 边界流进来，和第 17 条的 `assertTrustedSender` 串在一起）。
- **`ws` 的 `maxPayload`**（`node_modules/ws/lib/websocket-server.js:50` 的 `@param {Number} [options.maxPayload=104857600]`、`node_modules/ws/lib/websocket-server.js:74` 的默认值 `100 * 1024 * 1024`；类型见 `node_modules/@types/ws/index.d.ts:263`）：**框架已经提供了帧级上限**，超限时 ws 自己按 RFC 6455 用 1009 关连接。所以 ④ 的一半是「把框架的开关拧对」，不是自研一个计数器（R29：框架有的不再造）。我们只补它管不到的那半：**帧内容的 schema**。
- **obs-phone-cam**（<https://github.com/ThomasHartDev/obs-phone-cam>，同类「iPhone 当机位、不装 App、扫码开 Safari 页」）：README 明写 *"By default the server generates a self-signed cert, so Safari shows a one-time warning you tap through."*，配对只有二维码，**没有一次性码、没有会话令牌**——典型的 TOFU。这条是反面参照：同样的形状我们不照抄，因为 Nomi 的二维码会被投屏/截图带走（见上表②），而它假设的是一个人在自己书房里。
- **JesseAustin/phone-webcam**（<https://github.com/JesseAustin/phone-webcam>，Android 当 OBS 摄像头）：README 的安全节写 *"A fresh random salt is generated every session; no two sessions share the same encryption keys."*——**每会话新凭据**是这类局域网桥的既有做法，我们的「配对码用一次就换、换出会话令牌」是它在「不装 App、只有浏览器」约束下的等价物。
- **仓库里已有的**：`electron/ipcSenderGuard.ts` 的 `assertTrustedSender` 已被本桥调用；`electron/productionRun/productionRunApprovalReceipt.ts:88-105` 定下了「特权动作的人证只在主进程内部装配、不从渲染层 payload 抄」的既有纪律——同意闸照这个形状写（渲染层只能**发起**一次同意，**能不能监听**由服务自己判），不另起一套。

结论：③④ 用已有（框架开关 + 浏览器自己的证书详情面），①② 自研，理由是领域约束——Electron 清单不管本机监听，而同类项目的 TOFU 假设（私人书房）在 Nomi 的使用场景（会投屏、会截图、会在合租/办公 Wi-Fi 上跑）里不成立。

## 四项怎么做

### ① 同意闸：`grantConsent()` 之前 `start()` 必抛

防线放在**服务自己**而不是对话框（R28：能让最早那层拦住的，别留给 UI）。`MobileBridgeServer.start()` 在没拿到
`grantConsent()` 之前直接 `reject(MobileBridgeConsentError)`，一个 socket 都不 bind。IPC 层 `nomi:director:mobile:start`
的载荷多一个 `consent?: true`：`assertTrustedSender` 之后，只有它为真才调 `grantConsent()`。渲染层打开对话框时照旧调
`start()`（不带 consent），拿回 `consentRequired: true` 的状态，**画面上不出二维码**，出的是一张同意卡：讲清「会在哪个网段开什么口、同一 Wi-Fi 下谁都能看到这个端口」，用户点「允许开启」才带 `consent: true` 再调一次。

同意的有效期 = **本次 App 运行**（主进程内存，不落盘）。每次冷启动重新问一遍；同一次运行里反复开关对话框不再骚扰。
落盘会变成「一次点头永久放行」，冷启动重问是这类网络入口的通行折中（与系统防火墙每次装新版本重新问同构）。

### ② 配对码一次性 + 有时效，换出会话令牌

二维码/URL 里的 `k` 从「服务级长生令牌」改成**配对码**：

- 有效期 `MOBILE_PAIRING_TTL_MS = 120_000`，过期即拒；
- **用一次就废**：第一个成功的 WS upgrade 消费掉它，服务当场轮换出新码并发 `pairing` 事件，桌面端二维码自己刷新；
- 配对成功时服务给手机发一条 `{type:'paired', s:<sessionToken>, fp:<指纹>}`，手机存 `sessionStorage`，此后重连一律用
  `?s=<sessionToken>`。**断线重连因此不用重新扫码**——没有这一步，一次性码会把「地铁里网抖一下」变成「重新扫」。
- 比较用 `crypto.timingSafeEqual`（长度先判，再定时安全比）。

时钟可注入（`now?: () => number`），过期用例因此不靠墙钟（R18）。

### ③ 证书指纹：桌面显示 + 二维码带着 + 手机页显示

服务算自签证书的 SHA-256 指纹（`node:crypto` 的 `X509Certificate#fingerprint256`，冒号分组），进 `status().certFingerprint`。

- **桌面端**：对话框里一行「证书指纹」，等宽字体、可复制。
- **二维码/链接**：指纹进 URL 的 **fragment**（`#fp=<hex>`）。fragment 不上线（浏览器不发给服务端），所以它是一条
  **从桌面出发、走二维码这条带外通道到手机**的声明，中间人改不了它，只能改证书。
- **手机页**：把 `location.hash` 里的指纹原样显示出来，旁边一句「和浏览器证书详情里的那串比一下」。
  用户真正比对的是**浏览器自己读到的真实证书** vs **桌面通过二维码给的那串**——这条链才是可核的。
  服务同时在 `paired` 消息里回自己的指纹，页面与 fragment 比一次，不一致就标红：这一层挡不了中间人（对手会照抄），
  但能挡住「二维码是旧的 / 证书重新生成过」这类误配，成本只有几行。**诚实说明**：自动比对只是一致性检查，
  真正的验证动作是人眼比那串指纹，界面文案就这么写，不吹成「已验证安全」。

### ④ 入站 schema + 大小上限

- `new WebSocketServer({ noServer: true, maxPayload: MOBILE_CONTROL_MAX_BYTES })`（4 KiB）。超限由 ws 按 RFC 6455 关连接（1009）。
- 二进制帧：长度必须**正好** 32 字节（原来是 `< 32` 才拒，多了照收）；8 个 Float32 必须有限且落在各自量程里
  （摇杆/升降 ∈ [-1,1]、三个角增量 ∈ [-360,360]、焦距 ∈ [0,1000]、复位标志 ∈ [0,1]）。原来的「NaN 归零」是在
  吞掉畸形，现在判为畸形。
- JSON 控制帧：严格白名单 `hello|record|pong`，逐字段判类型与取值；不认识的类型、多余的非法字段、非对象、解析失败一律畸形。
- 畸形帧的处置是**断开**（`close(1008)`），不是静默 `return`——静默吞掉正是「本地看不出、线上才炸」那一族。
  正常手机页永远发不出畸形帧，所以这条对真实用户零影响。

## 范围

改：`electron/shared/contracts/directorMobileBridge.ts`、`electron/director/mobileBridgeServer.ts`、
`electron/director/mobileBridgeIpc.ts`、`electron/director/mobilePage.ts`、
`src/workbench/generationCanvas/nodes/director/useMobileCamera.ts`、
`src/workbench/generationCanvas/nodes/director/panels/dialogs/MobileConnectDialog.tsx`、`src/i18n/locales/director.ts`。
新增：`electron/director/mobileBridgeMessages.ts`（入站帧 schema 的唯一判据）。
测试：`mobileBridgeServer.test.ts`、`mobileBridgeSecurity.test.ts`（新增，四项各一条先红后绿）、`mobilePage.test.ts`、
`mobileBridgeIpc.test.ts`、`tests/ux/director-mobile.walk.mjs`。

**不动项**：包的语义与 30Hz 发包节奏、预览回传通路（`feedback`）、录制/摇杆/陀螺仪交互、证书缓存位置与 SAN 组装、
`MOBILE_PREVIEW_MAX_BYTES` 那条已有的出站上限。

**回滚**：一个 commit，`git revert` 即回到 #721 的形状。没有持久化结构变更（同意只活在主进程内存，会话令牌只活在
`sessionStorage`），回滚不留脏数据。

## 验收门

1. 单测先红后绿：未同意时 `start()` 抛且没有监听 / 配对码复用被拒 / 配对码过期被拒（注入时钟）/ 指纹与缓存证书一致
   且出现在 URL fragment / 超限帧与畸形帧被断开。
2. 真机走查 `tests/ux/director-mobile.walk.mjs`：开对话框 → 无二维码只有同意卡 → 点允许 → 二维码里含 `#fp=` →
   手机扫一次连上 → 同一个配对码再连被拒。截图进 PR。
3. `pnpm run gates` 全绿。
