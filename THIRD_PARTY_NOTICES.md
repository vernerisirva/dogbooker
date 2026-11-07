# Third-party dependency review

Reviewed 2026-11-06 against the committed npm lockfile. DogBooker's own source is MIT licensed; that does not relicense dependencies. No `node_modules`, native binary, vendor source, hosted font, stock photo or external image asset is included in the Git release. Screenshots are generated from synthetic local data and use the app's own UI.

`npm run licenses` produces [the complete locked dependency inventory](docs/dependencies.json), including versions, source archive URLs, integrity values, development and optional flags. Optional entries cover platforms not installed on the review host. The script fails when a license is unresolved. `@vercel/cli-auth` omits its package metadata license: its shipped `LICENSE` was read and identifies **Apache-2.0** (Copyright 2017 Vercel, Inc.).

## Direct dependencies

| Package | License |
| --- | --- |
| Next.js, React, React DOM | MIT |
| Better Auth, pg, Zod | MIT |
| Lucide React | ISC |
| Nodemailer | MIT-0 |
| Drizzle ORM, Workflow, @vercel/functions | Apache-2.0 |

Development tools include MIT, ISC and Apache-2.0 components. See exact installed metadata in the inventory. The lockfile's broader tree also includes BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, Python-2.0, CC0-1.0 and MIT-or-CC0 licensing.

## Non-permissive and attribution-sensitive components

- **libvips / sharp native packages:** LGPL-3.0-or-later, sometimes combined with Apache-2.0/MIT. If distributing a built image or executable, retain notices and applicable library source/relinking rights; do not assume the application's MIT license covers those binaries. Review the actual target-platform packages before shipping an image.
- **Lightning CSS and axe-core:** MPL-2.0. Preserve applicable notices and source availability for covered files when distributing them, especially if modified. No third-party source is modified here.
- **caniuse-lite:** CC-BY-4.0 data. Preserve attribution and license information when redistributing the data. The source is [caniuse-lite](https://github.com/browserslist/caniuse-lite).
- **SWC native packages:** Apache-2.0 AND MIT; retain both applicable notices.

This repository distributes first-party source plus dependency manifests, not a prebuilt image. Downstream binary/image publishers must carry the licenses and NOTICE files from the packages they actually redistribute and satisfy any corresponding-source requirements. License metadata review is not a legal certification.

## Security maintenance

The initial audit found one moderate minimatch advisory propagated through 27 dependency records: [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). A targeted override upgrades only affected minimatch versions (7 through 10) to patched 11.0.1+. Legacy 3/5 consumers retain their API-compatible unaffected versions. Build, lint and tests validate the override. Remove it when upstream dependencies adopt the fix. Other existing overrides constrain Zod and Undici. Weekly Dependabot updates and CI audit checks track future changes.

ESLint 9.39.5 emits an upstream end-of-support notice. It remains development-only: the installed React, JSX accessibility and import plugins declare compatibility through ESLint 9, so a forced major upgrade would bypass their peer contracts. No npm advisory is reported for it in this audit. Track a coordinated plugin/ESLint upgrade; this maintenance limitation does not affect the deployed application runtime.
