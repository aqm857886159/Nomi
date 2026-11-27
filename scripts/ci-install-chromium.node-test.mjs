// ci-install-chromium.sh 的「超时就结束整组」必须真的连孙进程一起结束：
// 2026-10-07 main 4c88addfc 那次，外层 timeout 只杀了直接子进程，留下的进程占着锁，后面每次重试都失败。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { cleanupTestTemp, makeTempDir } from './_test-temp.mjs'
import { fileURLToPath } from 'node:url'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ci-install-chromium.sh')
const source = fs.readFileSync(script, 'utf8')
const fn = source.slice(source.indexOf('run_group_with_timeout() {'), source.indexOf('\n}\n', source.indexOf('run_group_with_timeout() {')) + 3)

function runBash(body) {
  return spawnSync('bash', ['-c', `set -euo pipefail\n${fn}\n${body}`], { encoding: 'utf8', timeout: 60000 })
}

test('超时会结束这一次起的整个进程组（孙进程也不留下）', () => {
  const marker = `nomi-ci-group-${process.pid}`
  // 只数这一次起的 sleep：秒数按本进程取一个别人不会用的数。按「sleep 30」数的是整台机器，
  // 别的任务正好用 sleep 30 轮询时就误报残留（2026-10-24 多条线共用一台 Mac，所有人的 gates 都红在这里）。
  const seconds = 3000 + (process.pid % 997)
  const result = runBash(`set +e; run_group_with_timeout 2 bash -c 'sleep ${seconds} & sleep ${seconds} & wait' ${marker}; echo "rc=$?"; sleep 1; ps -eo comm=,args= | awk '$1 == "sleep" && $2 == "sleep" && $3 == "${seconds}"' | wc -l`)
  assert.match(result.stdout, /rc=124/)
  const leftover = Number(result.stdout.trim().split('\n').pop())
  assert.equal(leftover, 0, `超时后还剩 ${leftover} 个子孙进程：${result.stdout}${result.stderr}`)
})

test('没超时就原样返回命令的退出码', () => {
  assert.match(runBash(`set +e; run_group_with_timeout 10 bash -c 'exit 0'; echo "rc=$?"`).stdout, /rc=0/)
  assert.match(runBash(`set +e; run_group_with_timeout 10 bash -c 'exit 3'; echo "rc=$?"`).stdout, /rc=3/)
})

test('系统依赖（apt）不套外层超时，并且让 apt 自己等锁、限时、重试', () => {
  assert.match(source, /DPkg::Lock::Timeout/)
  assert.match(source, /Acquire::Retries/)
  assert.doesNotMatch(source, /timeout[^\n]*install-deps/)
  assert.doesNotMatch(source, /install --with-deps/)
})

