# 出厂配置只能在**产物**上验，env 在打包机上永远是对的

> 📎 教训 · 首次记录 2026-09-17 · 状态：✅ 已固化（`scripts/check-packaged-intake.mjs`）
> **触发场景**：任何「随包发出去的配置」——上报端点、发布令牌、默认服务地址、构建期开关。

**结论**：只从 `process.env` 读的配置，在**装机版里等于没配**——装机版的 `process.env` 是用户桌面的环境。
要随包出厂，就必须在构建期烤进产物；要证明它出厂了，就必须**在产物上**验，不能在源码、env 或走查里验。

**为什么会踩**：0.21.0 的反馈回路 `electron/telemetry/intakeClient.ts` 只读
`NOMI_INTAKE_ENDPOINT` / `NOMI_INTAKE_TOKEN`，而全仓**没有任何地方**在打包或 CI 里注入它们。
四道证据同时说「好的」：
- 两条走查自己在 `env` 里塞了端点 → 端到端链路真发出去了，绿；
- 单测测的是**解析规则**（https 卡不卡、尾斜杠剥没剥），不是「出厂那个包配没配」，绿；
- 打包步骤只验媒体目标与 MCP 冒烟，没人看过包里有没有这份配置，绿；
- 用户侧唯一的信号是设置页一行「未配置端点，只在本机记录」，而那行文案当时长得像**正常状态说明**。

于是用户点了「愿意」、写了反馈、拿到编号 `NF-0917-0001`，东西只躺在本机发件箱里。

**怎么用**：
- 判断一份配置是不是「出厂了」，唯一可信的动作是**解开包读那个文件**（`check-packaged-intake.mjs`
  从 `app.asar` 里取 `dist-electron/intake-config.json`）。任何在构建机 shell 里 `echo $VAR` 的检查都不作数。
- 这道门**不进 `pnpm run gates`**：本机开发构建本来就该是空的。它属于 CI 的打包 job，紧跟 electron-builder。
- 「未配置」的界面文案要说人话说到底（「这个版本不发送」），别只说内部状态（「未配置端点」）——
  后者读起来像一条说明，不像一条故障。

**出处**：走查 `docs/audit/2026-09-17-post-804-walkthrough.md` 第 3 节 W-01；
修复见 `scripts/write-intake-config.mjs` / `scripts/check-packaged-intake.mjs` /
`.github/workflows/desktop-rc.yml` / `desktop-preview.yml`。
