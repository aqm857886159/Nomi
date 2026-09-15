import { stationTimeout } from '../_station-budget.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { expect, clickOrFail } from '../_assert.mjs'
import { openSystemPromptEditor } from '../_systemPromptEditor.mjs'
import { DOCUMENT, CREATION_PANEL, COMPOSER_INPUT, COMPOSER_SEND, INTERVENTION_CONFIRM, APPROVAL_CARD,
  openCanvas, sendCreation, hasToolResult } from '../agent-runtime-walk-support.mjs'
import { FIXTURE_IMAGE_MODEL } from '../agent-runtime-fixture.mjs'
import { shots } from './c0-fixture.mjs'
import { repairStoryboard } from './sweep-repair.mjs'
import { writeJson } from './sweep-evidence.mjs'
import { providerFailure } from './sweep-response.mjs'
import { sweepTimeline } from './sweep-timeline.mjs'

export async function runSurface({ walk, win, input, fixture, realText, directory, payload, projectId }) {
  const surface = input.surface
  const station = (id, expected, run, repair) => walk.station({ id, surface, expected, repair, requires: () => Boolean(win && !win.isClosed() && projectId) }, run)
  await station('input', '原始输入可编辑且完整', async () => {
    await win.locator(DOCUMENT).fill(input.text)
    await expect(win.locator(DOCUMENT)).toHaveText(input.text)
    writeJson(path.join(directory, 'input.json'), input)
  })
  if (surface === 'agent-panel' || surface === 'storyboard') {
    await station('agent', '真实 UI 发起工具回合并得到领域结果', async () => {
      if (!input.text) {
        await win.locator(`${CREATION_PANEL} ${COMPOSER_INPUT}`).fill('')
        await expect(win.locator(`${CREATION_PANEL} ${COMPOSER_SEND}`)).toBeDisabled()
        return
      }
      if (input.boundary === 'attachment') {
        const file = path.resolve(directory, 'reference.jpg')
        fs.copyFileSync(new URL('../../../resources/onboarding-demo/shot-4.jpg', import.meta.url), file)
        await win.locator(`${CREATION_PANEL} input[type="file"]`).setInputFiles(file)
      }
      const id = 'sweep-plan'
      if (fixture) fixture.expectText({ label: 'sweep plan', match: body => !hasToolResult(body, id),
        reply: { type: 'tool', id, name: 'draft_shots', args: {
          shots: shots.map((s, index) => ({ title: `Sweep 分镜 · ${index + 1}`, taskKind: 'text_to_image', modelKey: FIXTURE_IMAGE_MODEL, modeId: 't2i', parameters: { size: input.boundary === 'aspect' ? '9:16' : '16:9' }, prompt: input.text.slice(0, 200) + s.prompt })),
        } } })
      if (fixture) fixture.expectText({ label: 'sweep tool result', match: body => hasToolResult(body, id),
        reply: { type: 'text', text: 'SWEEP_DONE：请审阅分镜。' } })
      await sendCreation(win, `把文稿拆为分镜：${input.text}`)
      if (realText) {
        await win.waitForFunction(() => document.querySelector('[data-v4-control="confirm"], [data-agent-error="true"], [data-v4-block="errorbar"]'))
        const failed = providerFailure(JSON.parse(fs.readFileSync(path.join(directory, 'model-requests.json'), 'utf8')))
        if (failed) throw Error(failed)
      }
      await clickOrFail(win.locator(`${CREATION_PANEL} ${APPROVAL_CARD} ${INTERVENTION_CONFIRM}`), '批准测试分镜', { timeout: stationTimeout({ operations: 1 }) })
      if (!realText) await expect(win.locator(CREATION_PANEL)).toContainText('SWEEP_DONE', { timeout: stationTimeout({ operations: 1 }) })
      await expect(win.locator('[data-storyboard-id]').first()).toBeVisible({ timeout: stationTimeout({ operations: 1 }) })
    }, { name: 'explicit storyboard fixture after failed Agent turn',
      run: () => repairStoryboard(win, projectId, { title: 'Sweep 分镜', shots: shots.map(s => ({ ...s, modelKey: realText ? 'MiniMax-H3' : FIXTURE_IMAGE_MODEL, params: realText ? { duration: 8, resolution: '768P', size: '16:9' } : { size: '16:9' } })) }) })
    await station('storyboard', '分镜可编辑并保留输入约束', async () => {
      if (!input.text) return
      await clickOrFail(win.locator('[data-storyboard-id]').first(), '打开分镜表', { timeout: stationTimeout({ operations: 1 }) })
      if (!realText) await expect(win.getByRole('textbox', { name: '方案标题', exact: true })).toHaveValue('Sweep 分镜')
      await expect.poll(async () => {
        const p = await payload()
        return p.storyboardDesignsByDocumentId?.[p.activeDocumentId]?.[0]?.plan?.shots?.length
      }, { timeout: stationTimeout({ operations: 1 }) }).toBe(8)
      const p = await payload()
      const plan = p.storyboardDesignsByDocumentId?.[p.activeDocumentId]?.[0]?.plan
      expect(plan?.shots).toHaveLength(8)
      if (realText && input.boundary === 'model-tier') expect(plan?.shots.every(s => s.modelKey === 'MiniMax-H3' && s.params?.resolution === '768P')).toBe(true)
      if (input.boundary === 'aspect') expect(plan?.shots.every(s => s.params?.size === '9:16')).toBe(true)
    })
    return
  }
  if (surface === 'prompt-library') {
    // 2026-09-14 搬家：系统提示词编辑器住在 Agent 面板的档位弹层里，不再在设置 → AI 策略。
    await station('prompt-editor-open', '提示词编辑器通过 Agent 面板档位弹层打开', async () => {
      await openSystemPromptEditor(win, { timeout: stationTimeout({ operations: 2 }) })
    })
    await station('settings-task', input.coverage, async () => {
      const editor = win.locator('[data-system-prompt-editor]')
      await clickOrFail(editor.locator('[data-settings-prompt-create]'), '新建提示词')
      await editor.locator('[data-settings-field="system-prompt-name"]').fill('Sweep 测试')
      await editor.locator('[data-settings-field="system-prompt"]').fill(input.text)
      await expect(editor.locator('[data-settings-field="system-prompt"]')).toHaveValue(input.text)
    })
    return
  }
  if (surface === 'settings' || surface === 'mcp') {
    await station('settings-open', '设置通过用户入口打开', async () => {
      await clickOrFail(win.getByRole('button', { name: '设置', exact: true }).first(), '设置', { timeout: stationTimeout({ operations: 1 }) })
      await expect(win.locator('[data-settings-overlay]')).toBeVisible()
    })
    await station('settings-task', input.coverage, async () => {
      const settings = win.locator('[data-settings-overlay]')
      if (surface === 'settings') {
        await clickOrFail(settings.locator('aside button').filter({ hasText: '通用' }).first(), '通用')
        if (input.scenario === 'canvas-pan') {
          await clickOrFail(settings.locator('[data-canvas-gesture-scheme="modifier-zoom"]'), '切换滚轮平移')
          await expect(settings.locator('[data-canvas-gesture-scheme="modifier-zoom"]')).toHaveAttribute('aria-checked', 'true')
          return
        }
        if (input.scenario === 'theme') {
          const before = await win.locator('html').getAttribute('data-mantine-color-scheme')
          await clickOrFail(settings.getByRole('button', { name: /切换到.*色模式/ }), '切换外观')
          await expect(win.locator('html')).toHaveAttribute('data-mantine-color-scheme', before === 'dark' ? 'light' : 'dark')
          return
        }
        await expect(settings.locator('[data-settings-locale="zh-CN"]')).toBeVisible()
        await clickOrFail(settings.locator('[data-settings-locale="en"]'), 'English')
        await expect(settings.locator('[data-settings-locale="en"]')).toHaveAttribute('aria-pressed', 'true')
        await clickOrFail(settings.locator('[data-settings-locale="zh-CN"]'), '中文')
      } else if (surface === 'mcp') {
        await clickOrFail(settings.locator('aside button').filter({ hasText: /自动化|权限/ }).first(), '自动化权限')
        await clickOrFail(settings.locator('[data-settings-action="manage-mcp-connections"]'), 'MCP 连接管理')
        await expect(win.getByRole('dialog').last()).toBeVisible()
      }
    })
    return
  }
  if (surface === 'skill-library') {
    await station('skill-canvas', '生成工作区技能库入口可达', () => openCanvas(win))
    await station('skill-open', '技能库导入入口可用', async () => {
      await clickOrFail(win.getByRole('button', { name: '技能库', exact: true }).first(), '技能库')
      await expect(win.locator('[data-skill-drop-zone]')).toBeVisible()
    })
    await station('skill-import', '标准 SKILL.md 导入后可见', async () => {
      const file = path.join(directory, 'SKILL.md')
      fs.writeFileSync(file, `---\nname: sweep-skill\ndescription: Sweep 测试技能\n---\n${input.text}\n`)
      await win.locator('[data-skill-drop-zone] input[type="file"]').setInputFiles(file)
      await expect(win.locator('[data-skill-drop-zone]')).toContainText('sweep-skill')
    })
    return
  }
  await station('canvas-open', '生成画布可达', () => openCanvas(win))
  if (surface === 'timeline' || surface === 'export') return sweepTimeline({ station, win, input, directory, payload })
  await station('surface-task', input.coverage, async () => {
    if (surface === 'canvas-node') {
      await clickOrFail(win.getByRole('button', { name: '添加视频节点', exact: true }), '添加视频节点', { timeout: stationTimeout({ operations: 1 }) })
      const node = win.locator('[data-node-id]').last()
      await expect(node).toBeVisible()
      const editor = win.locator('.generation-canvas-v2-node__composer [contenteditable="true"]').first()
      await editor.fill(input.text)
      await expect(editor).toHaveText(input.text)
      await editor.blur()
      await expect.poll(async () => (await payload()).generationCanvas.nodes.some(n => n.prompt === input.text), { timeout: stationTimeout({ operations: 1 }) }).toBe(true)
      if (input.boundary === 'attachment') {
        const file = path.resolve(directory, 'canvas-reference.jpg')
        fs.copyFileSync(new URL('../../../resources/onboarding-demo/shot-4.jpg', import.meta.url), file)
        await win.locator('.generation-canvas-v2__stage input[type="file"][accept="image/*,video/*"]').first().setInputFiles(file)
        await expect.poll(async () => (await payload()).generationCanvas.nodes.some(n => n.result?.url?.startsWith('nomi-local://')), { timeout: stationTimeout({ operations: 1 }) }).toBe(true)
      }
    }
  })
}
