---
name: tapcanvas.modelIntegration
description: 模型供应商接入 Agent。用户提供文档 URL 和 API Key，自动分析 API 结构、推荐可接入的模型列表、询问用户选择，然后完整配置写入 model catalog。
---

# 模型接入 Agent

## 目标

用户给你一个供应商的文档链接和 API Key，你负责：
1. 抓取并分析文档，理解 API 结构
2. 列出该供应商支持的模型，给出推荐，询问用户想接入哪些
3. 根据用户选择，构建完整的 import package
4. 写入 model catalog，并做连接测试
5. 报告结果

## 工具脚本

所有操作通过以下脚本完成（路径相对于 repo 根目录）：

```bash
# 查看当前 catalog 状态
node apps/agents-cli/skills/tapcanvas-model-integration/scripts/catalog.mjs \
  --cmd health --apiKey <KEY>

# 抓取供应商文档
node apps/agents-cli/skills/tapcanvas-model-integration/scripts/catalog.mjs \
  --cmd fetch-docs --url <DOCS_URL> --apiKey <KEY>

# 导入 package（--pkg 可以是 JSON 字符串或文件路径）
node apps/agents-cli/skills/tapcanvas-model-integration/scripts/catalog.mjs \
  --cmd import --pkg '<JSON>' --apiKey <KEY>

# 测试 mapping 连通性
node apps/agents-cli/skills/tapcanvas-model-integration/scripts/catalog.mjs \
  --cmd test-mapping --mappingId <ID> --modelKey <KEY> --apiKey <KEY> --execute true

# 查看已有 vendors / models / mappings
node apps/agents-cli/skills/tapcanvas-model-integration/scripts/catalog.mjs \
  --cmd list-vendors --apiKey <KEY>
node apps/agents-cli/skills/tapcanvas-model-integration/scripts/catalog.mjs \
  --cmd list-models --apiKey <KEY>
node apps/agents-cli/skills/tapcanvas-model-integration/scripts/catalog.mjs \
  --cmd list-mappings --vendorKey <VENDOR> --apiKey <KEY>
```

`--apiKey` 是用户的 Nomi API Key（用于调用本地 API，不是供应商 Key）。  
供应商 API Key 写入 import package 的 `vendors[].apiKey.apiKey` 字段。

## 执行流程

### 第一步：收集信息

用户必须提供：
- 供应商文档 URL（一个或多个）
- 供应商 API Key
- Nomi API Key（用于写入 catalog）

如果缺少任何一项，直接问用户要，不要猜测或跳过。

### 第二步：分析文档

用 `fetch-docs` 抓取文档，分析：
- API endpoint（base URL、认证方式）
- 支持的模型列表（model ID、能力类型：text/image/video）
- 请求/响应结构（create task、query result）
- 是否异步任务（需要轮询）还是同步返回

### 第三步：推荐并询问用户

列出你发现的所有可接入模型，格式：

```
发现以下模型，请告诉我你想接入哪些（可以说"全部"或列出编号）：

1. gpt-image-2-text-to-image — 文生图，支持 1K/2K/4K 分辨率
2. gpt-image-2-image-to-image — 图生图/局部重绘
3. ...
```

等待用户回复后再继续。

### 第四步：构建 import package

根据用户选择，构建符合以下结构的 JSON：

```json
{
  "version": "v2",
  "exportedAt": "<ISO时间>",
  "vendors": [{
    "vendor": {
      "key": "<vendor-key>",
      "name": "<供应商名>",
      "enabled": true,
      "baseUrlHint": "<base URL>",
      "authType": "bearer",
      "meta": {
        "integrationDraft": {
          "source": "model-integration-agent",
          "channelKind": "aggregator_gateway",
          "adapterContract": "requestProfile.v2"
        }
      }
    },
    "apiKey": { "apiKey": "<供应商API Key>", "enabled": true },
    "models": [
      {
        "modelKey": "<model-id>",
        "modelAlias": "<model-id>",
        "labelZh": "<中文名>",
        "kind": "image",
        "enabled": true,
        "meta": { "sourceUrl": "<文档URL>" },
        "pricing": { "cost": 1, "enabled": true, "specCosts": [] }
      }
    ],
    "mappings": [
      {
        "taskKind": "text_to_image",
        "name": "<供应商名> 文生图",
        "enabled": true,
        "requestProfile": {
          "enabled": true,
          "version": "v2",
          "status_mapping": {
            "queued": ["queued", "pending", "0"],
            "running": ["running", "processing", "1"],
            "succeeded": ["succeeded", "success", "completed", "2"],
            "failed": ["failed", "error", "3", "-1"]
          },
          "create": {
            "candidates": [
              {
                "when": { "equals": { "left": "model.model_key", "value": "<model-id>" } },
                "method": "POST",
                "path": "<create endpoint path>",
                "body": { "model": "<model-id>", "input": { "prompt": "{{request.prompt}}" } },
                "response_mapping": {
                  "task_id": "data.taskId|taskId",
                  "status": "data.state|data.status"
                },
                "provider_meta_mapping": { "query_id": "data.taskId|taskId" }
              }
            ]
          },
          "query": {
            "default": {
              "method": "GET",
              "path": "<query endpoint path>",
              "query": { "taskId": "{{taskId}}" },
              "response_mapping": {
                "task_id": "data.taskId",
                "status": "data.state|data.status",
                "error_message": "data.failMsg|data.errorMessage",
                "assets": { "type": "image", "urls": ["data.resultUrls"] }
              }
            }
          }
        }
      }
    ]
  }]
}
```

**关键规则：**
- `taskKind` 只能是：`chat` / `prompt_refine` / `image_to_prompt` / `text_to_image` / `image_edit` / `text_to_video` / `image_to_video`
- `kind` 只能是：`text` / `image` / `video`
- `authType` 只能是：`none` / `bearer` / `x-api-key` / `query`
- 异步任务必须有 `create` + `query` 两段；同步任务只需 `create`
- `response_mapping` 的字段路径用 `|` 分隔多个候选，从左到右取第一个非空值
- `{{request.prompt}}` 等模板变量会在运行时替换

### 第五步：写入并测试

1. 用 `import` 命令写入 catalog
2. 用 `list-mappings` 获取刚写入的 mapping ID
3. 用 `test-mapping --execute true` 做真实连接测试
4. 报告结果：成功/失败、哪些模型可用

## 失败处理

- 文档抓取失败：让用户直接粘贴 curl 示例或 API 说明
- import 返回 400：检查 package 结构，修正后重试
- 连接测试失败：检查 base URL、认证方式、endpoint 路径是否正确，询问用户确认
- 信息不足时：在 `missing` 中列出问题，不要编造 endpoint

## 禁止

- 不要编造 endpoint、模型 ID 或响应字段
- 不要在没有用户确认的情况下写入 catalog
- 不要跳过连接测试步骤
