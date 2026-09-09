// 真集成测试：起真 MCP stdio 服务（app 自身二进制 + NOMI_MCP_STDIO=1，= Claude Code / Codex 拉起它的
// 真路径），像外部 agent 那样发 JSON-RPC，验真 skillStore 把仓内技能经 resources + prompts 真的
// list/read 出来。零生成额度（只读技能，不碰模型/项目）。
//
// 2026-09-02 重写（docs/fixes/2026-09-02-unwired-stale-skill-resource-test.root-cause.json）。修之前它有两个毛病：
//
// 1. **从没跑过。** 全仓只有它自己的头注释引用它——不在 package.json、不在 tests/system/profiles.mjs、
//    不在任何 workflow。于是它一边在文件里写着「验真 skillStore」，一边对任何回归零检出力；
//    而 `resources.length >= 20` 这种手抄下限连「有没有在跑」都掩盖了。现已挂进 test:mcp-journey，
//    与 MCP 面同触发面。
// 2. **断言已过期。** 它按面收敛前的形态写：期望裸 uri `nomi-skill://director-cinematography`
//    （现已内容寻址成 `nomi-skill://<dir>/<packageVersion>/<contentHash>`），且以未签名身份却期望拿到
//    内部创作技能（未签名 host 只能看 audience:"mcp" 的公开子集）。
//
// 现在：签名身份（local-authenticated → 全量目录），期望集合从**仓内 skills/ 目录 derive**，
// 不再手抄数量。签名客户端没有 audience 过滤，所以这里不存在「在测试里重抄一份可见性规则」的风险。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  assertBuilt,
  makeIsolatedDirs,
  repoRoot,
  spawnMcpStdioClient,
  seedMcpClientIdentityEnv,
} from './_mcpJourney.mjs'

const SKILL_URI_PREFIX = 'nomi-skill://'
const UI_RESOURCE_URI = 'ui://nomi/live-draft.html'

/** 真相源：仓内 skills/ 下每个带 SKILL.md 的目录。签名客户端应当一个不少地拿到它们。 */
function bundledSkillDirectories() {
  const skillsDir = path.join(repoRoot, 'skills')
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort()
}

let passed = 0
function check(condition, label) {
  if (!condition) throw new Error(`MCP-SKILLS FAIL: ${label}`)
  passed += 1
  console.log(`  ✓ ${label}`)
}

