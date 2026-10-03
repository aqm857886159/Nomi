// Director localized-edit acceptance: cold boot in English, then create and rename a character.
// Run with: NOMI_DIRECTOR_LOCALE=en node tests/ux/director-locale-edit.walk.mjs
import { clickOrFail, expectVisible, launchDirectorLab } from './_directorLab.mjs'

if (process.env.NOMI_DIRECTOR_LOCALE !== 'en') throw new Error('Set NOMI_DIRECTOR_LOCALE=en for this walk')

const lab = await launchDirectorLab({ name: 'locale-edit-en' })
const { page, check } = lab

try {
  const locale = await page.evaluate(() => document.documentElement.lang)
  const editorText = await page.getByTestId('director-editor').innerText()
  check(
    'English locale is active in the Director editor',
    locale === 'en' && editorText.includes('Scene objects') && !editorText.includes('场景对象'),
  )

  await clickOrFail(page.getByTestId('director-add-menu'), 'Add menu')
  await clickOrFail(page.getByRole('button', { name: 'Character', exact: true }), 'Add menu · Character')
  await clickOrFail(page.getByRole('button', { name: 'Woman', exact: true }), 'Character menu · Woman')
  const ground = await lab.bridge('projectPoint', 0, 0, 0)
  await page.mouse.click(ground.x, ground.y)
  await lab.waitScene("s.objects.filter(o => o.type === 'character').length === 1", 'English character created')

  const row = lab.outlinerRow('Character 1')
  await expectVisible(row, 'English character row')
  await row.click()
  await expectVisible(page.getByRole('radio', { name: 'Basics', exact: true }), 'English character inspector')
  const nameField = page.getByRole('textbox', { name: 'Name', exact: true })
  await nameField.fill('Lead')
  await nameField.press('Enter')
  await lab.waitScene("s.objects.some(o => o.type === 'character' && o.name === 'Lead')", 'English rename committed')
  check('English localized edit commits a renamed character', true)
  await lab.snap('english-renamed-character')
} catch (error) {
  check(`Journey interrupted: ${String(error.message || error).split('\n')[0]}`, false)
} finally {
  await lab.finish()
}
