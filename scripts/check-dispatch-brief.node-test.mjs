import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTempDir } from './_test-temp.mjs'
import * as checker from './check-dispatch-brief.mjs'
import { checkDispatchBrief, roundNumber } from './check-dispatch-brief.mjs'

const SELF_CHECK = '\n## 自验\n设计卡 ★9 每条反例改坏 → 红、还原 → 绿，日志进报告。'

const GOOD = '范围：只改 src/a。不碰：%APPDATA%。停点：完成就停。'

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
      assert.deepEqual(checkDispatchBrief(`${GOOD}\n删掉：${answer}${SELF_CHECK}`, { implementation: true }), [])
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
    const result = runHook(`读任务书 ${writeBrief(`${GOOD}\n删掉：不选，保留必要能力。${SELF_CHECK}`)}`)
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

const IMPLEMENTATION = { implementation: true }
const IMPLEMENTATION_GOOD = `${GOOD}\n删掉：不选，保留必要能力。`

describe('反例红绿前移', () => {
  test('实现任务缺自验要求时拦截并解释补法', () => {
    assert.match(checkDispatchBrief(IMPLEMENTATION_GOOD, IMPLEMENTATION).join(), /自验.*设计卡.*★9.*每条反例.*改坏.*红.*还原.*绿.*日志.*报告/)
  })
  test('要求齐全时通过；非实现任务不强制红绿合同', () => {
    assert.deepEqual(checkDispatchBrief(IMPLEMENTATION_GOOD + SELF_CHECK, IMPLEMENTATION), [])
    assert.deepEqual(checkDispatchBrief(GOOD), [])
  })
  for (const missing of ['★9', '每条', '反例', '改坏', '红', '还原', '绿', '日志', '报告']) {
    test(`自验缺 ${missing} 时不通过`, () => {
      assert.match(checkDispatchBrief(IMPLEMENTATION_GOOD + SELF_CHECK.replace(missing, ''), IMPLEMENTATION).join(), /缺反例红绿/)
    })
  }
  test('自验外写同样要求不算自验合同', () => {
    assert.match(checkDispatchBrief(IMPLEMENTATION_GOOD + SELF_CHECK.replace('## 自验', '## 说明'), IMPLEMENTATION).join(), /缺反例红绿/)
    assert.match(checkDispatchBrief(IMPLEMENTATION_GOOD + '\n## 自验\n跑测试\n## 报告' + SELF_CHECK.split('\n').slice(2).join('\n'), IMPLEMENTATION).join(), /缺反例红绿/)
  })
  for (const declaration of ['纯测试', '纯文档', '纯配置', '任务类型：纯测试 / 文档 / 配置', '范围：只改测试、文档']) {
    test(`明确声明可以豁免：${declaration}`, () => {
      assert.deepEqual(checkDispatchBrief(`${IMPLEMENTATION_GOOD}\n${declaration}`, IMPLEMENTATION), [])
    })
  }
  test('提到纯文档或混合代码任务不能冒充豁免', () => {
    for (const declaration of ['参考纯文档任务的写法', '纯文档 + 代码', '范围：只改 src/a.ts，另补纯测试']) {
      assert.match(checkDispatchBrief(`${IMPLEMENTATION_GOOD}\n${declaration}`, IMPLEMENTATION).join(), /缺反例红绿/)
    }
  })
})

function churnRepo() {
  const root = makeTempDir('dispatch-churn')
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(root, 'no-global-config'), GIT_CONFIG_NOSYSTEM: '1' } })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git('init', '-q')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'user.name', 'test')
  git('config', 'core.hooksPath', path.join(root, 'no-hooks'))
  const put = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), value)
  }
  const commit = (subject) => { git('add', '.'); git('commit', '-qm', subject) }
  put('src/feature/hot.ts', 'export const value = 0\n')
  put('src/feature/neighbor.ts', 'export const neighbor = 0\n')
  put('src/cold/cold.ts', 'export const cold = 0\n')
  commit('chore: initial sources')
  put('src/feature/hot.ts', 'export const value = 1\n'); commit('fix: first repair')
  put('src/feature/hot.ts', 'export const value = 2\n'); commit('fix: second repair')
  const ref = git('rev-parse', 'HEAD')
  git('update-ref', 'refs/remotes/origin/main', ref)
  return { root, ref, git, put, commit }
}

const CHURN = churnRepo()
const scopeBrief = (files) => `${IMPLEMENTATION_GOOD}${SELF_CHECK}\n## 范围\n${files.map((f) => `- \`${f}\``).join('\n')}\n## 不碰清单\n其它文件。`
const DIRECTION_REF = '\n先读 docs/engineering/direction-checks/approved.md。'

