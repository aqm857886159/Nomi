// Claude hook 注册判据的测试（R17：加规则先证明它会红）。
//
// 为什么这道判据必须有测试：install-claude-hooks.cjs 在 root-cause-contracts.mjs 的高风险名单里，
// 收的是同一个风险形状——**静默失效**。闸门没挂上和闸门放行长得一模一样，只有断言能把两者分开。
import assert from 'node:assert/strict'
import test from 'node:test'
import registry from './claude-hooks-registry.cjs'

const { referencedScript, validateRegistration } = registry

const GOOD = {
  settings: {
    hooks: {
      PreToolUse: [{
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/scripts/claude-hooks/commit-bypass-check.sh"' }],
      }],
    },
  },
  requiredScripts: ['commit-bypass-check.sh'],
  existingScripts: ['scripts/claude-hooks/commit-bypass-check.sh'],
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
  const settings = {
    hooks: {
      PreToolUse: [{
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/commit-bypass-check.sh"' }],
      }],
    },
  }
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
