import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTempDir } from './_test-temp.mjs'
import * as checker from './check-dispatch-brief.mjs'
import { checkDispatchBrief, roundNumber } from './check-dispatch-brief.mjs'

const GOOD = '范围：只改 src/a。不碰：%APPDATA%。停点：样张出来就停。'

describe('派工书检查', () => {
  test('只写范围、不碰清单、停点即可通过', () => assert.deepEqual(checkDispatchBrief(GOOD), []))
  test('缺哪件报哪件', () => {
    assert.equal(checkDispatchBrief('范围：x').length, 2)
    assert.match(checkDispatchBrief('范围 不碰 x').join(), /停点/)
  })
  test('轮次识别：阿拉伯数字与中文', () => {
    assert.equal(roundNumber('这是第 5 轮修补'), 5)
    assert.equal(roundNumber('第五轮'), 5)
    assert.equal(roundNumber('第十二轮'), 12)
    assert.equal(roundNumber('没有轮次'), 0)
  })
  test('第 3 轮及以上必须引用方向检查复盘；第 2 轮不要求', () => {
    assert.match(checkDispatchBrief(`${GOOD} 第三轮修补`).join(), /第 3 轮/)
    assert.deepEqual(checkDispatchBrief(`${GOOD} 第三轮修补，见类根因复盘 docs/x.md`), [])
    assert.match(checkDispatchBrief(`${GOOD} 第五轮修补`).join(), /第 5 轮/)
    assert.deepEqual(checkDispatchBrief(`${GOOD} 第五轮修补，依据 Direction-Check 复盘 docs/x.md`), [])
    assert.deepEqual(checkDispatchBrief(`${GOOD} 第二轮`), [])
  })
  test('模型可见工具改动没引用清单则红', () => {
    assert.match(checkDispatchBrief(`${GOOD} 新增一个模型可见工具`).join(), /model-facing-tool-checklist\.md/)
  })
  test('模型可见工具改动引用清单则过', () => {
    assert.deepEqual(checkDispatchBrief(`${GOOD} 新增一个模型可见工具，先读 docs/engineering/model-facing-tool-checklist.md`), [])
    assert.deepEqual(checkDispatchBrief(`${GOOD} 改 verbDeclarations 的 tool schema，见 model-facing-tool-checklist.md`), [])
  })
  test('非工具类任务不要求清单', () => {
    assert.deepEqual(checkDispatchBrief(`${GOOD} 修改项目库文案`), [])
  })
  test('工具栏和工具条不误伤', () => {
    assert.deepEqual(checkDispatchBrief(`${GOOD} 调整工具栏和工具条布局`), [])
  })
})


const DELETE_INSTRUCTION = '1. `grep -rn "foo"` 全仓，列出所有出现的地方，逐处删或改。'

describe('删除决策与归属范围', () => {
  test('实现线缺删掉答案时报缺项', () => {
    assert.match(checkDispatchBrief(GOOD, { implementation: true }).join(), /缺「删掉：」/)
  })
  for (const answer of ['选，移除无用入口', '不选，保留必要能力']) {
    test(`实现线有删掉答案可通过：${answer}`, () => {
      assert.deepEqual(checkDispatchBrief(`${GOOD}\n删掉：${answer}`, { implementation: true }), [])
    })
  }
  test('非实现线不要求删掉答案', () => {
    assert.deepEqual(checkDispatchBrief(GOOD, { implementation: false }), [])
  })
  for (const [file, text, expected] of [
    ['I-a.md', '# 普通任务', true],
    ['V-a.md', '# 实现线任务', true],
    ['V-a.md', '# 验收线任务\n实现线另见其它任务', false],
  ]) {
    test(`实现线分类：${file} ${text.split('\n')[0]}`, () => {
      assert.equal(typeof checker.isImplementationBrief, 'function')
      assert.equal(checker.isImplementationBrief(text, file), expected)
    })
  }
  test('直接指令搜到就删应拦截', () => {
    assert.match(checkDispatchBrief(`${GOOD}\n${DELETE_INSTRUCTION}`).join(), /搜到就删/)
  })
  for (const [name, example] of [
    ['引号', `「${DELETE_INSTRUCTION}」`],
    ['代码块', `\`\`\`text\n${DELETE_INSTRUCTION}\n\`\`\``],
  ]) {
    test(`${name}中的反面例子不拦截`, () => {
      assert.deepEqual(checkDispatchBrief(`${GOOD}\n${example}`), [])
    })
  }
  for (const instruction of [
    '引用：全仓 `git grep` 指向已删文件的路径，应只剩指向 README 的引用',
    '逐处改掉并删除 `scripts/x.json` 里的待补条目',
    '最后 `git grep -n foo`，剩下的只能是不许动清单里的',
  ]) {
    test(`按归属删除与最后核对可通过：${instruction}`, () => {
      assert.deepEqual(checkDispatchBrief(`${GOOD}\n${instruction}`), [])
    })
  }
  test('只许改可作为范围声明', () => {
    assert.deepEqual(checkDispatchBrief('## 只许改这些文件\nsrc/a\n不碰：其它。停点：完成就停。'), [])
    assert.deepEqual(checkDispatchBrief('## 范围：只许改这些文件\n不碰：其它。停点：完成就停。'), [])
  })
})

const HOOK = fileURLToPath(new URL('./claude-hooks/dispatch-brief-gate.sh', import.meta.url))
function runHook(prompt) {
  return spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_name: 'Agent', tool_input: { prompt } }),
    encoding: 'utf8',
    timeout: 1000,
  })
}
function writeBrief(text) {
  const dir = path.join(makeTempDir('dispatch-brief'), 'briefs', 'x')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'I-a.md')
  fs.writeFileSync(file, text)
  return file
}

describe('Claude 派线执行点', () => {
  test('引用缺停点的任务书时阻断并给出缺项', () => {
    const file = writeBrief('范围：src/a。不碰：其它。\n删掉：不选，保留必要能力。')
    const result = runHook(`读任务书 ${file}，再核对 ${file}`)
    assert.equal(result.error, undefined)
    assert.equal(result.status, 2)
    assert.match(result.stderr, /缺停点/)
    assert.equal(result.stderr.match(/派工书检查：/g)?.length, 1)
  })
  test('引用齐全任务书时放行', () => {
    const result = runHook(`读任务书 ${writeBrief(`${GOOD}\n删掉：不选，保留必要能力。`)}`)
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0)
  })
  test('未引用任务书路径时放行', () => {
    assert.equal(runHook('请分析这个问题').status, 0)
  })
  test('引用不存在任务书时放行', () => {
    const file = path.join(makeTempDir('dispatch-brief'), 'briefs', 'x', 'I-missing.md')
    assert.equal(runHook(`读任务书 ${file}`).status, 0)
  })
})