describe('碰热点先方向检查', () => {
  test('真实 Git 热点缺方向文档时拦截，补引用通过', () => {
    const text = scopeBrief(['src/feature/hot.ts'])
    assert.match(checkDispatchBrief(text, { ...IMPLEMENTATION, root: CHURN.root }).join(), /src\/feature\/hot\.ts[\s\S]*先派独立方向检查/)
    assert.deepEqual(checkDispatchBrief(text + DIRECTION_REF, { ...IMPLEMENTATION, root: CHURN.root }), [])
    assert.match(checkDispatchBrief(text + '\n已做方向检查', { ...IMPLEMENTATION, root: CHURN.root }).join(), /先派独立方向检查/)
  })
  test('真实 Git 冷文件通过，目录热点提示不拦', () => {
    const warnings = []
    assert.deepEqual(checkDispatchBrief(scopeBrief(['src/cold/cold.ts']), { ...IMPLEMENTATION, root: CHURN.root, warnings }), [])
    assert.equal(warnings.length, 0)
    assert.deepEqual(checkDispatchBrief(scopeBrief(['src/feature/neighbor.ts']), { ...IMPLEMENTATION, root: CHURN.root, warnings }), [])
    assert.match(warnings.join(), /仅提示.*目录[\s\S]*src\/feature\/neighbor\.ts/)
  })
  test('范围节内明确不在范围的文件不送热点检查', () => {
    const text = scopeBrief(['src/cold/cold.ts']).replace('\n## 不碰清单', '\n不在范围：`src/feature/hot.ts`\n## 不碰清单')
    assert.deepEqual(checkDispatchBrief(text, { ...IMPLEMENTATION, root: CHURN.root }), [])
  })
  test('固定 ref 不受后续修复提交影响', () => {
    CHURN.put('src/cold/cold.ts', 'export const cold = 1\n'); CHURN.commit('fix: later cold repair')
    CHURN.put('src/cold/cold.ts', 'export const cold = 2\n'); CHURN.commit('fix: another later cold repair')
    const text = scopeBrief(['src/cold/cold.ts'])
    assert.deepEqual(checkDispatchBrief(text, { ...IMPLEMENTATION, root: CHURN.root, ref: CHURN.ref }), [])
    assert.match(checkDispatchBrief(text, { ...IMPLEMENTATION, root: CHURN.root, ref: 'HEAD' }).join(), /先派独立方向检查/)
  })
  test('范围外路径、绝对路径、目录、不存在文件不送热点检查', () => {
    const text = scopeBrief(['src/feature/missing.ts', 'src/feature/', path.join(CHURN.root, 'src/feature/hot.ts'), '../src/feature/hot.ts']) + '\n## 报告\n`src/feature/hot.ts`'
    assert.deepEqual(checkDispatchBrief(text, { ...IMPLEMENTATION, root: CHURN.root }), [])
  })
  test('概念热点只提示，复用计数器登记', () => {
    CHURN.put('docs/engineering/concept-owners/_meta.json', '{}')
    CHURN.put('docs/engineering/concept-owners/dispatch.test.json', JSON.stringify({ subject: 'dispatch.test', name: '跨文件概念', owner: { path: 'src/feature/hot.ts' }, write_api: [{ path: 'src/cold/cold.ts' }] }))
    const warnings = []
    assert.deepEqual(checkDispatchBrief(scopeBrief(['src/cold/cold.ts']), { ...IMPLEMENTATION, root: CHURN.root, warnings }), [])
    assert.match(warnings.join(), /仅提示[\s\S]*跨文件概念/)
  })
})

const DESIGN_REF = '\n先读 docs/design/nomi-design-system.md#1。'
describe('界面先对设计系统', () => {
  for (const trigger of ['界面', '样张', '拍板']) {
    test(`正文提到${trigger}，缺引用拦截，补章节引用通过`, () => {
      assert.match(checkDispatchBrief(`${GOOD} ${trigger}`).join(), /缺设计系统引用.*docs\/design\/nomi-design-system\.md/)
      assert.deepEqual(checkDispatchBrief(`${GOOD} ${trigger}${DESIGN_REF}`), [])
    })
  }
  test('范围里的 src tsx 文件要求设计系统引用，即使还未建文件', () => {
    const text = scopeBrief(['src/ui/NewPanel.tsx'])
    assert.match(checkDispatchBrief(text, IMPLEMENTATION).join(), /缺设计系统引用/)
    assert.deepEqual(checkDispatchBrief(text + DESIGN_REF, IMPLEMENTATION), [])
  })
  test('非界面文件、范围以外的 tsx 不误拦', () => {
    assert.deepEqual(checkDispatchBrief(scopeBrief(['src/logic.ts', 'electron/Window.tsx', 'src/ui/Panel.test.tsx']) + '\n## 说明\n`src/ui/Panel.tsx`', IMPLEMENTATION), [])
  })
  test('流程里的用户拍板和明确不在范围的界面不误拦', () => {
    assert.deepEqual(checkDispatchBrief(`${GOOD}\n用户拍板：删掉无用目录。\n不在范围：界面文案。`), [])
    assert.match(checkDispatchBrief(`${GOOD} 用户拍板界面样张。`).join(), /缺设计系统引用/)
  })
  test('CLI 和 Claude 钩子都拦实现任务缺反例红绿与设计引用', () => {
    const file = writeBrief(`${IMPLEMENTATION_GOOD}\n调整界面。`)
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./check-dispatch-brief.mjs', import.meta.url)), file], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /缺反例红绿/)
    assert.match(result.stderr, /缺设计系统引用/)
    const hooked = runHook(`读任务书 ${file}`)
    assert.equal(hooked.status, 2)
    assert.match(hooked.stderr, /缺反例红绿/)
    assert.match(hooked.stderr, /缺设计系统引用/)
    fs.writeFileSync(file, `${IMPLEMENTATION_GOOD}\n调整界面。${SELF_CHECK}${DESIGN_REF}`)
    assert.equal(runHook(`读任务书 ${file}`).status, 0)
  })
})
