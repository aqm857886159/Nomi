// Real product tasks, isolated storage, existing loopback providers. No seeded results.
import fs from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp, repoRoot } from '../_launchApp.mjs'
import { applyColorSchemeForShot, clickOrFail, expect } from '../_assert.mjs'
import {
  createAgentRuntimeFixture,
  FIXTURE_IMAGE_MODEL_LABEL,
  FIXTURE_TEXT_MODEL_LABEL,
} from '../agent-runtime-fixture.mjs'
import {
  CREATION_PANEL,
  COMPOSER_INPUT,
  COMPOSER_SEND,
  COMPOSER_MODEL,
  DOCUMENT,
  MODEL_POPOVER,
  hasToolResult,
  readProject,
} from '../agent-runtime-walk-support.mjs'
import { startFixtureServer } from '../model-access-journeys/fixture-server.mjs'

export async function runJourney(journey, collector) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nomi-experience-'))
  const settingsDir = path.join(tempRoot, 'settings')
  let launched, fixture, error, outcome
  try {
    fixture =
      journey.entry === 'settings'
        ? await startFixtureServer({ repoRoot })
        : await createAgentRuntimeFixture({ rootDir: repoRoot, settingsDir })
    const launchStarted = performance.now()
    launched = await launchNomiApp({
      name: `experience-${journey.id}`,
      tempRoot,
      settingsDir,
      settleMs: 0,
      syntheticCredentialStorage: true,
      observeWindow: collector.attach,
      args: ['--no-proxy-server'],
      env: {
        NOMI_RENDERER_URL: '',
        VITE_DEV_SERVER_URL: '',
        NOMI_DESKTOP_DEV: '',
        NOMI_E2E_PRODUCTION_FIXTURE: '0',
        NOMI_DISABLE_AUTO_UPDATE: '1',
      },
    })
    const { win } = launched
    win.setDefaultTimeout(20000)
    await applyColorSchemeForShot(win, 'light')
    // Setup preferences only, then use the visible splash action; never reload an active app.
    await win.evaluate(() => {
      localStorage.setItem('nomi:journey-tour:v1', 'seen')
      localStorage.setItem('nomi:canvas-gesture-hint:v1', 'seen')
    })
    const skip = win.locator('[data-splash-skip="true"]')
    const firstAction = (await skip.isVisible()) ? skip : win.getByRole('button', { name: /^新建空白项目/ })
    await firstAction.click({ trial: true })
    collector.run.startup.firstActionableFromLaunchMs = performance.now() - launchStarted
    collector.run.startup.firstActionableScope =
      'first-screen actionability proxy, includes test observer/window setup; not Lighthouse TTI'
    if (await skip.isVisible()) await clickOrFail(skip, '跳过开场（准备，不计旅程）')
    const click = (id, target, options = {}) =>
      collector.step(id, () => clickOrFail(target, id), { target, ...options })
    const fill = (id, target, value) => collector.step(id, () => target.fill(value), { type: 'input', target })
    if (journey.entry === 'settings') {
      await click('open-settings', win.getByRole('button', { name: '设置', exact: true }).first())
      await click(
        'open-models',
        win.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '模型', exact: true }),
      )
      await click('custom-api', win.locator('[data-model-home-action="custom-api"]'))
      await fill('connection-name', win.getByPlaceholder('如：TOAPI 中转'), 'Experience Loopback')
      await fill('connection-url', win.getByPlaceholder('https://api.openai.com/v1'), fixture.origin)
      await fill('connection-key', win.getByPlaceholder('sk-...'), 'sk-fixture-key')
      await click('save-connection', win.getByRole('button', { name: '保存连接', exact: true }))
      await click('fetch-models', win.getByRole('button', { name: /获取模型|获取可用模型|重新获取列表/ }).first(), {
        complete: () => expect(win.getByRole('button', { name: 'fixture-text-chat', exact: true })).toBeVisible(),
      })
      await click('choose-model', win.getByRole('button', { name: 'fixture-text-chat', exact: true }))
      await click('verify-model', win.getByRole('button', { name: /验证\s*1\s*个模型/ }), {
        complete: async () => {
          await expect
            .poll(
              async () => {
                const catalog = JSON.parse(await fs.readFile(path.join(settingsDir, 'model-catalog.json'), 'utf8'))
                return catalog.models.some((m) => m.modelKey === 'fixture-text-chat' && m.enabled)
              },
              { timeout: 30000 },
            )
            .toBe(true)
        },
      })
      expect(fixture.requests.some((r) => r.method === 'GET' && r.path.endsWith('/models'))).toBe(true)
      outcome = { passed: true, assertion: 'UI selected model persisted enabled; loopback GET /models observed' }
    } else {
      await click('new-project', win.getByRole('button', { name: /^新建空白项目/ }), {
        complete: () => expect(win.locator(DOCUMENT)).toBeVisible(),
      })
      const projectId = await win.evaluate(() => {
        const url = new URL(location.href)
        return url.searchParams.get('projectId') || new URLSearchParams(url.hash.split('?')[1] || '').get('projectId')
      })
      expect(projectId).toMatch(/^project-/)
      if (journey.entry === 'agent') {
        await click('open-models', win.locator(`${CREATION_PANEL} ${COMPOSER_MODEL}`))
        await click(
          'open-chat-model',
          win.locator(`${CREATION_PANEL} ${MODEL_POPOVER} [data-v4-model-row]`).first().locator('button').first(),
        )
        await click(
          'choose-model',
          win
            .locator('[data-nomi-select-dropdown] [data-nomi-select-option-label]')
            .filter({ hasText: FIXTURE_TEXT_MODEL_LABEL }),
        )
        await collector.step('close-models', () => win.keyboard.press('Escape'), { type: 'key' })
        const content = '体验量表验收：红色杯子放在白色桌面。'
        fixture.expectText({
          label: 'append document',
          match: (b) => !hasToolResult(b, 'experience-append'),
          reply: {
            type: 'tool',
            name: 'append_to_end',
            id: 'experience-append',
            args: { content },
          },
        })
        fixture.expectText({
          label: 'tool result',
          match: (b) => hasToolResult(b, 'experience-append'),
          reply: { type: 'text', text: '已将句子写入文稿。' },
        })
        await fill(
          'write-instruction',
          win.locator(`${CREATION_PANEL} ${COMPOSER_INPUT}`),
          `在文稿末尾加一句：${content}`,
        )
        await click('send-instruction', win.locator(`${CREATION_PANEL} ${COMPOSER_SEND}`), {
          feedback: `${CREATION_PANEL} [data-mode="running"]`,
          complete: async () => {
            await expect(win.locator(DOCUMENT)).toContainText(content, { timeout: 30000 })
            await expect(win.locator(CREATION_PANEL)).toContainText('已将句子写入文稿。', { timeout: 30000 })
            await expect
              .poll(async () => JSON.stringify((await readProject(win, projectId)).payload), { timeout: 30000 })
              .toContain(content)
          },
        })
        fixture.assertClean()
        const toolResults = fixture.requests.filter((r) => hasToolResult(r.body, 'experience-append'))
        expect(toolResults.length).toBe(1)
        outcome = {
          passed: true,
          assertion: 'Tool result returned to loopback model; text visible and persisted',
          toolResults: toolResults.length,
          paidCalls: 0,
        }
      } else {
        await click('open-canvas', win.getByRole('button', { name: '生成', exact: true }), {
          complete: () => expect(win.locator('.generation-canvas-v2__stage')).toBeVisible(),
        })
        await click('add-image', win.locator('.generation-canvas-v2-toolbar [data-add-intent="image"]'))
        const composer = win.locator('.generation-canvas-v2-node__composer-card').last()
        await click('select-model', composer.getByRole('button', { name: '模型', exact: true }))
        await click('choose-model', win.getByText(FIXTURE_IMAGE_MODEL_LABEL, { exact: true }).last())
        await fill(
          'write-prompt',
          composer.locator('textarea, [contenteditable="true"]').first(),
          '白桌中央的红色杯子，柔和自然光。',
        )
        await click('generate', composer.getByRole('button', { name: /生成素材|生成/ }).last())
        const confirmation = win.locator('div.fixed.inset-0').filter({ hasText: '开始生成' }).last()
        await click('confirm-generation', confirmation.getByRole('button', { name: '生成', exact: true }), {
          confirmation: true,
          feedback: '[data-node-id][data-status="running"]',
          complete: async () => {
            await expect(win.locator('[data-node-id][data-status="success"]')).toBeVisible({ timeout: 30000 })
            await expect
              .poll(
                async () =>
                  (await readProject(win, projectId)).payload.generationCanvas.nodes.some((n) =>
                    Boolean(n.result?.url),
                  ),
                { timeout: 30000 },
              )
              .toBe(true)
          },
        })
        expect(fixture.images.length).toBe(1)
        fixture.assertClean()
        outcome = {
          passed: true,
          assertion: 'One real canvas image request; success node visible and result persisted',
          imageRequests: fixture.images.length,
          paidCalls: 0,
        }
      }
    }
  } catch (caught) {
    error = caught
  } finally {
    try {
      await collector.finish(outcome, error)
    } catch (caught) {
      error ||= caught
    }
    if (launched) await launched.close()
    if (fixture) await fixture.close()
  }
  if (error) throw error
  return collector.run
}
