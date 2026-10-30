'use strict';
// 安装器清单（Windows NSIS）：构建时从打包产物算出「安装器往安装目录里放了哪些文件、哪些目录」，给 build/installer.nsh 用。
//
// 为什么要它：electron-builder 默认卸载段是 `RMDir /r $INSTDIR`，用户放进安装目录的东西会一起被删
// （2026-10-29：用户把项目位置设在安装目录下，0.24.0 一升级 5 个项目全没了，回收站也没有）。
// 修好之后卸载只删这份清单里的条目；从 0.24.0 升上来那一次，安装程序按清单的顶层名把「外来条目」先挪开。
// 清单不许手抄：afterPack 每次打包（剪完平台二进制之后）现算，NSIS 编译时按版本号核对，旧清单编不进去。
//
// 输出两份，同一次生成、同一份事实：
//   .tmp/installer-manifest/<产品文件名>-<架构>.nsh   给 makensis（数据宏，不含逻辑）
//   .tmp/installer-manifest/<产品文件名>-<架构>.json  给测试与 Windows 安装作业
//
// 打包产物之外、安装器也会放进安装目录的东西，按 electron-builder 26.15.3 的规则补：
//   · resources\elevate.exe：afterPack 之后才由 CopyElevateHelper 拷进去（packElevateHelper 不为 false，或 perMachine 为 true）；
//   · Uninstall <产品文件名>.exe 与可选的 uninstallerIcon.ico：由 NSIS 自己写，installer.nsh 里用 ${UNINSTALL_FILENAME} 等常量处理，不进清单。
/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder 以 CommonJS 加载 afterPack（scripts/after-pack-mac.cjs），本模块由它 require，只能是 CommonJS */
const fs = require('node:fs');
const path = require('node:path');
const { normalizeArch } = require('./native-binaries.cjs');
/* eslint-enable @typescript-eslint/no-require-imports */

const MANIFEST_DIR = ['.tmp', 'installer-manifest'];
const SUPPORTED_ARCHS = new Set(['x64']);
const ELEVATE_HELPER = 'resources\\elevate.exe';

/** 只按 UTF-16 码元比较，保证同一棵树在任何机器上输出逐字节相同（localeCompare 随区域设置变）。 */
function compareNames(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function manifestPaths(projectDir, productFilename, arch) {
  const base = path.join(projectDir, ...MANIFEST_DIR, `${productFilename}-${arch}`);
  return { nsh: `${base}.nsh`, json: `${base}.json` };
}

function uninstallerFileName(productFilename) {
  // 与 electron-builder templates/nsis/common.nsh 的 UNINSTALL_FILENAME 同一个规则。
  return `Uninstall ${productFilename}.exe`;
}

/** electron-builder CopyElevateHelper 的判据（nsisUtil.js），只用于 Electron 框架。 */
function packsElevateHelper(nsisOptions) {
  return nsisOptions.packElevateHelper !== false || nsisOptions.perMachine === true;
}

/**
 * 遍历打包产物。7z 打包时跟随符号链接，这里也跟随；按真实路径记住祖先，遇到环直接报错。
 * 返回的 dirs 是前序（父目录在子目录之前），files / dirs 都用 Windows 分隔符的相对路径。
 */
function walkAppOutDir(appOutDir) {
  const files = [];
  const dirs = [];
  const ancestors = new Set();
  const walk = (absDir, relDir) => {
    const real = fs.realpathSync(absDir);
    if (ancestors.has(real)) throw new Error(`installer manifest: symlink cycle at ${absDir}`);
    ancestors.add(real);
    const names = fs.readdirSync(absDir).sort(compareNames);
    for (const name of names) {
      const abs = path.join(absDir, name);
      const rel = relDir ? `${relDir}\\${name}` : name;
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        dirs.push(rel);
        walk(abs, rel);
      } else if (stat.isFile()) {
        files.push(rel);
      } else {
        throw new Error(`installer manifest: unsupported entry type at ${abs}`);
      }
    }
    ancestors.delete(real);
  };
  walk(appOutDir, '');
  return { files, dirs };
}

/**
 * NSIS 字符串转义：`$` 写成 `$$`。`${` 会被预处理器当成 define 展开、在引号里也一样，碰到直接报错，不猜。
 * Windows 文件名本来就不可能含 `"` 和控制字符；出现了说明产物不对，同样报错。
 */
