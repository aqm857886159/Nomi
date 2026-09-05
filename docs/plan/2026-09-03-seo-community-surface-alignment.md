# SEO community surface alignment

## Scope

Align the marketing source and generated public pages with the current GitHub repository state: Discussions is enabled and reachable, so questions, ideas, and workflow sharing should point to the Discussions surface. Extend the SEO contract test to verify the canonical destination without encoding the former disabled state.

## Why

The checked-in SEO contract was written when Discussions was disabled and treated `/issues` as the only valid community surface. GitHub now exposes a working Discussions page, while the marketing source and generated website still send users to Issues and describe that surface as the community home. This creates stale link signals and sends users to a less suitable surface for discoverable workflow discussions.

## Included

- Restore the canonical Discussions URL in the marketing content source and generated marketing pages.
- Preserve the already-correct Discussions links in the READMEs, issue-template contact link, and active English onboarding guide.
- Update the static SEO regression test to assert the current canonical community destination across active public surfaces.
- Record the recurring external-state drift and its static prevention contract.

## Not included

- No OpenSEO/DataForSEO account connection, API key, paid keyword/backlink/rank lookup, or external publication.
- No change to the desktop app's issue-reporting URL; bugs and feature requests remain Issues.
- No rewrite of historical plans/specs/mockups that intentionally describe earlier product decisions.
- No GitHub repository-settings mutation.

## Rollback

Revert this change. The generated marketing pages can be regenerated with `pnpm run build:site`; no user project data or migration is involved.

## Acceptance

1. No active public/community surface points to a stale or contradictory destination.
2. `pnpm run build:site` regenerates the two marketing pages without drift.
3. `node --test tests/seo/*.node.mjs scripts/seo/seo-audit.node.mjs` passes.
4. The root-cause contract checker passes.
