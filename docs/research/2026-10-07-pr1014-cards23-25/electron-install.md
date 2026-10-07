# Electron install repair evidence

The audit started from `origin/main` `520466c13af5ccc9e4b2cafba89dcf05ca41388c`. The first `pnpm run delivery:preflight` could not create `/home/agent/.local/share/pnpm` (`ENOENT`). A frozen install with the repository's declared pnpm 10.8.1 then reached Electron's postinstall, but the configured `npmmirror.com` mirror was blocked by the environment proxy:

```text
curl: (56) CONNECT tunnel failed, response 403
HTTP/1.1 403 Forbidden
TypeError: fetch failed
Electron runtime installer failed (1)
```

Raw install logs are in [`raw/electron/`](raw/electron/). The blocked Playwright browser download is also retained there; Card 24 uses the preinstalled `/usr/bin/chromium` explicitly.

## Repair

`@electron/get` v5 only wires the environment proxy when `ELECTRON_GET_USE_PROXY=true`. I removed the blocked mirror override, enabled that proxy path, and reused an isolated cache:

```bash
unset ELECTRON_MIRROR ELECTRON_CUSTOM_DIR
export ELECTRON_GET_USE_PROXY=true
export ELECTRON_GET_NO_PROGRESS=1
export electron_config_cache=/tmp/nomi-electron-cache
node node_modules/electron/install.js
node scripts/install-electron-runtime.mjs
node scripts/check-electron-install.mjs
```

The repair downloaded and checksum-validated the official GitHub artifact, then the identity check passed:

```text
✅ Electron 43.4.1 runtime installed and verified
✅ Electron 安装身份一致：declared=43.4.1 · package=43.4.1 · dist=43.4.1 · runtime=43.4.1
```

The final `check:electron-install` test suite passed all 14 tests. No production source was changed for this repair.
