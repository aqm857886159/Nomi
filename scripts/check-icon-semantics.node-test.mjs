/**
 * icon 语义门岗的自测：**先证明它会红**（R17），再证明它不乱红。
 *
 * 一道从没红过的门岗和一道不存在的门岗，在 CI 输出里长得一模一样。
 * 这里锁的是三条「长得像漂移、其实不是」的排除——它们是这道门岗唯一微妙的部分，
 * 一旦悄悄失效，门岗要么天天假红被人 --update-baseline 掉，要么漏掉真漂移。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { conflictId, findConflicts, scanIconSemantics } from './check-icon-semantics.mjs'

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-semantics-'))
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  return dir
}

const scan = (files) => findConflicts(scanIconSemantics(fixture(files), ['src']))

test('会红：同一动作在两处配了不同图标', () => {
  const conflicts = scan({
    'src/A.tsx': `import { IconLink } from '@tabler/icons-react'
export const A = () => <button aria-label={t('lib.paste')}><IconLink /></button>`,
    'src/B.tsx': `import { IconTrashX } from '@tabler/icons-react'
export const B = () => <button aria-label={t('lib.paste')}><IconTrashX /></button>`,
  })
  assert.equal(conflicts.length, 1)
  assert.equal(conflictId(conflicts[0]), 'lib.paste → IconLink/IconTrashX')
})

test('不乱红①：容器的 aria-label 不算动作身份（role=dialog + stopPropagation 的弹层）', () => {
  // 真实假红来源：TimelineTransitionPicker 的外壳 <div role="dialog" aria-label onClick>，
  // 一旦把它当控件，弹层里所有图标都会被算成「同一动作的多个图标」。
  const conflicts = scan({
    'src/P.tsx': `import { IconCheck, IconTrash } from '@tabler/icons-react'
export const P = () => (
  <div role="dialog" aria-label={t('picker.title')} onClick={(e) => e.stopPropagation()}>
    <button aria-label={t('picker.select')}><IconCheck /></button>
    <button aria-label={t('picker.remove')}><IconTrash /></button>
  </div>)`,
  })
  assert.deepEqual(conflicts, [])
})

test('不乱红②：同一三元里的两个图标是状态切换，不是漂移', () => {
  const conflicts = scan({
    'src/D.tsx': `import { IconDownload, IconLoader2 } from '@tabler/icons-react'
export const D = ({ busy }) => (
  <button aria-label={t('asset.download')}>{busy ? <IconLoader2 /> : <IconDownload />}</button>)`,
  })
  assert.deepEqual(conflicts, [])
})

test('不乱红③：chevron 这类示能图标不参与语义比对', () => {
  const conflicts = scan({
    'src/C.tsx': `import { IconChevronDown, IconVideo } from '@tabler/icons-react'
export const C = () => (
  <button aria-label={t('camera.move')}><IconVideo /><IconChevronDown /></button>)`,
  })
  assert.deepEqual(conflicts, [])
})

test('仍然会红：同一按钮里两个语义图标（不是示能、不是三元）', () => {
  const conflicts = scan({
    'src/E.tsx': `import { IconCube, IconMaximize } from '@tabler/icons-react'
export const E = () => (
  <button aria-label={t('scene.open')}><IconCube /><IconMaximize /></button>)`,
  })
  assert.equal(conflicts.length, 1)
})
