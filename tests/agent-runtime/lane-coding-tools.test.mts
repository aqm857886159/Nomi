// 阶段 5c 的**安全断言**与按需装载证据，全部零额度。
//
// 五条安全断言（任务书 §5）各自回答一个「真机上会怎么坏」的问题：
//   ① 越界读 `~/.ssh` 必拒——两层：策略层的硬清单，和 operations 的路径包容；
//   ② env 里的 key 不出现在子进程；
//   ③ bash 未确认不执行（闸拒 = pi 收到 block，工具**没跑**）；
//   ④ 超时杀进程（杀的是整棵进程树，不是那一个 bash）；
//   ⑤ 沙箱不可用时自动放行整档消失（阳性对照住在 codingCommandPolicy.test.ts）。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import { containPath, LaneCodingPathError } from '../../electron/agentLane/laneCodingPaths.mjs';
import {
  classifyCommand,
} from '../../electron/shared/agentCapabilities/codingCommandPolicy.js';
import {
  createLaneCodingTools, LANE_CODING_TOOL_EFFECTS,
  LANE_CODING_TOOL_NAMES, laneBashSpawnHook, loadPiCodingToolFactories, sanitizeSpawnEnvironment,
  type LaneCodingToolName,
} from '../../electron/agentLane/laneCodingTools.mjs';
import {
  evaluateLaneToolBudget, laneToolMenu, LANE_TOOL_REQUEST_TOOL_NAME, LANE_CODING_TOOL_GROUP,
} from '../../electron/agentLane/laneToolGroups.mjs';
import { laneSandboxVendorPaths, openLaneSandbox, sandboxPolicyFor,
  type LaneBashOperations, type SandboxManagerLike }
  from '../../electron/agentLane/laneCodingSandbox.mjs';
import { VERB_EFFECTS } from '../../electron/shared/agentCapabilities/verbDeclaration.js';
import { laneToolBillable, laneToolMutates } from '../../electron/shared/agentLane/laneToolContract.js';

async function projectDir(t: TestContext): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'nomi-coding-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** 真的跑本地 shell 的 operations（沙箱那一层在别的测试里单独证；这里要证的是超时与 env）。 */
const localOperations: LaneBashOperations = {
  exec: (command, cwd, { onData, signal, timeout, env }) => new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) });
    let timedOut = false;
    const killTree = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } } };
    const timer = timeout && timeout > 0 ? setTimeout(() => { timedOut = true; killTree(); }, timeout) : undefined;
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    signal?.addEventListener('abort', killTree, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) { reject(new Error(`timeout after ${timeout} ms`)); return; }
      resolve({ exitCode: code });
    });
  }),
};

// ── ① 越界读必拒（两层）─────────────────────────────────────────────────

test('安全断言① 越界读 ~/.ssh：策略层硬清单直接拒，且与沙箱状态无关', () => {
  for (const sandboxActive of [true, false]) {
    const verdict = classifyCommand({ command: 'cat ~/.ssh/id_ed25519', projectDir: '/proj', sandboxActive });
    assert.equal(verdict.tier, 'hard-list');
    assert.equal(verdict.decision, 'deny');
    assert.equal(verdict.rule, 'secret-store');
  }
});

test('安全断言① 越界读：operations 的路径包容拦住项目外的绝对路径', async (t) => {
  const dir = await projectDir(t);
  assert.equal(containPath(path.join(dir, 'a/b.txt'), dir), path.join(dir, 'a/b.txt'));
  assert.throws(() => containPath('/etc/passwd', dir), LaneCodingPathError);
  assert.throws(() => containPath(path.join(process.env.HOME ?? '/root', '.ssh/id_rsa'), dir), LaneCodingPathError);
  // `startsWith` 那个洞：`<dir>-evil` 以 `<dir>` 开头，但它不在 `<dir>` 里。
  assert.throws(() => containPath(`${dir}-evil/secret.txt`, dir), LaneCodingPathError);
});

test('包容的错误正文告诉模型下一步，不是一个错误码', async (t) => {
  const dir = await projectDir(t);
  try {
    containPath('/etc/passwd', dir);
    assert.fail('should have thrown');
  } catch (error) {
    const message = (error as Error).message;
    assert.match(message, /outside this project/);
    assert.match(message, /relative to the project root/);
  }
});

