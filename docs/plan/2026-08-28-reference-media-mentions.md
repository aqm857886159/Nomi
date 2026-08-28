# Reference media mentions

状态：✅ 已交付

## Scope

- Make `@` suggestions cover all media-backed array reference slots, including video references in omni modes.
- Preserve the existing image `@imageN` behavior and URL-only persistence format.
- Project video/audio mentions to `@videoN` / `@audioN` using the same ordered arrays sent to the provider.
- Keep canvas mentions as real capability-checked edges and library mentions as real reference-slot attachments.

## Non-goals

- No new model-specific UI or provider mapping.
- No change to first/last-frame prompt semantics; only array reference slots become media-aware mentions.

## Acceptance

- A generated/current video reference is searchable by its node title or URL name and appears as `视频1`.
- Selecting it creates/keeps a real `video_ref` reference and the prompt survives send projection as `@video1`.
- Image mention tests and existing URL-only prompt persistence remain green.
- Build/typecheck and focused UX/static checks pass.

## Rollback

Revert the scoped commit; the old image-only candidate and projection path is restored.
