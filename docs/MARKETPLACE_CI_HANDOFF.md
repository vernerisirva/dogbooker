# Marketplace publication and CI handoff

Prepared 8 November 2026. **Publication is not authorized.** The accepted local verdict is [PASS WITH NOTES](../MARKETPLACE_ACCEPTANCE_REREVIEW.md). The P3 cancellation issue remains open in an [unpublished draft](issue-drafts/cancellation-timestamp-precision.md). Do not push, create an issue/PR, merge or deploy until the corresponding explicit authorization is given.

## Three workflows and exact check names

Read-only inspection of the public repository confirmed that default branch `main` currently contains `ci.yml` and `secrets.yml`. This feature branch adds `.github/workflows/marketplace.yml`. Each of these three workflows has one job. [Public workflow directory](https://github.com/vernerisirva/dogbooker/tree/main/.github/workflows).

| Exact check/job name | Workflow name | Workflow file | Acceptance label |
| --- | --- | --- | --- |
| `validate` | `CI` | `.github/workflows/ci.yml` | `CI / validate` |
| `local-prototype` | `Marketplace prototype` | `.github/workflows/marketplace.yml` | `Marketplace prototype / local-prototype` |
| `gitleaks` | `Secret scan` | `.github/workflows/secrets.yml` | `Secret scan / gitleaks` |

The existing public check runs confirm names `validate` and `gitleaks`. `local-prototype` is the expected name from the new workflow's job ID, with no custom job name or matrix. It has not run remotely. The qualified labels in the acceptance review identify workflow/job pairs; they are not the literal API check names. Existing successful runs on public base `7b9dadb` are not evidence for the feature candidate. [Existing validation job](https://github.com/vernerisirva/dogbooker/actions/runs/42350084674/job/128336158795), [existing secret-scan job](https://github.com/vernerisirva/dogbooker/actions/runs/42350084893/job/128336159596), [GitHub workflow/job naming](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idname).

These three checks are required by the acceptance gate. This document does not claim that branch protection already enforces them. No branch-protection/ruleset settings were changed. Do not disable or bypass a check to complete this handoff.

## Hosted isolation and coverage

Root CI uses a disposable `postgres:16-alpine` service on port 5432 with the synthetic `dogbooker_test` database, explicit test opt-in and no outbound-mail password. It runs migrations twice, lint/types, standalone unit/integration tests, licenses/audit, a production build and Chromium browser tests.

The marketplace workflow provisions a separate runner-local PostgreSQL cluster with `btree_gist` support, bound only to `127.0.0.1:55438` and the dedicated Unix socket. Setup generates local credentials for `marketplace_app`/`marketplace_auth`; migration and seed create only synthetic accounts/data. The database/role/origin validators apply in CI. Integration tests also create/drop allowlisted random disposable databases; the new privilege test logs in as the real restricted app role. No fixture file or generated credential must be committed.

Marketplace CI runs setup/migration/seed, lint/types, all unit/integration tests (including the 24 new cases), benchmark, production build and Chromium. Secret scan reads full Git history using the checksum-verified Gitleaks release. All three use `contents: read`, have no production-secret dependency, and contain no deployment job. Marketplace has a separate PostgreSQL cluster rather than a `services:` block; it is still isolated to its ephemeral runner.

Both new test paths match the marketplace push/pull-request path filter. The shared PostgreSQL validator is also included. A later documentation-only push can skip this workflow, and there is no `workflow_dispatch`; absence/skipping is not a successful check. Ubuntu package versions, provisioning, browser libraries, networking and the 15/20-minute runner limits remain hosted verification gates. No workflow modification is necessary for this first authorized publication.

## Local evidence being committed

The re-review's completed results are **381 baseline + 24 new cases = 405 passing tests**. The initial standalone integration run was **92/93**, followed by an unchanged **93/93** run; that failure remains documented. Both lint/type checks, both production builds, migration reruns, dependency audit and source/history scans passed as recorded in the review. Finalization preserves the tested code/test bytes and adds only documentation. The 13 connection cases and 11 database boundary cases were rerun unchanged on Node 22 and all passed again; their disposable database was removed and the synthetic cluster stopped. The full 405-test suite and builds were not repeated for documentation-only finalization. This does not claim a new hosted run or erase the first-run flake.

## Proposed commands — only after explicit push authorization

Run from the public-source checkout, never from the private installation. First verify its clean tree, branch and origin. The finalization response supplies the new commit SHA; compare it with `candidate_sha` before pushing. These commands are prepared, not executed:

```sh
test "$(git branch --show-current)" = "codex/marketplace-foundation" || exit 1
test -z "$(git status --porcelain)" || exit 1
test "$(git remote get-url origin)" = "https://github.com/vernerisirva/dogbooker.git" || exit 1
test "$(git remote get-url --push origin)" = "https://github.com/vernerisirva/dogbooker.git" || exit 1
candidate_sha=$(git rev-parse HEAD) || exit 1
git show --stat --oneline "$candidate_sha" || exit 1
git push --set-upstream origin HEAD:refs/heads/codex/marketplace-foundation || exit 1

gh run list --repo vernerisirva/dogbooker \
  --branch codex/marketplace-foundation --commit "$candidate_sha" \
  --event push --limit 20 \
  --json databaseId,workflowName,headSha,status,conclusion,url
```

After GitHub has registered all three runs, this read-only follow-up watches each workflow for that exact SHA, checks its single expected job, and prints evidence. Run it in the same shell so `candidate_sha` remains set. If a run is absent, stop and investigate; allow GitHub time to register it without treating absence as success.

```sh
for workflow_file in ci.yml marketplace.yml secrets.yml; do
  case "$workflow_file" in
    ci.yml) expected_check=validate ;;
    marketplace.yml) expected_check=local-prototype ;;
    secrets.yml) expected_check=gitleaks ;;
  esac
  run_id=$(gh run list --repo vernerisirva/dogbooker \
    --workflow "$workflow_file" --branch codex/marketplace-foundation \
    --commit "$candidate_sha" --event push --limit 1 \
    --json databaseId --jq '.[0].databaseId // empty') || exit 1
  test -n "$run_id" || { echo "Missing run: $workflow_file" >&2; exit 1; }
  gh run watch "$run_id" --repo vernerisirva/dogbooker --exit-status || exit 1
  actual_sha=$(gh run view "$run_id" --repo vernerisirva/dogbooker \
    --json headSha --jq '.headSha') || exit 1
  test "$actual_sha" = "$candidate_sha" || exit 1
  successful_check=$(gh run view "$run_id" --repo vernerisirva/dogbooker \
    --json status,conclusion,jobs \
    --jq 'select(.status == "completed" and .conclusion == "success") |
      .jobs[] | select(.status == "completed" and .conclusion == "success") | .name') || exit 1
  test "$successful_check" = "$expected_check" || exit 1
  gh run view "$run_id" --repo vernerisirva/dogbooker \
    --json workflowName,headSha,status,conclusion,jobs,url || exit 1
done
```

Record all run URLs, the SHA and conclusions. Investigate failures, including any P3 recurrence; do not weaken tests or bypass branch protection. Successful checks allow a later merge-readiness decision, not automatic merge or production deployment.

## Separate issue-publication authorization

The draft is ready locally. The following command is proposed only if issue publication is separately authorized; push authorization alone does not publish it:

```sh
gh issue create --repo vernerisirva/dogbooker \
  --title '[P3] Preserve PostgreSQL precision in recent-cancellation cutoffs' \
  --body-file docs/issue-drafts/cancellation-timestamp-precision.md
```

No PR, merge, branch-protection or deployment command is part of this checkpoint. Production readiness remains no.