test('read 工具真的读不到项目外的文件（走 pi 的工具，不是走我们的断言）', async (t) => {
  const dir = await projectDir(t);
  await writeFile(path.join(dir, 'inside.txt'), 'ok\n', 'utf8');
  const tools = await createLaneCodingTools({
    projectDir: dir,
    sandbox: { active: true, operations: localOperations, close: async () => undefined },
    bashTimeoutMs: 5_000,
    factories: await loadPiCodingToolFactories(),
  });
  const read = tools.find((tool) => tool.name === 'read');
  assert.ok(read, 'pi 不再提供 read 工具');
  const context = { abortSignal: new AbortController().signal } as never;
  const noop = (() => undefined) as never;
  const invocation = {} as never;

  const inside = await read.execute('c1', { path: 'inside.txt' } as never, noop, undefined, invocation, context);
  assert.match(JSON.stringify(inside), /ok/);

  await assert.rejects(
    () => read.execute('c2', { path: '/etc/passwd' } as never, noop, undefined, invocation, context),
    /outside this project/,
  );
});

// ── ② env 里的 key 不出现在子进程 ────────────────────────────────────────

test('安全断言② key 类环境变量摘干净（判据是名字，不是白名单）', () => {
  const clean = sanitizeSpawnEnvironment({
    PATH: '/usr/bin',
    HOME: '/home/x',
    DEEPSEEK_API_KEY: 'sk-should-not-survive',
    ANTHROPIC_API_KEY: 'sk-should-not-survive',
    OPENAI_KEY: 'sk-should-not-survive',
    GITHUB_TOKEN: 'ghp_should-not-survive',
    AWS_SECRET_ACCESS_KEY: 'should-not-survive',
    NOMI_SESSION_ID: 'should-not-survive',
    DB_PASSWORD: 'should-not-survive',
    NODE_ENV: 'test',
  });
  assert.deepEqual(Object.keys(clean).sort(), ['HOME', 'NODE_ENV', 'PATH']);
  assert.ok(!JSON.stringify(clean).includes('should-not-survive'));
});

test('安全断言② key 真的到不了子进程（跑一条 `env` 看输出）', async (t) => {
  const dir = await projectDir(t);
  const hook = laneBashSpawnHook(dir);
  const spawned = hook({
    command: 'env',
    cwd: '/somewhere/else',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', NOMI_TEST_API_KEY: 'sk-leak-canary' },
  });
  // cwd 被钉回项目根：模型换个 cwd 绕过包容这条路在结构上不存在。
  assert.equal(spawned.cwd, path.resolve(dir));
  let output = '';
  await localOperations.exec(spawned.command, spawned.cwd, {
    onData: (chunk) => { output += chunk.toString('utf8'); },
    env: spawned.env,
  });
  assert.ok(output.length > 0, 'env 应当有输出——空输出会让下面那条断言恒真');
  assert.ok(!output.includes('sk-leak-canary'), `key 泄进了子进程：\n${output}`);
});

// ── ③ bash 未确认不执行 ─────────────────────────────────────────────────

/**
 * 闸的形状 = 3a 的 `before_tool`：判定为 `ask`/`deny` 且没批 → 返回 `{block:{reason}}`，
 * pi **不会**调用工具的 `execute`。3a 未合，所以这里用同一形状的包装把它演出来。
 */
function gatedBash(
  tool: { execute(...args: never[]): Promise<unknown> },
  decide: (command: string) => 'allow' | 'block',
): (command: string) => Promise<'blocked' | unknown> {
  return async (command: string) => {
    if (decide(command) === 'block') return 'blocked';
    return await (tool.execute as unknown as (
      id: string, params: unknown, onUpdate: unknown, ctx: undefined, inv: unknown, context: unknown,
    ) => Promise<unknown>)(
      'call-1', { command }, () => undefined, undefined, {},
      { abortSignal: new AbortController().signal },
    );
  };
}

