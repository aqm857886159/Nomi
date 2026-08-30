# Issue #237: 接入请求与英文上手入口

日期：2026-08-30

> 状态：🚧 进行中

## 背景

GitHub issue #237 与 Discussion #220 的最新追问暴露出两条不同摩擦：

1. OpenAI-compatible 图片请求在“Auto · 1K”时可能把空的 `size` 发给供应商，供应商因此返回 `Invalid size ""`。
2. 英文用户第一次到达仓库后，不知道模型接入、参考图上传和排错从哪里开始。

## 范围

- 修复请求参数构建的根因：无明确尺寸时，OpenAI-compatible 图片请求省略 `size`，不发送空字符串或 `auto`。
- 增加英文模型接入教程，覆盖文本/图片/视频模型、OpenAI-compatible endpoint、参考图、测试失败时需要收集的信息。
- 增加一份可复制给 Codex 的英文贡献者提示词，让没有 Nomi 内部上下文的用户也能从 issue、供应商官方文档和脱敏证据开始排查，并以分支/PR 交付。
- 增加一份不要求开 PR 的紧急接入提示词：优先调用已内置的 `model-integration` Skill / MCP；若当前版本缺少供应商私有上传能力，只允许在用户本地补齐上传通道，不扩展 Runway 模型适配。
- 在英文 README 增加清晰的 Tutorial、model integration guide、Discussion 和 business inquiry 入口。
- 写入当日反馈摘要与研究雷达，保留 issue 的可追溯证据但不复制公开 issue 中的私人联系方式。

## 不做

- 不猜测或公开未确认的 X/Twitter、Reddit、YouTube 账号 URL。
- 按维护者明确授权，公开工作流支持邮箱 `2373272608@qq.com` 与 X/Twitter 账号；Issue 正文仍不得包含其他私人联系方式或凭据。
- 不把匿名文件上传 host 的网络可达性伪装成代码已修复；该类失败需要用户网络、代理或已配置供应商上传能力。
- 不重写 provider adapter 的自动猜测逻辑；没有官方 API 文档和可复现请求/响应前，不宣称某个第三方 endpoint 已支持。

## 验收

- `taskTemplateParams({ extras: { aspect_ratio: "auto", resolution: "1K" } })` 经 OpenAI-compatible image mapping 后，最终 body 不含 `size`。
- 明确比例（例如 `16:9`）仍生成合法像素尺寸（例如 `1024x576`）。
- 相关 Vitest 通过；站点/文档静态检查通过；不修改当前脏工作树中的用户变更。
- README 能直接到达英文模型接入教程、快速启动、Discussion 和 Business Inquiry。
- 紧急接入提示词明确使用 `model-integration` Skill / MCP、自行在本地完成接入、不提交 PR；若需代码变更，仅补经官方文档验证的 Runway 私有上传通道，不添加 Seedance 2.5 模型适配。
- 英文教程能直接到达 Codex 修复提示词；提示词不要求用户公开 API key、私人联系方式或把代码直接推到 `main`。

## 回滚

代码回滚只涉及 `electron/catalog/taskParams.ts` 与其回归测试；文档和摘要可独立删除，不触碰用户配置或远端数据。
