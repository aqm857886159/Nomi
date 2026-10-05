/**
 * 提问工具的**逐字段对拍**：模型看到的那份 schema ↔ 渲染层画那张卡时读的那些字段。
 *
 * ── 它在守什么 ──
 *
 * 用户 2026-09-21 点名的那个坑：同一个工具的契约有好几份（schema / 描述 / 提示词里的用法 /
 * MCP 目录 / 校验器 / 渲染层类型），每份不一样，于是 Agent 很难触发它。提问工具是全新的
 * 模型可见工具，最容易再长出这个坑——而长出来的那一天，**编译器、单测、门岗谁都不会红**：
 * 模型多填一个字段，解析器安静地忽略它；渲染层多读一个字段，模型从来没被告知要填它。
 * 两种都是「安静地少做一件事」，用户那头看到的是「它问得不对」或者「它不问」。
 *
 * ── 判据 ──
 *
 * 不比较两份手写的清单（那只是把同一份漂移抄成两份）。这里从**模型真正收到的那份 JSON
 * Schema**（`MODEL_FACING_TOOL_SPECS` → `toPublishedJsonSchema`，与 pi 拿去跑 ajv 的是同一份）
 * 取出字段名，逐个要求渲染层这边给出「它怎么落到卡上」的具体断言。schema 加一个字段，
 * 下面 `FIELDS` 的键就对不上 —— 当场红，而且红在「你还没说这个字段怎么画」这句话上。
 *
 * 反向验红（2026-09-21 亲跑，日志 `scratchpad/C-redproof-drift.txt`）：
 *   ① 给 `askUserInputSchema` 加一个 `urgency` 字段（渲染层没人读） → ① 红
 *      「expected ['note','options','question','urgency'] to deeply equal ['note','options','question']」；
 *   ② 把 `questionOptions` 里读 `description` 那一行删掉 → ④ 红
 *      「选项的 "description" 字段模型填得出来，但渲染层没读」；
 *   ③ 把说明书里那句 `More than ${max}` 写死成 `More than 6`（判越界的仍是 4） → ⑥ 红
 *      「expected 'Two to four options, …' to contain '4'」。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { MODEL_FACING_TOOL_SPECS } from '../../../../electron/shared/agentCapabilities/modelFacingToolRegistry'
import { toPublishedJsonSchema } from '../../../../electron/shared/agentCapabilities/modelVisibleJsonSchema'
import {
  ASK_USER_OPTION_RANGE, ASK_USER_QUESTION_RANGE, askUserInputSchema, askUserPendingArgsSchema, askUserReplySchema,
} from '../../../../electron/shared/agentCapabilities/askUser'
import {
  parseQuestionSheet, questionCountIssue, questionOptionCountIssue, questionOptions,
  V4_QUESTION_COUNT_RANGE, V4_QUESTION_OPTION_RANGE,
} from './agentPanelV4Question'
import { askCardAnswer, EMPTY_ASK_DRAFT } from './agentPanelV4AskModel'

const spec = MODEL_FACING_TOOL_SPECS.find(candidate => candidate.name === 'ask_user')

function properties(schema: unknown): Record<string, unknown> {
  const record = schema as { properties?: Record<string, unknown> }
  return record.properties ?? {}
}

/**
 * 模型那份 schema 的每一个字段，配一条「它怎么落到卡上」。
 * **键必须与 schema 逐字相等**（第 1 条断言），所以这张表不会悄悄落后。
 */
const FIELDS: Record<string, () => void> = {
  questions: () => {
    const sheet = parseQuestionSheet({ questions: [{ question: '哪一个要删掉？' }, { question: '多长合适？' }] })
    expect(sheet?.questions.map((one) => one.question)).toEqual(['哪一个要删掉？', '多长合适？'])
  },
}

/** 一题里的每一个字段，配一条「它怎么落到卡上」。 */
const QUESTION_FIELDS: Record<string, () => void> = {
  question: () => {
    expect(parseQuestionSheet({ questions: [{ question: '哪一个要删掉？' }] })?.questions[0]?.question)
      .toBe('哪一个要删掉？')
  },
  options: () => {
    const sheet = parseQuestionSheet({ questions: [{ question: 'q', options: [{ label: 'A' }, { label: 'B' }] }] })
    expect(sheet?.questions[0]?.options.map((option) => option.label)).toEqual(['A', 'B'])
  },
  multiSelect: () => {
    expect(parseQuestionSheet({ questions: [{ question: 'q', multiSelect: true }] })?.questions[0]?.multiSelect).toBe(true)
  },
  note: () => {
    expect(parseQuestionSheet({ questions: [{ question: 'q', note: '因为这两条剪法完全不同' }] })?.questions[0]?.note)
      .toBe('因为这两条剪法完全不同')
  },
}