test('安全断言③ 闸拒 = 命令一次都没跑（**带阳性对照**：同一条命令批了就真的跑）', async (t) => {
  const dir = await projectDir(t);
  const attempted: string[] = [];
  const recording: LaneBashOperations = {
    exec: async (command, cwd, options) => {
      attempted.push(command);
      return localOperations.exec(command, cwd, options);
    },
  };
  const tools = await createLaneCodingTools({
    projectDir: dir,
    sandbox: { active: true, operations: recording, close: async () => undefined },
    bashTimeoutMs: 10_000,
    factories: await loadPiCodingToolFactories(),
  });
  const bash = tools.find((tool) => tool.name === 'bash');
  assert.ok(bash, 'pi 不再提供 bash 工具');

  // 拒收臂：真实策略判定为 ask（`git push` 在硬清单里），闸不放行。
  const deniedMarker = path.join(dir, 'denied.txt');
  const deniedCommand = `touch ${deniedMarker}`;
  const denying = gatedBash(bash as never, () => 'block');
  assert.equal(await denying(deniedCommand), 'blocked');
  assert.deepEqual(attempted, [], '闸拒了，operations 却被碰过——工具在闸之前就跑了');
  await assert.rejects(() => readFile(deniedMarker), /ENOENT/, '拒收的命令留下了副作用');

  // **阳性对照**：一模一样的命令，闸放行 → operations 被调用、文件真的出现。
  // 没有这一臂，上面那个空数组和「execute 根本没接上」长得一模一样。
  const allowedMarker = path.join(dir, 'allowed.txt');
  const allowedCommand = `touch ${allowedMarker}`;
  const allowing = gatedBash(bash as never, () => 'allow');
  await allowing(allowedCommand);
  assert.deepEqual(attempted, [allowedCommand], '批了却没跑——那上面那条拒收断言什么也没证明');
  assert.equal((await readFile(allowedMarker, 'utf8')), '', '批准的命令没产生副作用');
});

test('安全断言③ 硬清单的 ask 档在真实策略里确实不自动放行', async (t) => {
  const dir = await projectDir(t);
  assert.equal(classifyCommand({ command: 'git push origin main', projectDir: dir, sandboxActive: true }).decision, 'ask');
  assert.equal(classifyCommand({ command: 'rm -rf build', projectDir: dir, sandboxActive: true }).decision, 'ask');
  assert.equal(classifyCommand({ command: 'cat ~/.ssh/id_rsa', projectDir: dir, sandboxActive: true }).decision, 'deny');
});

// ── ④ 超时杀进程树 ──────────────────────────────────────────────────────

test('安全断言④ 超时把整棵进程树杀掉，不是只杀那一个 bash', async (t) => {
  const dir = await projectDir(t);
  const survivor = path.join(dir, 'survivor.txt');
  const started = Date.now();
  await assert.rejects(
    () => localOperations.exec(
      // 子进程在 1.5s 后写文件。超时 400ms：杀对了它就永远写不出来。
      `bash -c 'sleep 1.5; echo survived > ${survivor}' & wait`,
      dir,
      { onData: () => undefined, timeout: 400 },
    ),
    /timeout/,
  );
  assert.ok(Date.now() - started < 1_200, '超时没生效——它等到了子进程自己结束');
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  await assert.rejects(() => readFile(survivor), /ENOENT/, '子进程活过了超时：杀的是 bash 不是进程组');
});

// ── ⑤ 沙箱不可用 → 明标，不假装 ──────────────────────────────────────────

test('安全断言⑤ 平台不支持时 active=false 且带人话原因，不抛异常', async () => {
  const manager: SandboxManagerLike = {
    isSupportedPlatform: () => false,
    initialize: async () => { throw new Error('should not be called'); },
    wrapWithSandbox: async (command) => command,
    reset: async () => undefined,
  };
  const sandbox = await openLaneSandbox(
    sandboxPolicyFor({ projectDir: '/proj', settingsRoot: '/settings' }),
    { manager, localOperations },
  );
  assert.equal(sandbox.active, false);
  // 码是产品契约（界面按它挑那句人话），正文只是诊断——两半都断言住，
  // 不然把 code 写死成一个值、正文里放任何东西，测试照样绿。
  assert.equal(sandbox.inactive?.code, 'unsupported-platform');
  assert.match(sandbox.inactive?.detail ?? '', /No OS-level sandbox/);
  assert.ok(sandbox.operations, 'active:false 不等于不能跑命令——等于每条都要人点头');
});

test('沙箱初始化失败也是 active=false，不是整条 lane 开不起来', async () => {
  const manager: SandboxManagerLike = {
    isSupportedPlatform: () => true,
    initialize: async () => { throw new Error('bubblewrap missing'); },
    wrapWithSandbox: async (command) => command,
    reset: async () => undefined,
  };
  const sandbox = await openLaneSandbox(
    sandboxPolicyFor({ projectDir: '/proj', settingsRoot: '/settings' }),
    { manager, localOperations },
  );
  assert.equal(sandbox.active, false);
  assert.equal(sandbox.inactive?.code, 'init-failed');
  assert.match(sandbox.inactive?.detail ?? '', /bubblewrap missing/);
});

