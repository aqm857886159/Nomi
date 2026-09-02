# 走查里别用 `win.reload()`

> 📎 教训 · 首次记录 2026-08-18 · 状态：现行
> **触发场景**：走查里出现 `win.reload()`；或走查跑出「某个面板整个空掉 / 卡片退化成一行没有任何按钮的紧凑行」，看起来像真 bug。

**结论**：不要用 `win.reload()` 来「重新加载状态」。原地刷新后活动项目恒 `null`，一堆面板会静默空掉——这是走查独有的路径，不是用户路径。

## 为什么会踩

原地刷新后 `setActiveWorkbenchProjectSaveTarget` 不会被重新调用（它挂在 `NomiStudioApp` 的 `activeProject` 绑定副作用上），于是 `getActiveWorkbenchProjectId()` **永远返回 `null`**。

所有读它的地方（制作任务卡、抽帧落素材、`ClipNode` 导出、拆镜头…）会静默失效——任务中心里制作 run 从完整卡退化成一行没有任何按钮的紧凑行，**看起来和真 bug 一模一样**。

2026-08-18 为此追了半小时，一度以为是产品 bug。实测对照：冷启动后从项目库点「继续创作」进项目，一切正常（卡片、按钮都在）。

## 怎么用

- 要让 store 重新挑 run：**关掉再打开那个面板**（`load` 挂在面板 enabled 变化上），别刷页面。
- 要模拟冷启动：`app.close()` 后用同一份 `userDataDir` / `projectsDir` 重新 `launchNomiApp`，再从项目库点「继续创作」（按钮文案就是这个，不是项目名）。
- 看到「面板整个空掉 / 没有按钮」**先怀疑这条，再怀疑产品**。

**出处**：2026-08-18 走查排查；相关代码 `NomiStudioApp` 的 `activeProject` 绑定副作用、`getActiveWorkbenchProjectId()`。

**相关**：[walkthrough-repair-probe-first](walkthrough-repair-probe-first.md)、[walkthrough-assertions-need-a-real-signal](walkthrough-assertions-need-a-real-signal.md)、[walkthrough-default-profile-is-isolated](walkthrough-default-profile-is-isolated.md)
