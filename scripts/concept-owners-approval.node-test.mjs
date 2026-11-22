// 结论扫描只防误导；签发能力隔离由生产装配的运行时测试验证。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { APPROVAL_DECISION_HOMES, findApprovalDecisionBypass } from './concept-owners-approval.mjs'
import { workingTreeSource } from './concept-owners-scan.mjs'

const probe = 'electron/capabilityCore/approvalBypassProbe.ts'
const scan = (snippet, file = probe) => findApprovalDecisionBypass({ files: [file], read: () => snippet })
const kinds = (snippet, file) => scan(snippet, file).map((hit) => hit.kind)

const verdictBypasses = [
  // ① 改名常量
  'export function f(challengeToken: string, receiptId: string) { const ok = true; return { confirmed: ok, receiptId } }',
  // ② 内联
  'export function f(receiptToken: string) { return { confirmed: true, receiptToken } }',
  // ③ 别名展开
  'export function f(challengeId: string) { const yes = { confirmed: true }; return { ...yes, challengeId } }',
  // ④ 属性赋值
  'export function f(verdict: { confirmed: boolean; challengeId?: string }) { verdict.confirmed = true; return verdict }',
  "export function f(verdict: { confirmed: boolean; challengeId?: string }) { verdict['confirmed'] = !0; return verdict }",
  // ⑤ Object.assign 与展开覆盖
  'export function f(verdict: { confirmed: boolean; challengeId?: string }) { return Object.assign(verdict, { confirmed: true }) }',
  'export function f(verdict: { confirmed: boolean; challengeId?: string }) { return { ...verdict, confirmed: true } }',
  // 改名的常量本身就叫 confirmed（简写属性）
  'export function f(challengeId: string) { const confirmed = true; return { confirmed, challengeId } }',
]

for (const code of verdictBypasses) {
  test(`结论绕法要报：${code}`, () => {
    assert.ok(kinds(code).includes('verdict'), JSON.stringify(scan(code)))
  })
}

for (const [label, code, file] of [
  ['客户端答复解析', "export function f(res: any, challengeId: string) { return { confirmed: res?.action === 'accept' && res?.content?.confirm === true, challengeId } }"],
  ['回环转话', 'export function f(typed: any) { return { confirmed: typed.confirmed === true, receiptId: typed.receiptId, receiptToken: typed.receiptToken } }'],
  ['渲染层卡片', "export function confirmGenerationGateForAgent(ok: unknown, challengeId: string) { return { confirmed: Boolean(ok), challengeId } }", 'src/workbench/capability/probeCard.ts'],
  ['拆解批量令牌（不在付费门链上）', "export async function f(askUser: boolean) { const reply = !askUser ? { confirmed: true } : await ask('spend.confirm'); return reply }", 'electron/spendConfirmGrantProbe.ts'],
  ['关窗确认（不在付费门链上）', "send('nomi:window:close-response', { requestId, confirmed: true })", 'electron/preloadProbe.ts'],
  ['类型里点名签发口', "export type Mint = ApprovalReceiptAuthority['mintReceipt']; export type Pick2 = Pick<ApprovalReceiptAuthority, 'issueDecisionReceipt'>"],
  ['同名的自家方法定义不是签发口', 'export const fake = { mintReceipt: () => null }'],
  ['测试文件不在生产范围', 'receipts.mintReceipt(t, a); const v = { confirmed: true, receiptId }', 'electron/capabilityCore/whatever.test.ts'],
]) {
  test(`不得误报：${label}`, () => {
    assert.deepEqual(scan(code, file), [])
  })
}

test('主人与收据权威本身不报；把主人的真文件换个路径就报（扫描器确实看得见真形状）', () => {
  for (const home of APPROVAL_DECISION_HOMES) {
    const text = fs.readFileSync(new URL(`../${home}`, import.meta.url), 'utf8')
    assert.deepEqual(scan(text, home), [], home)
  }
  const owner = fs.readFileSync(new URL('../electron/capabilityCore/runOwnedGenerationGateAuthority.ts', import.meta.url), 'utf8')
  const moved = scan(owner)
  assert.ok(moved.some((hit) => hit.kind === 'verdict'), '主人搬到别处，「算批准」要报')
})

test('真源码（src、electron 生产代码）零命中', () => {
  const source = workingTreeSource(fileURLToPath(new URL('..', import.meta.url)))
  assert.deepEqual(findApprovalDecisionBypass({ files: source.listFiles(), read: source.read }), [])
})
