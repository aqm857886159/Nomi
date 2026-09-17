// `docs/engineering/framework-boundaries.json` 里那些 **scope 声明**的共用判据（纯函数）。
//
// 两道门岗都从这份登记表读「要扫哪些路径前缀」：
//   · `check:framework-boundary` 读 `capabilities[].scope`（禁令正则在哪儿扫）
//   · `check:framework-surface`  读 `surface.scope`（字段赋值的锚点在哪儿找）
// 两边各自的 walk() 都写着 `if (!fs.existsSync(dir)) return`——**指不到就当没事发生**。
//
// 2026-09-18 实证这条静默有多贵：whisper-cpp 那条能力的两条 scope 都写成了
// `electron/localTranscription/`，而真实目录叫 `localSpeech/`。它下面两条禁令一次都没扫过，
// 其中一条守的是用户定的硬约束「一条英语专用权重都不许有」。同一份登记表 24 条 scope
// 里有 7 条指向不存在的目录（另 5 条是 pi，指向 agent-lane 那轮重做时删掉的两个目录）。
// **登记表写了守卫却不守，比没写更糟**：它让每个读到这条登记的人以为有防线。
//
// 判据取「这条 scope 有没有贡献出可扫的源文件」，不取「目录存不存在」——目录在、
// 但里面一个非测试源文件都没有，对禁令来说同样等于没扫。两种情况措辞分开，因为修法不同：
// 前者改路径或删掉这条 scope，后者要想清楚这条 scope 还有没有意义。
//
// 放在独立文件而不是某一边的 lib 里：两道门岗是平级的，判据只该有一份（P1）。

/**
 * 列出登记表里所有 scope 声明。`kind` 说明它是哪一种，报错时用得上。
 */
export function declaredScopes(registry) {
  const declared = []
  for (const framework of registry?.frameworks ?? []) {
    for (const scope of framework?.surface?.scope ?? []) {
      declared.push({ framework: framework.id, owner: 'surface', kind: 'surface.scope', scope })
    }
    for (const capability of framework?.capabilities ?? []) {
      for (const scope of capability?.scope ?? []) {
        declared.push({ framework: framework.id, owner: capability.id, kind: 'capability.scope', scope })
      }
    }
  }
  return declared
}

/**
 * 找出扫不到任何源文件的 scope。
 *
 * @param registry        登记表对象
 * @param listScopeFiles  (scope) => string[]，这条前缀下门岗真正会扫的文件（由调用方按自己的扫法提供）
 * @param scopeExists     (scope) => boolean，可选；只用来把措辞分成「目录不存在」和「目录在但没源文件」
 * @param only            可选，'surface' | 'capability.scope' 之类的 kind 过滤；省略则查全部
 */
export function deadScopes({ registry, listScopeFiles, scopeExists, only }) {
  const dead = []
  for (const entry of declaredScopes(registry)) {
    if (only && entry.kind !== only) continue
    if (listScopeFiles(entry.scope).length > 0) continue
    const exists = typeof scopeExists === 'function' ? scopeExists(entry.scope) : true
    dead.push({ ...entry, reason: exists ? '目录在，但没有可扫的非测试源文件' : '目录不存在' })
  }
  return dead
}

/** 报红文案：两道门岗共用，措辞只有一份。 */
export function formatDeadScopes(dead, registryFile) {
  const lines = [`✖ ${registryFile} 有 ${dead.length} 条 scope 扫不到任何源文件（登记了守卫却没在跑）：`]
  for (const entry of dead) {
    lines.push(`  - ${entry.framework}/${entry.owner} 的 ${entry.kind} "${entry.scope}"：${entry.reason}`)
  }
  lines.push('  → 改成真实路径；这块代码真被删了就把这条 scope（或整条能力）从登记表删掉，别留着指向空气。')
  return lines.join('\n')
}
