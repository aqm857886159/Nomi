# CLA 签名账本与受保护主分支解耦

> 状态：⛔ 已废弃；现行政策见 [AGPL-only 与不要求 CLA](2026-08-29-agpl-only-no-cla.md)

## 问题

`contributor-assistant/github-action@v2.6.1` 需要把签名写入仓库文件。当前 workflow
把 `branch` 指向受保护的 `main`；而 `main` 强制所有修改通过 PR，因此 fork 贡献者
留言签署后，action 无法提交 `signatures/cla.json`，CLA check 会红且签名没有可靠落盘。

## 决策

> 历史方案说明：本方案曾解决“继续要求 CLA 时如何保存签名”的工程问题。用户随后决定 Nomi 只发布 AGPL-3.0-only，不再要求贡献者签字，因此当前实现已由新方案取代。

- 建立专用、非受保护的 `cla-signatures` 分支作为唯一签名账本。
- 从当前 `main` 初始化该分支，保留已有签名，再从代码分支删除会过期的账本副本。
- `pull_request_target` 继续只执行固定版本的第三方 action，不 checkout 或执行 fork 代码。
- 增加结构化 workflow 合同，禁止签名存储重新指回 `main`，并禁止代码分支保留第二份账本。

## 不动项

- （历史不再适用）不取消 CLA，不把 CLA 加入 allowlist 绕过贡献者签署。
- 不降低 `main` 分支保护，不给第三方 action 配置 PAT 或管理员绕过权限。
- 不修改 CLA 文本与既有签名内容。

## 迁移与回滚

先从修复前的 `main` 创建 `cla-signatures`，确认 `signatures/cla.json` 可读，再合入
workflow 修改。回滚只需把 workflow 的存储分支改到另一个明确的非受保护账本分支；
不得回到 `main`。签名提交历史独立保留，不依赖代码 PR 的 squash/merge 历史。

## 验收

- 合同测试在旧配置上报红、修复后转绿。
- `check:root-cause-contracts`、workflow/门岗检查与完整 CI 通过。
- 在 fork PR 留言 `recheck` 后，CLA check 通过，签名真实出现在
  `cla-signatures:signatures/cla.json`。
