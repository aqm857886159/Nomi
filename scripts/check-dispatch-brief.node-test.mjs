import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
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
