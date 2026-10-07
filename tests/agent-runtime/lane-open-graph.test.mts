import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CURRENT_SESSION_VERSION } from '@earendil-works/pi-coding-agent';
import { LEGACY_PI_SESSION_VERSION } from '../../electron/shared/agentLane/legacyPiSnapshot.mjs';

// 类级检查（逃逸 FB-20261005-01-open-agent-load，docs/fixes/2026-10-06-agent-runtime-lazy-load.root-cause.json）：
// 打开项目路径上被装的每一个 Agent 岛入口，整张模块图里都不许有 pi-coding-agent 的入口——那是一整个 CLI（约 1500 个文件），
// Electron 的 Node 同步装 ESM，主进程这段时间什么 IPC 都不接。
//
// 清单只有一份：electron/agentLane/laneNativeLoader.entries.json（入口登记表，按 open / use 分阶段）。
// 它的完整性由下面第一条普查保证：从 laneNativeLoader.cts 源码取出全部 `import('./X.mjs')`，与登记表双向比对；
// 再扫整个 electron/ 确认主进程没有第二座 CJS → 岛的桥。新增入口忘了登记 = 第一条红。
// 每个 open 入口在子进程里用 Node 官方 module.registerHooks 的 load 钩子数真装载的文件（不受本进程已装模块影响）。

function findRepoRoot(start: string): string {
  for (let dir = start; ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).name === 'nomi') return dir;
    if (path.dirname(dir) === dir) throw new Error('repository root not found');
  }
}
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);
const LOADER = 'electron/agentLane/laneNativeLoader.cts';
const REGISTRY_FILE = 'electron/agentLane/laneNativeLoader.entries.json';
type Phase = 'open' | 'use';
const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, REGISTRY_FILE), 'utf8')) as {
  entries: Record<string, { phase: Phase; via: string; when: string }>;
};
const ENTRY = /pi-coding-agent\/dist\/index\.js$/; // file: URL 的分隔符永远是 /
const DYNAMIC_ISLAND_IMPORT = /\bimport\(\s*['"](\.{1,2}\/[^'"]+\.mjs)['"]\s*\)/g;

/** 去掉注释再找 import：注释里举例的写法不算入口。 */
function code(file: string): string {
  return fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function loaderImports(): string[] {
  const source = code(path.join(repoRoot, LOADER));
  return [...new Set([...source.matchAll(DYNAMIC_ISLAND_IMPORT)].map((match) => match[1]))].sort();
}

/** 编译后的岛模块（测试与产品同一份 tsc 产物，相对本测试文件的位置与源码树一致）。 */
function compiledIslandUrl(specifier: string): string {
  return new URL(`../../electron/agentLane/${specifier.replace(/^\.\//, '')}`, import.meta.url).href;
}

function loadedBy(urls: readonly string[]): { entry: boolean; count: number } {
  const script = `
    import module from 'node:module';
    const loaded = [];
    module.registerHooks({ load(url, context, next) { if (url.startsWith('file:')) loaded.push(decodeURIComponent(url)); return next(url, context); } });
    for (const url of ${JSON.stringify(urls)}) await import(url);
    process.stdout.write(JSON.stringify({ entry: loaded.some((url) => ${ENTRY}.test(url)), count: loaded.length }));
  `;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
}

test('census: every island entry the loader can import is registered (both ways), and the loader is the only bridge', () => {
  assert.deepEqual(loaderImports(), Object.keys(registry.entries).sort(),
    `${LOADER} 的 import 与 ${REGISTRY_FILE} 不一致：新增入口必须登记 phase（open / use）`);
  for (const [specifier, entry] of Object.entries(registry.entries)) {
    assert.ok(entry.phase === 'open' || entry.phase === 'use', `${specifier} 的 phase 只能是 open / use`);
    assert.ok(entry.via && entry.when, `${specifier} 要写清从哪个导出进来、什么时候装`);
  }
  // 第二座桥：主进程（CJS 侧）任何地方直接 import 岛模块，都会绕过这张登记表。
  const bridges: string[] = [];
  const walk = (dir: string): void => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (/\.(?:ts|cts|tsx)$/.test(item.name) && !/\.test\.|\.d\.ts$/.test(item.name)) {
        const rel = path.relative(repoRoot, file).split(path.sep).join('/');
        if (rel !== LOADER && DYNAMIC_ISLAND_IMPORT.test(code(file))) bridges.push(rel);
        DYNAMIC_ISLAND_IMPORT.lastIndex = 0;
      }
    }
  };
  walk(path.join(repoRoot, 'electron'));
  assert.deepEqual(bridges, [], '主进程只许经 laneNativeLoader.cts 进岛');
});

const openEntries = Object.entries(registry.entries).filter(([, entry]) => entry.phase === 'open');
for (const [specifier, entry] of openEntries) {
  test(`open-path entry ${specifier} (${entry.via}) never loads the pi-coding-agent entry`, () => {
    const loaded = loadedBy([compiledIslandUrl(specifier)]);
    assert.equal(loaded.entry, false, `${specifier}（${entry.when}）的模块图里出现了 pi-coding-agent 入口（共 ${loaded.count} 个文件）`);
  });
}

test('the open-path set is not empty (otherwise the census above proves nothing)', () => {
  assert.ok(openEntries.length >= 2);
});

test('positive control: the place that really needs it (native desktop: bash / sandbox) still loads it on use', () => {
  // 阳性对照：同一个探测在真正用到的模块上必须看得见入口，否则「没有」可能只是探测瞎了。
  const native = loadedBy([compiledIslandUrl('./laneNativeDesktop.mjs')]);
  assert.equal(native.entry, true);
});

test('the legacy pi snapshot version stays identical to upstream', () => {
  assert.equal(LEGACY_PI_SESSION_VERSION, CURRENT_SESSION_VERSION);
});
