import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { adminPool } from "./migrate";
import { addDays, todayStockholm } from "../lib/dates";
export async function seed() {
  const pool = adminPool();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const real = await c.query(
      `SELECT 1 FROM "user" WHERE email NOT LIKE '%@example.test' LIMIT 1`,
    );
    if (real.rowCount) throw new Error("Refusing non-synthetic accounts.");
    if ((await c.query('SELECT 1 FROM "user" LIMIT 1')).rowCount)
      throw new Error(
        "Database already has accounts; seed never deletes existing data.",
      );
    const password = randomBytes(18).toString("base64url");
    const hash = await hashPassword(password);
    const people = [];
    for (const [name, email] of [
      ["Alva Demo", "alva@example.test"],
      ["Bo Demo", "bo@example.test"],
      ["Maja Demo", "maja@example.test"],
      ["Erik Demo", "erik@example.test"],
      ["Liv Demo", "liv@example.test"],
    ]) {
      const id = randomUUID();
      await c.query(
        'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',
        [id, name, email],
      );
      await c.query(
        'INSERT INTO account(id,"userId","accountId","providerId",password) VALUES($1,$2::uuid,$2::text,\'credential\',$3)',
        [randomUUID(), id, hash],
      );
      people.push({ id, name, email, password });
    }
    for (const [owner, name, size, social, requirements, preferences] of [
      [0, "Smulan", "small", true, [], ["quiet"]],
      [0, "Atlas", "large", true, ["medication"], ["garden"]],
      [1, "Vilda", "medium", false, [], ["quiet"]],
    ] as const) {
      await c.query(
        "INSERT INTO dogs(owner_id,name,size,age_years,breed,social,requirements,preferences,care_notes) VALUES($1,$2,$3,4,'Blandras',$4,$5,$6,$7)",
        [
          people[owner].id,
          name,
          size,
          social,
          requirements,
          preferences,
          `Syntetisk omsorgsanteckning för ${name}.`,
        ],
      );
    }
    const data = [
      {
        index: 2,
        name: "Majas lugna hundhem",
        area: "Södermalm",
        lat: 59.31,
        lon: 18.07,
        price: 45000,
        capacity: 3,
        resident: false,
        years: 8,
        services: ["medication", "puppy", "senior"],
        preferences: ["quiet", "garden"],
      },
      {
        index: 3,
        name: "Eriks promenadkompisar",
        area: "Vasastan",
        lat: 59.34,
        lon: 18.04,
        price: 35000,
        capacity: 2,
        resident: true,
        years: 4,
        services: ["puppy"],
        preferences: ["active"],
      },
      {
        index: 4,
        name: "Livs trädgårdsboende",
        area: "Nacka",
        lat: 59.31,
        lon: 18.16,
        price: 55000,
        capacity: 2,
        resident: false,
        years: 12,
        services: ["medication", "senior"],
        preferences: ["garden", "quiet"],
      },
    ];
    for (const s of data) {
      const {
        rows: [r],
      } = await c.query(
        "INSERT INTO sitters(user_id,name,area,latitude,longitude,radius_km,description,sizes,experience_years,daily_price,capacity,resident_dogs,services,preferences) VALUES($1,$2,$3,$4,$5,30,$6,ARRAY['small','medium','large'],$7,$8,$9,$10,$11,$12) RETURNING id",
        [
          people[s.index].id,
          s.name,
          s.area,
          s.lat,
          s.lon,
          "Ett tryggt tempo, nära promenader och gott om tid för din hund. Syntetisk demonstrationsprofil.",
          s.years,
          s.price,
          s.capacity,
          s.resident,
          s.services,
          s.preferences,
        ],
      );
      await c.query(
        "INSERT INTO availability SELECT $1::uuid,$2::date+i FROM generate_series(0,90) i",
        [r.id, todayStockholm()],
      );
    }
    await c.query("COMMIT");
    await mkdir(".local", { recursive: true });
    await writeFile(
      ".local/demo-accounts.json",
      JSON.stringify(
        {
          people,
          suggestedDates: {
            startDate: addDays(todayStockholm(), 7),
            endDate: addDays(todayStockholm(), 9),
          },
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(
      "Created five synthetic accounts, three sitters, three dogs and 91 available dates. Demo logins: .local/demo-accounts.json",
    );
    return people;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}
if (process.argv[1]?.endsWith("/seed.ts")) await seed();
