import { makeTempDirAsync } from '../../../scripts/_test-temp.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { createCollector, readJson, rubricFile } from './collect.mjs'
import { installFeelObserver } from '../_feel-observer.mjs'

test('collector consumes the existing observer screenshot record without another scan', async () => {
  const outputDir = await makeTempDirAsync('experience-shared-observer-')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<button style="font-size:16px">Continue</button>')
    const observer = installFeelObserver(page, { name: 'experience-shared', outputDir: path.join(outputDir, 'feel') })
    const collector = await createCollector({ journey: { id: 'shared', steps: ['continue'] }, outputDir, identity: {} })
    await collector.attach(page)
    assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), (await readJson(rubricFile)).viewport)
    const target = page.getByRole('button', { name: 'Continue' })
    await collector.step('continue', () => target.click(), { target })
    const shots = observer.records.filter((record) => /01-continue-(before|after)\.png$/.test(record.screenshot))
    assert.equal(shots.length, 2)
    assert.equal(collector.run.steps[0].feel, shots[1])
    assert.equal(shots[1].journey, 'experience-shared')
    assert.equal(shots[1].mode, 'record')
    await collector.finish({ passed: true, assertion: 'button clicked' })
  } finally {
    await browser.close()
    await fs.rm(outputDir, { recursive: true, force: true })
  }
})
