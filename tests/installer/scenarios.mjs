// Windows 安装器场景登记（清单）。设计卡 ★9：docs/plan/2026-10-29-installer-keep-user-files.md。
//
// 三方共用这一份：
//   · tests/installer/windows-installer-scenarios.mjs：.github/workflows/win-installer.yml 在 windows-latest 上逐个真装真升真卸；
//   · tests/installer/installerScenarios.test.mjs：普查——每个覆盖面有场景认领、每个场景有执行器、工作流跑全部、
//     build/installer.nsh 的字面量与这里逐字一致、每个反例的改动在 installer.nsh 里恰好一处；
//   · build/installer.nsh：能力标记名与它的 !define 对账，改一边不改另一边普查就红。

/** 能力标记：只信等于同根 DisplayVersion 的非空值。 */
export const MARKER_VALUE_NAME = 'RemovesOnlyOwnFiles'
/**
 * 新项目的默认位置 = 「文档」下的这个文件夹（electron/runtimePaths.ts 的 defaultProjectsFolderName，应用名是 Nomi 时）。
 * 执行器把「默认位置」的用户数据种在这里；普查测试核对应用代码里还是这个名字、还是「文档」目录。
 */
export const DEFAULT_PROJECTS_FOLDER = 'Nomi Projects'

/** 任务书点名、设计卡 ★9 要覆盖的面；每一项至少一个场景认领。 */
export const REQUIRED_COVERAGE = Object.freeze({
  'user-folder-with-project': '安装目录里有用户文件夹，含 .nomi\\project.json',
  'loose-user-file': '安装目录顶层有一个散文件',
  'install-dir-full-of-user-files': '安装目录本身就是装满用户文件的目录',
  'old-to-new': '旧版 0.24.0 → 新版',
  'new-to-newer': '新版 → 更新版（新卸载程序）',
  'plain-uninstall': '普通卸载',
  'locked-user-file': '用户文件被别的程序占着',
  'reinstall-changed-dir': '手动重装时改了目录',
  'no-foreign-no-residue': '没有任何外来文件时不留残渣',
  'interrupted-run': '安装中途被打断后续上',
  'app-still-running': '应用还开着时就开始升级',
  'per-machine': '旧版装给了所有用户',
  'stale-marker': '注册表里有别的版本写的标记',
  'locked-uninstaller': '登记卸载程序不可替换时，在执行前中止',
  'late-deleter': '只终止父安装器后，迟到的卸载进程继续运行',
  'unowned-sidecar': '没有待恢复记录的同名旁边目录属于用户',
  'nested-old-upgrade': '旧版升级那一次的安装器子目录内用户文件',
  'user-data-three-places': '用户数据放三处（默认位置、安装目录外的自选位置、安装目录里），升级后、卸载后各验一遍',
})

