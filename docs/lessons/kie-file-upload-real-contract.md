# KIE 文件上传的实测契约（官方文档三处不实）

> 📎 教训 · 首次记录 2026-08-25 · 状态：现行
> **触发场景**：要接入或改动 KIE 文件上传时；打算按 `docs.kie.ai/file-upload-api/*` 的响应字段写解析代码时；抓不到 `docs.kie.ai` 正文时。

**结论**：KIE 文件上传（`https://kieai.redpandaai.co`，Bearer 鉴权，**上传免费**）的官方文档有三处与实测不符，**以实测为准**。

**实测覆盖范围**（2026-08-25 用真 key + 真文件验过）两个端点：
- `/api/file-base64-upload`（图片）
- `/api/file-stream-upload`（multipart，**字段名必须是 `file`**，`uploadPath` 必填）

回链 GET 取回的字节与上传源**逐字节相同**。

**文档三处不实**：

1. **响应 `data` 的实际形状**是 `{ success, fileName, filePath, downloadUrl, fileSize, mimeType, uploadedAt }`。文档宣称的 `fileId` / `fileUrl` / `uploadPath` / `originalName` / `expiresAt` **都不存在**。只读 `data.downloadUrl` 才安全。
2. **回链域名是 `tempfile.redpandaai.co/<path>`**，不是文档写的 `kieai.redpandaai.co/download/<fileId>`。**别硬编码回链域名**，从 `downloadUrl` 里取。
3. **有效期无字段可读**，且文档自相矛盾（页面横幅写 24h、特性列表写 3 天）。唯一硬证据是回链响应头 `Cache-Control: max-age=86400` → **按 24h 算**。

**抓这家文档的姿势**：`docs.kie.ai` 是 apidog 站，直接抓 HTML **取不到正文**——**给 URL 加 `.md` 后缀**即得 OpenAPI 原文；`https://docs.kie.ai/llms.txt` 列出全部页面。另外用 python-urllib 直接打 API 会被 Cloudflare 拦（`error code: 1010`），`curl` 正常。

**不接的那个端点**：`/api/file-url-upload` 我们没接也不该接——Nomi 手里永远是本机字节，不存在「远程 URL 需要转存」的路径。要接之前先说明这个前提哪里变了。

**怎么用**：
- 解析响应只依赖上面列出的七个字段，出现 `fileId` / `expiresAt` 的代码就是照文档写的，需要复核。
- 回链有效期按 24h 规划缓存/重传，不要相信「3 天」。
- 契约数字变更前重跑一次真机上传验证，别只读文档 diff。

**出处**：2026-08-25 真 key 真文件实测两个端点。相关 [`assert-you-are-in-the-situation-you-claim.md`](assert-you-are-in-the-situation-you-claim.md)、[`model-limits-first-party-over-reseller.md`](model-limits-first-party-over-reseller.md)。
