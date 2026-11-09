import { uiText } from './full-walk/invariants.mjs'
import { expect } from './_assert.mjs'
import { ensureAgentPanelOpen } from './_shell.mjs'
import { chooseAssistantModel, COMPOSER_INPUT, COMPOSER_PERMISSION, permissionTier, readProject, STORYBOARD_PANEL, waitForV4TurnIdle } from './agent-runtime-walk-support.mjs'

// One journey for the real brain and its local rehearsal; neither path authorizes generation.
export async function runStoryboardAgentBulk({ walk, brainLabel, imageLabel, beforeSend }) {
  const { win } = await walk.start({ first: true })
  const { projectId } = await walk.newProject()
  const rail = win.locator('[data-shell-rail-item="docs"][aria-pressed="false"]')
  if (await rail.isVisible()) await rail.click()
  await win.locator('[data-add-storyboard]').first().click()
  const editor = win.locator('[data-storyboard-editor]:visible')
  await expect(editor).toBeVisible()
  const planTitle = 'Selected storyboard edit rehearsal'
  await editor.getByRole('textbox', { name: uiText('zh-CN', 'storyboardEditor.titleAria'), exact: true }).fill(planTitle)
  await editor.getByRole('button', { name: uiText('zh-CN', 'storyboardEditor.addShot'), exact: true }).click()
  for (const index of [1, 2, 3]) {
    const row = editor.locator(`[data-storyboard-row="${index}"]`)
    await row.locator('[data-prompt-box] [contenteditable="true"]').fill(`Bulk edit shot ${index}`)
    await row.getByRole('button', { name: uiText('zh-CN', 'generationCommon.parameters.model'), exact: true }).click()
    await win.getByRole('option', { name: new RegExp(imageLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click()
  }
  for (const index of [1, 2, 3]) await editor.locator(`input[data-storyboard-select="${index}"]`).check()
  const readPlan = async () => {
    const record = await readProject(win, projectId)
    return Object.values(record.payload.storyboardDesignsByDocumentId).flat().find(design => design.plan.title === planTitle)
  }
  await expect.poll(async () => (await readPlan())?.plan.shots.map(shot => shot.shotKind), { message: 'All three image choices must reach the persisted plan before handoff' }).toEqual(['image', 'image', 'image'])
  const before = await readPlan()
  await editor.locator('[data-storyboard-agent-handoff="selection"]').click()
  await ensureAgentPanelOpen(win, '分镜交接面板')
  const panel = win.locator(STORYBOARD_PANEL)
  await expect(panel.locator(COMPOSER_INPUT)).toBeFocused()
  await chooseAssistantModel(win, brainLabel, STORYBOARD_PANEL)
  await panel.locator(COMPOSER_PERMISSION).click()
  await panel.locator(permissionTier('request')).click()
  await beforeSend?.({ design: before, win })
  const input = panel.locator(COMPOSER_INPUT)
  await input.fill('把选中的这三镜全部换成视频，全部改成竖屏 9:16。只改当前这份分镜方案，不生成，不新建方案。')
  await win.evaluate(() => {
    window.__storyboardInputProbe = { users: [] }
    window.__storyboardInputProbe.dispose = window.nomiDesktop.agentLane.onProjection(projection => {
      window.__storyboardInputProbe.users = (projection.active?.parts ?? [])
        .filter(part => part.kind === 'user')
        .map(part => ({ storyboardTarget: part.storyboardTarget }))
    })
  })
  await input.press('Enter')
  await expect.poll(() => win.evaluate(() => window.__storyboardInputProbe.users.length),
    { message: 'The main-process lane must receive the selected-shot input' }).toBeGreaterThan(0)
  const received = await win.evaluate(() => {
    window.__storyboardInputProbe.dispose()
    return window.__storyboardInputProbe.users.at(-1)
  })
  walk.report.storyboardInput = received
  expect(received.storyboardTarget, 'The lane must receive the current design and exactly the selected shots')
    .toMatchObject({ designId: before.id, shotIds: before.plan.shots.map(shot => shot.shotId) })
  await waitForV4TurnIdle(win, { panel: STORYBOARD_PANEL })
  await expect.poll(async () => {
    const current = await readPlan()
    return current.id === before.id && current.plan.shots.every(shot => shot.shotKind === 'video' && (shot.params?.aspect_ratio ?? current.plan.aspectRatio) === '9:16')
  }, { message: 'The selected original storyboard must actually change to video and portrait' }).toBe(true)
  const after = await readPlan()
  expect(after.plan.shots.map(shot => shot.shotId)).toEqual(before.plan.shots.map(shot => shot.shotId))
  expect(walk.fixture.images).toHaveLength(0)
  expect(walk.fixture.videos).toHaveLength(0)
  await walk.snap('storyboard-agent-bulk-edited-without-generation')
  walk.report.storyboardBulk = { selected: 3, originalPlanChanged: true, mediaPosts: 0 }
}
