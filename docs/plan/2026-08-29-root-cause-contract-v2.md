# 根因合同 v2 与规则收敛

日期：2026-08-29
状态：🚧 进行中

## 用户价值

同一类缺陷只调查和修复一次。任何 AI 处理 bug、回归、CI 失败、性能/安全问题或审计发现时，都必须证明改动落在共享边界，覆盖同类入口，并留下机器可验证的防复发机制；不能用供应商、版本、样例或测试环境特判换取暂时全绿。

## 现状根因

仓库已有 P2、R21、`root-cause-remediation` skill 和根因合同门禁，但仍有三处结构缺口：

1. P2 与 R21 在多个常驻段落重复解释，增加注意力负担，却仍把强制合同限定在少数高风险目录。
2. 合同 schema v1 主要验证非空文本，不能证明共享边界、同类入口扫描、类级回归测试、旧路径清理和依赖生命周期相互对应。
3. 本地 hook 被 gitignore，不能成为跨 Claude/Codex/Cursor 或新 worktree 的可靠执行层；真正可移植的约束只能由已提交规则、skill 和 CI 组成。

## 范围

- 压实 `CLAUDE.md` 的 P2 与 R21，不新增规则编号；重新生成 `AGENTS.md`。
- 将 `.agents/skills/root-cause-remediation/SKILL.md` 改成所有纠正性改动的统一流程，并明确禁止补丁形态。
- 将根因合同升级到 schema v2，新增可交叉验证的共享边界、同类入口、预防机制、类级测试、旧路径和依赖生命周期字段。
- 为已有 schema v1 合同建立只读内容哈希基线：历史合同可读，但任何改动必须迁移到 v2，不能继续创建或悄悄修改 v1。
- 用 Node fixture 证明缺共享边界、单入口扫描、无类级测试、版本特判和无退出条件的依赖滞留会失败。
- 将本次跨平台 WebP 修复合同升级到 v2，并把 FFmpeg 版本漂移与升级退出条件写入依赖生命周期决策。

## 不动项

- 不在本次直接把 `@ffmpeg-installer/ffmpeg` 换成 host-architecture-only 的 `ffmpeg-static`。当前打包链能从一台 Mac 同时产出 arm64/x64；直接替换可能把错误架构二进制装进 x64 包。
- 不删除安全、认证、持久化、媒体解码或真实用户旅程测试。
- 不新增 R23，也不让本地 hook 成为唯一门禁。

## FFmpeg 决策

本次修复在共享图片解码入口把已验证 MIME 和已限界的完整字节长度绑定为 FFmpeg 输入协议；`frame_size` 消除 FFmpeg 4.1 的 4096 字节分包歧义，对 PNG/JPEG/WebP 和所有调用者一致生效。

依赖暂时保留 `@ffmpeg-installer/ffmpeg@1.1.0`，但合同必须记录升级目标与退出条件：先建立按目标平台/架构获取、校验、裁剪和打包 FFmpeg/ffprobe 的单一管线，再切到统一受支持版本；每个 macOS arm64/x64、Linux 和 Windows 产物都要验证实际架构与版本。满足这些条件前，直接换包不是升级，而是新的跨架构发布风险。

产品版本维持 `0.21.0`。该版本已由 `origin/main` 的 `v0.21.0` 确立，本 PR 是该版本后的集成功能和修复候选；在没有确定发布批次和 release notes 的情况下只改 `package.json` 会制造版本真相漂移。合并后由正式发布流程决定下一个 SemVer。

## 验收门

1. schema v2 的合法合同通过；补丁形态 fixture 失败；历史 v1 内容一旦变化就失败。
2. WebP 真实 fixture 同时通过 Antigravity 与 Provider Adapter 两个入口。
3. `check:agents-sync` 证明 Claude/Codex 规则同源。
4. 聚焦验证通过后只运行一次 `test:system:full`。
5. PR CI 全绿后合并；最终在真实 `main` 合并提交运行完整系统测试和用户价值旅程。

## 回滚

治理层可整体回滚 schema v2、v1 哈希基线、skill 和 P2/R21 文案，不改变产品数据。WebP 输入协议修复可独立回滚，但回滚会重新暴露 Linux FFmpeg 4.1 对完整 VP8 WebP 的分包失败。
