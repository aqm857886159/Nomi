# Nomi Desktop

Nomi 的桌面端（Electron），基于 apps/web + apps/hono-api 构建，无需 Docker，双击即用。

## 开发

```bash
# 根目录安装依赖
pnpm install

# 构建 hono-api
pnpm build:api

# 启动 desktop（需要 hono-api 已构建，web dev server 会自动启动）
pnpm dev:desktop
```

## 生产构建

```bash
# 构建所有产物并打包安装包
pnpm dist:desktop
```

产物输出到 `apps/desktop/dist-release/`。

## GitHub Actions CI

Push 一个 `v*.*.*` 格式的 tag 即可触发自动构建：

```bash
git tag v1.0.0
git push origin v1.0.0
```

## 所需 GitHub Secrets

| Secret | 说明 | 必须 |
|--------|------|------|
| `MAC_CSC_LINK` | macOS 签名证书 (.p12) 的 base64 编码 | 可选 |
| `MAC_CSC_KEY_PASSWORD` | 签名证书密码 | 可选 |
| `APPLE_ID` | Apple Developer 账号邮箱 | 可选（公证用） |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple 专用 App 密码 | 可选（公证用） |
| `APPLE_TEAM_ID` | Apple 开发者 Team ID | 可选（公证用） |
| `WIN_CSC_LINK` | Windows 签名证书 (.p12) base64 | 可选 |
| `WIN_CSC_KEY_PASSWORD` | Windows 证书密码 | 可选 |

> 未配置签名证书时，安装包仍可正常构建和运行，但 macOS 会有 Gatekeeper 警告，Windows 会有 SmartScreen 提示。