function nsisQuote(value) {
  if (value.includes('${')) throw new Error(`installer manifest: name contains "\${", cannot be expressed in NSIS: ${value}`);
  if ([...value].some((ch) => ch === '"' || ch.charCodeAt(0) < 0x20)) throw new Error(`installer manifest: name contains a quote or control character: ${JSON.stringify(value)}`);
  return `"${value.replaceAll('$', '$$$$')}"`;
}

function topLevelNamesOf(files, dirs) {
  const names = new Set();
  for (const rel of [...files, ...dirs]) names.add(rel.split('\\')[0]);
  return [...names].sort(compareNames);
}

function renderNsh(manifest) {
  const lines = [
    '; 生成文件：scripts/packaging/installer-manifest.cjs 在 afterPack 里写出，不要手改、不要提交。',
    '; 数据宏只列条目，逻辑全在 build/installer.nsh；每个宏的参数是回调宏的名字，每个条目调用一次。',
    `!define NOMI_INSTALLER_MANIFEST_VERSION ${nsisQuote(manifest.version)}`,
    `!define NOMI_INSTALLER_MANIFEST_FILE_COUNT ${manifest.files.length}`,
  ];
  const macro = (name, entries) => {
    lines.push(`!macro ${name} _M`);
    for (const entry of entries) lines.push(`  !insertmacro \${_M} ${nsisQuote(entry)}`);
    lines.push('!macroend');
  };
  macro('NOMI_INSTALLER_TOP_LEVEL_NAMES', manifest.topLevelNames);
  macro('NOMI_INSTALLER_FILES', manifest.files);
  macro('NOMI_INSTALLER_DIRS', manifest.dirs);
  macro('NOMI_INSTALLER_DIRS_DEEPEST_FIRST', [...manifest.dirs].reverse());
  return `${lines.join('\n')}\n`;
}

/** 只算不写：给测试和 writeInstallerManifest 共用。 */
function computeInstallerManifest({ appOutDir, productFilename, version, arch, nsisOptions = {}, fileAssociations = [] }) {
  const archName = normalizeArch(arch);
  if (!SUPPORTED_ARCHS.has(archName)) {
    throw new Error(`installer manifest: arch ${archName || String(arch)} is not supported (build/installer.nsh only handles x64)`);
  }
  if (Array.isArray(fileAssociations) && fileAssociations.length > 0) {
    // 文件关联会在安装时往 resources\ 里额外写图标（NsisTarget computeFinalScript），清单里没有它们。
    throw new Error('installer manifest: fileAssociations add install-time files to resources\\; teach scripts/packaging/installer-manifest.cjs about them first');
  }
  if (!productFilename || !version) throw new Error('installer manifest: productFilename and version are required');
  const { files, dirs } = walkAppOutDir(appOutDir);
  if (files.length === 0) throw new Error(`installer manifest: ${appOutDir} has no files`);
  if (packsElevateHelper(nsisOptions)) {
    if (!dirs.includes('resources')) throw new Error('installer manifest: elevate.exe goes to resources\\ but the packed app has no resources directory');
    if (!files.includes(ELEVATE_HELPER)) {
      files.push(ELEVATE_HELPER);
      files.sort(compareNames);
    }
  }
  for (const entry of [...files, ...dirs]) nsisQuote(entry);
  return {
    version,
    productFilename,
    arch: archName,
    uninstallerFileName: uninstallerFileName(productFilename),
    topLevelNames: topLevelNamesOf(files, dirs),
    files,
    dirs,
  };
}

/** afterPack 调用：算清单并写出 NSH + JSON。返回写到哪里和清单本身。 */
function writeInstallerManifest(options) {
  const manifest = computeInstallerManifest(options);
  const target = manifestPaths(options.projectDir, manifest.productFilename, manifest.arch);
  fs.mkdirSync(path.dirname(target.nsh), { recursive: true });
  fs.writeFileSync(target.nsh, renderNsh(manifest), 'utf8');
  fs.writeFileSync(target.json, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { ...target, manifest };
}

module.exports = {
  ELEVATE_HELPER,
  computeInstallerManifest,
  manifestPaths,
  nsisQuote,
  renderNsh,
  uninstallerFileName,
  walkAppOutDir,
  writeInstallerManifest,
};