// ── 打包后二进制找不找得到（2026-09-12 的发布阻塞项）──
//
// 这三条守的是那条最反直觉的事实：`asarUnpack` 把真文件摊到了 `app.asar.unpacked/`，
// 但运行时自己用 `import.meta.url` 拼出来的路径仍然指进 `app.asar`，而且它那句
// `existsSync` 在 Electron 里回 `true`——于是它「找到了」，不再试别的候选，然后把一个
// `execve` 不了的路径交出去。所以真正让二进制被用上的是我们显式传的这几个路径。
// 真机实测见 `docs/lessons/2026-09-12-sandbox-runtime-not-unpacked.md`。

function vendorDeps(input: { platform: string; arch: string; packageJson: string; present?: readonly string[] }) {
  return {
    resolvePackageJson: () => input.packageJson,
    // 只认解包副本存在——正是打包后的真实形状：归档里那份对 `execve` 不存在。
    exists: (candidate: string) => (input.present ?? []).some((suffix) => candidate.endsWith(suffix)),
    platform: input.platform,
    arch: input.arch,
  };
}

test('打包后给出的是 app.asar.unpacked 里那份，不是归档里那份', () => {
  const packaged = '/Apps/Nomi.app/Contents/Resources/app.asar/node_modules/@anthropic-ai/sandbox-runtime/package.json';
  const linux = laneSandboxVendorPaths(vendorDeps({
    platform: 'linux', arch: 'x64', packageJson: packaged,
    present: ['vendor/seccomp/x64/apply-seccomp', 'vendor/java-proxy-agent/srt-proxy-agent.jar'],
  }));
  assert.equal(linux.seccomp?.applyPath,
    '/Apps/Nomi.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/sandbox-runtime/vendor/seccomp/x64/apply-seccomp');
  assert.equal(linux.javaAgentJarPath,
    '/Apps/Nomi.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/sandbox-runtime/vendor/java-proxy-agent/srt-proxy-agent.jar');
  // 改写是**全路径替换**，不是只换第一处；而且不许把已改写的再改一次。
  assert.ok(!linux.seccomp?.applyPath.includes('app.asar/'), '归档路径一个都不许漏过去');
  assert.ok(!linux.seccomp?.applyPath.includes('unpacked.unpacked'), '防重入');

  const windows = laneSandboxVendorPaths(vendorDeps({
    platform: 'win32', arch: 'arm64', packageJson: packaged, present: ['vendor/srt-win/arm64/srt-win.exe'],
  }));
  assert.match(windows.windows?.srtWin.path ?? '', /app\.asar\.unpacked\b.*[\\/]srt-win[\\/]arm64[\\/]srt-win\.exe$/);
});

test('按平台给：macOS 上不声明一个这辈子不会被打开的路径', () => {
  const present = ['apply-seccomp', 'srt-win.exe', 'srt-proxy-agent.jar'];
  const mac = laneSandboxVendorPaths(vendorDeps({
    platform: 'darwin', arch: 'arm64', packageJson: '/repo/node_modules/@anthropic-ai/sandbox-runtime/package.json', present,
  }));
  assert.equal(mac.seccomp, undefined, 'seccomp 是 Linux 的');
  assert.equal(mac.windows, undefined, 'srt-win 是 Windows 的');
  // jar 没有平台条件：沙箱里跑 JVM 三个平台都可能发生。
  assert.ok(mac.javaAgentJarPath?.endsWith('srt-proxy-agent.jar'));
});

test('盘上没有就一个字段都不给——让上游按自己的办法找，而不是塞一个错路径', () => {
  const none = laneSandboxVendorPaths(vendorDeps({
    platform: 'linux', arch: 'x64', packageJson: '/repo/node_modules/@anthropic-ai/sandbox-runtime/package.json',
  }));
  assert.deepEqual(none, {});
  // 连包都解析不到时同样静默退出，不抛——沙箱起不起得来由 initialize 回答，不由这个函数回答。
  assert.deepEqual(laneSandboxVendorPaths({
    resolvePackageJson: () => { throw new Error('MODULE_NOT_FOUND'); },
    exists: () => true, platform: 'linux', arch: 'x64',
  }), {});
});

