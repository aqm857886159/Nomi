# DOCAUDIT-A：KIE + APIMart

> 状态：✅ 已交付

## 范围

- 只核对 `electron/catalog/kie*`、`electron/catalog/apimart*` 以及其已有共享能力档案/合同测试。
- 先抓 2026-09-02 的官方 `.md` 文档，逐 mapping 核对 model、端点、模式、参数、互斥、响应与轮询。
- 对 recurring wire drift 在最早的请求构造边界统一修复；保留内部兼容 model key，不改变用户已有节点身份。
- 付费只测 acceptance matrix 中未封印且用户已解锁的最小样本；新增台账支出不超过 ¥45。

## 不动项

- 不触碰其他 vendor catalog、其他 worktree、`main` 或远端默认分支。
- 不把官方文档中已证实与线上 wire 冲突的 KIE 响应/回链/有效期说法直接写进生产解析器。
- 不把未在当前 curated catalog 中的 APIMart Pro/Max 变体擅自加入目录。

## 回滚与验收

- 每个 vendor 证据报告独立提交；每两个 commit 推送一次 `origin HEAD`。
- 合同红测先于生产修复；`check:root-cause-contracts`、changed tests、`pnpm run gates` 必须通过。
- 付费产物必须下载并用图像/视频帧人工核对提示词特征与参考特征；失败、余额不足或无法核对均如实记账。
