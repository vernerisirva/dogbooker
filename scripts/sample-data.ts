import { seedTestDatabase } from "./test-database";
import { pool } from "../src/db";
import { createBooking } from "../src/lib/booking-service";
import { addDays, todayStockholm } from "../src/lib/dates";
import type { Actor } from "../src/lib/access";
async function main() {
  const [sitter, alice, bob] = await seedTestDatabase();
  const admin = { ...sitter, role: "admin", dogName: null } as Actor;
  for (const [index, owner] of [alice, bob].entries()) {
    await createBooking(admin, {
      ownerId: owner.id,
      startDate: addDays(todayStockholm(), 3 + index),
      endDate: addDays(todayStockholm(), 6 + index),
      arrivalTime: "10:00",
      pickupTime: "18:00",
    });
  }
  console.log(
    "Synthetic sample stays created. Random login credentials are in .local/test-accounts.json.",
  );
}
main()
  .catch(() => {
    console.error("Sample data failed; use a disposable test database.");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