async function verifyClient(client) {
  assertBuilt()
  const dirs = makeIsolatedDirs('nomi-mcp-skills-')
  const fixtureRoot = path.join(dirs.settingsDir, 'skills', 'b6-complete-package')
  fs.mkdirSync(path.join(fixtureRoot, 'references'), { recursive: true })
  fs.mkdirSync(path.join(fixtureRoot, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(fixtureRoot, 'SKILL.md'), '---\nname: b6-complete-package\ndescription: Isolated package fixture\n---\nRead references/full.md and inspect scripts/example.py.\n')
  fs.writeFileSync(path.join(fixtureRoot, 'references/full.md'), 'Complete fixture reference.\n')
  fs.writeFileSync(path.join(fixtureRoot, 'scripts/example.py'), 'print("read only, never executed")\n')
  // Exercise the same verified-client contract for both requested external hosts.
  const mcp = spawnMcpStdioClient({
    ...dirs,
    clientInfo: { name: client, version: '1.0.0' },
    env: seedMcpClientIdentityEnv(dirs.capabilityDir, client),
    capabilities: {},
  })

  try {
    const init = await mcp.rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'Nomi MCP skills integration', version: '1.0.0' },
    }, 30_000)
    check(Boolean(init.result), 'initialize 有响应（MCP stdio 服务起来了）')
    const caps = init.result.capabilities || {}
    check(Boolean(caps.tools && caps.resources && caps.prompts), '广告 tools + resources + prompts 能力')

    const resources = (await mcp.rpc('resources/list', {}, 30_000)).result?.resources || []
    const skillResources = resources.filter((resource) => String(resource.uri).startsWith(SKILL_URI_PREFIX))

    // 内容寻址后 uri 形如 nomi-skill://<dir>/<packageVersion>/<contentHash>，取首段即目录名。
    const listedDirectories = [...new Set(
      skillResources.map((resource) => String(resource.uri).slice(SKILL_URI_PREFIX.length).split('/')[0]),
    )].sort()
    const expectedDirectories = [...bundledSkillDirectories(), 'b6-complete-package'].sort()
    assert.deepEqual(
      listedDirectories,
      expectedDirectories,
      `resources/list 的技能集合与仓内 skills/ 不一致：`
        + `多出 [${listedDirectories.filter((name) => !expectedDirectories.includes(name)).join(', ')}]，`
        + `缺少 [${expectedDirectories.filter((name) => !listedDirectories.includes(name)).join(', ')}]`,
    )
    check(true, `resources/list 恰好暴露仓内全部 ${expectedDirectories.length} 个技能（集合相等，非手抄下限）`)

    // 非技能资源只有 MCP Apps 的 widget 一条——显式钉住，免得「资源总数」将来又变成一个没人解释的数字。
    const otherResources = resources.filter((resource) => !String(resource.uri).startsWith(SKILL_URI_PREFIX))
    assert.deepEqual(otherResources.map((resource) => resource.uri), [UI_RESOURCE_URI],
      'resources/list 的非技能资源应当只有 live-draft widget')
    check(true, '非技能资源恰为 live-draft widget 一条')

    const cinematography = skillResources.find(
      (resource) => String(resource.uri).startsWith(`${SKILL_URI_PREFIX}director-cinematography/`),
    )
    check(Boolean(cinematography), '含 director-cinematography 资源（内容寻址 uri）')
    // name 从 2026-09-07 起就是目录名（Agent Skills 规范要求 name == 父目录名），所以这里
    // 按目录名断言而不是抄一个字面量——抄字面量正是上一次改名时这条断言变红的原因。
    check(
      cinematography.name === 'director-cinematography' && (cinematography.description || '').length > 5,
      '资源带 name（= 目录名）+ 非空 description',
    )
    // 渐进披露：list 只给索引，正文要另外 read。
    check(cinematography.text === undefined && cinematography.body === undefined, 'resources/list 不含正文（渐进披露）')

    const read = (await mcp.rpc('resources/read', { uri: cinematography.uri }, 30_000)).result
    const text = read?.contents?.[0]?.text || ''
    check(text.length > 1_000 && text.includes('镜头'), 'resources/read 按返回的 uri 载入真实技能正文')

    const prompts = (await mcp.rpc('prompts/list', {}, 30_000)).result
    const promptNames = (prompts?.prompts || []).map((prompt) => prompt.name)
    check(promptNames.includes('director-cinematography'), 'prompts/list 用 directoryName 当命令名（斜杠友好）')

    // Every advertised file must be exactly readable, including referenced files; no length heuristic.
    let attachmentCount = 0
    for (const resource of skillResources) {
      const uriParts = String(resource.uri).slice(SKILL_URI_PREFIX.length).split('/').map(decodeURIComponent)
      const [directoryName, , , ...segments] = uriParts
      const relativePath = segments.length ? segments.join('/') : 'SKILL.md'
      const expected = fs.readFileSync(path.join(directoryName === 'b6-complete-package' ? fixtureRoot : path.join(repoRoot, 'skills', directoryName), relativePath), 'utf8')
      const response = await mcp.rpc('resources/read', { uri: resource.uri }, 30_000)
      assert.equal(response.result?.contents?.[0]?.text, expected, `Resource content mismatch: ${directoryName}/${relativePath}`)
      if (segments.length) attachmentCount += 1
    }
    assert.ok(attachmentCount >= 2, 'Isolated package references and scripts must be exposed')
    check(true, `resources/read 逐字读回全部 ${skillResources.length} 个文件（含 ${attachmentCount} 个附件）`)
    for (const prompt of prompts.prompts) {
      assert.equal(prompt.packageVersion, undefined, 'Prompt identity must use the standard metadata extension')
      assert.equal(prompt.contentHash, undefined, 'Prompt identity must use the standard metadata extension')
      assert.deepEqual(prompt.arguments.map(arg => arg.name), ['packageVersion', 'contentHash'])
      const response = await mcp.rpc('prompts/get', { name: prompt.name, arguments: prompt._meta }, 30_000)
      const expected = fs.readFileSync(path.join(prompt.name === 'b6-complete-package' ? fixtureRoot : path.join(repoRoot, 'skills', prompt.name), 'SKILL.md'), 'utf8')
      assert.equal(response.result?.messages?.[0]?.content?.text, expected, `Prompt body mismatch: ${prompt.name}`)
      const related = skillResources.filter(resource => resource.uri.startsWith(`${SKILL_URI_PREFIX}${prompt.name}/`) && resource.uri.split('/').length > 5)
      for (const resource of related) assert.ok(response.result.messages.some(message => message.content.text.includes(resource.uri)), `Missing attachment URI in prompt ${prompt.name}`)
    }
    check(true, 'prompts/get 标准 arguments 绑定身份，正文与附件索引完整')
    const stalePrompt = await mcp.rpc('prompts/get', { name: 'director-cinematography', arguments: { contentHash: '0'.repeat(64) } }, 30_000)
    check(Boolean(stalePrompt.error), '标准 prompt arguments 中过期 hash 被拒绝')
    const unsafeRead = await mcp.rpc('resources/read', { uri: `${cinematography.uri}/%2e%2e/SKILL.md` }, 30_000)
    check(Boolean(unsafeRead.error), '附件资源拒绝路径穿越')

    const badRead = await mcp.rpc('resources/read', { uri: `${SKILL_URI_PREFIX}nope-nonexistent` }, 30_000)
    check(Boolean(badRead.error), '未知技能资源回 error')

    console.log(`\nMCP-SKILLS-INTEGRATION PASS: ${passed} assertions（真 stdio 服务 · 真 skillStore · 零生成额度）`)
  } finally {
    await mcp.terminate()
  }
}

async function main() {
  for (const client of ['claude', 'workbuddy']) await verifyClient(client)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
