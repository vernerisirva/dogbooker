import { createBooking } from "../helpers/bookings";
import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { seedTestDatabase } from "../../scripts/test-database";
import { pool } from "@/db";
import {
  createBlock,
  cancelBooking,
  decideBooking,
  modifyBooking,
  calendar,
} from "@/lib/booking-service";
import { todayStockholm, addDays } from "@/lib/dates";
import type { Actor } from "@/lib/access";
let admin: Actor, luna: Actor, milo: Actor;
const range = {
  startDate: addDays(todayStockholm(), 150),
  endDate: addDays(todayStockholm(), 153),
};
beforeEach(async () => {
  [admin, luna, milo] = (await seedTestDatabase()).map((p) => ({
    id: p.id,
    email: p.email,
    name: p.name,
    role: p.role as Actor["role"],
    dogName: p.dog,
  }));
});
afterAll(() => pool.end());
describe("shared stays and privacy", () => {
  it("accepts concurrent different-dog requests; approvals keep both reservations", async () => {
    const bookings = await Promise.all([
      createBooking(luna, range),
      createBooking(milo, range),
    ]);
    for (const owner of [luna, milo]) {
      const data = await calendar(owner, todayStockholm().slice(0, 7));
      expect(data.entries).toHaveLength(1);
      expect(data.entries[0]).toMatchObject({
        state: "mine",
        status: "pending",
      });
    }
    await Promise.all(
      bookings.map((b) => decideBooking(admin, b.id, "confirmed")),
    );
    const visible = await calendar(luna, todayStockholm().slice(0, 7));
    expect(visible.entries.filter((e) => e.state === "companion")).toEqual([
      { ...range, state: "companion", dogName: "Milo" },
    ]);
    expect(JSON.stringify(visible)).not.toContain(milo.id);
    expect(JSON.stringify(visible)).not.toContain(milo.name);
    expect(JSON.stringify(visible)).not.toContain(milo.email);
    expect(JSON.stringify(visible)).not.toContain(bookings[1].id);
    expect(visible.bookings).toHaveLength(1);
    expect(
      (await calendar(admin, range.startDate.slice(0, 7))).entries,
    ).toHaveLength(2);
    for (const owner of [luna, milo])
      await expect(createBooking(owner, range)).rejects.toMatchObject({
        status: 409,
      });
    await expect(createBlock(admin, range)).rejects.toMatchObject({
      status: 409,
    });
    await cancelBooking(luna, bookings[0].id);
    await createBooking(luna, range);
    await expect(createBooking(milo, range)).rejects.toMatchObject({
      status: 409,
    });
    await expect(createBlock(admin, range)).rejects.toMatchObject({
      status: 409,
    });
  });
  it("decline releases only that dog's dates and edits cannot move onto its other booking", async () => {
    const b = await createBooking(luna, range),
      l = await createBooking(milo, range);
    await decideBooking(admin, b.id, "declined");
    const replacement = await createBooking(luna, range);
    await expect(
      modifyBooking(admin, replacement.id, { ...range, ownerId: milo.id }),
    ).rejects.toMatchObject({ status: 409 });
    await cancelBooking(luna, replacement.id);
    await expect(createBlock(admin, range)).rejects.toMatchObject({
      status: 409,
    });
    await cancelBooking(milo, l.id);
    await createBlock(admin, range);
    for (const owner of [luna, milo])
      await expect(createBooking(owner, range)).rejects.toMatchObject({
        status: 409,
      });
  });
});

// Bypass every service/precheck. Hold one INSERT uncommitted while the second
// transaction has an established snapshot, then verify native GiST arbitration.
describe.each(["READ COMMITTED", "REPEATABLE READ"] as const)(
  "database concurrency at %s",
  (isolation) => {
    it.each([
      "same dog",
      "booking then block",
      "block then booking",
      "block then block",
    ])("serializes %s", async (scenario) => {
      const first = await pool.connect(),
        second = await pool.connect();
      const insert = (block: boolean) => ({
        text: "INSERT INTO entries(kind,owner_id,start_date,end_date,booking_status) VALUES($1,$2,$3,$4,$5)",
        values: [
          block ? "block" : "booking",
          block ? null : luna.id,
          range.startDate,
          range.endDate,
          block ? null : "pending",
        ],
      });
      try {
        await first.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        await second.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        await second.query("SET LOCAL statement_timeout='5s'");
        await second.query("SELECT count(*) FROM entries");
        await first.query(insert(scenario.startsWith("block")));
        const pending = second.query(insert(scenario.endsWith("block"))).then(
          () => ({ code: "accepted" }),
          (e) => ({ code: e.code }),
        );
        await first.query("COMMIT");
        expect((await pending).code).toBe("23P01");
        await second.query("ROLLBACK");
        expect(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM entries WHERE status='active'",
            )
          ).rows[0].n,
        ).toBe(1);
      } finally {
        await first.query("ROLLBACK");
        await second.query("ROLLBACK");
        first.release();
        second.release();
      }
    });
    it("allows different dogs even when their dates and snapshots overlap", async () => {
      const first = await pool.connect(),
        second = await pool.connect();
      try {
        await first.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        await second.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        await second.query("SET LOCAL statement_timeout='5s'");
        const sql =
          "INSERT INTO entries(kind,owner_id,start_date,end_date,booking_status) VALUES('booking',$1,$2,$3,'pending')";
        await first.query(sql, [luna.id, range.startDate, range.endDate]);
        await second.query(sql, [milo.id, range.startDate, range.endDate]);
        await first.query("COMMIT");
        await second.query("COMMIT");
        expect(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM entries WHERE status='active'",
            )
          ).rows[0].n,
        ).toBe(2);
      } finally {
        await first.query("ROLLBACK");
        await second.query("ROLLBACK");
        first.release();
        second.release();
      }
    });
    it("allows a waiting block after a conflicting reservation rolls back", async () => {
      const first = await pool.connect(),
        second = await pool.connect();
      try {
        await first.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        await second.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        await second.query("SET LOCAL statement_timeout='5s'");
        await first.query(
          "INSERT INTO entries(kind,owner_id,start_date,end_date) VALUES('booking',$1,$2,$3)",
          [luna.id, range.startDate, range.endDate],
        );
        const pending = second.query(
          "INSERT INTO entries(kind,start_date,end_date) VALUES('block',$1,$2)",
          [range.startDate, range.endDate],
        );
        await first.query("ROLLBACK");
        await pending;
        await second.query("COMMIT");
        expect(
          (await pool.query("SELECT kind FROM entries WHERE status='active'"))
            .rows,
        ).toEqual([{ kind: "block" }]);
      } finally {
        await first.query("ROLLBACK");
        await second.query("ROLLBACK");
        first.release();
        second.release();
      }
    });
  },
);
