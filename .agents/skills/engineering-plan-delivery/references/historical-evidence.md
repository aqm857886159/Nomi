# Historical PR And UI Evidence

Read this reference only when relevant historical PRs, reviews, incidents, or
approved UI designs exist.

Keep a coverage section in the active plan with the query/scope, relevant PR
ids, base/head, checked date, problem exposed, and an `adopt`, `adapt`, or
`reject` decision. Limit relevance to the frozen contract's owners and
surfaces, explicit incidents, and PRs the user named.

A stale PR may contain current problem evidence even when its code no longer
applies. Bind every adopted point to a contract clause or acceptance criterion;
never treat the section as a mechanical cherry-pick list. After coverage
freezes, inspect only new PRs or changed heads/reviews.

For UI, start from the approved design and current rendered product, then use
the design system only to close real gaps. Missing evidence blocks the
overlapping acceptance criterion, not an unrelated whole lane.
