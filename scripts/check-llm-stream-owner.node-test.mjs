import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { bannedImports, scan } from './check-llm-stream-owner.mjs'

test('阳性对照：直接引入 streamText / generateText 被报出来', () => {
  assert.deepEqual(bannedImports(`import { streamText } from "ai";`), ['streamText'])
  assert.deepEqual(bannedImports(`import { generateObject, generateText as gen } from 'ai'`), ['generateText'])
  assert.deepEqual(bannedImports(`import {\n  streamObject,\n  APICallError,\n} from "ai";`), ['streamObject'])
  assert.deepEqual(bannedImports(`const { streamText } = require('ai')`), ['require("ai")'])
})

test('不误报：只引类型 / 错误类 / generateObject / 注释里提到', () => {
  assert.deepEqual(bannedImports(`import type { LanguageModelV1 } from "ai";`), [])
  assert.deepEqual(bannedImports(`import { APICallError, RetryError } from "ai";`), [])
  assert.deepEqual(bannedImports(`import { generateObject } from "ai";`), [])
  assert.deepEqual(bannedImports(`// import { streamText } from "ai"\nconst x = 1`), [])
  assert.deepEqual(bannedImports(`import { streamTextTask } from "./streamTextTask";`), [])
})

test('扫盘：owner 自己放行，别的文件直接引入就红，测试文件不算', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-owner-'))
  try {
    const put = (rel, body) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body) }
    put('electron/ai/streamTextTask.ts', 'import { streamText } from "ai"')
    put('electron/other/rogue.ts', 'import { streamText } from "ai"')
    put('electron/other/rogue.test.ts', 'import { streamText } from "ai"')
    assert.deepEqual(scan(root), [{ file: 'electron/other/rogue.ts', names: ['streamText'] }])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
