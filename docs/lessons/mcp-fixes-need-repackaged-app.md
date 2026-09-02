# MCP 侧改动必须重新打包 app 才看得到

> 📎 教训 · 首次记录 2026-09-01 · 状态：现行
> **触发场景**：改了 `electron/capabilityCore/**` 之后用户说「界面上没有呀，为什么依然是旧行为」；或走查里断言不到刚写的新文案；或 dev 树里跑 MCP 走查，工具数量和预期对不上。

**结论**：**Nomi 的 MCP server 就是 app 自身的二进制**（客户端配的是 `Nomi.app/Contents/Frameworks/Nomi Helper.app/.../Nomi Helper` + `app.asar/dist-electron/capabilityCore/mcpNodeLauncher.js`，`NOMI_MCP_STDIO=1`）。所以改了 `electron/capabilityCore/**` 之后，用户在他的客户端里**什么都不会变**，直到：合 PR → 重新打包安装 Nomi.app → 重启客户端。分支上跑绿的走查跟他装机版的行为是两码事。

**怎么当场验装机版有没有你的改动**（别猜、别解释半天）：

```
grep -a -c "<你新代码里的特征中文串>" /Applications/Nomi.app/Contents/Resources/app.asar
grep -a -c "<被你删掉的旧串>"        /Applications/Nomi.app/Contents/Resources/app.asar
```

用 `grep -a`，**不要用 `strings`**（抓不到 asar 里的中文）。旧串还在 + 新串为 0 = 装机版是改动前的。

**配套的另一个构建坑**：走查里验**渲染层**改动（确认卡文案、i18n…）只跑 `pnpm run build:electron` 是无效的——那只编译 electron 侧 tsc，GUI 加载的是 vite 产物 `dist/`。必须 `pnpm run build`。栽过一次：卡上那句新文案怎么都断言不到，以为逻辑没通，其实是渲染层没重编。

**反向的同一坑（2026-09-01）**：在 dev 树里跑 `mcp-client-activation.walk.mjs` 时，`verifyMcp` 的握手对象是 **launcherEntry 配置指向的装机版** `/Applications/Nomi.app` 的 server，**不是**当前树的 `dist`——所以 dev 走查看到的 toolCount 跟着装机版走（当天：装机 Aug-27 版 = 33，树内 = 43）。给 MCP 工具目录写精确计数断言必错两头；仓库已定调用下限（`packaged-mcp-smoke` 与该 walk 均用 `>= 22` legacy floor + 唯一名检查）。

**出处**：2026-08-19 从「用户说界面上没有」那场排查里学到；2026-09-01 补反向坑。相关：[MCP elicitation 的支持面](claude-code-lacks-elicitation-capability.md)（叠加的第二个原因）。
