// Claude hook 注册的判据本体（2026-09-07）。纯函数、不碰磁盘，为的是能被 node-test 喂假树：
// 这个文件属于「交付闸门的执行体」（root-cause-contracts.mjs 的高风险名单里点名了 install-claude-hooks.cjs），
// 它的失效形状是**静默放行**——闸门没挂上和闸门放行长得一模一样，只有测试能把两者分开。
//
// 判的三件事：
//   ① 共享设置里不许有机器本地键（env / permissions 进了 git 就污染所有人）；
//   ② 每条 hook 命令都指向仓库内 scripts/claude-hooks/ 下真实存在的脚本
//      （指向 .claude/hooks/ 那种「装了才有」的路径 = 闸门靠运气，直接判不合法）；
//   ③ 每个该注册的脚本都被注册（写了不挂等于没写），且不留旧安装副本（P1：不许有并行版）；
//   ④ 每条命令都带「脚本文件缺失守卫」（见下）。
//
// ④ 的起因（2026-09-07 实测）：一棵落后 main 的 worktree，`.claude/settings.json` 里
// 好端端登记着 `bash "$CLAUDE_PROJECT_DIR/scripts/claude-hooks/commit-bypass-check.sh"`，
// 而那棵树上**根本没有这个文件**（它是后来才进 main 的）。bash 报 file-not-found、
// 退出码 **127**——Claude Code 只把 exit 2 当阻断，127 归为「hook 自己出错，继续」。
// 于是子 agent 一条 `git -c core.hooksPath=… commit` 畅通无阻：闸门在登记表里活着，
// 在现实里不存在，全程没有一个字的红。
//
// 类根因：**防线依赖一个可能不存在的文件，缺失时默认放行**（R28：登记是备忘录不是防线）。
// 这不是意外而是常态——③ 把路径从 `.claude/hooks/`（装了才有）换成 `scripts/claude-hooks/`
// （checkout 就有）之后，「缺失」的成因只是从「没装依赖」换成了「分支停在旧提交」，
// 缺失时放行这一条一点没变。判据必须由**一定在场的那一层**执行：hook 这条链上唯一一定
// 在场的是 harness 起的那个 shell，所以守卫是 settings 里的一行 `sh -c`，
// 而不是另抽一个 `_guard.sh` 入口——分发器自己就是一个可能不存在的文件，
// `bash _guard.sh` 缺失时同样 127 同样放行，等于把这个 bug 原样搬了个家。
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

const BLOCKING = 'blocking'
const ADVISORY = 'advisory'

/**
 * 一个 hook 是不是**拦截型**：看它自己有没有把 `exit 2` 当拒绝通道。
 *
 * 刻意不另维护一份「哪些是拦截型」的名单——那是第二份真相源，新增一个闸门忘了登记
 * 就又是一次静默降级。注释行不算数：pre-push-check.sh 的抬头注释里就写着「block(exit 2)」，
 * 纯文本匹配会把注释当实现（这仓栽过，见 check-hook-behavior.mjs 抬头）。
 *
 * 分型决定缺失时怎么办，理由是代价不对称：
 *   · 拦截型（pre-push / commit-bypass / secret-guard）缺失 → fail-closed。拦错的代价是零
 *     （装一下、换棵树重跑），放过的代价不可逆（敏感数据永久进历史、没过五门的推送上远端）。
 *   · 提示型（其余）缺失 → fail-open，但 stderr 必须有话（可以 fail-open，不可以 fail-silent）。
 *     Stop 的 completion-check.sh 归这一档：它的拒绝走 stdout 的 `decision: block` 而不是 exit 2，
 *     且在 Stop 上 fail-closed 会把会话锁进「想修都停不下来」的死循环——而漏一条完成度提醒
 *     是可恢复的、用户当场看得见的。
 */
function hookKind(source) {
  const blocks = String(source)
    .split('\n')
    .some((raw) => {
      const line = raw.trim()
      if (line === '' || line.startsWith('#')) return false
      // 行内任意位置都算（`then exit 2; fi`、`|| { …; exit 2; }` 都要认）。
      // 宁可把提示型误判成拦截型也不反过来：误判的代价是一条会被 check:hook-behavior
      // 当场喊出来的红，反向误判的代价是又一个静默放行的闸门。
      return /\bexit\s+2\b/.test(line)
    })
  return blocks ? BLOCKING : ADVISORY
}

/**
 * 规范守卫命令：由 shell 自己判文件在不在，缺失时**明确**退出。
 * 拦截型退 2（Claude Code 唯一认得的阻断码），提示型退 1（不阻断，但 stderr 对用户可见）。
 *
 * 结构面按整串逐字比对：这是一份 JSON 配置不是代码，规范形状唯一，报红时把期望串抄过去即可。
 * 真正证明它管用的是 `check:hook-behavior` 的阳性对照——把脚本挪走、跑这条命令、看退出码。
 */
function guardedCommand(scriptPath, kind) {
  const target = `$CLAUDE_PROJECT_DIR/${scriptPath}`
  const message =
    kind === BLOCKING
      ? `[nomi-hooks] 拦截型 hook 缺失，fail-closed 拒绝本次调用：${scriptPath}（分支停在没有它的旧提交？先并上 origin/main 再重试）`
      : `[nomi-hooks] 提示型 hook 缺失（本次不阻断，但你少了一层提醒）：${scriptPath}（分支停在没有它的旧提交？先并上 origin/main）`
  const code = kind === BLOCKING ? 2 : 1
  return `sh -c 'h="${target}"; [ -f "$h" ] || { echo "${message}" >&2; exit ${code}; }; exec bash "$h"'`
}

/**
 * @param settings        .claude/settings.json 的对象（null = 文件缺失）
 * @param requiredScripts 必须被注册的脚本文件名数组
 * @param existingScripts 仓库里真实存在的脚本相对路径集合（Set 或数组）
 * @param scriptSources   { 相对路径: 脚本正文 } —— 用来分型（拦截型 / 提示型）。缺一个就报红：
 *                        分不出型就校验不了守卫，而「校验不了」在这道判据里必须等于红，不是跳过。
 * @param legacyCopies    .claude/hooks/ 下残留的 *.sh 数量
 */
function validateRegistration({
  settings,
  requiredScripts = [],
  existingScripts = [],
  scriptSources = {},
  legacyCopies = 0,
}) {
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

    // ④ 文件缺失守卫。裸 `bash <不存在的文件>` 退出码是 127，Claude Code 不当阻断 → 静默放行。
    const source = scriptSources[script]
    if (source === undefined) {
      problems.push(`拿不到 ${script} 的正文，分不出拦截型 / 提示型 —— 分不出型就校验不了缺失守卫`)
      continue
    }
    const expected = guardedCommand(script, hookKind(source))
    if (command !== expected) {
      problems.push(
        `${script} 的 hook 命令没有带「文件缺失守卫」——` +
          `这条命令在脚本不存在时（分支停在旧提交、或文件被删）会以 127 退出，` +
          `Claude Code 把它当「hook 出错，继续」，闸门于是静默放行。\n` +
          `      现在：${command}\n` +
          `      期望：${expected}`,
      )
    }
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

module.exports = {
  ADVISORY,
  BLOCKING,
  LOCAL_ONLY_KEYS,
  guardedCommand,
  hookCommands,
  hookKind,
  referencedScript,
  validateRegistration,
}