test('重试只记普通日志、不发 ::warning:: 注解（注解卫生检查会把它当意外警告）；三次都失败才 ::error::', () => {
  assert.doesNotMatch(source, /echo "::warning::/)
  assert.match(source, /::error::/)
})

const mirror = 'mirror+file:/etc/apt/apt-mirrors.txt'
const nobleSources = [
  'Types: deb', `URIs: ${mirror}`, 'Suites: noble noble-updates',
  'Components: main universe', 'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg', '',
  'Types: deb', 'URIs: http://security.ubuntu.com/ubuntu/', 'Suites: noble-security',
  'Components: main universe', 'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg', '',
].join('\n')
const jammyList = [
  `deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] ${mirror} jammy main`,
  'deb https://archive.ubuntu.com/ubuntu jammy-updates main',
  'deb-src http://security.ubuntu.com/ubuntu jammy-security main', '',
].join('\n')

const mainList = 'sources.list'
const dropIn = 'sources.list.d/'
const ubuntuList = dropIn + 'ubuntu.list'
const ubuntuSources = dropIn + 'ubuntu.sources'
const comment = '# Sources configured in sources.list.d\n'
const vendorLine = 'deb [arch=amd64] https://archive.ubuntu.com.vendor.invalid/ubuntu jammy main # ubuntu.com\n'
const vendorStanza = 'Types: deb\nURIs: https://repo.vendor.invalid/packages\nSuites: stable\nComponents: main\n'
const badParts = {
  [dropIn + 'vendor.list']: 'deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n',
  [dropIn + 'another.sources']: vendorStanza,
}
const movedParts = Object.fromEntries(Object.keys(badParts).map(name => [name, null]))
const foldedOfficial = [
  'Types: deb', 'Uris: HTTP://PORTS.UBUNTU.COM:80/ubuntu-ports   https://canonical.com',
  '# continuation follows the comment', `\t${mirror}  file:/etc/apt/apt-mirrors.txt`,
  'Suites: noble', 'Components: main', '',
].join('\n')
const mixedSources = [
  foldedOfficial,
  'Types: deb\nURIs: https://archive.ubuntu.com https://repo.vendor.invalid\nSuites: noble\n',
  'Types: deb\nURIs: https://canonical.com\n# still in URIs\n https://repo.vendor.invalid\n',
  'Types: deb\n# URIs: https://canonical.com\nSuites: noble\n',
  'Types: deb\nURIs:\nComponents: main\n',
  nobleSources,
].join('\n')

for (const { name, files, changes, officialFile } of [
  {
    name: 'noble', files: { [mainList]: comment, [ubuntuSources]: nobleSources, ...badParts },
    changes: movedParts, officialFile: ubuntuSources,
  },
  {
    name: 'jammy', files: { [mainList]: jammyList + vendorLine, ...badParts },
    changes: { [mainList]: jammyList, ...movedParts }, officialFile: mainList,
  },
  {
    name: '官方源只在 ubuntu.list', files: { [mainList]: comment, [ubuntuList]: jammyList.trimEnd(), ...badParts },
    changes: movedParts, officialFile: ubuntuList,
  },
  {
    name: '第三方整文件改名 ubuntu.sources', files: { [mainList]: jammyList, [ubuntuSources]: vendorStanza },
    changes: { [ubuntuSources]: null }, officialFile: mainList,
  },
  {
    name: '混合 list 分片',
    files: {
      [mainList]: comment, [ubuntuList]: comment + vendorLine + jammyList + 'invalid entry\n',
      [dropIn + 'empty.list']: '# disabled\n',
    },
    changes: { [ubuntuList]: comment + jammyList, [dropIn + 'empty.list']: null }, officialFile: ubuntuList,
  },
  {
    name: 'DEB822 多 URI 和折行按整段筛选',
    files: {
      [mainList]: comment, [ubuntuSources]: mixedSources,
      [dropIn + 'regional.sources']: foldedOfficial.trimEnd(),
      [dropIn + 'disabled.sources']: '# URIs: https://archive.ubuntu.com\n',
    },
    changes: { [ubuntuSources]: foldedOfficial + '\n' + nobleSources, [dropIn + 'disabled.sources']: null },
    officialFile: ubuntuSources,
  },
]) {
  test(`${name}: 故障源移走后用官方源安装系统依赖，再下载 Chromium`, (t) => {
    const root = makeTempDir('ci-chromium')
    t.after(() => cleanupTestTemp(root))
    const put = (name, value, mode) => fs.writeFileSync(path.join(root, name), value, { mode })
    const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
    for (const dir of ['etc/apt/sources.list.d', 'etc/apt/apt.conf.d', 'bin', 'backup']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true })
    }
    for (const [name, value] of Object.entries(files)) put('etc/apt/' + name, value, 0o600)
    put('etc/apt/apt-mirrors.txt', 'https://archive.ubuntu.com/ubuntu/\tpriority:2\n')

    // The old script also reaches our fake apt without touching the host.
    put('bin/sudo', `#!/bin/sh
if [ "$1" = tee ] && [ "$2" = /etc/apt/apt.conf.d/99nomi-ci ]; then
  exec tee etc/apt/apt.conf.d/99nomi-ci
fi
exec "$@"
`, 0o755)
    put('bin/pnpm', `#!/bin/sh
case "$*" in
  'exec playwright install-deps chromium') apt-get update && apt-get install libnss3 ;;
  'exec playwright install chromium') echo browser >> steps ;;
  *) exit 2 ;;
esac
`, 0o755)
    put('bin/apt-get', `#!/bin/sh
set -eu
echo "$*" >> steps
for f in etc/apt/sources.list etc/apt/sources.list.d/*.list etc/apt/sources.list.d/*.sources; do
  [ -f "$f" ] || continue
  if grep -Eq 'packages[.]microsoft[.]com|vendor[.]invalid' "$f"; then
    echo '403 Forbidden: repository is no longer signed' >&2
    exit 100
  fi
done
if [ "$1" = install ]; then
  [ -f "$OFFICIAL_FILE" ] && grep -qF '${mirror}' "$OFFICIAL_FILE" && grep -q 'archive.ubuntu.com' etc/apt/apt-mirrors.txt ||
    { echo 'Unable to locate package libnss3' >&2; exit 100; }
fi
`, 0o755)

    const result = spawnSync('bash', [script, 'etc/apt', 'backup'], {
      cwd: root, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH,
        RUNNER_ENVIRONMENT: 'github-hosted', OFFICIAL_FILE: 'etc/apt/' + officialFile },
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(read('steps'), 'update\ninstall libnss3\nbrowser\n')
    for (const [name, original] of Object.entries(files)) {
      const active = 'etc/apt/' + name
      const backup = 'backup/' + name
      const changed = Object.hasOwn(changes, name)
      if (changed) assert.equal(read(backup), original, name)
      else assert.equal(fs.existsSync(path.join(root, backup)), false, name)
      if (changes[name] === null) {
        assert.equal(fs.existsSync(path.join(root, active)), false, name)
      } else {
        assert.equal(read(active), changed ? changes[name] : original, name)
        assert.equal(fs.statSync(path.join(root, active)).mode & 0o777, changed ? 0o644 : 0o600, name)
      }
    }
  })
}
