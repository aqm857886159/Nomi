#!/usr/bin/env node
// 提交闸（scripts/claude-hooks/commit-bypass-check.sh）的行为测试。
//
// 为什么值得为一个 hook 写测试：它的失效是**静默**的——放行了一次绕过 pre-commit 的提交，
// 输出和正常放行一模一样，只有事后（或者永远不）才看得见，而代价是敏感数据永久进历史。
// `check:claude-hooks` 只拦「装的和仓里的不一致」，拦不住「仓里那份逻辑本身错了」。
//
// 开发本闸门时，两个**分列**的坑各自让全部拦截静默失效，两次都是「hook 正常退出 0」：
//   ① 用 TAB 当 IFS 分隔符——tab 是 IFS whitespace，`read` 折叠连续分隔符并吃掉空字段，
//      于是「选项列为空、配置列有值」的 `git -c core.hooksPath=… cherry-pick` 把配置读进了选项列；
//   ② 改用 \001——bash 内部拿它当 CTLESC，`read` 直接把它吃掉，一列都不分。
// 这两次都只有「跑真 hook 看退出码」测得到，读源码是读不出来的。所以这里测的是**判决**
// （exit 2 = 拒绝 / exit 0 = 放行），不是实现细节：怎么分列、用什么正则都可以改。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'

const hookDir = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(hookDir, 'commit-bypass-check.sh')

/** 跑一次真实 hook，喂真实的 PreToolUse 载荷。返回退出码（2 = 拒绝）。 */
function verdict(command, cwd = '/tmp/nomi-commit-guard-probe') {
  const result = spawnSync('bash', [HOOK], {
    input: Buffer.from(JSON.stringify({ cwd, tool_name: 'Bash', tool_input: { command } }), 'utf8'),
    env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
  })
  return { status: result.status, stderr: (result.stderr || Buffer.alloc(0)).toString('utf8') }
}

const denied = (command) => {
  const { status, stderr } = verdict(command)
  assert.equal(status, 2, `应当拒绝但没拒绝：${command}\n${stderr}`)
  // 拒绝必须带人话说明「为什么」和「正确做法」——只有退出码的闸门会被当成故障绕过去。
  assert.match(stderr, /提交闸门/, `拒绝时没给说明：${command}`)
  assert.match(stderr, /正确做法/, `拒绝时没给正确做法：${command}`)
}
const allowed = (command) => {
  const { status, stderr } = verdict(command)
  assert.equal(status, 0, `应当放行但被拦了：${command}\n${stderr}`)
}

describe('提交闸：五种绕过写法一律拒绝（不是留痕）', () => {
  test('① git -c core.hooksPath= —— 今天两个子 agent 实际写出的那条', () => {
    denied('git -c core.hooksPath=.git/hooks commit -m "wip"')
    denied('git -c core.hooksPath=/dev/null commit -m "wip"')
    // 前面还有别的全局选项 / 别的命令，一样要认出来。
    denied('git --no-pager -c core.hooksPath=/dev/null commit -m "wip"')
    denied('git add -A && git -c core.hooksPath=/dev/null commit -m "wip"')
  })

  test('② --no-verify', () => {
    denied('git commit --no-verify -m "wip"')
    denied('git -C /some/tree commit --no-verify -m "wip"')
    // 前面挂了别的短选项也不能把它挤掉（`-s` 不带值，不该吞掉后一个 token）。
    denied('git commit -s --no-verify')
  })

  test('③ -n（commit 的短写法）', () => {
    denied('git commit -n -m "wip"')
    denied('git commit -nm "wip"')
  })

  test('④ HUSKY=0 一类钩子管理器开关（前置环境赋值）', () => {
    denied('HUSKY=0 git commit -m "wip"')
    denied('env HUSKY=0 git commit -m "wip"')
    denied('SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "wip"')
  })

  test('⑤ core.hooksPath 的环境变量覆盖形式', () => {
    denied(
      'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m "wip"',
    )
  })

  test('其它会产生提交的子命令同样覆盖（不只 commit）', () => {
    denied('git -c core.hooksPath=/dev/null merge --continue')
    denied('git -c core.hooksPath=/dev/null cherry-pick abc123')
    denied('cd /tmp && git -c core.hooksPath=/dev/null revert HEAD')
    denied('git -c core.hooksPath=/dev/null rebase --continue')
    denied('git -c core.hooksPath=/dev/null am patch.mbox')
    denied('git -c core.hooksPath=/dev/null pull --rebase=false')
  })

  test('git commit-tree 天生不跑 hook —— 不需要任何标志就是绕口', () => {
    denied('git commit-tree abc123 -p HEAD')
  })
})

describe('提交闸：正常提交必须畅通（会误报的闸门几次之后就被绕过 = 等于不存在）', () => {
  test('普通提交放行', () => {
    allowed('git commit -m "fix: 修根因"')
    allowed('git add -A && git commit -m "fix: 修根因"')
    allowed('git commit -am "fix: 修根因"')
    allowed('git merge --continue')
    allowed('git rebase --continue')
    allowed('git status')
    allowed('git push -u origin HEAD')
  })

  test('-n 只在 commit 上是 --no-verify —— 别的子命令上是另一个意思，不能误伤', () => {
    allowed('git merge -n origin/main')       // --no-stat
    allowed('git cherry-pick -n abc123')      // --no-commit（压根不产生提交）
    allowed('git log -n 5')
  })

  test('push 那条维持现状：留痕 + 审计，不由本闸门拒绝', () => {
    allowed('git push --no-verify origin HEAD')
    allowed('git -c core.hooksPath=/dev/null push origin HEAD')
  })
})

describe('提交闸：边界——这些字样出现在**提交信息或数据里**不算绕过', () => {
  test('提交信息里写了这些词，不误伤', () => {
    allowed('git commit -m "docs: 说明为什么禁用 --no-verify"')
    allowed('git commit -m "--no-verify"')
    allowed('git commit -am "--no-verify"')
    allowed('git commit -m "-n"')
    allowed('git commit -m "chore: 移除 core.hooksPath 逃生口"')
    allowed('git commit -F /tmp/--no-verify.txt')
  })

  test('`--` 之后是 pathspec，不是选项', () => {
    allowed('git commit -m "msg" -- --no-verify.md')
  })

  test('引号里的词组不是命令（只读命令不该被拦）', () => {
    allowed('echo "git commit --no-verify"')
    allowed('grep -rn "core.hooksPath" docs/')
    allowed('cat docs/lessons/commit-bypass-must-be-blocked-not-audited.md')
  })
})

describe('提交闸：读不懂命令时 fail-closed', () => {
  test('引号不配对 + 出现绕过痕迹 → 拦（不猜）', () => {
    denied('git commit -m "未闭合 --no-verify')
  })

  test('引号不配对但没有绕过痕迹 → 放行（不当拦路虎）', () => {
    allowed('echo "未闭合')
  })
})
