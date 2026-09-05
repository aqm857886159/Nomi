# Nomi Skill 资源研究包（2026-09-05）

状态：`research-in-progress`。本目录只保存可复核的来源元数据、版权字段设计和证据索引，不复制外部 Skill 正文或受版权保护媒体。

## 文件

- `catalog.schema.json`：候选资源 machine-readable 记录的 JSON Schema。
- `catalog.seed.json`：首批已核对/待核对候选的元数据；`status` 必须区分 documented、observed、inferred、proposed、blocked。
- `report-source.md`：来源、访问日期、证据强度、许可判断和下架联系入口。
- `nomi-current-state-audit.md`：当前源码/设计链/真实入口与缺口的 source locator 审计。
- `acceptance-matrix.md`：Skill、全屏 Agent、canonical storyboard、视频拆解、隐私的真实任务与 H/B/E/T/N 草案。

## 研究规则

1. 搜索结果只用于发现；最终证据优先来自原始仓库、官方文档或作者页面。
2. `license`、`copyrightStatus`、`redistribution`、`adaptation` 任一未知时，不把资源标成可下载/可改编。
3. Skill 正文、工作流 JSON、图片、视频只保存原始 URL/版本/哈希和允许的预览引用；不把外部内容复制到 Nomi。
4. TikHub、抖音、小红书、X、用户群和 Alex 聊天没有可验证访问路径时写 `blocked`，不以点击或搜索摘要替代内容证据。
5. 本包不代表资源已经进入产品，也不代表作者授权 Nomi 再分发。

Walkthrough：source-oriented study；需要页面交互时，Action 截图必须与对应结果相邻保存。当前阶段不把静态搜索结果升级为真实产品完成证据。
