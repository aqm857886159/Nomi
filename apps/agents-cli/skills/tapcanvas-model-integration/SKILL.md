---
name: tapcanvas.modelIntegration
description: 模型供应商接入 Agent。用户提供文档 URL 和供应商 API Key，自动分析 API 结构、推荐模型列表、询问用户选择，然后用内置工具完整写入 model catalog 并测试。
---

# 模型接入 Agent

## 可用工具

你有以下专用工具，直接调用，不需要 curl 或脚本：

- `model_catalog_health` — 查看当前 catalog 状态
- `model_catalog_fetch_docs` — 抓取供应商文档页面
- `model_catalog_import` — 写入 vendor/model/mapping 配置
- `model_catalog_list_mappings` — 列出已有 mappings（获取 mappingId）
- `model_catalog_test_mapping` — 测试连通性（execute:true 做真实调用）

## 执行流程

### 第一步：收集信息

必须有：文档 URL、供应商 API Key。缺一项就问用户要。

### 第二步：抓取并分析文档

调用 `model_catalog_fetch_docs`，分析：
- base URL、认证方式（bearer/x-api-key）
- 支持的模型 ID 和能力（text/image/video）
- create endpoint（路径、请求体结构）
- query endpoint（路径、taskId 参数、响应字段）
- 状态值（queued/running/succeeded/failed 对应的原始字符串）

### 第三步：列出模型，询问用户

```
发现以下模型，你想接入哪些？（说"全部"或列出编号）

1. xxx — 文生图
2. yyy — 视频生成
```

等用户回复后继续。

### 第四步：构建并写入

调用 `model_catalog_import`，package 结构：

```json
{
  "version": "v2",
  "exportedAt": "<ISO时间>",
  "vendors": [{
    "vendor": {
      "key": "<vendor-key>",
      "name": "<名称>",
      "enabled": true,
      "baseUrlHint": "<base URL>",
      "authType": "bearer",
      "meta": { "integrationDraft": { "source": "model-integration-agent", "channelKind": "aggregator_gateway", "adapterContract": "requestProfile.v2" } }
    },
    "apiKey": { "apiKey": "<供应商API Key>", "enabled": true },
    "models": [{
      "modelKey": "<model-id>",
      "modelAlias": "<model-id>",
      "labelZh": "<中文名>",
      "kind": "image|video|text",
      "enabled": true,
      "meta": { "sourceUrl": "<文档URL>" },
      "pricing": { "cost": 1, "enabled": true, "specCosts": [] }
    }],
    "mappings": [{
      "taskKind": "text_to_image|text_to_video|image_to_video|image_edit|chat",
      "name": "<名称>",
      "enabled": true,
      "requestProfile": {
        "enabled": true,
        "version": "v2",
        "status_mapping": {
          "queued": ["<原始状态值>"],
          "running": ["<原始状态值>"],
          "succeeded": ["<原始状态值>"],
          "failed": ["<原始状态值>"]
        },
        "create": {
          "candidates": [{
            "when": { "equals": { "left": "model.model_key", "value": "<model-id>" } },
            "method": "POST",
            "path": "<endpoint路径>",
            "body": { "<按文档填写>": "{{request.prompt}}" },
            "response_mapping": { "task_id": "<taskId字段路径>", "status": "<status字段路径>" },
            "provider_meta_mapping": { "query_id": "<taskId字段路径>" }
          }]
        },
        "query": {
          "default": {
            "method": "GET",
            "path": "<query endpoint路径>",
            "query": { "<taskId参数名>": "{{taskId}}" },
            "response_mapping": {
              "task_id": "<taskId路径>",
              "status": "<status路径>",
              "error_message": "<error路径>",
              "assets": {
                "type": "image|video",
                "urls": [
                  "<直接数组路径>",
                  { "from": "<JSON字符串字段路径>", "transform": "jsonStringFieldArray", "field": "<数组字段名>" }
                ]
              }
            }
          }
        }
      }
    }]
  }]
}
```

**关键规则：**
- `taskKind` 只能是：`chat` / `text_to_image` / `image_edit` / `text_to_video` / `image_to_video` / `prompt_refine` / `image_to_prompt`
- `kind` 只能是：`text` / `image` / `video`
- 响应字段路径用 `|` 分隔多个候选（如 `data.taskId|taskId`）
- 如果结果 URL 在 JSON 字符串字段里，用 `jsonStringFieldArray` transform
- 不确定的字段：`mapping.enabled` 设 false，在 missing 里说明

### 第五步：测试

1. `model_catalog_list_mappings` 获取 mappingId
2. `model_catalog_test_mapping` 做真实测试（execute:true）
3. 报告结果

## 失败处理

- 文档 404：让用户提供具体模型页面 URL（不是目录页）
- import 400：检查 package 结构，修正后重试
- 测试失败：检查 base URL、认证、endpoint 路径，询问用户确认
