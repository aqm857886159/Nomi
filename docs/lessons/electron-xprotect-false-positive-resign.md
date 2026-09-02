# Electron 被 macOS 误报恶意软件的修法：重下 + ad-hoc 重签换 cdhash

> 📎 教训 · 首次记录 2026-08-12 · 状态：现行
> **触发场景**：macOS 弹「未打开 Electron.app，因其包含恶意软件」并把 `node_modules/electron/dist/Electron.app` 本体直接删除；或 `pnpm dev` 起不来、Electron 进程 hang 住且完全没有日志。

**结论**：这是 XProtect 误报，判定按二进制 **cdhash** 缓存，与 quarantine 属性无关。所以 `xattr -cr` 摘标记**没用**，重新下载同版本（同 cdhash）也照样在 exec 层卡死。真正的修法是重下本体 + ad-hoc 重签，换掉 cdhash。

2026-08-12 实锤：macOS（Darwin 25）误报开发用 Electron 31.7.7。

**修法（已验证）**：

```
cd node_modules/electron && rm -rf dist && node install.js
codesign --force --deep --sign - node_modules/electron/dist/Electron.app
```

第 2 步换出新的 ad-hoc 签名 → cdhash 变 → 缓存判定失配 → 立刻能跑。

**为什么会踩**：「被系统拦下的 app」的直觉修法是摘 quarantine 或重装，两条在这里都无效，很容易在错的方向上耗掉一小时。关键分辨点是**它连日志都没有**——因为压根没进到 app 代码。

**怎么用**：

- 诊断技巧：`ELECTRON_RUN_AS_NODE=1 <binary> -e 'console.log(1)'` 也 hang = 被拦在 exec 层，不是 app 代码问题。
- **复发条件**：pnpm 重装 / 清 store 后 electron dist 被重新解压（恢复原 cdhash）会再犯，照跑第 2 步即可。升级 Electron 版本天然换 cdhash，大概率不再触发。

**出处**：2026-08-12 本机实测（Darwin 25 / Electron 31.7.7）。
