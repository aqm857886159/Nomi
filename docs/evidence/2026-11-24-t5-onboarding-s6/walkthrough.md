# S6 接入页 · Electron 走查

在当前分支运行 `pnpm run build` 和 `node tests/ux/t5-onboarding-s6.walk.mjs`。六次隔离启动共收到 28 次 loopback GET，覆盖账户资金与 Key 额度两个官方路径。每次充值回查各发一个 GET。真实供应商请求数和费用均为 0。

| 路径与操作 | 窗口中看到的结果 | 真窗截图 |
|---|---|---|
| O3 从项目库打开官网，Esc 返回，再进接入页 | 仍显示打开时间、三个步骤和返回位置。展开「打不开？」可见三个镜像地址 | [中文等待](o3-light.png) · [英文窄窗](o3-narrow.png) · [备用地址](o6-mirrors-dark.png) |
| O4a 从图片节点接入，保存后恢复网络 | Key 有效、账户 52.3 积分、Key 不设上限、目录模型计数，四行均通过 | [中文](o4a-light.png) · [英文深色](o4a-dark.png) |
| O4b 等待检查页关闭 | 回到原图片节点，草稿仍为 “An orange cat at the window”。Composer 显示 52.3 积分，提示随后淡出、移除 | [中文原稿](o4b-light.png) · [英文原稿](o4b-dark.png) |
| O5 / O6 将账户设为 0，Key 为不限额 | 第二行显示 0，第三行显示不限额，页面停在「Key 已存好，就差充值」。隐藏窗口后把夹具资金改为 52.3，恢复窗口，两行更新，充值卡消失，随后回项目库 | [充值前](o5-light.png) · [恢复后](o5-refreshed-light.png) · [英文深色窄窗](o5-dark.png) · [窄窗恢复](o5-refreshed-dark.png) |
| O4a 账户 52.3，Key 额度 0 | 第三行显示警告和 0 积分，直接回项目库 | [Key 额度用完](o4a-zero-token.png) |
| O4a 账户端点返回 403，Key 额度 0 | 第二行显示 Unavailable 和空心圆，第三行显示 0。没有充值卡，随后回项目库 | [账户未知](o4a-unknown-account.png) |
| O6 提交网址，再粘贴被拒绝的 Key | 格式错新增请求 0 次；HTTP 401 显示 APIMart 的错 Key 提示，留在原页 | [格式](o6-format-light.png) · [拒收](o6-invalid-dark.png) |
| O6 模拟一次钥匙串加密失败，重试时断网，再恢复在线 | 第一次提示解锁后重试；断网卡提示 Key 已存；恢复后用已存 Key 读回四行 | [钥匙串](o6-keychain-dark.png) · [断网](o6-offline-light.png) |

## 板对实现

每张拼图左栏为批准的板图，右栏为生产窗口。账户行显示官方积分，费用格式化白名单与 S7a 基线一致。模型数取本次运行目录，图片 25、视频 30、声音 9、文字 24。

- [O3 等待、O4a 检查与 O4b 回草稿](board-vs-impl-o3-o4.png)
- [O5 充值与到账](board-vs-impl-o5-light.png) · [O5 英文深色窄窗](board-vs-impl-o5-dark.png)
- [O6 六种情况](board-vs-impl-o6.png) · [O4a 与 O6 英文深色](board-vs-impl-en-dark.png)

## 条件与复查

中文浅色和英文深色宽窗均为 1440×900。O3 英文窄窗为 700×720，O5 英文深色窄窗为 700×900。O5 使用关闭 Playwright 默认焦点模拟的 CDP 连接，执行 Electron 的原生隐藏与显示。断言先观察到页面隐藏，再核对恢复后的请求、到账数值和关页。外链由隔离窗口仪表截获，官网不可达走用户可点击的备用地址入口。加密失败通过一次合成存储错误触发。真实账户、实际浏览器充值及 Windows 原生钥匙串未验证。

修前按路径区分的 owner 测试为 14 红、8 绿。修后相关 10 份 Vitest 文件共 141 项通过。覆盖账户端点 401、403、404、500、传输中断、错误信封与未知字段，也覆盖 Key 端点明确拒绝时保留旧凭据。项目库、画布和发送侧读取同一个账户资金来源。[官方账户接口](https://docs.apimart.ai/en/api-reference/account/user-balance) · [官方 Key 接口](https://docs.apimart.ai/en/api-reference/account/token-balance)

独立复盘另外核对了缺少单位和负数哨兵。只有 Key 的 `-1` 表示不限额。接入页收到单独的正数 `remain_balance` 时显示原数及「单位未提供」；只有官方 `remain_credits` 或明确的零余额才显示积分。#1624 普通账户 IPC 保留既有 balance-only ×10 兼容换算，仅返回积分时 USD 为 null。该兼容字段不供接入页展示。
