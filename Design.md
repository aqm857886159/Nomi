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
- One thing, one home; the Agent only points: chat holds pointer elements, necessary confirmations and chat-native content, never mini editors or full previews (full design system §1.0).

## Tokens

- Background: `--nomi-bg`
- Surface: `--nomi-paper`
- Text: `--nomi-ink`
- Muted text: `--nomi-ink-60`
- Line: `--nomi-line`
- Accent: `--nomi-accent`
- Radius: `--nomi-radius-sm`, `--nomi-radius`, `--nomi-radius-lg`

## Motion

Use `src/design/motion.ts` for the six duration tiers. Bare Tailwind transitions use micro (110 ms) and ease-out. Fast, normal and spatial exits take two thirds of the enter duration, rounded to the nearest 10 ms. Text buttons and ComposerSendButton scale to 0.97 while pressed. Dense icon tools use color feedback. System reduced motion keeps loading and completion legible in a static frame. [Motion Language, §2.7](docs/design/nomi-design-system.md#27-motion-language动效语言)
