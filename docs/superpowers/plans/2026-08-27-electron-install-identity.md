# Electron 安装身份执行计划

> ✅ 已交付（Electron 安装身份闸门、Workers Web-only 构建边界与回归测试随 PR #210 同批落地）

1. 先写身份检查器的失败测试，覆盖共享依赖、包版本、dist 版本、真实二进制版本和健康安装。
2. 实现只读身份检查器与命令行错误报告，使定向测试转绿。
3. 写安装修复测试，证明缺失运行时会调用 Electron 自带安装器，错误包和共享依赖不会被修改。
4. 实现安装修复脚本并接入根 `postinstall`。
5. 把同一检查接入 dev/start/build/dist/gates 和 Windows 门岗，更新 worktree 文档与过时注释。
6. 在独立 worktree 执行真实 `pnpm install --frozen-lockfile --prefer-offline`，核对三份版本与 `electron --version`。
7. 运行定向测试、完整 gates、diff 审查和独立代码审查。
8. 从最新远端 main 更新，普通 push、开 PR；等待必需检查后正常合并。
9. PR 的 Cloudflare Workers 静态站构建暴露安装边界：先用失败测试证明 `WORKERS_CI=1` 仍会进入桌面 Electron 安装/探针，再让这个官方 Web-only 环境只跳过桌面运行时安装；桌面 dev/start/build/dist/gates 的身份闸门保持不变。重跑完整 gates，等待新 SHA 的 GitHub 与 Workers 检查后再合并。
10. Cloudflare 首轮新 SHA 仍使用旧的 `pnpm run build` 快照，证明页面输入值不等于后端构建配置。把 Workers Build command 持久化为 `pnpm run build:site`，将这一外部配置写入设计不变量；再用设置保存后的新提交触发全新构建，必须从 Build settings 快照和日志同时确认 Web-only 命令后才放行。

回滚：撤销本 PR 即恢复旧安装流程；不修改用户数据、项目文件或发布产物。
