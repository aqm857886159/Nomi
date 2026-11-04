# APIMart 接入地址归用户改（0.22.5 热修）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 背景

用户反馈：新电脑上把 APIMart 改成国内地址，保存报英文「Certification-owned connection changes require a new integration session」，老电脑能改。主域在部分网络连不上，不会翻墙的用户完全用不了。

根因：设置页入口的锁看「这条连接名下有没有带认证标记的模型」，新装机点过「继续验证 → 自检」就会带上，老装机没有；这条判据在 4 个文件各抄一份，且都把「任一行带标记」当成「整条连接归认证管」，连带让 Agent 生成路径对整家 APIMart 关门。

## 先查别人

- 生态 Cherry Studio：内置供应商的接口地址可编辑、预设为默认值、可重置，`src/renderer/pages/settings/ProviderSettings/ConnectionSettings/ApiHost.tsx:33` 与 `:54-61`，https://github.com/CherryHQ/cherry-studio/blob/main/src/renderer/pages/settings/ProviderSettings/ConnectionSettings/ApiHost.tsx
- 生态 LobeChat：内置供应商声明 `proxyUrl` 槽给用户填自己的地址，`packages/model-bank/src/modelProviders/xai.ts:15-17`，https://github.com/lobehub/lobehub/blob/main/packages/model-bank/src/modelProviders/xai.ts
- 依赖 Vercel AI SDK：provider 接受调用方传入 `baseURL`，https://ai-sdk.dev/providers/ai-sdk-providers/openai ，本仓库 `node_modules/@ai-sdk/openai/dist/index.d.ts:267`
- 仓库 08-28 认证锁的引入点：`electron/catalog/rendererCatalogMutation.ts:23-34`（提交 `529188045`）
- 仓库现在判据的唯一主人：`electron/catalog/certificationOwnership.ts:31-41`
- 完整报告：[prior-art.md](../research/2026-09-29-apimart-address-editable/prior-art.md)
- 结论：恢复旧行为（地址归用户改），不另造规则；判据收成一份。

## 范围

- 设置页入口不再锁接入地址；认证连接上改鉴权放法、连接种类仍拒绝，拒绝话说人话（中英）。
- 用户存新地址时，已存 key 的绑定跟过去（只经 `bindCredentialDestination`）。
- 首次接入页复用已接入卡片同一个地址栏组件。
- 「这条连接归不归认证管」收成 `certificationOwnership.ts` 一份，Agent 生成器装配、取连接、出请求、内置家发布、设置页改连接全部改为引用。
- 内置连接判据认官方国内线路，不再只认种子一个主机。

## 不动项

- 认证契约本身、adapter 标记的写入方、鉴权放法的保护。
- 程序写门（Agent、MCP）改地址的绑定规则。
- 不新增 IPC、弹窗、快捷填入；不改价格、额度相关任何东西。

## 回滚

单 PR 单合并，回滚即 revert 该合并提交；数据无迁移（不改盘上格式），回滚后老装机行为不变，新装机重新出现地址锁。

## 验收门

- 36 行测试表（32 通过、3 条不通过为 0.22.4 就有的英文界面旧问题、1 条未验证），用户已看截图打勾：`D:\tmp\apimart-endpoint-test\验收.html`、`测试表.md`。
- 走查脚本 `scripts/apimart-domestic-line-walkthrough.mjs --packaged` 驱动安装包，主进程出站换成本机模拟，零真实请求；真实调用一次由 `tests/ux/apimart-domestic-line.paid.mjs` 经 `tests/ux/_paidRun.mjs` 护栏跑，约 0.1 点。
- 候选版再验：新装机改地址到国内线路 → 画布生成走国内线路。
- 门岗：contracts 全绿、相关单测、build。
