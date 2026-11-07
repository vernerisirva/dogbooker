import { afterEach, expect, it, vi } from "vitest";
import { ownerLimit } from "@/lib/installation";
afterEach(() => vi.unstubAllEnvs());
it("defaults to unlimited and accepts a configured owner limit", () => {
  vi.stubEnv("MAX_OWNERS", undefined);
  expect(ownerLimit()).toBe(0);
  vi.stubEnv("MAX_OWNERS", "12");
  expect(ownerLimit()).toBe(12);
});
it.each(["-1", "1.5", "Infinity", "", "9007199254740992", "ten"])(
  "rejects invalid limit %s",
  (value) => {
    vi.stubEnv("MAX_OWNERS", value);
    expect(ownerLimit).toThrow("MAX_OWNERS");
  },
);