test('沙箱策略：allowWrite 只有项目目录与 /tmp；Nomi 设置目录进 denyRead', () => {
  const policy = sandboxPolicyFor({ projectDir: '/proj', settingsRoot: '/Users/x/Library/Application Support/Nomi' });
  assert.deepEqual([...policy.allowWrite], ['/proj', '/tmp']);
  assert.ok(policy.denyRead.includes('/Users/x/Library/Application Support/Nomi'));
  assert.ok(policy.denyRead.includes('~/.ssh'));
  assert.deepEqual([...policy.allowedDomains], [], '网络默认全拒');
});

// ── 按需装载 ────────────────────────────────────────────────────────────

test('按需装载：默认只有 always-on + 一个找工具的工具；coding 组不亮', () => {
  const menu = laneToolMenu();
  assert.equal(menu.activeGroup, null);
  assert.equal(menu.codingUnlocked, false);
  assert.ok(menu.activeToolNames.includes(LANE_TOOL_REQUEST_TOOL_NAME));
  assert.ok(menu.activeToolNames.includes('read'));
  for (const name of LANE_CODING_TOOL_NAMES.filter(name => name !== 'read')) {
    assert.ok(!menu.activeToolNames.includes(name), `${name} 不该默认亮着`);
  }
});

test('按需装载：点亮 coding 组就整组亮', () => {
  const menu = laneToolMenu({ activeGroup: LANE_CODING_TOOL_GROUP });
  assert.equal(menu.codingUnlocked, true);
  for (const name of LANE_CODING_TOOL_NAMES) assert.ok(menu.activeToolNames.includes(name));
});

test('B1c: registered schemas remain resident across group selection', () => {
  const groups = [
    { name: LANE_CODING_TOOL_GROUP, toolNames: LANE_CODING_TOOL_NAMES },
    { name: 'timeline', toolNames: ['nomi_timeline_fixture'] },
  ];
  const coding = laneToolMenu({ groups, activeGroup: LANE_CODING_TOOL_GROUP });
  const timeline = laneToolMenu({ groups, activeGroup: 'timeline' });
  assert.equal(timeline.activeGroup, 'timeline');
  assert.equal(timeline.codingUnlocked, false, 'group selection is not coding authorization');
  for (const name of LANE_CODING_TOOL_NAMES) {
    assert.ok(coding.activeToolNames.includes(name));
    assert.ok(timeline.activeToolNames.includes(name), `${name} remains resident`);
  }
  // 常驻那一段两边逐字相同——换组只动尾巴，前缀不动。
  const alwaysOn = laneToolMenu().activeToolNames;
  assert.deepEqual(coding.activeToolNames.slice(0, alwaysOn.length), [...alwaysOn]);
  assert.deepEqual(timeline.activeToolNames.slice(0, alwaysOn.length), [...alwaysOn]);
  // 没注册的组不许被点亮：模型给的字符串不能凭空造出一个组。
  assert.throws(() => laneToolMenu({ groups, activeGroup: 'nope' }), /Unknown lane tool group/);
});

test('按需装载：工具顺序是合同（前缀稳定才有缓存），两次算出来必须逐字相同', () => {
  assert.deepEqual(laneToolMenu().activeToolNames, laneToolMenu().activeToolNames);
  assert.deepEqual(
    laneToolMenu({ activeGroup: LANE_CODING_TOOL_GROUP }).activeToolNames,
    laneToolMenu({ activeGroup: LANE_CODING_TOOL_GROUP }).activeToolNames,
  );
});

test('预算判定两条各挡各的（先证会红：R17）', () => {
  // 常驻数超了。
  assert.equal(evaluateLaneToolBudget({ alwaysOnCount: 13, combinations: [] }).length, 1);
  // 常驻数没变，但某个组合的 schema 胖了。
  const fat = evaluateLaneToolBudget({
    alwaysOnCount: 11,
    combinations: [{ label: 'always-on + coding', toolNames: [], estimatedTokens: 12_345 }],
  });
  assert.equal(fat.length, 1);
  assert.match(fat[0] ?? '', /read \/ write.*子组/, '超限的处置必须写在报错里，不然下一个人只会去抬上限');
  assert.match(fat[0] ?? '', /不是.*抬这个上限/);
  // 都没超 = 绿。**阳性对照的对照**：这一条恒绿才说明上面两条不是恒红。
  assert.deepEqual(evaluateLaneToolBudget({
    alwaysOnCount: 11,
    combinations: [{ label: 'ok', toolNames: [], estimatedTokens: 6_854 }],
  }), []);
});

