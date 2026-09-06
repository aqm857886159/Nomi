// 门岗自己的测试：R17 那条「加规则必须先验它会红」的机器化版本。
//
// 一道从来没红过的门岗和一道不存在的门岗，在 CI 输出里长得一模一样。这里同时钉两头：
// 真违规必须被抓到，两种合法写法必须放过——后者尤其重要，一次误报就会有人来把规则关掉。
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { scanSource, stripCommentsAndTemplates } from './check-main-console.mjs'

test('抓得住真正的 console 调用', () => {
  const hits = scanSource(['const a = 1', 'console.error("boom", err)', 'const b = 2'].join('\n'))
  assert.equal(hits.length, 1)
  assert.equal(hits[0].line, 2)
})

test('各种 console 方法都算', () => {
  for (const method of ['log', 'warn', 'error', 'info', 'debug', 'trace']) {
    assert.equal(scanSource(`console.${method}('x')`).length, 1, method)
  }
})

test('赋值形态放过：mcpStdioServer 把第三方输出从 stdout 赶到 stderr 是保护，不是日志调用', () => {
  assert.equal(scanSource(['console.log = toErr', 'console.info = toErr'].join('\n')).length, 0)
})

test('模板串里的放过：那是注入进 BrowserView 页面执行的脚本，不是主进程代码', () => {
  const source = ['const script = `', "  try { console.info(prefix); } catch {}", '`;'].join('\n')
  assert.equal(scanSource(source).length, 0)
})

test('注释里的放过', () => {
  assert.equal(scanSource('// 从前这里是 console.error(x)').length, 0)
  assert.equal(scanSource(['/*', ' * console.warn(x)', ' */'].join('\n')).length, 0)
})

test('抹除逐行等高——行号一挪，报出来的 file:line 点开就是别的地方', () => {
  const source = ['/*', ' * block', ' */', '// line', 'const t = `a', 'b`', 'console.log(1)'].join('\n')
  assert.equal(stripCommentsAndTemplates(source).split('\n').length, source.split('\n').length)
  assert.equal(scanSource(source)[0].line, 7)
})
