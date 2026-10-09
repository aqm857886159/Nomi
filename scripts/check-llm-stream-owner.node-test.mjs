import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { makeTempDir } from './_test-temp.mjs'
import { bannedAccesses, scan } from './check-llm-stream-owner.mjs'

const hit = (source) => bannedAccesses(source).length > 0

// 每一种绕法各一个夹具，门岗都必须红。
const BYPASSES = {
  '具名导入': 'import { streamText } from "ai";',
  '具名导入 + 改名': "import { generateText as gen, APICallError } from 'ai'",
  '多行具名导入': 'import {\n  streamObject,\n  APICallError,\n} from "ai";',
  '命名空间导入取成员': "import * as ai from 'ai'\nai.streamText(options)",
  '命名空间导入取成员（方括号）': "import * as ai from 'ai'\nai['generateText'](options)",
  '命名空间整个流出去（赋值）': "import * as ai from 'ai'\nconst alias = ai\nalias.streamText(o)",
  '命名空间整个流出去（传参）': "import * as ai from 'ai'\nuse(ai)",
  '命名空间导出': "import * as ai from 'ai'\nexport { ai }",
  '默认导入': "import ai from 'ai'\nai.streamText(o)",
  'import x = require': "import ai = require('ai')",
  'require 解构': "const { streamText } = require('ai')",
  'require 整个模块': 'const ai = require("ai")',
  '动态 import 解构': "const { streamText } = await import('ai')",
  '动态 import then': "import('ai').then((m) => m.streamText(o))",
  '具名重导出': "export { streamText } from 'ai'",
  '具名重导出 + 改名': 'export { generateText as run } from "ai"',
  '全量重导出': "export * from 'ai'",
  '命名空间重导出': "export * as sdk from 'ai'",
}

for (const [name, source] of Object.entries(BYPASSES)) {
  test(`绕法必红：${name}`, () => assert.equal(hit(source), true, source))
}

// 不误报：只引类型 / 错误类 / generateObject / 注释字符串 / 同名局部函数 / 命名空间只取非禁名。
const ALLOWED = {
  '类型导入': 'import type { LanguageModelV1 } from "ai";',
  '错误类': 'import { APICallError, RetryError } from "ai";',
  'generateObject': 'import { generateObject } from "ai";',
  '类型限定的具名': 'import { type streamText } from "ai"',
  '注释里提到': '// import { streamText } from "ai"\nconst x = 1',
  '字符串里提到': 'const s = `import { streamText } from "ai"`',
  '自己的 streamTextTask': 'import { streamTextTask } from "./streamTextTask";',
  '同名局部函数': 'function streamText() {}\nstreamText()',
  '命名空间只取非禁名': "import * as ai from 'ai'\nai.generateObject(o)",
  '别的包的 streamText': 'import { streamText } from "other-sdk"',
  '类型重导出': "export type { streamText } from 'ai'",
}

for (const [name, source] of Object.entries(ALLOWED)) {
  test(`不误报：${name}`, () => assert.deepEqual(bannedAccesses(source), []))
}

test('扫盘：owner 自己放行，别的文件（含 .mjs）任何绕法都红，测试文件不算', () => {
  const root = makeTempDir('llm-owner-')
  const put = (rel, body) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body) }
  put('electron/ai/streamTextTask.ts', 'import { streamText } from "ai"')
  put('electron/other/rogue.ts', 'export * from "ai"')
  put('src/x/rogue.mjs', 'const m = await import("ai")')
  put('electron/other/rogue.test.ts', 'import { streamText } from "ai"')
  assert.deepEqual(scan(root).map((entry) => entry.file).sort(), ['electron/other/rogue.ts', 'src/x/rogue.mjs'])
})
