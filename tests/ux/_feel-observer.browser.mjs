import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { test } from 'node:test'
import { expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { compareFeelBaseline, installFeelObserver } from './_feel-observer.mjs'

test('baseline accepts known counts and reports increases and reductions', () => {
  const baseline = { entries: [{ journey: 'agent-panel', screenshotName: 'state.png', rule: 'text-overlap', count: 1, owner: 'test' }] }
  expect(compareFeelBaseline({ label: 'state', journey: 'agent-panel', screenshotName: 'state.png', findings: [{ rule: 'text-overlap' }] }, baseline)).toEqual([])
  expect(compareFeelBaseline({ label: 'state', journey: 'agent-panel', screenshotName: 'state.png', findings: [] }, baseline)[0].kind).toBe('reduced-update-baseline')
  expect(compareFeelBaseline({ label: 'other', findings: [{ rule: 'font-size' }] }, baseline)).toEqual([])
})

test('shared observer scans screenshots and completed state waits without author calls', async () => {
  const browser = await chromium.launch({ headless: true })
  const dir = makeTempDir('feel-observer-')
  try {
    const page = await browser.newPage()
    const observer = installFeelObserver(page, {
      name: 'agent-panel', outputDir: dir, baseline: { entries: ['bad.png', 'locator.png', 'waitForFunction.png'].map((screenshotName) => ({ journey: 'agent-panel', screenshotName, rule: 'font-size', count: 0 })) }, exemptions: { entries: [] },
    })
    await page.setContent('<p>Readable</p>')
    await page.screenshot({ path: path.join(dir, 'clean.png') })
    await page.waitForFunction(() => document.readyState === 'complete')
    expect(observer.records.length).toBe(2)
    await page.setContent('<p style="font-size:8px">Tiny</p><button>Continue</button>')
    await page.screenshot({ path: path.join(dir, 'unregistered.png') })
    const surfaces = JSON.parse(fs.readFileSync(path.join(dir, 'new-surfaces.json'), 'utf8'))
    expect(surfaces[0]).toMatchObject({ mode: 'record', rule: 'font-size', findings: [{ text: ['Tiny'] }] })
    await expect(page.screenshot({ path: path.join(dir, 'bad.png') })).rejects.toThrow(/Feel baseline drift/)
    await expect(page.getByRole('button').first().screenshot({ path: path.join(dir, 'locator.png') })).rejects.toThrow(/Feel baseline drift/)
    await expect(page.waitForFunction(() => document.readyState === 'complete')).rejects.toThrow(/Feel baseline drift/)
    const records = JSON.parse(fs.readFileSync(path.join(dir, 'contact-sheet.json'), 'utf8'))
    expect(records.length).toBe(6)
    expect(records[2].findings[0].rule).toBe('font-size')
    expect(fs.existsSync(records[2].screenshot)).toBe(true)
    await page.setContent('<p>Readable again</p>')
    const reduced = installFeelObserver(await browser.newPage(), {
      name: 'agent-panel', outputDir: path.join(dir, 'reduction'),
      baseline: { entries: [{ journey: 'agent-panel', screenshotName: 'state.png', rule: 'font-size', count: 1 }] }, exemptions: { entries: [] },
    })
    await reduced.checkpoint('state')
    expect(reduced.records[0].drift[0].kind).toBe('reduced-update-baseline')
  } finally {
    await browser.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})


test('real journey observer records known budget overruns on page, locator and waits', async () => {
  const browser = await chromium.launch({ headless: true })
  const dir = makeTempDir('feel-real-record-')
  try {
    for (const name of ['eval-iso', 'real-user-test-gates']) {
      const page = await browser.newPage()
      const outputDir = path.join(dir, name)
      const observer = installFeelObserver(page, {
        name, outputDir, exemptions: { entries: [] },
        baseline: { entries: ['bad.png', 'locator.png', 'waitForFunction.png'].map((screenshotName) => ({ journey: name, screenshotName, rule: 'font-size', count: 0 })) },
      })
      await page.setContent('<p style="font-size:8px">Tiny</p><button>Continue</button>')
      await page.screenshot({ path: path.join(outputDir, 'bad.png') })
      await page.getByRole('button').screenshot({ path: path.join(outputDir, 'locator.png') })
      await page.waitForFunction(() => document.readyState === 'complete')
      expect(observer.records).toHaveLength(3)
      const surfaces = JSON.parse(fs.readFileSync(path.join(outputDir, 'new-surfaces.json'), 'utf8'))
      expect(surfaces).toHaveLength(3)
      expect(new Set(surfaces.map((surface) => surface.screenshotName)).size).toBe(3)
      for (const record of observer.records) {
        expect(record.mode).toBe('record')
        expect(record.drift).toEqual([])
        expect(record.findings[0].text).toEqual(['Tiny'])
        expect(fs.existsSync(record.screenshot)).toBe(true)
      }
      expect(JSON.parse(fs.readFileSync(path.join(outputDir, 'contact-sheet.json'), 'utf8'))).toHaveLength(3)
      await page.close()
    }
  } finally {
    await browser.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('repeated rows records five tool steps without ratcheting even with a registered zero', async () => {
  const browser = await chromium.launch({ headless: true })
  const dir = makeTempDir('feel-repeated-')
  try {
    const page = await browser.newPage()
    const observer = installFeelObserver(page, {
      name: 'agent-panel', outputDir: dir, exemptions: { entries: [] },
      baseline: { entries: [{ journey: 'agent-panel', screenshotName: 'rows.png', rule: 'repeated-rows', count: 0 }] },
    })
    const row = (i) => `<div>准备工具 · 参数 其他设置 ${i} 项 · ✓完成 <time>14:20:${10 + i}</time></div>`
    await page.setContent(`<section>${[1, 2, 3, 4, 5].map(row).join('')}</section>`)
    const result = await observer.checkpoint('rows')
    const hits = result.findings.filter((finding) => finding.rule === 'repeated-rows')
    expect(hits).toHaveLength(1)
    expect(hits[0].text).toHaveLength(5)
    expect(observer.records[0].drift).toEqual([])
    expect(observer.records[0].newSurfaces).toEqual([expect.objectContaining({ rule: 'repeated-rows', mode: 'record' })])
    await page.setContent(`<section>${[1, 2, 3].map(row).join('')}</section>`)
    expect((await observer.checkpoint('threshold')).findings.filter((finding) => finding.rule === 'repeated-rows')).toHaveLength(1)
    await page.setContent(`<section style="pointer-events:none">${[1, 2, 3].map(row).join('')}</section>`)
    expect((await observer.checkpoint('noninteractive')).findings.filter((finding) => finding.rule === 'repeated-rows')).toHaveLength(1)
    for (const content of [
      `<section>${row(1)}${row(2)}</section>`,
      `<section>${row(1)}${row(2)}<div>等待用户确认</div>${row(3)}${row(4)}</section>`,
      `<section>${row(1)}${row(2)}</section><section>${row(3)}</section>`,
      `<section hidden>${row(1)}${row(2)}${row(3)}</section>`,
      `<details><summary>准备工具 ×5</summary>${row(1)}${row(2)}${row(3)}</details>`,
      `<section style="height:40px;overflow:hidden">${row(1)}${row(2)}<div style="height:2000px"></div>${row(3)}${row(4)}${row(5)}</section>`,
    ]) {
      await page.setContent(content)
      expect((await observer.checkpoint('negative')).findings.filter((finding) => finding.rule === 'repeated-rows')).toEqual([])
    }
  } finally {
    await browser.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