test('B1c the full resident catalog has no report-only budget exemption', () => {
  assert.equal(evaluateLaneToolBudget({ alwaysOnCount: 12,
    combinations: [{ label: 'all resident', toolNames: [], estimatedTokens: 10001 }],
  }).length, 1);
});

// ── effects 自洽（与 laneTools.mts 同一条装配期不变量）──────────────────

test('每个 coding 工具的效果是四值词表里的一个，且 coding 工具不花供应商的钱', () => {
  for (const name of LANE_CODING_TOOL_NAMES) {
    const effect = LANE_CODING_TOOL_EFFECTS[name];
    assert.ok(effect, `${name} 没声明 effect`);
    assert.ok(VERB_EFFECTS.includes(effect), `${name} 的 effect 不在词表里`);
    assert.equal(laneToolBillable(effect), false, 'coding 工具不花供应商的钱');
  }
});

test('只读的 coding 工具崩溃恢复可以安全重放，写入的不行', async (t) => {
  const dir = await projectDir(t);
  const tools = await createLaneCodingTools({
    projectDir: dir,
    sandbox: { active: true, operations: localOperations, close: async () => undefined },
    bashTimeoutMs: 5_000,
    factories: await loadPiCodingToolFactories(),
  });
  assert.equal(tools.length, LANE_CODING_TOOL_NAMES.length, 'pi 的 coding 工具数变了——先读 CHANGELOG');
  for (const tool of tools) {
    const effect = LANE_CODING_TOOL_EFFECTS[tool.name as LaneCodingToolName];
    assert.ok(effect, `pi 给了一个我们没声明 effect 的工具：${tool.name}`);
    const expected = laneToolMutates(effect) ? 'never' : 'safe';
    assert.equal(tool.replay, expected, `${tool.name} 的 replay 派生错了`);
  }
});

// ── OS 级沙箱：真的拒，不是我们说它拒 ────────────────────────────────────

test('沙箱在 OS 层真的挡住 ~/.ssh 与出网（macOS 实跑；其他平台明说跳过）', async (t) => {
  if (process.platform !== 'darwin') {
    t.skip('这台机器不是 macOS——sandbox-exec 不在，跳过而不是假装通过');
    return;
  }
  const dir = await projectDir(t);
  const { SandboxManager } = await import('@anthropic-ai/sandbox-runtime');
  const manager = SandboxManager as unknown as SandboxManagerLike;
  const sandbox = await openLaneSandbox(
    sandboxPolicyFor({ projectDir: dir, settingsRoot: path.join(dir, '__settings__') }),
    { manager, localOperations },
  );
  t.after(() => sandbox.close());
  assert.equal(sandbox.active, true, `沙箱没起来：${sandbox.inactive?.detail ?? ''}`);

  const run = async (command: string) => {
    let output = '';
    const result = await sandbox.operations.exec(command, dir, {
      onData: (chunk) => { output += chunk.toString('utf8'); },
      timeout: 20_000,
    });
    return { output, exitCode: result.exitCode };
  };

  // 阳性对照先跑：项目内读写必须成功。它不成立的话，下面两条「被拒」就可能只是沙箱把一切都拒了。
  await writeFile(path.join(dir, 'inside.txt'), 'hello\n', 'utf8');
  const inside = await run('cat inside.txt && echo written > out.txt && cat out.txt');
  assert.match(inside.output, /hello/, '项目内读被拒了——那这套沙箱配置本身是坏的');
  assert.match(inside.output, /written/, '项目内写被拒了');

  const ssh = await run('ls ~/.ssh 2>&1 | head -2');
  assert.match(ssh.output, /Operation not permitted|No such file/, `~/.ssh 没被 OS 层挡住：${ssh.output}`);

  const net = await run('curl -s -m 8 https://example.com -o /dev/null -w "%{http_code}" 2>&1 | tail -1');
  assert.ok(!/^2\d\d/m.test(net.output.trim()), `出网没被挡住：${net.output}`);
});
