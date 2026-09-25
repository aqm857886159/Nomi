# 通知策略真实前后证据

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：真实截图与交互通过；完整 gates / 推送收据见仓库根目录 TOAST-POLICY-LAST.md。

基线 1d565961f。Electron before 使用旧生产构建；局部 before 由 git show 基线真实组件经 Vite 渲染，不手绘旧界面。桌面写入失败采用明确注入，不调用收费模型。

| 用户任务 | 前 | 后 | 验证 |
|---|---|---|---|
| 检查文件夹五次 | [前](before-directory-check.png) | [后](after-directory-check.png) | 原地结果保留，全局 toast 2→0 |
| 收到新版本 | [前](before-update-available.png) | [后](after-update-available.png) | 自动模态→角标；[主动点击才打开](after-update-requested.png)，关闭后 downloaded 不重开 |
| 开启 Codex 失败后重试 | [前](before-codex-inline.png) | [后](after-codex-inline.png) | 原按钮旁错误；[重试成功清错](after-codex-retry.png) |
| 恢复制作为失败 | [前](before-production-inline.png) | [后](after-production-inline.png) | 原任务卡原因与继续按钮 |
| 音轨拒绝外项目素材 | [前](before-timeline-inline.png) | [后](after-timeline-inline.png) | 原轨道说明，素材未写入 |
| 同一原因五次 | [前](before-repeat-five.png) | [后](after-repeat-five.png) | 2可见+3排队→1可见×5+0排队；动作运行第5次回调；关闭重来从1计数 |
| 五次非法全景导入 | [前](before-scene3d-panorama-inline.png) | [后](after-scene3d-panorama-inline.png) | 2可见+3排队→1内联，无重复导入按钮 |
| 书签改名 | 旧源码 Playwright dialog 事件验证 native prompt | [原位编辑](after-bookmark-inline-edit.png) / [保存](after-bookmark-inline-saved.png) | Enter保存、Esc取消；未伪造原生窗口截图 |

复现：`node tests/ux/notification-local-feedback.e2e.mjs`；`node tests/ux/notification-scene-feedback.e2e.mjs`；先 `pnpm build` 再 `NOTIFICATION_POLICY_PHASE=after node tests/ux/notification-policy.walk.mjs`。均 exit 0。共享时钟用真实浏览器 page.clock：首次1000ms，900ms再报错，再推进5000ms仍保留最新错误直到关闭。主任务逐张检查最终截图；局部组件交互不冒称完整生成旅程。未运行真实收费生成（本任务无生成契约改动）。
