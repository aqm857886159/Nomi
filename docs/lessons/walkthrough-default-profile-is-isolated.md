# 走查默认跑隔离 profile，不是真实资料库

> 📎 教训 · 首次记录 2026-08-25 · 状态：现行
> **触发场景**：走查里配好的 key / 项目 / 设置「怎么都不生效」；或走查输出里的厂商、模型、时长和你在真实 Nomi 里看到的对不上；或你想在 `app.evaluate()` 里 `require` 仓库模块。

**结论**：`tests/ux/_launchApp.mjs` 的 `launchNomiApp()` **默认 `isolate: true`**，跑在 `mkdtemp` 出来的临时 userData / settings / projects 上。要操作**真实**资料库（`~/Library/Application Support/nomi`）必须显式传 `isolate: false`。

## 怎么当场识破自己在不在真现场

看走查输出里有没有「只有真 profile 才会有」的痕迹。

2026-08-25 实例：在临时 profile 里配了 KIE key，卡片显示图片走 litterbox——但真实资料库有 apimart key，**图片本该显示 APIMart**。这个不一致就是「我不在我以为的现场」的信号；切 `isolate: false` 后立刻变成 APIMart 72h。

事后再用 `node -e` 读一次真实 `model-catalog.json` 确认落盘，**别只信 UI**。

## 另一个坑

`app.evaluate()` 里 **`require` 和动态 `import()` 都不可用**（`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`）。想在主进程里调仓库模块，别走这条路——直接用 Playwright 驱动真实 UI 更可靠，还顺带验了交互路径。

**出处**：`tests/ux/_launchApp.mjs`（`launchNomiApp` 的 `isolate` 默认值）。

**相关**：[assert-you-are-in-the-situation-you-claim](assert-you-are-in-the-situation-you-claim.md)、[iso-walkthrough-key-seeding-traps](iso-walkthrough-key-seeding-traps.md)、[walkthrough-no-win-reload](walkthrough-no-win-reload.md)、[walkthrough-assertions-need-a-real-signal](walkthrough-assertions-need-a-real-signal.md)
