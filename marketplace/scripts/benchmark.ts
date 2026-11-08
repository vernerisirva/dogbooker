import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { rankSitters, type Candidate, type Dog } from "../lib/matching";
const dogs: Dog[] = [
  {
    id: "synthetic-a",
    name: "A",
    size: "large",
    age_years: 8,
    breed: "",
    social: false,
    requirements: ["medication"],
    preferences: ["quiet", "garden"],
    care_notes: "private",
  },
  {
    id: "synthetic-b",
    name: "B",
    size: "small",
    age_years: 2,
    breed: "",
    social: true,
    requirements: [],
    preferences: ["quiet"],
    care_notes: "private",
  },
];
const results = [];
for (const size of [100, 1000, 10000]) {
  const candidates: Candidate[] = Array.from({ length: size }, (_, i) => ({
    profile: {
      id: String(i).padStart(6, "0"),
      name: `Synthetic ${i}`,
      area: "Test",
      latitude: 59.3 + (i % 30) / 100,
      longitude: 18 + (i % 20) / 100,
      radius_km: 20,
      description: "Synthetic benchmark",
      sizes: i % 7 === 0 ? ["small"] : ["small", "large"],
      experience_years: i % 16,
      daily_price: 20000 + (i % 10) * 5000,
      capacity: 1 + (i % 4),
      resident_dogs: i % 5 === 0,
      services: i % 3 === 0 ? [] : ["medication"],
      preferences: i % 2 === 0 ? ["quiet"] : ["quiet", "garden"],
      published: true,
    },
    available: i % 11 !== 0,
    capacity_ok: i % 13 !== 0,
  }));
  const times: number[] = [];
  let eligible = 0;
  for (let run = 0; run < 26; run++) {
    const start = performance.now();
    const r = rankSitters(candidates, dogs, {
      latitude: 59.33,
      longitude: 18.07,
    });
    const elapsed = performance.now() - start;
    if (run) times.push(elapsed);
    eligible = r.matches.length;
    for (const m of r.matches) {
      assert.ok(m.sitter.capacity >= 2);
      assert.ok(!m.sitter.resident_dogs);
      assert.ok(m.sitter.sizes.includes("large"));
      assert.ok(m.sitter.services.includes("medication"));
      assert.ok(m.distanceKm <= 20.1);
      assert.ok(m.score >= 0 && m.score <= 100);
    }
    assert.ok(!JSON.stringify(r).includes('"care_notes"'));
    assert.equal(r.matches.length + r.excluded.length, size);
  }
  times.sort((a, b) => a - b);
  results.push({
    candidates: size,
    eligible,
    runs: times.length,
    medianMs: +times[12].toFixed(2),
    p95Ms: +times[23].toFixed(2),
    maxMs: +times.at(-1)!.toFixed(2),
  });
}
console.log(
  JSON.stringify(
    {
      scope:
        "In-process deterministic ranking only; excludes SQL, HTTP and network. Mixed hard cases, two-dog exclusive party. Synthetic inputs are not outcome validation.",
      node: process.version,
      results,
    },
    null,
    2,
  ),
);