/** 每个场景：id（执行器按它认领）、设计卡编号、认领的覆盖面、一句话。断言细节在执行器里，和设计卡 ★9 表逐行对应。 */
export const SCENARIOS = Object.freeze([
  {
    id: 'old-to-new-user-folder',
    card: 'A1',
    covers: ['user-folder-with-project', 'loose-user-file', 'old-to-new', 'user-data-three-places', 'nested-old-upgrade', 'plain-uninstall'],
    title: '事故原样：0.24.0 装在 Nomi_new，项目在 xiangmu、顶层有散文件，另有默认位置和安装目录外自选位置的项目；新包 --updated /S 升级，再用新卸载程序卸载',
  },
  {
    id: 'old-to-new-dir-full-of-user-files',
    card: 'A2',
    covers: ['install-dir-full-of-user-files', 'old-to-new', 'plain-uninstall'],
    title: '中文带空格目录本来就塞满用户文件（多层、隐藏、只读、空目录、0 字节），0.24.0 装进去 → 升级 → 新版卸载',
  },
  {
    id: 'old-to-new-app-still-running',
    card: 'A3',
    covers: ['app-still-running', 'old-to-new'],
    title: '旧版 Nomi 以 xiangmu 为工作目录还开着时升级：默认模板结束应用，用户文件不动',
  },
  {
    id: 'old-to-new-locked-user-file',
    card: 'A4',
    covers: ['locked-user-file', 'old-to-new'],
    title: '用户文件被独占打开：用户文件被占用不挡更新，无对话框、文件原样',
  },
  {
    id: 'old-to-new-changed-dir',
    card: 'A5',
    covers: ['reinstall-changed-dir', 'old-to-new'],
    title: '手动重装改目录（/D=，不带 --updated）：用户文件留在旧目录原路径',
  },
  {
    id: 'old-to-new-per-machine',
    card: 'A6',
    covers: ['per-machine', 'old-to-new'],
    title: '0.24.0 装给所有用户（HKLM）：旧卸载程序跑两轮，每个可执行的登记先换成清单卸载器',
  },
  {
    id: 'old-to-new-stale-marker',
    card: 'A7',
    covers: ['stale-marker', 'old-to-new'],
    title: '注册表标记是别的版本写的：不信，替换登记的卸载程序',
  },
  {
    id: 'old-to-new-no-foreign-then-uninstall',
    card: 'A8',
    covers: ['no-foreign-no-residue', 'old-to-new', 'plain-uninstall'],
    title: '没有外来文件：升级后顶层恰好是清单 + 卸载程序，卸载后目录不存在',
  },
  {
    id: 'interrupted-after-replace',
    card: 'A9',
    covers: ['interrupted-run', 'old-to-new'],
    title: '上次换好安全卸载器后被打断：重跑升级，用户文件不动',
  },
  {
    id: 'interrupted-after-replaced-uninstaller-ran',
    card: 'A10',
    covers: ['interrupted-run', 'old-to-new'],
    title: '安全卸载器已跑完时被打断：重装原目录，用户文件原地',
  },
  {
    id: 'new-to-new-update',
    card: 'A11',
    covers: ['new-to-newer', 'locked-user-file', 'user-data-three-places', 'plain-uninstall'],
    title: '新版 → 新版：三处用户数据（含被占用的、嵌套在 resources\\ 和 locales\\ 里的）不挡升级、都留着；再卸载，三处还在',
  },
  {
    id: 'new-to-new-changed-dir',
    card: 'A12',
    covers: ['new-to-newer', 'reinstall-changed-dir'],
    title: '新版改目录重装：旧目录只剩用户文件',
  },
  {
    id: 'new-uninstall-keeps-user-files',
    card: 'A13',
    covers: ['plain-uninstall'],
    title: '普通卸载：清单文件全删、用户文件全留、含用户文件的目录留着、注册表与快捷方式清掉',
  },
  {
    id: 'late-deleter-after-killed-installer', card: 'A14',
    covers: ['late-deleter', 'interrupted-run', 'old-to-new'],
    title: 'IFEO 卡住旧卸载进程，只杀父安装器，重跑更新后放行迟到删除者，用户文件仍须原样',
  },
  {
    id: 'unowned-sidecar-untouched', card: 'A15',
    covers: ['unowned-sidecar', 'old-to-new', 'plain-uninstall'],
    title: '用户自己的同名旁边目录和说明文件，在升级与卸载后逐文件原样保留',
  },
  {
    id: 'old-to-new-locked-uninstaller', card: 'A16',
    covers: ['locked-uninstaller', 'old-to-new'],
    title: '独占登记卸载程序：静默下恰好一个双语框、退出 2、旧版字节与登记不变；释放后重试成功',
  },
])

/**
 * Windows 作业里的反例：执行器按 find → replace 临时生成一份 installer.nsh（只在 .tmp 里，不改仓库文件），
 * 用 electron-builder --prepackaged 重打安装包，再跑 expectRed 场景，必须红，而且红在 failureMatch。
 * 红不了，作业就红：说明那个场景量不到它声称守住的东西。
 */
export const COUNTEREXAMPLES = Object.freeze([
  {
    id: 'remove-all-on-uninstall', card: 'CX1',
    expectRed: 'new-uninstall-keeps-user-files', failureMatch: 'user file',
    find: '!insertmacro NOMI_INSTALLER_FILES nomiUnDeleteOwnedFile',
    replace: 'RMDir /r "$INSTDIR"',
  },
  {
    id: 'skip-replace', card: 'CX2',
    expectRed: 'old-to-new-user-folder', failureMatch: 'user file',
    alsoExpectRed: [
      { scenario: 'late-deleter-after-killed-installer', failureMatch: 'user file', additionalFailureMatch: 'held image is not the current uninstaller', legacyImage: true, card: 'CX9' },
      { scenario: 'unowned-sidecar-untouched', failureMatch: 'user file', card: 'CX2' },
    ],
    find: '    Function nomiReplaceUntrustedUninstaller\n',
    replace: '    Function nomiReplaceUntrustedUninstaller\n      Return\n',
  },
  {
    id: 'trust-every-version', card: 'CX11',
    expectRed: 'old-to-new-user-folder', failureMatch: 'user file',
    alsoExpectRed: [
      { scenario: 'late-deleter-after-killed-installer', failureMatch: 'user file', additionalFailureMatch: 'held image is not the current uninstaller', legacyImage: true, card: 'CX11' },
      { scenario: 'unowned-sidecar-untouched', failureMatch: 'user file', card: 'CX11' },
    ],
    find: '    ${If} $nomiMarker == ""\n    ${OrIf} $nomiMarker != $nomiVersion',
    replace: '    ${If} 0 == 1',
  },
  {
    id: 'silent-dialog', card: 'CX3',
    expectRed: 'old-to-new-locked-uninstaller', failureMatch: 'dialog',
    find: 'check write permission, and update Nomi again."',
    replace: 'check write permission, and update Nomi again." /SD IDOK',
  },
  {
    id: 'touch-unowned-sidecar', card: 'CX10',
    expectRed: 'unowned-sidecar-untouched', failureMatch: 'NOMI-INSTALLER-KEEP.txt',
    find: '    Function nomiReplaceUntrustedUninstaller\n',
    replace: '    Function nomiReplaceUntrustedUninstaller\n      Delete "$INSTDIR.nomi-keep\\NOMI-INSTALLER-KEEP.txt"\n',
  },
])
