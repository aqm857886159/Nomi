# 模型账户、选择器和估价免费走查

macOS 开发版 Electron，走查提交 81e973af6。合成 Key 与回环 HTTP 服务独立运行。所有读数为测试样本，供应商订单 0 笔。复跑命令：

```sh
pnpm run build
node tests/ux/apimart-model-surfaces.rehearsal.mjs
```

| 操作 | 中文 | 英文 | 结果 |
|---|---|---|---|
| 设置里的 APIMart 账户 | [zh](zh-CN-account.png) | [en](en-account.png) | 账户 52.3 积分、Key 不设上限、近 7 天 19.6 积分和 41 次均经正式 IPC 读取。未知显示暂时读不到，0 按原值呈现。 |
| 窄窗账户卡 | [zh](zh-CN-account-narrow.png) | [en](en-account-narrow.png) | 设置宽度受真实窗口约束，三栏未溢出卡片。 |
| 画布搜索 Seedance | [zh](zh-CN-model-picker.png) | [en](en-model-picker.png) | 原有节点选择器支持搜索，结果展现当前供应商可用的模式和选项。 |
| Mini、720p、5 秒 | [zh](zh-CN-public-estimate.png) | [en](en-public-estimate.png) | 展示 1.95 积分，悬停内容有“公开估价”的来源。 |
| 余额为零 | [zh](zh-CN-zero-balance.png) | [en](en-zero-balance.png) | 有正价时显示充值与刷新。让上一次快照在渲染和点击之间过期，点击只发起账户 GET。余额为 1 积分时仍保留原发送动作。 |

[隔离网络收据](receipt.json) · [设计卡与逐元素差异](../../plan/2026-11-08-model-surface-implementation.md)

未验证 Windows、真实充值及会员实扣。按输出 token 估价和零余额的价格类别矩阵由单测另行覆盖。

## 可点击目标对账

| 拍板出处 | 生产组件 / 状态 | 角色和名称 | 动作 | 界面及副作用 | 走查锚点 | 证据 |
|---|---|---|---|---|---|---|
| M1 账户卡 | ModelAccountCard，读取成功 / 未知 | button，刷新账户 | 刷新 | 更新该连接的 Key、额度及 7 天消费，只发 GET | settings.account-card | 中英账户截图及 receipt.json |
| M2 搜索 | NomiSelect，有结果 | textbox，搜索选项；option，Seedance | 输入型号并选择 | 当前节点切换型号，浮层收起 | picker.search、picker.row | 中英 model-picker |
| M2 空结果 | NomiSelect，无匹配 | button，用 AI 帮我接入 | 点击 | 打开设置中同一个 AI 接入区，展开并聚焦 | picker.search | 双语正式走查断言 details[open] |
| M4 估价 | NodeGenerationComposer，正常 / 未知 | button，生成；描述读出积分和来源 | 选 Mini、5 秒、720p，悬停 | 得到发送前估价，未创建报价授权和订单 | cost.send-pill、cost.hover | 中英 public-estimate |
| M4 零余额 | NodeGenerationComposer，零余额 | button，去充值；button，刷新账户 | 模拟余额刚过期再点击去充值 | 本次点击只刷新，外部生成调用 0 次；非零差额保留发送 | cost.low-balance | 中英 zero-balance、receipt.json |

未通过首次独验的两项，以及实施线与真人量具的区别，见[体验成绩单](model-surfaces.scorecard.md)。
