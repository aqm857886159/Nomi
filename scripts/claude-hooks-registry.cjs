// Claude hook 注册的判据本体（2026-09-07）。纯函数、不碰磁盘，为的是能被 node-test 喂假树：
// 这个文件属于「交付闸门的执行体」（root-cause-contracts.mjs 的高风险名单里点名了 install-claude-hooks.cjs），
// 它的失效形状是**静默放行**——闸门没挂上和闸门放行长得一模一样，只有测试能把两者分开。
//
// 判的三件事：
//   ① 共享设置里不许有机器本地键（env / permissions 进了 git 就污染所有人）；
//   ② 每条 hook 命令都指向仓库内 scripts/claude-hooks/ 下真实存在的脚本
//      （指向 .claude/hooks/ 那种「装了才有」的路径 = 闸门靠运气，直接判不合法）；
//   ③ 每个该注册的脚本都被注册（写了不挂等于没写），且不留旧安装副本（P1：不许有并行版）。
'use strict'

const LOCAL_ONLY_KEYS = ['env', 'permissions']
const REQUIRED_PREFIX = 'scripts/claude-hooks/'

function hookCommands(hooks) {
  const commands = []
  for (const matchers of Object.values(hooks || {})) {
    for (const matcher of Array.isArray(matchers) ? matchers : []) {
      for (const hook of Array.isArray(matcher && matcher.hooks) ? matcher.hooks : []) {
        if (hook && typeof hook.command === 'string') commands.push(hook.command)
      }
    }
  }
  return commands
}

/** 从命令里取它引用的仓库相对脚本路径（认 $CLAUDE_PROJECT_DIR/ 前缀）。 */
function referencedScript(command) {
  const match = /\$(?:\{)?CLAUDE_PROJECT_DIR(?:\})?\/([\w./-]+\.sh)/.exec(command)
  return match ? match[1] : null
}

/**
 * @param settings        .claude/settings.json 的对象（null = 文件缺失）
 * @param requiredScripts 必须被注册的脚本文件名数组
 * @param existingScripts 仓库里真实存在的脚本相对路径集合（Set 或数组）
 * @param legacyCopies    .claude/hooks/ 下残留的 *.sh 数量
 */
function validateRegistration({ settings, requiredScripts = [], existingScripts = [], legacyCopies = 0 }) {
  const problems = []
  if (!settings) {
    problems.push('缺失: .claude/settings.json —— 它现在进 git（共享项目设置），checkout 就该有；被谁删了？')
    return problems
  }
  const existing = new Set(existingScripts)
  for (const key of LOCAL_ONLY_KEYS) {
    if (settings[key] !== undefined) {
      problems.push(`.claude/settings.json 里有机器本地键 \`${key}\` —— 它进了 git 就会污染所有人；跑 \`node scripts/install-claude-hooks.cjs\` 迁到 settings.local.json`)
    }
  }
  const commands = hookCommands(settings.hooks)
  if (commands.length === 0) problems.push('.claude/settings.json 里一条 hook 都没注册')
  const registered = new Set()
  for (const command of commands) {
    const script = referencedScript(command)
    if (!script) {
      problems.push(`hook 命令没有指向仓库内脚本（必须写 $CLAUDE_PROJECT_DIR/${REQUIRED_PREFIX}...）：${command}`)
      continue
    }
    if (!script.startsWith(REQUIRED_PREFIX)) {
      problems.push(`hook 指向了仓库外或非版本化路径：${script} —— 装了才有的闸门不是闸门`)
      continue
    }
    if (!existing.has(script)) {
      problems.push(`hook 指向的脚本不存在：${script}`)
      continue
    }
    registered.add(script.slice(REQUIRED_PREFIX.length))
  }
  for (const name of requiredScripts) {
    if (!registered.has(name)) {
      problems.push(`${REQUIRED_PREFIX}${name} 没有被 .claude/settings.json 注册 —— 写了不挂等于没写`)
    }
  }
  if (legacyCopies > 0) {
    problems.push(`.claude/hooks/ 下还留着 ${legacyCopies} 个旧安装副本 —— 并行版会让人改错那份；跑 \`node scripts/install-claude-hooks.cjs\` 清掉`)
  }
  return problems
}

module.exports = { LOCAL_ONLY_KEYS, hookCommands, referencedScript, validateRegistration }
