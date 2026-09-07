// Claude hook 注册判据的测试（R17：加规则先证明它会红）。
//
// 为什么这道判据必须有测试：install-claude-hooks.cjs 在 root-cause-contracts.mjs 的高风险名单里，
// 收的是同一个风险形状——**静默失效**。闸门没挂上和闸门放行长得一模一样，只有断言能把两者分开。
import assert from 'node:assert/strict'
import test from 'node:test'
import registry from './claude-hooks-registry.cjs'

const { BLOCKING, guardedCommand, hookKind, referencedScript, validateRegistration } = registry

/** 拦截型脚本的最小正文：把 `exit 2` 当拒绝通道（分型由正文推出，不另立名单）。 */
const BLOCKING_SRC = '#!/usr/bin/env bash\n# 抬头注释里也写 block(exit 2)，注释不算实现\nexit 2\n'
/** 提示型脚本的最小正文：从不 exit 2。 */
const ADVISORY_SRC = '#!/usr/bin/env bash\nexit 0\n'

const BYPASS = 'scripts/claude-hooks/commit-bypass-check.sh'
const GUARD = 'scripts/claude-hooks/handoff-read.sh'

function settingsWith(...commands) {
  return {
    hooks: {
      PreToolUse: [{
        matcher: 'Bash',
        hooks: commands.map((command) => ({ type: 'command', command })),
      }],
    },
  }
}

const GOOD = {
  settings: settingsWith(guardedCommand(BYPASS, 'blocking')),
  requiredScripts: ['commit-bypass-check.sh'],
  existingScripts: [BYPASS],
  scriptSources: { [BYPASS]: BLOCKING_SRC },
  legacyCopies: 0,
}

test('全都挂上、脚本都在、没有旧副本 → 绿', () => {
  assert.deepEqual(validateRegistration(GOOD), [])
})

test('settings.json 缺失 → 红（现在它进 git，checkout 就该有）', () => {
  const problems = validateRegistration({ ...GOOD, settings: null })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /缺失: \.claude\/settings\.json/)
})

test('指向 .claude/hooks/ 那种「装了才有」的路径 → 红', () => {
  const settings = settingsWith('bash "$CLAUDE_PROJECT_DIR/.claude/hooks/commit-bypass-check.sh"')
  const problems = validateRegistration({ ...GOOD, settings })
  assert.ok(problems.some((problem) => /装了才有的闸门不是闸门/.test(problem)))
  assert.ok(problems.some((problem) => /没有被 \.claude\/settings\.json 注册/.test(problem)))
})

test('写了脚本却没挂上 → 红（这是旧的逐字节比对拦不住的那一类）', () => {
  const problems = validateRegistration({
    ...GOOD,
    requiredScripts: ['commit-bypass-check.sh', 'secret-guard.sh'],
    existingScripts: [...GOOD.existingScripts, 'scripts/claude-hooks/secret-guard.sh'],
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /secret-guard\.sh 没有被/)
})

test('挂了一个不存在的脚本 → 红', () => {
  const problems = validateRegistration({ ...GOOD, existingScripts: [] })
  assert.ok(problems.some((problem) => /指向的脚本不存在/.test(problem)))
})

test('共享设置里出现机器本地键 → 红（进了 git 就污染所有人）', () => {
  const settings = { ...GOOD.settings, env: { MAX_THINKING_TOKENS: '10000' }, permissions: { allow: [] } }
  const problems = validateRegistration({ ...GOOD, settings })
  assert.equal(problems.filter((problem) => /机器本地键/.test(problem)).length, 2)
})

test('.claude/hooks/ 还留着旧安装副本 → 红（P1：不许有并行版）', () => {
  const problems = validateRegistration({ ...GOOD, legacyCopies: 11 })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /11 个旧安装副本/)
})

test('一条 hook 都没注册 → 红（空的 hooks 块不算已配置）', () => {
  const problems = validateRegistration({ ...GOOD, settings: { hooks: {} }, requiredScripts: [] })
  assert.deepEqual(problems, ['.claude/settings.json 里一条 hook 都没注册'])
})

test('命令里的脚本路径认 $CLAUDE_PROJECT_DIR 与 ${CLAUDE_PROJECT_DIR} 两种写法', () => {
  assert.equal(referencedScript('bash "$CLAUDE_PROJECT_DIR/scripts/claude-hooks/a.sh"'), 'scripts/claude-hooks/a.sh')
  assert.equal(referencedScript('bash "${CLAUDE_PROJECT_DIR}/scripts/claude-hooks/a.sh"'), 'scripts/claude-hooks/a.sh')
  assert.equal(referencedScript('bash /absolute/elsewhere/a.sh'), null)
})

// —— 文件缺失守卫（2026-09-07）——
//
// 今天实测：落后的 worktree 上登记的脚本压根不存在，裸 `bash <文件>` 退 127，
// Claude Code 只认 exit 2 是阻断 → 闸门静默放行，零句红。判据从此要求每条命令
// 自带「脚本不在就明确退出」的守卫，退出码按分型（拦截型 2 / 提示型 1）。

test('裸 `bash <脚本>`（今天出事的那一版）→ 红，并把期望的守卫串给出来', () => {
  const problems = validateRegistration({ ...GOOD, settings: settingsWith(`bash "$CLAUDE_PROJECT_DIR/${BYPASS}"`) })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /没有带「文件缺失守卫」/)
  assert.match(problems[0], /127/)
  assert.ok(problems[0].includes(guardedCommand(BYPASS, 'blocking')), '报红必须把期望的命令串抄给人，否则没法照着改')
})

test('拦截型挂了提示型守卫（exit 1）→ 红：1 不是阻断码', () => {
  const problems = validateRegistration({ ...GOOD, settings: settingsWith(guardedCommand(BYPASS, 'advisory')) })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /没有带「文件缺失守卫」/)
})

test('提示型 hook 用提示型守卫 → 绿；被写成拦截型守卫 → 红', () => {
  const base = {
    settings: settingsWith(guardedCommand(GUARD, 'advisory')),
    requiredScripts: ['handoff-read.sh'],
    existingScripts: [GUARD],
    scriptSources: { [GUARD]: ADVISORY_SRC },
    legacyCopies: 0,
  }
  assert.deepEqual(validateRegistration(base), [])
  const wrong = validateRegistration({ ...base, settings: settingsWith(guardedCommand(GUARD, 'blocking')) })
  assert.equal(wrong.length, 1)
  assert.match(wrong[0], /没有带「文件缺失守卫」/)
})

test('拿不到脚本正文 → 红（分不出型就校验不了守卫；「校验不了」必须是红，不是跳过）', () => {
  const problems = validateRegistration({ ...GOOD, scriptSources: {} })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /分不出拦截型 \/ 提示型/)
})

test('分型只看可执行行：注释里的 exit 2 不算，脚本自己 exit 2 才算', () => {
  assert.equal(hookKind('#!/usr/bin/env bash\n# 否则 → block(exit 2)\nexit 0\n'), 'advisory')
  assert.equal(hookKind('#!/usr/bin/env bash\nif [ x ]; then exit 2; fi\n'), BLOCKING)
  assert.equal(hookKind('#!/usr/bin/env bash\n  exit 2\n'), BLOCKING)
  // python 堆里的 sys.exit(2) 不是 shell 的拒绝通道，不该被误认
  assert.equal(hookKind('#!/usr/bin/env bash\npython3 -c "import sys; sys.exit(2)"\nexit 0\n'), 'advisory')
})
