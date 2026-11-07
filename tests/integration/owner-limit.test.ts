import { beforeEach, afterEach, afterAll, it, expect, vi } from "vitest";
import { seedTestDatabase } from "../../scripts/test-database";
import { pool } from "@/db";
import { inviteOwner } from "@/lib/invitations";
import { createBooking, calendar, createBlock } from "@/lib/booking-service";
import { addDays, todayStockholm } from "@/lib/dates";
import type { Actor } from "@/lib/access";
let admin: Actor;
beforeEach(async () => {
  const [account] = await seedTestDatabase();
  admin = { ...account, role: "admin", dogName: null };
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => pool.end());
const input = (i: number) => ({
  name: `Owner ${i}`,
  email: `owner${i}@example.test`,
  dogName: `Dog ${i}`,
});
it("supports more than two owners and overlapping different-dog stays", async () => {
  vi.stubEnv("MAX_OWNERS", "0");
  for (let i = 3; i <= 5; i++) await inviteOwner(admin, input(i));
  const state = await calendar(admin, todayStockholm().slice(0, 7));
  expect(state.owners).toHaveLength(5);
  const date = addDays(todayStockholm(), 7);
  const range = {
    startDate: date,
    endDate: date,
    arrivalTime: "10:00",
    pickupTime: "18:00",
  };
  await Promise.all(
    state.owners.map((owner) =>
      createBooking(admin, { ...range, ownerId: owner.id }),
    ),
  );
  await expect(
    createBooking(admin, { ...range, ownerId: state.owners[0].id }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(createBlock(admin, range)).rejects.toMatchObject({
    status: 409,
  });
  expect((await calendar(admin, date.slice(0, 7))).bookings).toHaveLength(5);
});
it("serializes concurrent invitations at the configured limit", async () => {
  vi.stubEnv("MAX_OWNERS", "3");
  const results = await Promise.allSettled([
    inviteOwner(admin, input(3)),
    inviteOwner(admin, input(4)),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(
    (await calendar(admin, todayStockholm().slice(0, 7))).owners,
  ).toHaveLength(3);
});
