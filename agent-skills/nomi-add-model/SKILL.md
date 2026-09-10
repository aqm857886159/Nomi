---
name: nomi-add-model
description: 把一个生成模型（文本 / 图片 / 视频 / 音频 / 3D）接进本机 Nomi 并真跑一次验证。当用户说「帮我把 X 接进 Nomi」「在 Nomi 里加个模型」「给 Nomi 接一下这家中转站」时使用。需要宿主已连上 Nomi 的 MCP server（工具名 nomi_integration）。
compatibility: 需要宿主已接入 Nomi 的 MCP server，并能调用 nomi_integration 工具。
metadata:
  nomi-audience: external-host
  nomi-contract: electron/capabilityCore/mcpIntegrationTools.ts
---

# 把模型接进 Nomi

Nomi 通过 MCP 暴露 `nomi_integration` 这**一个**工具，六个 action 走完全程。

**任何时候都不要把 API Key 写进工具参数。** Nomi 会自己弹出本机安全页向用户要，你看不到，也不需要看到。
参数里只允许出现 header / query 的**名字**（`authHeader` / `authQueryParam`），不允许出现它们的值。

每一步都带 `expectedRevision`——它是会话状态指纹。拿到的返回里有新的 `revision`，下一步就用新的那个；
对不上说明会话被别人动过，重新 `get` 一次再继续，不要重试旧的。

## 六步

1. **`begin`** — 说清要接什么，拿到 `sessionId` 与 `revision`。
   必填 `kind`（`http-api-provider` 或 `comfyui-workflow`）与 `name`。
   把用户给的接口文档一并递进来：`baseUrl`、`docs`（文档正文，或每行一个 URL 的列表，≤64KB）、
   `authType`（`none` / `bearer` / `x-api-key` / `query`）。文档是这一步最值钱的输入——递进来的会被直接采信，
   不递就只能靠猜域名去找文档站。

2. **`open_credentials`** — Nomi 弹出本机安全页，用户在那儿贴 Key。
   这一步返回后会话停在 `needs_credential`，等用户贴完才继续。别在这里替用户想办法。

3. **`propose`** — 先传**空 proposal** 让 Nomi 去探对方的 `/models`。
   探不到就把候选手填进 `proposal.candidates`（每项 `{ modelKey, kind }`，`kind` ∈ text / image / video / audio / model3d）。
   用户选定哪几个，写进 `proposal.selections`。
   ComfyUI 走的是 `proposal.workflow`（工作流 JSON 文本）。

   **如果 propose 返回了 `compileRequest`**：这台机器上没有可用来读文档写说明卡的文本模型，
   所以这活儿交给你。`compileRequest` 里带着目标 `contractSchema`（JSON Schema）与 `instructions`（撰写规则）。
   照它写出 `{"sources":[...],"models":[...]}` 的 JSON 文本，放进 `proposal.adapterDraft` 再 `propose` 一次。
   供应商身份、模型 id、显示名与计费类别由 Nomi 锁定，**不要在 adapterDraft 里重复它们**。

4. **`confirm`** — 带 `expectedRevision` 与 `idempotencyKey` 请用户确认。
   要花钱的话 Nomi 自己会弹付费确认卡，不用你另外问。

5. **`start`** — 真跑一次最小样例。
   **跑通了模型才会出现在用户的「模型」列表里**——没有 `start` 就没有 `completed`，没有捷径。

6. **`cancel`** — 卡住就取消，把原始错误**原样**报给用户（错误码 + 原文），不要自己编原因。
   常见的两个：`402 insufficient_balance` 是余额不够（Key 已经存下了，充值后重试即可）、
   `401` 是 Key 或 auth 方式不对（回到第 2 步重贴）。

## 先查真实文档

写请求前先抓供应商的**官方** API 文档逐项对账：端点路径、请求体字段名、鉴权放在 header 还是 query、
异步任务是不是要轮询。不要凭记忆填字段——记错一个字段名，第 5 步会以一次真实调用失败告终。

## 做完告诉用户什么

一句话说清三件：接进来的是哪几个模型、它们在 Nomi 的模型列表里叫什么名字、试跑产出了什么。
没接成就直说没接成、卡在第几步、对方返回了什么——不要把「提案已提交」说成「已经接好了」。
