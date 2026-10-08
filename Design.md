# Nomi Design System

> **完整版设计系统在 [`docs/design/nomi-design-system.md`](docs/design/nomi-design-system.md)。**
> 本文档只保留高层原则与 token 速查；做任何新设计前请先读完整版。

Nomi is a dense, local-first AI video production workspace. The UI should help creators move through:

```txt
Script -> Generate -> Edit -> Preview -> Export
```

## Principles

- Light and dark modes: token-only switching, new colors go through semantic tokens (details in the full design system §1).
- No fake progress or mock completion states.
- Prioritize dense, useful production surfaces over decorative marketing layout.
- Use one clear visual hierarchy: spacing, typography, and subtle surface contrast before borders.
- Keep creator control explicit; AI suggestions should not hide final user decisions.
- Keep local project and asset visibility obvious in desktop workflows.

## Tokens

- Background: `--nomi-bg`
- Surface: `--nomi-paper`
- Text: `--nomi-ink`
- Muted text: `--nomi-ink-60`
- Line: `--nomi-line`
- Accent: `--nomi-accent`
- Radius: `--nomi-radius-sm`, `--nomi-radius`, `--nomi-radius-lg`
