# S6 接入页 · Electron 走查

在隔离资料中运行 `node tests/ux/t5-onboarding-s6.walk.mjs`。中文浅色与英文深色均使用 1440×900 内容视口，英文另切到 700×720。供应商的主域和三个备用域均重定向至本机 HTTP 夹具，网络守卫开启，浏览器外链由走查截获。

| 操作 | 实际结果 | 截图 |
|---|---|---|
| 项目库进入，打开官网，Esc 返回，再进接入页 | 浏览器打开时间和三步说明仍在。打开「打不开？」可见三个镜像 | [中文等待](o3-light.png)、[英文窄窗](o3-narrow.png)、[镜像](o6-mirrors-light.png) |
| 提交网址，再粘贴一个返回 401 的候选 Key | 前者新增请求数为 0；后者留在原页显示对应的拒收卡 | [格式](o6-format-light.png)、[拒收](o6-invalid-dark.png) |
| 创建图片节点，写下草稿，从生成框进入，模拟加密失败 | 本机化钥匙串错误与重试按钮可见 | [中文](o6-keychain-light.png)、[英文](o6-keychain-dark.png) |
| 重试遇到连接中断，再让浏览器恢复在线 | 离线卡说明凭据已存好。online 恢复后主进程用已存凭据回查，显示四行，Key 额度为 52.3 积分 | [离线](o6-offline-light.png)、[四行检查](o4a-light.png) |
| 检查完成回到生成画布 | 原图片节点草稿仍为 “An orange cat at the window”，生成框显示连接成功提示，随后自行消失 | [回到草稿](o4b-light.png) |

两次草稿走查和一次独立项目库走查共收到 9 个 loopback GET。最后一次让官方形状的 token 响应返回零积分，真窗分别显示账户「暂时读不到」与 Key「0 积分」，随后回到项目库。[零 Key 额度截图](o4a-zero-token.png)

格式、候选 Key 拒收和存储失败均走真实 Electron 桥接，401/403 保留旧凭据另有主进程写入测试。窗口使用模拟加密后端，钥匙串锁定通过注入一次加密失败验证。

## 板图对照

左栏为设计板，右栏为生产窗口。[O3、O4a、O4b](board-vs-impl-o3-o4.png) · [O6](board-vs-impl-o6.png) · [英文与深色](board-vs-impl-en-dark.png)

## 账户余额待裁定

这次夹具按官方 `GET /v1/balance` 的结构返回单把 Key 的额度。账户余额行显示「暂时读不到」。Composer 只提示已连接。来处说明取现有项目名或项目库名。真实端点含义见 [APIMart 的两种余额对照](https://docs.apimart.ai/en/api-reference/account/user-balance#token-balance-vs-user-balance)。

单测另给页面注入明确的账户快照，验证账户为零显示充值说明，focus 与 visibilitychange 合并为一次只读重查，正数余额进入返回事件。这个测试没有覆盖账户快照的生产来源。O5 与 O6 零余额真窗、O5 对照图，以及 O4 的真实账户数值仍待账户数据源裁定。

## 自验命令

- 先后运行 app 与 electron 两份 TypeScript 配置的 noEmit 检查。
- 余额与接入页两份 Vitest 文件共 24 例。另跑主进程凭据测试 9 例，其中覆盖 401 与 403 保留旧记录。
- 板图、文件体积、设计 token、词典费用文案、测试文案、概念 owner、分层边界、边界 owner 与改动 lint 均使用仓库门岗。文件体积和 token 的入口在 package.json 分别登记为 `scripts/check-file-sizes.mjs`、`scripts/check-design-tokens.mjs`。
