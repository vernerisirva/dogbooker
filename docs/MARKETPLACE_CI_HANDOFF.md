# Marketplace publication and CI handoff

Updated 8 November 2026 after explicit publication authorization. The branch is published and [draft PR #8](https://github.com/vernerisirva/dogbooker/pull/8) is open against `main`.

The current durable record is [Publication handoff](../marketplace/docs/PUBLICATION_HANDOFF.md). It records the exact verified source commit, initial hosted failures, tested corrections and successful check links. The [independent acceptance report](../MARKETPLACE_ACCEPTANCE_REREVIEW.md) remains the source of the original review findings, including the initial cancellation-history flake.

Required check names remain exactly `validate` (CI), `local-prototype` (Marketplace prototype), and `gitleaks` (Secret scan). All three passed on corrective commit `0149cb06a0fdfd8d218632929fe8cadabfe33d85`. A later candidate requires its own successful checks; missing or skipped checks do not count. These are acceptance requirements, not a claim that repository branch protection enforces them. No protection settings were changed.

Merge, deployment, private production changes, [P3 issue publication](issue-drafts/cancellation-timestamp-precision.md), live external review, and application of external-review findings remain separate authorization gates. The prior commands have been executed only within the user's later explicit branch-push/draft-PR authorization. No merge or deployment occurred.
