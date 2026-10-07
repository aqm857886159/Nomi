import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { proveProbe, expectAbsent } from './_assert.mjs'
// Host integration, not live-provider/Electron acceptance. Only environment ports are replaced.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { chromium } from 'playwright'
import { createServer } from 'vite'
let server, browser, page, cacheDir
const ports = {
  // 拖文件进卡体那张框（`useNodeAssetDrop`）在当前项目里上传。
  projectCanvasReadSurface: `export const withProjectAction = fn => fn({ binding: { projectId: 'project' }, assertCurrent() {} }); export const isProjectExecutionContextCurrent = () => true; export const isProjectImportCancellation = () => false;`,
  productionRunApi: `export const productionRunApi = { reviseSpend: async input => { const f = window.spendOwnership; f.calls.push(input); const reply = await (f.revise ? f.revise(input) : {ok: !f.failRevision}); return reply?.ok && reply.quoteId && !reply.pending ? { ...reply, pending: structuredClone(f.pending) } : reply }, discardSpend: async (...args) => {window.spendOwnership.calls.push({discard: args}); return window.spendOwnership.discardReply ? window.spendOwnership.discardReply(...args) : {ok:!window.spendOwnership.failDiscard}}, confirmSpend: async (...args) => { window.spendOwnership.calls.push({confirm: args}); return window.spendOwnership.confirmReply ? window.spendOwnership.confirmReply(...args) : {ok:!window.spendOwnership.failConfirm} }, confirmSpendRemaining: async (...args) => { window.spendOwnership.calls.push({remaining: args}); return window.spendOwnership.remaining ? window.spendOwnership.remaining(...args) : {ok:true} } };`,
  toast: `export const toast = (message, kind) => { window.spendOwnership.toasts.push({ message, kind }) }; export const useToastStore = { getState: () => ({ push: (input) => { window.spendOwnership.toasts.push({ message: input.message, kind: input.type, ttl: input.ttl }); return 'toast' } }) };`,
  modelCatalogCache: `export const preloadModelOptions = async () => []; export const MODEL_REFRESH_EVENT = 'fixture-refresh';`,
  generationCanvasStore: `export const useGenerationCanvasStore = Object.assign(selector => selector({ nodes: window.spendOwnership.nodes, edges: window.spendOwnership.edges, updateNode() { throw new Error('canvas write forbidden') } }), { getState: () => ({ nodes: window.spendOwnership.nodes, edges: window.spendOwnership.edges }) });`,
  assetUploadApi: `export const importWorkbenchLocalAssetFile = (...args) => window.spendOwnership.upload(...args);`,
}
beforeAll(async () => {
  cacheDir = mkdtempSync(path.join(tmpdir(), 'nomi-t7-vite-panel-'))
  server = await createServer({ configFile: false, cacheDir, plugins: [{ name: 'controlled-panel-environment', enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !/\/(useAgentPanelSpendConfirm|useNodeAssetDrop|nodeWriteAccess)\.ts$/.test(importer)) return
      const name = source.split('/').at(-1)
      if (name in ports) return '\0panel-environment:' + name
    },
    load(id) { if (id.startsWith('\0panel-environment:')) return ports[id.split(':')[1]] },
  }], server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } })
  await server.listen()
  browser = await chromium.launch({ headless: true })
})
beforeEach(async () => {
  await page?.close()
  page = await browser.newPage()
  page.on('pageerror', error => console.error(error.message))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/ux/fixtures/spend-panel-write-ownership-harness.html`)
  await page.locator('#upload').waitFor({ state: 'visible' })
})
afterAll(async () => { await browser?.close(); await server?.close(); if (cacheDir) rmSync(cacheDir, { recursive: true, force: true }) })
async function upload() {
  await page.locator('#upload').click()
  await page.waitForFunction(() => window.spendOwnership.snapshot().uploads === 1)
}
async function settle() {
  await page.evaluate(() => window.spendOwnership.finish())
  await page.waitForFunction(() => window.spendOwnership.snapshot().completed === 1)
}
it('positive control: actual panel writer retains an upload when its captured owner remains current', async () => {
  await upload(); await settle()
  await page.waitForFunction(() => window.spendOwnership.snapshot().refs?.length === 1)
  expect((await page.evaluate(() => window.spendOwnership.snapshot())).refs).toEqual(['nomi-local://asset/reference.png'])
})
// 付费卡逐镜（2026-09-30）：卡上没有「逐镜 / 全部」范围了，换的只剩页、报价、生成、候选版本。
it.each(['page', 'quote', 'operation', 'revision'])('retires the upload writer after changing %s, including same-node changes', async change => {
  await upload()
  await page.evaluate(value => window.spendOwnership.change(value), change)
  await page.waitForFunction(value => {
    const s = window.spendOwnership.snapshot()
    return value === 'page' ? s.page === 1 : value === 'quote' ? s.quote === 'quote-next' : value === 'operation' ? s.operation === 'operation-next' : s.candidateRevision === 2
  }, change)
  await settle()
  const result = await page.evaluate(() => window.spendOwnership.snapshot())
  expect(result.refs).toEqual([])
  expect(result.staleNode).toBeUndefined()
  expect(result.staleWritable).toBe(false)
})
it('switching A to B and back never revives the original writer', async () => {
  await upload()
  await page.evaluate(() => window.spendOwnership.change('page'))
  await page.waitForFunction(() => window.spendOwnership.snapshot().page === 1)
  await page.evaluate(() => window.spendOwnership.back())
  await page.waitForFunction(() => window.spendOwnership.snapshot().page === 0)
  await settle()
  expect((await page.evaluate(() => window.spendOwnership.snapshot())).refs).toEqual([])
})
it('unmount revokes both read and write authority before the upload completes', async () => {
  await upload()
  await page.evaluate(() => window.spendOwnership.unmount())
  await settle()
  await page.evaluate(() => window.spendOwnership.staleWrite())
  const result = await page.evaluate(() => window.spendOwnership.snapshot())
  expect(result.staleNode).toBeUndefined()
  expect(result.staleWritable).toBe(false)
  expect(result.feedback).toEqual([])
})

it('unplaced candidate keeps the existing composer writer usable without touching canvas', async () => {
  await page.evaluate(() => window.spendOwnership.detach())
  await page.waitForFunction(() => window.spendOwnership.pending.shots.every(s => !s.nodeId))
  await page.evaluate(() => window.spendOwnership.edit())
  await page.waitForFunction(() => window.spendOwnership.snapshot().prompt === 'edited', undefined, { timeout: 1500 })
  expect(await page.evaluate(() => window.spendOwnership.nodes)).toEqual([])
})
it('one visible shot retains its exact shot address on revise', async () => {
  await page.evaluate(() => window.spendOwnership.narrow())
  await page.waitForFunction(() => window.spendOwnership.snapshot().prompt === 'b')
  await page.evaluate(() => window.spendOwnership.edit())
  await page.waitForFunction(() => window.spendOwnership.snapshot().prompt === 'edited')
  await page.evaluate(() => window.spendOwnership.confirm())
  await page.waitForFunction(() => window.spendOwnership.calls.length > 0)
  expect(await page.evaluate(() => window.spendOwnership.calls[0])).toMatchObject({shotId: 'b', patch: {prompt: 'edited'}})
})

it('closing retains isolated edits and only dismisses without revising the canonical candidate', async () => {
  await page.evaluate(() => window.spendOwnership.edit())
  await page.waitForFunction(() => window.spendOwnership.snapshot().prompt === 'edited')
  await page.evaluate(() => window.spendOwnership.discard())
  await page.waitForFunction(() => window.spendOwnership.calls.some(call => call.discard))
  const calls = await page.evaluate(() => window.spendOwnership.calls)
  expect(calls).toHaveLength(1)
  expect(calls.at(-1)).toHaveProperty('discard')
})
it('failed dismissal keeps the local edit without revising the candidate', async () => {
  await page.evaluate(() => {window.spendOwnership.failDiscard = true;window.spendOwnership.edit()})
  await page.waitForFunction(() => window.spendOwnership.snapshot().prompt === 'edited')
  await page.evaluate(() => window.spendOwnership.discard())
  await page.waitForFunction(() => window.spendOwnership.calls.length > 0)
  expect(await page.evaluate(() => window.spendOwnership.calls.some(call => call.patch))).toBe(false)
  expect(await page.evaluate(() => window.spendOwnership.snapshot().prompt)).toBe('edited')
})

// 账本锚的是**这一次生成**：渲染层重挂它还在，报价刷新它也还在（报价指纹不是地址）；
// 换一次生成才是换一本，一个字都带不过去。
it('retains this operation draft through renderer remount and a newer quote, never across operations', async () => {
  await page.evaluate(() => window.spendOwnership.edit())
  await page.waitForFunction(() => window.spendOwnership.snapshot().prompt === 'edited')
  await page.reload()
  await page.waitForFunction(() => window.spendOwnership?.snapshot().prompt === 'edited')
  await page.evaluate(() => window.spendOwnership.change('quote'))
  await page.waitForFunction(() => window.spendOwnership.snapshot().quote === 'quote-next')
  expect(await page.evaluate(() => window.spendOwnership.snapshot().prompt)).toBe('edited')
  await page.evaluate(() => window.spendOwnership.change('operation'))
  await page.waitForFunction(() => window.spendOwnership.snapshot().operation === 'operation-next')
  expect(await page.evaluate(() => window.spendOwnership.snapshot().prompt)).toBe('a')
  expect(await page.evaluate(() => window.spendOwnership.calls)).toEqual([])
})

it('actual shared panel composer accepts pointer and keyboard input into only the unapproved draft', async () => {
  await page.goto(page.url() + '?composer=1')
  const input = page.locator('[data-composer-host="panel"] [contenteditable="true"]')
  await input.waitFor({state:'visible'})
  const before = await page.evaluate(() => structuredClone({nodes:window.spendOwnership.nodes,shots:window.spendOwnership.pending.shots}))
  expect(await input.evaluate(element => { const r=element.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return r.width>0 && r.height>0 && getComputedStyle(element).visibility==='visible' && element.contains(hit) })).toBe(true)
  await input.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText('Actual panel keyboard draft')
  await page.waitForFunction(() => window.spendOwnership.snapshot().prompt==='Actual panel keyboard draft')
  expect(await page.evaluate(() => ({nodes:window.spendOwnership.nodes,shots:window.spendOwnership.pending.shots}))).toEqual(before)
  expect(await page.evaluate(() => window.spendOwnership.calls)).toEqual([])
})

it('actual shared composer keeps a visible read-only reason and rejects text edits', async () => {
  const fixtureUrl = page.url()
  await page.goto(fixtureUrl + '?composer=1')
  const editable = page.locator('[data-composer-host="panel"] [contenteditable="true"]')
  const editableProof = await proveProbe(editable, 'same shared composer accepts text before readOnly transition')
  await page.goto(fixtureUrl + '?composer=1&readonly=1')
  const composer = page.locator('[data-composer-host="panel"]')
  await composer.waitFor({state:'visible'})
  await page.waitForFunction(() => document.querySelector('[data-composer-host="panel"] [contenteditable="false"]'))
  expect(await composer.locator('[role="status"]').textContent()).toMatch(/只读|read.only/i)
  await expectAbsent(editable, { provenBy: editableProof, message: 'readOnly host removes editable authority while retaining visible controls and reason' })
  expect(await page.evaluate(() => window.spendOwnership.calls)).toEqual([])
})


// 2026-09-21 起**没有第二本账本**（`nomi:dismissed-spend-draft:` 那套「藏起来再找回」整族删了）。
// 2026-09-22 裁决 D 之后 × 收回的只是这一次出价，所以「找回」这件事更没有存在的理由：
// 这一次生成的那一本账本从头到尾就是同一本，× 不动它，也不复制它。
it('a discarded request leaves exactly one ledger behind, never a recovery copy', async () => {
  await page.evaluate(() => window.spendOwnership.edit())
  await page.waitForFunction(() => window.spendOwnership.snapshot().prompt === 'edited')
  await page.evaluate(() => window.spendOwnership.discard())
  await page.waitForFunction(() => window.spendOwnership.calls.some(call => call.discard))
  await page.evaluate(() => window.spendOwnership.change('quote'))
  await page.waitForFunction(() => window.spendOwnership.snapshot().quote === 'quote-next')
  expect(await page.evaluate(() => window.spendOwnership.snapshot().prompt)).toBe('edited')
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('nomi:dismissed-spend-draft:')))).toEqual([])
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('nomi:spend-draft:')))).toHaveLength(1)
  expect(await page.evaluate(() => window.spendOwnership.calls.some(call => call.patch))).toBe(false)
})


it('confirming A keeps unsubmitted B edits across paging and a cold renderer reload', async () => {
  await page.evaluate(() => window.spendOwnership.change('page'))
  await page.waitForFunction(() => window.spendOwnership.snapshot().page === 1)
  await page.evaluate(() => window.spendOwnership.edit())
  await page.waitForFunction(() => window.spendOwnership.snapshot().prompt === 'edited')
  await page.evaluate(() => window.spendOwnership.back())
  await page.waitForFunction(() => window.spendOwnership.snapshot().page === 0)
  await page.evaluate(() => window.spendOwnership.confirm())
  await page.waitForFunction(() => !window.spendOwnership.snapshot().busy)
  expect(await page.evaluate(() => window.spendOwnership.calls.filter(call => call.confirm))).toEqual([{confirm: ['project', 'operation', 'quote', 'a']}])
  await page.evaluate(() => window.spendOwnership.change('page'))
  await page.waitForFunction(() => window.spendOwnership.snapshot().page === 1)
  expect((await page.evaluate(() => window.spendOwnership.snapshot())).prompt).toBe('edited')
  await page.reload()
  await page.locator('#upload').waitFor()
  await page.evaluate(() => window.spendOwnership.change('page'))
  await page.waitForFunction(() => window.spendOwnership.snapshot().page === 1)
  expect((await page.evaluate(() => window.spendOwnership.snapshot())).prompt).toBe('edited')
})


// 逐镜（2026-09-30）：点「生成这张」先把这一页摆着的那一份落到这一镜；宿主拒了这一次改动，就不确认，
// 他在这一镜上没提交的那句话留在卡上——报价刷新、翻页、× 之后同一次生成重新出价都还在。
it('a refused revision on one shot keeps its unsubmitted edit across quote refresh, paging and a re-bid', async () => {
  await page.evaluate(() => {
    window.spendOwnership.revise = input => input.shotId === 'b' ? {ok:false, message:'fixture refusal'} : {ok:true, quoteId:window.spendOwnership.pending.quoteId}
    window.spendOwnership.change('page')
  })
  await page.waitForFunction(() => window.spendOwnership.snapshot().page === 1)
  await page.evaluate(() => window.spendOwnership.edit())
  await page.waitForFunction(() => window.spendOwnership.snapshot().prompt === 'edited')
  await page.evaluate(() => window.spendOwnership.confirm())
  await page.waitForFunction(() => window.spendOwnership.calls.length === 1 && !window.spendOwnership.snapshot().busy)
  expect(await page.evaluate(() => window.spendOwnership.calls[0])).toMatchObject({shotId: 'b', patch: {prompt: 'edited'}})
  expect(await page.evaluate(() => window.spendOwnership.calls.some(call => call.confirm))).toBe(false)
  await page.evaluate(() => window.spendOwnership.change('quote'))
  await page.waitForFunction(() => window.spendOwnership.snapshot().quote === 'quote-next')
  await page.evaluate(() => window.spendOwnership.back())
  await page.waitForFunction(() => window.spendOwnership.snapshot().page === 0)
  await page.evaluate(() => window.spendOwnership.change('page'))
  await page.waitForFunction(() => window.spendOwnership.snapshot().page === 1)
  expect((await page.evaluate(() => window.spendOwnership.snapshot())).prompt).toBe('edited')
  await page.evaluate(() => window.spendOwnership.discard())
  await page.waitForFunction(() => window.spendOwnership.calls.some(call => call.discard) && !window.spendOwnership.snapshot().busy)
  // × 收回的是这一次出价（裁决 D）：同一个 operationId 重新出价——哪怕只剩 B 这一镜、报价换了一份——
  // 他在 B 上没提交的那句话仍然在卡上。
  await page.evaluate(() => {
    window.spendOwnership.pending.shots.splice(0, 1)
    window.spendOwnership.pending.quoteId = 'quote-B-only'
    window.spendOwnership.pending.planVersion++
    window.spendOwnership.change('revision')
  })
  await page.waitForFunction(() => window.spendOwnership.snapshot().quote === 'quote-B-only')
  expect((await page.evaluate(() => window.spendOwnership.snapshot())).prompt).toBe('edited')
  // 阳性对照：换一次生成就是另一本账本，B 回到它自己的原文。
  await page.evaluate(() => window.spendOwnership.change('operation'))
  await page.waitForFunction(() => window.spendOwnership.snapshot().operation === 'operation-next')
  expect((await page.evaluate(() => window.spendOwnership.snapshot())).prompt).toBe('b')
})

// 2026-09-22（与上面那条同根）：× 收回的是**这一次出价**，不是这份草稿
// （裁决 D）。同一个 operationId 再 `generate` = 重新出价，报价指纹必然换一份——而用户在卡上
// **没提交**的那句话是「这一次操作」的东西，不是「这一次报价」的东西，必须原样还在。
// 阳性对照写在同一条里：换一次 operationId 就是另一本账本，一个字都带不过去。
it('a withdrawn bid re-presented under the same operation keeps unsubmitted card edits', async () => {
  await page.evaluate(() => window.spendOwnership.edit())
  await page.waitForFunction(() => window.spendOwnership.snapshot().prompt === 'edited')
  await page.evaluate(() => window.spendOwnership.discard())
  await page.waitForFunction(() => window.spendOwnership.calls.some(call => call.discard) && !window.spendOwnership.snapshot().busy)
  await page.evaluate(() => window.spendOwnership.rebid())
  await page.waitForFunction(() => window.spendOwnership.snapshot().quote === 'quote-rebid')
  expect(await page.evaluate(() => window.spendOwnership.snapshot().operation)).toBe('operation')
  expect(await page.evaluate(() => window.spendOwnership.snapshot().prompt)).toBe('edited')
  // 冷启动（D4 走查里真实走过的那一步）：账本活在存储里，键是这一次操作，重挂之后照样读回来。
  await page.reload()
  await page.locator('#upload').waitFor()
  await page.waitForFunction(() => Boolean(window.spendOwnership?.snapshot().prompt))
  expect(await page.evaluate(() => window.spendOwnership.snapshot().prompt)).toBe('edited')
  // 没有任何改动被偷偷提交给宿主：草稿仍然只活在卡上。
  expect(await page.evaluate(() => window.spendOwnership.calls.some(call => call.patch))).toBe(false)
  await page.evaluate(() => window.spendOwnership.change('operation'))
  await page.waitForFunction(() => window.spendOwnership.snapshot().operation === 'operation-next')
  expect(await page.evaluate(() => window.spendOwnership.snapshot().prompt)).toBe('a')
})

// Real hook lifecycle with controlled storage failure; parent runs this browser slice serially.
// 账本写不进去（配额满 / 隐私模式）只是「关掉再回来还在不在」这件便利失效——
// **绝不允许**它把用户正在编辑的这张付费卡打断，也不许把上一次生成的改动贴到下一次上。
it('a storage quota failure never interrupts the card and never leaks the previous draft', async () => {
  await page.evaluate(() => window.spendOwnership.edit())
  await page.waitForFunction(() => window.spendOwnership.snapshot().prompt === 'edited')
  await page.evaluate(() => {
    window.recoverySetItem = Storage.prototype.setItem
    window.recoveryFailures = 0
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('nomi:spend-draft:')) {
        window.recoveryFailures++
        throw new DOMException('controlled quota failure', 'QuotaExceededError')
      }
      return window.recoverySetItem.call(this, key, value)
    }
    window.spendOwnership.edit()
  })
  await page.waitForFunction(() => window.recoveryFailures >= 1)
  // 卡还活着、改动还在（它活在 React state 里，存储只是便利）。
  expect(await page.evaluate(() => window.spendOwnership.snapshot().prompt)).toBe('edited')
  expect(await page.evaluate(() => window.spendOwnership.snapshot().operation)).toBe('operation')
  await page.evaluate(() => {
    Storage.prototype.setItem = window.recoverySetItem
    window.spendOwnership.change('operation')
  })
  await page.waitForFunction(() => window.spendOwnership.snapshot().operation === 'operation-next')
  expect(await page.evaluate(() => window.spendOwnership.snapshot().prompt)).toBe('a')
  expect(await page.evaluate(() => window.spendOwnership.calls)).toEqual([])
})

// 2026-10-02 真 App 实测：「生成剩下 6 张」要走半分钟，这半分钟里卡上那颗 × 走的是 act()，被 busy 闸吞掉，6 张全发。
// 宿主级测试一直绿，是因为它绕过了渲染层的 busy 闸、直接调宿主的收回。这两条走真闸：渲染层的 act() 在 busy 时点 ×。
it('「生成剩下」交给宿主之后点 ×：× 立刻送到主进程，不排在那一下后面；卡关掉时照实说发了几张、剩几张没发', async () => {
  await page.evaluate(() => {
    const f = window.spendOwnership
    f.revise = () => ({ ok: true, quoteId: 'quote' })
    f.remaining = () => new Promise(resolve => { f.releaseRemaining = resolve })
  })
  await page.evaluate(() => window.spendOwnership.confirmRemaining())
  await page.waitForFunction(() => window.spendOwnership.calls.some(call => call.remaining))
  const running = await page.evaluate(() => window.spendOwnership.snapshot())
  expect(running.busy).toBe(true)
  expect(running.batchRunning).toBe(true)
  expect(running.progress).toBe('按 × 停下剩下的')
  expect(running.title).toMatch(/^正在发出 1\/2 段$/)
  await page.evaluate(() => window.spendOwnership.discard())
  await page.waitForFunction(() => window.spendOwnership.calls.some(call => call.discard))
  const calls = await page.evaluate(() => window.spendOwnership.calls)
  // × 没等宿主那一叠跑完：此刻那一叠还在路上，收回已经送到了。带的是这一叠交出去时那一版报价（宿主认这一叠出过的每一版）。
  expect(calls.filter(call => call.remaining)).toHaveLength(1)
  expect(calls.find(call => call.discard).discard).toEqual(['project', 'operation', 'quote'])
  expect((await page.evaluate(() => window.spendOwnership.snapshot())).title).toBe('正在停下…')
  await page.evaluate(() => window.spendOwnership.releaseRemaining({ ok: true, code: 'spend_confirmed', batchStopped: { sent: 1, notSent: 1 } }))
  await page.waitForFunction(() => window.spendOwnership.toasts.length > 0)
  expect(await page.evaluate(() => window.spendOwnership.toasts)).toEqual([{ message: '发出了 1 段，剩下 1 段没发。', kind: 'info', ttl: 8000 }])
  const after = await page.evaluate(() => window.spendOwnership.snapshot())
  expect(after.busy).toBe(false)
  expect(after.batchRunning).toBe(false)
})

it('「生成剩下」还在落候选时点 ×：不再往下改、不交给宿主，带着最新那一版报价收回出价；说一张都没发', async () => {
  await page.evaluate(() => window.spendOwnership.edit())
  await page.waitForFunction(() => window.spendOwnership.snapshot().prompt === 'edited')
  await page.evaluate(() => window.spendOwnership.change('page'))
  await page.waitForFunction(() => window.spendOwnership.snapshot().page === 1)
  await page.evaluate(() => window.spendOwnership.edit())
  await page.waitForFunction(() => window.spendOwnership.snapshot().prompt === 'edited')
  await page.evaluate(() => {
    const f = window.spendOwnership
    let revisions = 0
    f.revise = () => {
      revisions += 1
      return revisions === 1 ? new Promise(resolve => { f.releaseRevise = () => resolve({ ok: true, quoteId: 'quote-r1' }) }) : { ok: true, quoteId: `quote-r${revisions}` }
    }
  })
  await page.evaluate(() => window.spendOwnership.confirmRemaining())
  await page.waitForFunction(() => typeof window.spendOwnership.releaseRevise === 'function')
  await page.evaluate(() => window.spendOwnership.discard())
  await page.evaluate(() => window.spendOwnership.releaseRevise())
  await page.waitForFunction(() => window.spendOwnership.calls.some(call => call.discard))
  const calls = await page.evaluate(() => window.spendOwnership.calls)
  expect(calls.filter(call => call.remaining), '没交给宿主').toEqual([])
  expect(calls.filter(call => call.shotId), '只改了第一张就停').toHaveLength(1)
  expect(calls.find(call => call.discard).discard).toEqual(['project', 'operation', 'quote-r1'])
  await page.waitForFunction(() => window.spendOwnership.toasts.length > 0)
  expect(await page.evaluate(() => window.spendOwnership.toasts)).toEqual([{ message: '发出了 0 段，剩下 2 段没发。', kind: 'info', ttl: 8000 }])
})

// 10-02 搞破坏线 X2：「生成这张」在路上时点 ×。× 不排在那一下后面；宿主等手上那一镜落定才回，回的是这一次出价最终批下几张、
// 没发几张——提示照它说（那一镜可能在 × 之前已经过了核对、照样批下花钱）。被打断的那一下随后的失败不再另弹一句。
async function stopWhileConfirming(confirmed, stopped) {
  await page.evaluate(() => {
    const f = window.spendOwnership
    f.revise = () => ({ ok: true, quoteId: 'quote' })
    f.confirmReply = () => new Promise(resolve => { f.releaseConfirm = resolve })
    f.discardReply = () => new Promise(resolve => { f.releaseDiscard = resolve })
  })
  await page.evaluate(() => window.spendOwnership.confirm())
  await page.waitForFunction(() => typeof window.spendOwnership.releaseConfirm === 'function')
  expect((await page.evaluate(() => window.spendOwnership.snapshot())).busy).toBe(true)
  await page.evaluate(() => window.spendOwnership.discard())
  await page.waitForFunction(() => typeof window.spendOwnership.releaseDiscard === 'function')
  const calls = await page.evaluate(() => window.spendOwnership.calls)
  expect(calls.filter(call => call.confirm), '× 没排在「生成这张」后面：那一下还在路上，收回已经送到').toHaveLength(1)
  expect(calls.find(call => call.discard).discard).toEqual(['project', 'operation', 'quote'])
  await page.evaluate((reply) => window.spendOwnership.releaseConfirm(reply), confirmed)
  await page.evaluate((reply) => window.spendOwnership.releaseDiscard(reply), { ok: true, code: 'discarded', batchStopped: stopped })
  await page.waitForFunction(() => window.spendOwnership.toasts.length > 0 && !window.spendOwnership.snapshot().busy)
  return page.evaluate(() => window.spendOwnership.toasts)
}

it('「生成这张」在路上时点 ×、那一镜照样批下了：提示照宿主最终批下的说「发出了 1 段」', async () => {
  expect(await stopWhileConfirming({ ok: true, code: 'spend_confirmed' }, { sent: 1, notSent: 1 }))
    .toEqual([{ message: '发出了 1 段，剩下 1 段没发。', kind: 'info', ttl: 8000 }])
})

it('「生成这张」在路上时点 ×、那一镜还没批下就被收回：只说「发出了 0 段」，不再弹那一下的失败', async () => {
  expect(await stopWhileConfirming({ ok: false, code: 'failed', message: 'generation_quote_changed' }, { sent: 0, notSent: 2 }))
    .toEqual([{ message: '发出了 0 段，剩下 2 段没发。', kind: 'info', ttl: 8000 }])
})

// ── 特征测试（付费卡并进对话投影之前钉住，2026-10-05）：卡怎么出现、怎么消失、读不到说什么、
// 「生成这张」和 × 带着哪一版报价去。换数据来源之后这几条一字不改照样要绿。
it('characterization: the host pending shows one spend card that counts the undecided shots', async () => {
  await page.waitForFunction(() => window.spendOwnership.snapshot().slotKind === 'spend')
  expect(await page.evaluate(() => { const s = window.spendOwnership.snapshot(); return { kind: s.slotKind, title: s.title, shots: s.pendingShots } }))
    .toEqual({ kind: 'spend', title: '生成这 2 段视频？', shots: ['a', 'b'] })
})
it('characterization: the host saying nothing is pending removes the card; it comes back when the host has one again', async () => {
  await page.waitForFunction(() => window.spendOwnership.snapshot().slotKind === 'spend')
  await page.evaluate(() => window.spendOwnership.hide())
  await page.waitForFunction(() => window.spendOwnership.snapshot().slotKind === undefined)
  expect(await page.evaluate(() => window.spendOwnership.snapshot().pendingShots)).toBeUndefined()
  await page.evaluate(() => window.spendOwnership.restore())
  await page.waitForFunction(() => window.spendOwnership.snapshot().slotKind === 'spend')
})
it('characterization: a host read failure is a speaking card, not an empty slot', async () => {
  await page.waitForFunction(() => window.spendOwnership.snapshot().slotKind === 'spend')
  await page.evaluate(() => window.spendOwnership.failRead())
  await page.waitForFunction(() => window.spendOwnership.snapshot().slotKind !== 'spend')
  expect(await page.evaluate(() => { const s = window.spendOwnership.snapshot(); return { kind: s.slotKind, title: s.title, detail: s.slotDetail } }))
    .toEqual({ kind: 'missing-card', title: '这里本该有一张确认卡', detail: '有一条在等你确认，但 Nomi 没能把卡画出来（读不到主进程那一份待确认清单）。先别重试同一步——换一句话让 Agent 重新提一次，或者重开这个项目。' })
})
it('characterization: 「生成这张」 approves only this page with the quote the host returned; × withdraws the displayed quote', async () => {
  await page.evaluate(() => { window.spendOwnership.revise = () => ({ ok: true, quoteId: 'quote' }) })
  await page.evaluate(() => window.spendOwnership.confirm())
  await page.waitForFunction(() => window.spendOwnership.calls.some(call => call.confirm))
  expect(await page.evaluate(() => window.spendOwnership.calls.find(call => call.confirm).confirm)).toEqual(['project', 'operation', 'quote', 'a'])
  await page.waitForFunction(() => !window.spendOwnership.snapshot().busy)
  await page.evaluate(() => window.spendOwnership.discard())
  await page.waitForFunction(() => window.spendOwnership.calls.some(call => call.discard))
  expect(await page.evaluate(() => window.spendOwnership.calls.find(call => call.discard).discard)).toEqual(['project', 'operation', 'quote'])
})
