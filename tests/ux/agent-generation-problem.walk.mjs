#!/usr/bin/env node
// 真实场景复现（2026-11-08）：用户原话「很多时候我们参数不合法什么的，没有最后有一个错误码，或者说分析码
// 以及下一步该怎么办这些东西」；截图里 Agent 面板那一行是「起草镜头卡 ⊘2 这一步没做成（generation_input_invalid）」。
//
// 现场：用户在画布面板里让 Agent 起草镜头，Agent 点名的模型 / 比例宿主收不了，被拒。修之前面板对**所有**这类拒收
// 都只说同一句「这个模型不接受这组参数，这一步没有执行。」——点名的模型不存在、真没配默认模型、比例不在这个模式里，
// 用户看到的是同一句话，分不出该去哪儿改。模型那边更糟：点名的 id 不存在时它读到「没有配置可用的图片模型」，
// 于是去劝用户「先去设置里选默认模型」（39 题轨迹里 9 次）。
//
// 这条走查按真人的手法走（一个窗口、只点界面、对话模型从下拉里选），零额度：对话模型是 loopback 夹具，
// 工具调用是**真的**过生产的起草路径、真的被拒。入参取自 39 题评测轨迹里真出现过的写法：
//   A unknown_model    —— candidate 点名 `volcengine` + `doubao-seedream-5-0-pro`（不带日期后缀；P07 原样）；
//   B ratio_not_in_mode —— Z-Image Turbo 要 21:9（它的比例档里没有 21:9）；
//   C no_default_model  —— 镜头没点名模型，用户也没存默认图片模型。
// 每种一回合：夹具模型发一次 draft_shots，读到拒收就收尾（不重试），面板留一行失败行。
//
// 参考超量（reference_over_capacity）**真走不到**：生产的起草路径今天没有一处在起草时按模式上限拒参考
// （注册表清单的 `assetInputSchema.references` 不带 max，`admitPlanCandidate` 那条检查在生产里走不到），
// 超量要到提交那一步才由供应商适配器拒。所以修前 / 修后最后各加一组**夹具图**：关掉 App，把 A 那一回合
// 写进 lane 转录的失败信封里的原因改写成「参考最多 4 个」，冷启动重开，让真面板照转录渲染。文件名和画面
// 都标「夹具 / FIXTURE」——它证的是面板读到这个原因时说什么，不证生产会抛它（那一条由单测证）。
//
// 用法：GENPROBLEM_REPLAY=before node tests/ux/agent-generation-problem.walk.mjs   （最新 main 的构建上）
//       node tests/ux/agent-generation-problem.walk.mjs                            （修后，缺省）
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { clickOrFail, expect, proveProbe } from './_assert.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { FIXTURE_TEXT_MODEL_LABEL } from './agent-runtime-fixture.mjs'
import {
  ASSISTANT_MESSAGE,
  CANVAS_PANEL,
  chooseAssistantModel,
  createRuntimeWalk,
  hasToolResult,
  openCanvas,
  readProject,
  recorded,
  sendCanvas,
  waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'
import { switchAppLocale } from './_permissionTiersPaidSteps.mjs'
import { uiText, uiTextWith } from './full-walk/invariants.mjs'

const MODE = process.env.GENPROBLEM_REPLAY === 'before' ? 'before' : 'after'
const TOOL_GROUP = '[data-v4-block="tool-group"]'
const TOOL_RECEIPT = '[data-v4-block="tool"]'

function recordSecurityAgents(stage) {
  if (process.platform !== 'darwin') return
  const result = spawnSync('pgrep', ['-x', 'SecurityAgent'], { encoding: 'utf8' })
  expect([0, 1], 'SecurityAgent 进程检查成功').toContain(result.status)
  console.log(`[security-agent] ${stage}: ${result.stdout.trim() || 'none'}`)
}

const CASES = [
  {
    key: 'unknown_model',
    // 面板只说「没有这个模型」，不给最接近的 id（那是 Agent 写错了，它自己换）；模型正文说「不在目录里 + 最接近的那个」。
    panelKey: 'agentToolFailure.problemUnknownModel',
    modelReads: /volcengine\/doubao-seedream-5-0-pro is not in the model catalog; the closest one is ([^\s/]+)\/([^\s]+?)\. Name/,
    ask: 'GENPROB_UNKNOWN：用 Seedream 5.0 Pro 起草一镜「窗台橘猫」海报，先不生成。',
    done: 'GENPROB_UNKNOWN_DONE：这一镜没起草成。',
    shot: {
      title: '设定·午后窗台', taskKind: 'text_to_image',
      prompt: '午后斜阳洒进窗户的室内窗台，一只橘白相间的短毛猫慵懒地趴在窗台上，暖黄色调，柔和自然光。',
      candidate: { providerId: 'volcengine', modelId: 'doubao-seedream-5-0-pro' },
    },
  },
  {
    key: 'ratio_not_in_mode',
    panelKey: 'agentToolFailure.problemRatioNotOffered',
    modelReads: /cannot make 21:9/,
    ask: 'GENPROB_RATIO：用 Z-Image Turbo 起草一张 21:9 的「海边灯塔」宽幅图，先不生成。',
    done: 'GENPROB_RATIO_DONE：这一镜没起草成。',
    shot: {
      title: '海边灯塔', taskKind: 'text_to_image', aspectRatio: '21:9',
      prompt: '深夜海岸，一座白墙红纹的灯塔矗立在岩礁上，光柱扫过漆黑海面，冷蓝夜雾。',
      candidate: { providerId: 'apimart', modelId: 'z-image-turbo' },
    },
  },
  {
    key: 'no_default_model',
    panelKey: 'agentToolFailure.problemNoDefaultImage',
    modelReads: /No image model was named and the user has no default image model/,
    ask: 'GENPROB_NODEFAULT：起草一镜「雪夜木屋」，先不生成。',
    done: 'GENPROB_NODEFAULT_DONE：这一镜没起草成。',
    shot: {
      title: '木屋·雪夜暖灯', taskKind: 'text_to_image',
      prompt: '夜晚细雪，一座小木屋窗户透出暖黄色灯光，烟囱飘出白烟，周围是银装素裹的松树林。',
    },
  },
]
const callId = (key) => `genprob-${key}`

const lastUserText = (body) => {
  const users = (body.messages ?? []).filter((message) => message.role === 'user')
  const last = users[users.length - 1]
  if (!last) return ''
  if (typeof last.content === 'string') return last.content
  return (Array.isArray(last.content) ? last.content : []).filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
}
const toolText = (body, id) => (body.messages ?? [])
  .filter((message) => message.role === 'tool' && message.tool_call_id === id)
  .map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
  .join('\n')

// 起 App 的子进程用假主目录：宿主配置、~ 下的一切都不碰用户真实资料。
const fakeHome = makeTempDir('nomi-pi-generation-problem-home-')
recordSecurityAgents('before fixture encryption')
const walk = await createRuntimeWalk(`generation-problem-${MODE}`, { generationProvider: 'apimart', env: { HOME: fakeHome } })
let failure
try {
  recordSecurityAgents('before first app launch')
  let { win } = await walk.start({ first: true })
  const { projectId, projectRoot, name } = await walk.newProject()
  await openCanvas(win)
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL, CANVAS_PANEL)
  const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await consent.isVisible().catch(() => false)) await consent.click()
  const panel = win.locator(CANVAS_PANEL)

  // 夹具模型的策略：按**最后一条用户消息**认是哪一回合；没读到拒收就发一次 draft_shots，读到了就收尾。
  const seen = {}
  const settles = {}
  const settled = Object.fromEntries(CASES.map((item) => [item.key, new Promise((resolve) => { settles[item.key] = resolve })]))
  walk.fixture.respond({
    label: 'scripted model: one draft_shots per turn, end the turn on the refusal',
    match: (body) => CASES.some((item) => lastUserText(body).includes(item.ask)),
    reply: (body) => {
      const item = CASES.find((candidate) => lastUserText(body).includes(candidate.ask))
      const id = callId(item.key)
      if (hasToolResult(body, id)) {
        seen[item.key] = toolText(body, id)
        settles[item.key](true)
        return { type: 'text', text: item.done }
      }
      return { type: 'tool', id, name: 'draft_shots', args: { shots: [item.shot] } }
    },
  })

  for (const [index, item] of CASES.entries()) {
    await sendCanvas(win, item.ask)
    await recorded(settled[item.key], `${item.key}: the scripted model reads the refusal`, 120_000)
    await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: panel.locator(ASSISTANT_MESSAGE).last() })
    await expect(panel.locator(ASSISTANT_MESSAGE).last()).toContainText(item.done.split('：', 1)[0])
    const row = panel.locator(TOOL_GROUP).or(panel.locator(`${TOOL_RECEIPT}[data-status="output-error"]`)).last()
    await proveProbe(row, `${item.key} 的失败行`)
    // 修前（最新 main）三种拒收都是同一句笼统话；修后每种说自己的原因。文案从词典按键取，不在走查里抄一份。
    await expect(row).toContainText(uiText('zh-CN', MODE === 'before' ? 'agentToolFailure.generation_input_invalid' : item.panelKey))
    await clickOrFail(row.locator(':scope > summary'), `${item.key}：展开失败详情`)
    if (MODE === 'after' && item.key === 'no_default_model') {
      await expect(row).toContainText(uiText('zh-CN', 'agentToolFailure.problemPickDefault'))
    }
    await walk.snap(`${MODE}-0${index + 1}-zh-${item.key}`)
    await switchAppLocale(win, 'en')
    await expect(row).toContainText(uiText('en', MODE === 'before' ? 'agentToolFailure.generation_input_invalid' : item.panelKey))
    if (MODE === 'after' && item.key === 'no_default_model') {
      await expect(row).toContainText(uiText('en', 'agentToolFailure.problemPickDefault'))
    }
    await walk.snap(`${MODE}-0${index + 1}-en-${item.key}`)
    await switchAppLocale(win, 'zh-CN')
  }

  const nodes = (await readProject(win, projectId)).payload.generationCanvas.nodes
  const results = readLaneTranscripts(projectRoot).flatMap(laneMessages)
    .filter((message) => message.role === 'toolResult' && String(message.toolCallId).startsWith('genprob-'))
  const rows = await panel.locator(`${TOOL_RECEIPT}, ${TOOL_GROUP}`).evaluateAll((elements) => elements.map((element) => ({
    block: element.getAttribute('data-v4-block'),
    status: element.getAttribute('data-status'),
    summary: element.querySelector(':scope > summary')?.textContent?.trim() ?? element.textContent?.trim().slice(0, 200) ?? '',
  })))
  const facts = {
    mode: MODE,
    toolCalls: results.length,
    rejected: results.filter((message) => message.isError).length,
    modelReads: Object.fromEntries(Object.entries(seen).map(([key, text]) => [key, text.slice(0, 600)])),
    nodes: nodes.length,
    providerImageRequests: walk.fixture.images.length,
    panelRows: rows,
  }
  console.log(`[generation-problem] facts ${JSON.stringify(facts)}`)
  expect(walk.fixture.images, '起草不生成：供应商一次请求都没收到').toHaveLength(0)
  expect(nodes, '三次都被拒，画布上没有任何节点').toHaveLength(0)
  expect(results.map((message) => message.isError), '三次都是真失败、写进了 lane 转录').toEqual([true, true, true])
  if (MODE === 'after') {
    for (const item of CASES) {
      expect(seen[item.key], `${item.key}：模型读到的是真原因`).toMatch(item.modelReads)
      // 2026-11-08 的真实故障：点名的模型不存在时，模型读到「没有配置可用的图片模型」，转头去劝用户配默认模型。
      if (item.key === 'unknown_model') {
        const [, vendorKey, modelKey] = seen[item.key].match(item.modelReads)
        const catalog = await win.evaluate(() => window.nomiDesktop.modelCatalog.listModels({ kind: 'image' }))
        expect(catalog.some(row => row.vendorKey === vendorKey && row.modelKey === modelKey),
          '推荐给 Agent 的型号确实在这个窗口的目录中').toBe(true)
      }
      if (item.key !== 'no_default_model') expect(seen[item.key], `${item.key}：不说没配默认模型`).not.toMatch(/没有配置可用|has no default/)
    }
  }

  {
    // 夹具图（见文件头）：只改写 A 那一回合信封里的原因，读回真实面板；修前忽略新增的 problem。
    await switchAppLocale(win, 'zh-CN')
    await walk.stopApp()
    const target = callId('unknown_model')
    const sessions = readLaneTranscripts(projectRoot).filter((session) => laneMessages(session)
      .some((message) => message.role === 'toolResult' && message.toolCallId === target))
    expect(sessions, `${target} 只写在一份 lane 转录里`).toHaveLength(1)
    let rewritten = 0
    const lines = fs.readFileSync(sessions[0].path, 'utf8').split('\n').map((line) => {
      if (!line.includes(target)) return line
      const transaction = JSON.parse(line)
      const entries = Array.isArray(transaction) ? transaction : [transaction]
      const entry = entries.find(item => item.type === 'message' && item.message?.role === 'toolResult'
        && item.message.toolCallId === target && item.message.details?.failure?.code === 'generation_input_invalid')
      if (!entry) return line
      entry.message.details.failure.problem = { code: 'reference_over_capacity', field: 'references', max: 4, next: 'reduce_references', retryable: true, charged: false }
      rewritten += 1
      return JSON.stringify(transaction)
    })
    expect(rewritten, '转录里恰好一条拒收信封被改写成参考超量').toBe(1)
    fs.writeFileSync(sessions[0].path, lines.join('\n'))

    recordSecurityAgents('before cold app launch')
    ;({ win } = await walk.start())
    const card = win.locator('[data-project-card="true"]').filter({ hasText: name })
    await expect(card).toBeVisible()
    await card.hover()
    await clickOrFail(card.getByRole('button', { name: /继续创作/ }), '冷启动重开这个临时项目')
    await win.waitForFunction((id) => location.href.includes(`projectId=${encodeURIComponent(id)}`), projectId)
    await openCanvas(win)
    const reopened = win.locator(CANVAS_PANEL)
    await expect(reopened, '冷启动后画布面板回到同一段对话').toContainText(CASES[0].done.split('：', 1)[0])
    const fixtureRow = reopened.locator(`${TOOL_RECEIPT}, ${TOOL_GROUP}`).filter({ hasText: MODE === 'before'
      ? uiText('zh-CN', 'agentToolFailure.generation_input_invalid')
      : uiTextWith('zh-CN', 'agentToolFailure.problemReferenceOverCapacity', { max: 4 }) }).first()
    await proveProbe(fixtureRow.first(), '夹具：参考超量的失败行')
    const stamp = (text) => win.evaluate((label) => {
      document.querySelector('[data-walk-fixture-stamp]')?.remove()
      const badge = document.createElement('div')
      badge.setAttribute('data-walk-fixture-stamp', '')
      badge.textContent = label
      Object.assign(badge.style, { position: 'fixed', top: '8px', left: '50%', transform: 'translateX(-50%)', zIndex: '2147483647',
        padding: '4px 10px', background: '#b42318', color: '#fff', font: '600 12px system-ui', borderRadius: '4px' })
      document.body.appendChild(badge)
    }, text)
    await fixtureRow.scrollIntoViewIfNeeded()
    await stamp('夹具 / FIXTURE：转录注入参考上限 4 个，非真实超量')
    await walk.snap(`${MODE}-04-zh-FIXTURE-reference_over_capacity`)
    await switchAppLocale(win, 'en')
    const enFixtureRow = reopened.locator(`${TOOL_RECEIPT}, ${TOOL_GROUP}`).filter({ hasText: MODE === 'before'
      ? uiText('en', 'agentToolFailure.generation_input_invalid')
      : uiTextWith('en', 'agentToolFailure.problemReferenceOverCapacity', { max: 4 }) }).first()
    await expect(enFixtureRow, '夹具：英文界面同一句').toBeVisible()
    await enFixtureRow.scrollIntoViewIfNeeded()
    await stamp('FIXTURE: transcript injected with a 4-reference cap; not a real overflow')
    await walk.snap(`${MODE}-04-en-FIXTURE-reference_over_capacity`)
  }
} catch (error) {
  failure = error
}
await walk.finish(failure)