/** 选项对象的每一个字段，同上。 */
const OPTION_FIELDS: Record<string, () => void> = {
  id: () => {
    expect(questionOptions({ options: [{ id: 'keep-wide', label: 'A' }] })[0]?.id).toBe('keep-wide')
  },
  label: () => {
    expect(questionOptions({ options: [{ label: '镜 2 · 推门' }] })[0]?.label).toBe('镜 2 · 推门')
  },
  description: () => {
    expect(questionOptions({ options: [{ label: 'A', description: '画布中间那张' }] })[0]?.description)
      .toBe('画布中间那张')
  },
  recommended: () => {
    expect(questionOptions({ options: [{ label: 'A', recommended: true }] })[0]?.recommended).toBe(true)
  },
}

describe('ask_user：一份契约，两端对拍', () => {
  it('⓪ 渲染层这一半**还在派生**（不是今天碰巧一致）', () => {
    // 为什么这一条单独存在：2026-09-21 本分支上真的发生过一次——反向验红时一条
    // `git checkout -- agentPanelV4Question.ts` 把刚写好的派生整段冲回手写版，
    // 而 typecheck 全绿、下面每一条也全绿，因为那一刻两份形状恰好还一样。
    // 「还在派生吗」和「今天是否碰巧一致」是两个问题，只有读源码答得了第一个。
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'agentPanelV4Question.ts')
    const source = fs.readFileSync(file, 'utf8')
    expect(source, '渲染层那份类型必须从共享 owner 派生，不许手写一份平行的')
      .toContain("from '../../../../electron/shared/agentCapabilities/askUser'")
    for (const handWritten of ['V4QuestionOption = Readonly<{', 'V4QuestionAskReason = Readonly<{ code:', 'V4QuestionAnswer = Readonly<{']) {
      expect(source, `「${handWritten}」是手写形状的长相——它一出现就说明派生被冲掉了`).not.toContain(handWritten)
    }
  })

  it('① 模型看到的字段，渲染层每一个都说得出怎么画', () => {
    expect(spec, 'ask_user 不在模型可见工具表里；它没被注册，模型就永远问不出这一句').toBeDefined()
    expect(Object.keys(properties(toPublishedJsonSchema(spec!.schema))).sort()).toEqual(Object.keys(FIELDS).sort())
  })

  it('② 一题里的每个字段，两端也逐个对上', () => {
    const questionSchema = (properties(toPublishedJsonSchema(spec!.schema)).questions as { items?: unknown }).items
    expect(Object.keys(properties(questionSchema)).sort()).toEqual(Object.keys(QUESTION_FIELDS).sort())
    for (const [field, assertCarried] of Object.entries({ ...FIELDS, ...QUESTION_FIELDS })) {
      try { assertCarried() } catch (cause) {
        throw new Error(`ask_user 的 "${field}" 字段模型填得出来，但渲染层没把它画到卡上：${String(cause)}`, { cause })
      }
    }
  })

  it('③ 选项对象的字段，两端也逐个对上', () => {
    const questionSchema = (properties(toPublishedJsonSchema(spec!.schema)).questions as { items?: unknown }).items
    const optionSchema = (properties(questionSchema).options as { items?: unknown }).items
    expect(Object.keys(properties(optionSchema)).sort()).toEqual(Object.keys(OPTION_FIELDS).sort())
    for (const [field, assertCarried] of Object.entries(OPTION_FIELDS)) {
      try { assertCarried() } catch (cause) {
        throw new Error(`选项的 "${field}" 字段模型填得出来，但渲染层没读：${String(cause)}`, { cause })
      }
    }
  })

  it('④ 说明书里的每个示例，卡都画得出来（示例本身已由装配期喂回 schema）', () => {
    expect(spec!.examples.length).toBeGreaterThan(0)
    for (const example of spec!.examples) {
      const sheet = parseQuestionSheet(example.arguments)
      expect(sheet, `示例「${example.when}」解析不出一张卡`).toBeDefined()
      const declared = (example.arguments as { questions?: unknown[] }).questions ?? []
      expect(sheet!.questions.length, `示例「${example.when}」的题在解析时掉了`).toBe(declared.length)
      for (const one of sheet!.questions) expect(one.question, `示例「${example.when}」有一题没有问句`).not.toBe('')
    }
  })

  it('⑤ 印给模型的数量，和判越界用的是同几个数', () => {
    // 这里**不能**用 `toBe`：vitest 下渲染层那条 import 路径与本文件这条会各自实例化一次
    // `electron/shared/**`（两个 transform 上下文），同一个 `Object.freeze` 出来的常量因此
    // 不是同一个对象。身份比不了，但要守的那件事——「两边的数不许分家」——`toStrictEqual`
    // 正好守得住；「还在不在派生」由 ⓪ 那条读源码来守。
    expect(V4_QUESTION_OPTION_RANGE).toStrictEqual(ASK_USER_OPTION_RANGE)
    expect(V4_QUESTION_COUNT_RANGE).toStrictEqual(ASK_USER_QUESTION_RANGE)
    const guidelines = [spec!.description, ...(spec!.promptGuidelines ?? [])].join(' ')
    expect(guidelines).toContain(String(ASK_USER_OPTION_RANGE.max))
    expect(guidelines).toContain(String(ASK_USER_QUESTION_RANGE.max))
    expect(questionOptionCountIssue({ question: 'q', options: questionOptions({ options: [{ label: 'A' }] }) })).toBe('too-few')
    expect(questionOptionCountIssue({
      question: 'q',
      options: questionOptions({ options: Array.from({ length: ASK_USER_OPTION_RANGE.max + 1 }, (_, i) => ({ label: `o${i}` })) }),
    })).toBe('too-many')
    const tooMany = parseQuestionSheet({
      questions: Array.from({ length: ASK_USER_QUESTION_RANGE.max + 1 }, (_, i) => ({ question: `q${i}` })),
    })!
    expect(questionCountIssue(tooMany), '多给一题不丢数据，但要有判词').toBe('too-many')
    expect(tooMany.questions.length, '越界不截断——截断会让它变成一条静默丢失的数据')
      .toBe(ASK_USER_QUESTION_RANGE.max + 1)
  })

  it('⑥ 两个宿主生产者的参数走同一份 schema，且模型填不出它们', () => {
    expect(askUserPendingArgsSchema.safeParse({ missingParam: 'duration' }).success).toBe(true)
    expect(askUserPendingArgsSchema.safeParse({
      questions: [{ question: '这一镜要多长？', options: [{ label: '5 秒' }, { label: '10 秒' }] }],
      askReason: { code: 'retry_exhausted', attempts: 3 },
    }).success).toBe(true)
    // 模型那一份收不下它们：能自己声称「这是第 3 次了」就是给它一个伪造理由的字段。
    expect(askUserInputSchema.safeParse({ questions: [{ question: 'q' }], missingParam: 'duration' }).success).toBe(false)
    expect(askUserInputSchema.safeParse({
      questions: [{ question: 'q' }], askReason: { code: 'retry_exhausted', attempts: 3 },
    }).success).toBe(false)
    // 一张既没有题也没有缺失参数名的卡不成立（那是一张空白卡，用户看不懂要答什么）。
    expect(askUserPendingArgsSchema.safeParse({ questions: [] }).success).toBe(false)
    expect(parseQuestionSheet({ questions: [{ options: [{ label: 'A' }] }] })).toBeUndefined()
  })

  it('⑦ 熔断那一句挂在整张卡上，只接受码 + 次数，不接受成句的字符串', () => {
    expect(parseQuestionSheet({ questions: [{ question: 'q' }], askReason: { code: 'retry_exhausted', attempts: 3 } })?.reason)
      .toEqual({ code: 'retry_exhausted', attempts: 3 })
    // 成句的字符串会绕过 i18n：英文用户读到中文，或者反过来。
    expect(parseQuestionSheet({ questions: [{ question: 'q' }], askReason: '试了三次都不对' })?.reason).toBeUndefined()
  })

  it('⑧ 缺参数那一支仍然画得出一张卡（它没有第二种长相）', () => {
    const sheet = parseQuestionSheet({ missingParam: 'duration' })
    expect(sheet?.questions).toHaveLength(1)
    expect(sheet?.questions[0]?.missingParamName).toBe('duration')
    expect(sheet?.questions[0]?.question, '问句由调用方按参数名补一句人话，解析层不编').toBe('')
  })

  it('⑨ 卡吐出来的答复，owner 的 schema 逐字段收得下——含「这题被跳过」的显式标记', () => {
    // 反向验红（2026-09-22 亲跑）：把 owner 的 `skippedQuestionIndexes` 那一行删掉 → 这里红在
    // 「Unrecognized key: "skippedQuestionIndexes"」（schema 是 strict 的）；把卡那侧的 skipped 收集删掉 →
    // 红在「跳过必须点名」那一句。两端任何一边先走一步，另一边当场知道。
    const questions = [
      { question: '给谁看？', options: [{ id: 'a', label: '同事' }] },
      { question: '多长？', options: [] },
    ]
    const reply = askCardAnswer(questions, [{ picked: [0], custom: '' }, EMPTY_ASK_DRAFT])
    const parsed = askUserReplySchema.safeParse(JSON.parse(JSON.stringify(reply)))
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true)
    expect(reply.skippedQuestionIndexes, '跳过必须点名，不能靠 questionIndex 缺席去猜').toEqual([1])
    // 一道题要么答了、要么点名跳过，不许两头都不在。
    const accounted = new Set([...reply.answers.map((answer) => answer.questionIndex), ...(reply.skippedQuestionIndexes ?? [])])
    expect([...accounted].sort()).toEqual(questions.map((_, index) => index))
  })
})
