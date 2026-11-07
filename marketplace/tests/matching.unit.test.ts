import { describe, it, expect } from "vitest";
import {
  rankSitters,
  distanceKm,
  type Candidate,
  type Dog,
} from "../lib/matching";
import { dogSchema, searchSchema } from "../lib/validation";
import { todayStockholm, addDays, dayCount } from "../lib/dates";
const dog: Dog = {
  id: "f9e8cc53-a85d-479a-8abb-dfe719272854",
  name: "Test",
  size: "small",
  age_years: 4,
  breed: "",
  social: true,
  requirements: [],
  preferences: ["quiet"],
  care_notes: "PRIVATE",
};
const candidate: Candidate = {
  profile: {
    id: "a",
    name: "Demo",
    area: "Stockholm",
    latitude: 59.33,
    longitude: 18.07,
    radius_km: 30,
    description: "",
    sizes: ["small", "medium", "large"],
    experience_years: 5,
    daily_price: 40000,
    capacity: 2,
    resident_dogs: false,
    services: ["medication"],
    preferences: ["quiet"],
    published: true,
  },
  available: true,
  capacity_ok: true,
};
const loc = { latitude: 59.33, longitude: 18.07 };
describe("deterministic matching", () => {
  it("returns explainable scores without dog notes or identities", () => {
    const r = rankSitters([candidate], [dog], loc);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].factors.distance).toBe(1);
    expect(r.matches[0].explanations.length).toBeGreaterThan(3);
    expect(JSON.stringify(r)).not.toContain("PRIVATE");
    expect(JSON.stringify(r)).not.toContain(dog.id);
  });
  it.each(["available", "capacity_ok"] as const)("rejects failed %s", (key) => {
    expect(
      rankSitters([{ ...candidate, [key]: false }], [dog], loc).matches,
    ).toHaveLength(0);
  });
  it.each([
    { sizes: ["large"] },
    { radius_km: 1, latitude: 60 },
    { resident_dogs: true },
    { services: [] },
    { published: false },
    { capacity: 1 },
  ])("hard filters win over weights: %j", (change) => {
    const d = { ...dog, social: false, requirements: ["medication"] };
    expect(
      rankSitters(
        [{ ...candidate, profile: { ...candidate.profile, ...change } }],
        [d, { ...d, id: "b" }],
        loc,
        { distance: 0, price: 100, experience: 0, preferences: 0 },
      ).matches,
    ).toHaveLength(0);
  });
  it("uses stable id tie break regardless of candidate order", () => {
    const b = { ...candidate, profile: { ...candidate.profile, id: "b" } };
    expect(
      rankSitters([b, candidate], [dog], loc).matches.map((r) => r.sitter.id),
    ).toEqual(["a", "b"]);
  });
  it("supports configurable weights and normalized price scores", () => {
    const b = {
      ...candidate,
      profile: {
        ...candidate.profile,
        id: "b",
        daily_price: 20000,
        experience_years: 0,
      },
    };
    expect(
      rankSitters([candidate, b], [dog], loc, {
        distance: 0,
        price: 1,
        experience: 0,
        preferences: 0,
      }).matches[0].sitter.id,
    ).toBe("b");
    expect(() =>
      rankSitters([candidate], [dog], loc, {
        distance: 0,
        price: 0,
        experience: 0,
        preferences: 0,
      }),
    ).toThrow();
  });
  it("handles dateline and antipodal coordinates", () => {
    expect(distanceKm(0, 179.99, 0, -179.99)).toBeLessThan(3);
    expect(distanceKm(0, 0, 0, 180)).toBeCloseTo(20015.09, 1);
    expect(distanceKm(90, 0, 90, 180)).toBeLessThan(0.001);
  });
  it("fails closed for unknown compatibility, empty dogs, NaN and duplicate dog ids", () => {
    expect(
      dogSchema.safeParse({ ...dog, ageYears: 4, social: undefined }).success,
    ).toBe(false);
    expect(() => rankSitters([candidate], [], loc)).toThrow();
    expect(() =>
      rankSitters([candidate], [dog], { ...loc, latitude: NaN }),
    ).toThrow();
    expect(
      searchSchema.safeParse({
        ...loc,
        startDate: todayStockholm(),
        endDate: todayStockholm(),
        dogIds: [dog.id, dog.id],
      }).success,
    ).toBe(false);
  });
  it("normalizes across DST and rejects invalid, past and excessive ranges", () => {
    expect(dayCount("2027-03-27", "2027-03-29")).toBe(3);
    expect(todayStockholm(new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
    for (const [a, b] of [
      ["2027-02-30", "2027-03-01"],
      [addDays(todayStockholm(), -1), todayStockholm()],
      [todayStockholm(), addDays(todayStockholm(), 31)],
    ])
      expect(
        searchSchema.safeParse({
          ...loc,
          startDate: a,
          endDate: b,
          dogIds: [dog.id],
        }).success,
      ).toBe(false);
  });
});
