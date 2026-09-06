// 真实端到端（零额度）：证明「生成画布面的**专长层 systemPrompt** 真的上了 wire，
// 并进了最终送往模型的 system 消息」，且模型回复渲染回了常驻 Agent 面板。
//
// 背景（2026-08-24 修的存量 bug）：buildStaticAgentSystemPrompt（本面工具手册 + 硬约束）
// 经 runWorkbenchAgent 一路传下来，却在 buildWorkbenchAiPayload 处被静默丢弃——payload.systemPrompt
// 对所有现役 caller 恒为空，专长层从未生效过。后端接收侧一直是齐的，只差渲染层没塞进 payload。
//
// 2026-09-05 重定向：画布内旧助手面板（aria-label「生成区 AI 助手」）已随 Agent Host cutover 退役，
// 专长层现由 ProjectAgentResidentShell（surface=generation）拼进 systemPrompt。走查改走常驻面板的
// 2026-09-06 面板换成 v4 积木：锚点改走 `data-v4-*`（选择器住在 agent-runtime-walk-support.mjs，
// 这里不手抄），不随 i18n 变；锚点全部来自真机 DOM 契约，不是读源码猜的。
//
// 为什么必须走真实 UI 路径：直调 IPC 的 e2e 是自己手搓 payload、**绕过**渲染层拼装的——那条路
// 修没修都会绿，是假绿。这里从「用户在面板打字点发送」出发，真 UI → 真 IPC → 真 transport，
// 只把远端 vendor 换成本地 loopback fixture，于是能直接在 wire 上验。
//
// 判定（硬证据，不看截图也成立）：送往 /v1/chat/completions 的 system 消息里必须出现专长层原文，
// 且排在共享身份层之后（composeAgentSystemPrompt 的层序：identity → panel → skill → memory）。
// 用法：pnpm run build && node tests/ux/agent-panel-system-prompt.walk.mjs [--packaged /abs/Nomi.app/Contents/MacOS/Nomi]
import { expect, expectAbsent, proveProbe } from './_assert.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  ASSISTANT_MESSAGE, CANVAS_PANEL, COMPOSER, COMPOSER_SEND, chooseAssistantModel, createRuntimeWalk,
  openCanvas, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'

const PROMPT = 'SYSPROMPT_WALK：帮我把这个画布搭起来'
const REPLY = 'SYSPROMPT_REPLY：收到。我先读一下画布，再给你一个分镜计划。'
// 共享身份层（electron/harness/context/agentContext.ts 的 NOMI_AGENT_IDENTITY）开头——
// 用来区分「system 整个没送」和「只丢了专长层」。
const IDENTITY_MARKER = '你是 Nomi 的 AI 创作伙伴'
// 专长层第一句（generationCanvasAgentClient.buildStaticAgentSystemPrompt 的 surfaceInstruction）——
// 它出现在 system 里，就证明这一层真的到了模型面前。
const PANEL_LAYER_MARKER = '你现在在「生成画布」工作'
// 专长层该带着它的工具手册和硬约束一起到（证明是整段而不是被截断的一行）。
// 这三句都取自当前 buildStaticAgentSystemPrompt 原文；旧走查里的 run_generation_batch 早已不在专长层里。
const PANEL_LAYER_CLAUSES = ['create_staging_reference', 'create_camera_move', '硬约束：']

function systemTextOf(body) {
  return (Array.isArray(body?.messages) ? body.messages : [])
    .filter((message) => message?.role === 'system')
    .map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
    .join('\n')
}

const walk = await createRuntimeWalk('panel-system-prompt')
let failure
try {
  const { win } = await walk.start({ first: true })
  await walk.newProject()
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)
  await openCanvas(win)
  await walk.snap('canvas-agent-open')

  const turn = walk.fixture.expectText({
    label: 'generation surface first turn carries the panel layer',
    match: (body) => flattenRequestText(body).includes(PROMPT),
    reply: { type: 'text', text: REPLY },
  })
  await sendCanvas(win, PROMPT)
  const wire = await recorded(turn.received, 'generation-surface chat/completions request')

  // ========== 判定 ①：wire 上的 system ==========
  const roles = (wire.body.messages ?? []).map((message) => message.role)
  const systemText = systemTextOf(wire.body)
  expect(systemText, `送往模型的消息里根本没有 system 段——比预期更糟，整层都没送。roles=${JSON.stringify(roles)}`).not.toBe('')
  expect(systemText, '共享身份层（NOMI_AGENT_IDENTITY）不在 system 里——后端拼装层出了问题，不只是专长层').toContain(IDENTITY_MARKER)
  expect(systemText, `system 里找不到面板专长层原文「${PANEL_LAYER_MARKER}」——systemPrompt 仍在半路被丢弃。实际 system 开头：${systemText.slice(0, 240)}`)
    .toContain(PANEL_LAYER_MARKER)
  for (const clause of PANEL_LAYER_CLAUSES) {
    expect(systemText, `system 里缺少专长层的「${clause}」——像是只到了一部分，检查是否被截断`).toContain(clause)
  }
  expect(systemText.indexOf(IDENTITY_MARKER), '专长层应排在共享身份层之后（identity → panel）').toBeLessThan(systemText.indexOf(PANEL_LAYER_MARKER))
  console.log(`  ✅ wire：system 长度 ${systemText.length}，身份层 + 生成画布专长层 + ${PANEL_LAYER_CLAUSES.length} 条硬约束/工具句均在`)

  // ========== 判定 ②：模型回复渲染回常驻面板（用户看得见这一轮跑通了） ==========
  const assistantItem = win.locator(`${CANVAS_PANEL} ${ASSISTANT_MESSAGE}`).last()
  await expect(assistantItem, '常驻面板没把模型回复渲染出来').toContainText(REPLY, { timeout: 30_000 })
  // v4 助手文本三态写在 data-status 上：complete = 这一轮说完了（streaming / interrupted 是另两态）。
  await expect(assistantItem, '回复条目应结束在 complete 状态').toHaveAttribute('data-status', 'complete')
  // 「不再是停止态」是不存在断言：先证明发送键本身在这一屏找得到，再断 composer 的 running 态持续不存在。
  // v4 里发送与停止是同一颗钮，运行中由 composer 的 data-mode="running" 标记。
  const sendProof = await proveProbe(win.locator(`${CANVAS_PANEL} ${COMPOSER_SEND}`), '常驻面板的发送键在生成区可见')
  await expectAbsent(win.locator(`${CANVAS_PANEL} ${COMPOSER}[data-mode="running"]`), {
    provenBy: sendProof, message: '回合结束后 composer 不应仍是运行（停止）态',
  })
  await walk.snap('canvas-agent-reply')
  console.log('\n✅ 生成画布专长层 systemPrompt 已真实抵达模型的 system 消息，且常驻 Agent 一轮对话在面板里跑通。')
} catch (error) {
  failure = error
} finally {
  await walk.finish(failure)
}
