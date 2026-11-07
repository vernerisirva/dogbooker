# Matching engine v1

The marketplace uses a pure deterministic TypeScript function, `rankSitters`, with an authenticated service adapter. There is no LLM, embedding service or external geocoder. No existing marketplace benchmark or outcome dataset was present in v1.0.0; its extensive tests cover single-sitter booking behavior, not match quality.

## Contract and hard filters

Input: published public sitter profiles plus authoritative date/capacity eligibility, selected owned dogs and a coarse latitude/longitude. The service validates 1–5 distinct owned dogs, valid Stockholm dates and a bounded location. A dog already reserved for overlapping dates produces a 409 with a Swedish explanation.

Before ranking, reject unavailable dates, insufficient per-day capacity, locations outside the sitter radius, unaccepted sizes, required services not offered, and incompatible resident dogs. Non-social dogs require an empty home and exclusive use of the sitter's full capacity for their household party. Unknown sociability is not accepted in dog-profile input. A party still cannot exceed the sitter's maximum dogs.

Search is advisory. `request_booking` independently repeats authorization, availability, geography, size, care, dog-overlap, price and daily capacity checks under locks. A search result or future AI recommendation is never a reservation. Exclusions identify only public profiles and generic incompatibility reasons; they do not reveal other owners, dogs, notes, reservation IDs or occupancy counts.

Output: `version`, stable ordered `matches` with public profile, approximate distance, score, four factor scores and Swedish explanations; `excluded` with public sitter ID/name and reasons. Factors are normalized to 0–1; the displayed total is 0–100. A later adapter or reranker may reuse this structure and reorder eligible results without changing the filters.

## Ranking

| Factor      | Default weight | Definition                                                             |
| ----------- | -------------: | ---------------------------------------------------------------------- |
| Distance    |           0.35 | `max(0, 1 - haversineKm / serviceRadiusKm)`                            |
| Price       |           0.20 | `1 / (1 + dailyPriceOre / 50000)`                                      |
| Experience  |           0.20 | `min(1, selfReportedYears / 10)`                                       |
| Preferences |           0.25 | Fraction of distinct party preferences offered, or neutral 0.5 if none |

Normalize by the sum of weights, round only the total and display distance, and break ties by stable sitter UUID. Weights must be finite, nonnegative and have a positive sum. The pure function accepts an explicit weights object for offline comparison; the HTTP client cannot manipulate server weights. Distance is straight-line from approximate coordinates, not travel time.

The price constant is an illustrative 500 SEK/day scale, not a market-price estimate. The UI shows per-dog/day price and the full inclusive demo total. The database stores and checks the quoted daily price so a later price change causes a conflict rather than silently charging a new amount. There is no actual charge.

## Evaluation and limits

Unit coverage includes every hard filter, multi-dog care conflicts, exclusive care, geography/dateline/poles, configurable weights, stable ties, invalid input, privacy and Stockholm DST/date ranges. Real PostgreSQL tests cover per-day fragmentation, matching/request parity, overlapping dogs, suspended sitters, capacity edits, release, idempotency and 100 competing requests. Browser tests cover matching through approval/decline with separate authenticated participants.

`npm run benchmark` uses 100, 1,000 and 10,000 synthetic profiles. It mixes unavailable/full profiles, distance boundaries, unsupported large dogs, missing medication support, resident dogs and multi-dog exclusive parties. Every eligible result is checked against independent basic assertions. After one warm-up, 25 measured runs on this macOS host / Node 25.9.0 produced:

| Profiles | Eligible |  Median |      p95 |  Maximum |
| -------: | -------: | ------: | -------: | -------: |
|      100 |       21 | 0.10 ms |  0.27 ms |  0.38 ms |
|    1,000 |      202 | 1.03 ms |  1.35 ms |  1.42 ms |
|   10,000 |    2,040 | 9.23 ms | 10.72 ms | 10.79 ms |

These timings measure **in-process ranking only**, excluding PostgreSQL, HTTP, serialization and network. They are not production latency guarantees or evidence that dogs are safe together. The database currently scans published profiles and checks daily slots; measure full search under realistic load before adding PostGIS, bounds/pagination and indexes for geographic scale.

Weights are uncalibrated. Lower prices can favor unsustainably cheap providers; years of self-reported experience favor incumbents and are gameable; distance/service radius can privilege dense urban supply or sitters who exaggerate their radius. A neutral preference score avoids penalizing users who provide no preferences, but the union of party preferences gives no per-dog priority. Breed does not influence scores. No review/reliability or paid-placement signal is invented.

Before a pilot: independently review care compatibility, collect consented outcome data, audit regional/newcomer exposure, test adversarial claims, and measure acceptance/cancellation and safety outcomes alongside conversion. Unknown critical requirements need a structured meet-and-greet/manual review flow. Natural-language extraction should produce an owner-confirmed structured profile; an optional reranker must preserve all hard exclusions and explanations. Never send private care notes to a model by default.
