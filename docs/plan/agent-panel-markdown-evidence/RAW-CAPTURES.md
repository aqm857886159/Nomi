# 原始采集归档

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

原始网页、声明、Context7/npm 响应、DOM 观察和日志按原字节保存于 `raw-captures.tar.gz`；逐文件大小与 SHA-256 见 `raw-captures-manifest.json`。源码、测试、审计结论和截图在归档外直接可审。

读取：`tar -xOzf raw-captures.tar.gz observations.json`；重放 harness 会重新生成观察文件。归档仅保存采集证据，不包含生产实现。
