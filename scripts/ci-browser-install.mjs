// CI 里装 Playwright Chromium 只有一种写法：调共享脚本（每次限时、挂住重试）。
// workflow 契约测试从这里取这一行，不各自手抄命令——手抄的那份在命令换掉时会漏改。
export const CHROMIUM_INSTALL_STEP = 'bash scripts/ci-install-chromium.sh'
