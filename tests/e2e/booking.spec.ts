import { mkdir } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { seedTestDatabase } from "../../scripts/test-database";
import { pool } from "../../src/db";
import { addDays, todayStockholm } from "../../src/lib/dates";
let people: Awaited<ReturnType<typeof seedTestDatabase>>;
const day = (n: number) => addDays(todayStockholm(), n);
async function login(page: Page, index: number) {
  await page.goto("/login");
  await expect(page.locator(".auth-form")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.getByLabel("E-postadress").fill(people[index].email);
  await page
    .getByLabel("Lösenord", { exact: true })
    .fill(people[index].password);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Logga ut" })).toBeVisible();
}
async function dates(page: Page, start: string, end = start) {
  await page.getByLabel("Från", { exact: true }).fill(start);
  await expect(page.getByLabel("Från", { exact: true })).toHaveValue(start);
  await page.getByLabel("Till och med", { exact: true }).fill(end);
  if (await page.getByLabel("Lämningstid", { exact: true }).count()) {
    await page.getByLabel("Lämningstid", { exact: true }).selectOption("10:00");
    await page
      .getByLabel("Hämtningstid", { exact: true })
      .selectOption("18:00");
  }
}
test.beforeAll(async () => {
  if (process.env.BASE_URL)
    throw new Error(
      "Browser fixtures may only run against the isolated local test server.",
    );
  people = await seedTestDatabase();
});
test.beforeEach(async () => {
  await pool.query("DELETE FROM auth_rate_limits");
});
test.afterAll(() => pool.end());
test("administrator blocks travel dates, unblocks part, edits and cancels stays", async ({
  page,
}) => {
  await login(page, 0);
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  await expect(page.locator(".weekdays span")).toHaveText([
    "MÅN",
    "TIS",
    "ONS",
    "TOR",
    "FRE",
    "LÖR",
    "SÖN",
  ]);
  const firstDay = await page
    .locator(".calendar-grid button")
    .first()
    .getAttribute("data-date");
  expect(new Date(`${firstDay}T12:00:00Z`).getUTCDay()).toBe(1);
  await expect(page.locator(".calendar-grid button").first()).toHaveAttribute(
    "aria-label",
    /måndag/,
  );
  await page.screenshot({
    path: ".local/swedish-admin-calendar.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Blockera", exact: true }).click();
  await dates(page, day(3), day(5));
  await page.getByLabel("Privat anteckning").fill("PRIVATE travel destination");
  await page
    .getByRole("button", { name: "Blockera datum", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Datumen har blockerats",
  );
  await page.reload();
  await page.getByRole("button", { name: "Frigör", exact: true }).click();
  await dates(page, day(4));
  await page
    .getByRole("button", { name: "Gör datumen tillgängliga", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("tillgängliga igen");
  await page.getByRole("button", { name: "Boka", exact: true }).click();
  await dates(page, day(4));
  await page.getByLabel("Hund", { exact: true }).selectOption(people[1].id);
  await page.getByRole("button", { name: "Godkänn bokning" }).click();
  await expect(page.getByRole("status")).toContainText("Bokningen är godkänd");
  await page.getByRole("button", { name: "Ändra", exact: true }).click();
  await dates(page, day(7), day(8));
  await page
    .getByRole("button", { name: "Spara ändringar", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Bokningen har uppdaterats",
  );
  await page.getByRole("button", { name: "Avboka", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Avboka", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Bokningen har avbokats",
  );
});
test("both dogs stay together, with private owner data and dog-specific availability", async ({
  browser,
}) => {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const [admin, alice, bob] = await Promise.all(
    contexts.map((c) => c.newPage()),
  );
  await login(admin, 0);
  await login(alice, 1);
  await login(bob, 2);
  const start = day(10),
    end = day(12);
  for (const owner of [alice, bob]) {
    await dates(owner, start, end);
    await owner
      .getByRole("button", { name: "Skicka bokningsförfrågan" })
      .click();
    await expect(owner.getByRole("status")).toContainText(
      "Din bokningsförfrågan har skickats",
    );
  }
  const pending = await (
    await bob.request.get(`/api/calendar?month=${start.slice(0, 7)}`)
  ).json();
  expect(
    pending.entries.some((e: { dogName?: string }) => e.dogName === "Luna"),
  ).toBe(false);
  await dates(alice, start, end);
  await alice.getByRole("button", { name: "Skicka bokningsförfrågan" }).click();
  await expect(
    alice.getByRole("alert").filter({ hasText: "inte längre tillgängliga" }),
  ).toContainText("inte längre tillgängliga");
  await admin.reload();
  await admin.getByRole("button", { name: /Bokningsförfrågningar/ }).click();
  for (const dog of ["Luna", "Milo"]) {
    const row = admin.locator(".booking-row").filter({ hasText: dog });
    await row.getByRole("button", { name: "Godkänn", exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(admin.getByRole("status")).toContainText(
      "Bokningen är godkänd",
    );
  }
  for (const page of [admin, alice, bob]) {
    await page.goto("/");
    const current = todayStockholm().slice(0, 7);
    if (current !== start.slice(0, 7))
      await page
        .getByRole("button", { name: "Nästa månad", exact: true })
        .click();
    const cell = page.locator(`[data-date="${start}"]`);
    await expect(cell).toHaveAttribute("aria-label", /2 hundar kommer/);
    if (page !== admin) await expect(cell).toBeDisabled();
  }
  const state = await (
    await bob.request.get(`/api/calendar?month=${start.slice(0, 7)}`)
  ).json();
  expect(
    state.entries.find((e: { state: string }) => e.state === "companion"),
  ).toEqual({
    startDate: start,
    endDate: end,
    state: "companion",
    dogName: "Luna",
  });
  for (const secret of [
    "Owner Alice",
    "alice@example.test",
    "PRIVATE",
    people[1].id,
  ])
    expect(JSON.stringify(state)).not.toContain(secret);
  await bob.setViewportSize({ width: 390, height: 844 });
  expect(
    await bob.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await bob.screenshot({
    path: ".local/shared-stays-mobile.png",
    fullPage: true,
  });
  await admin.getByRole("button", { name: "Blockera", exact: true }).click();
  await dates(admin, start, end);
  await admin
    .getByRole("button", { name: "Blockera datum", exact: true })
    .click();
  await expect(
    admin.getByRole("alert").filter({ hasText: "inte längre tillgängliga" }),
  ).toContainText("inte längre tillgängliga");
  await alice.getByRole("button", { name: "Avboka", exact: true }).click();
  await alice
    .getByRole("dialog")
    .getByRole("button", { name: "Avboka", exact: true })
    .click();
  await expect(alice.getByRole("status")).toContainText(
    "Bokningen har avbokats",
  );
  await expect(alice.locator(`[data-date="${start}"]`)).toBeEnabled();
  await expect(alice.locator(`[data-date="${start}"]`)).toHaveAttribute(
    "aria-label",
    /Milo kommer/,
  );
  await dates(alice, start, end);
  await expect(alice.locator(".selection-summary")).toContainText(
    "Milo kommer",
  );
  await bob.getByRole("button", { name: "Avboka", exact: true }).click();
  await bob
    .getByRole("dialog")
    .getByRole("button", { name: "Avboka", exact: true })
    .click();
  await expect(bob.getByRole("status")).toContainText("Bokningen har avbokats");
  await Promise.all(contexts.map((c) => c.close()));
});
test("administrator approves and declines requests; owners see final states", async ({
  browser,
}) => {
  const adminContext = await browser.newContext();
  const ownerContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const owner = await ownerContext.newPage();
  await login(owner, 1);
  await dates(owner, day(30), day(31));
  await owner.getByRole("button", { name: "Skicka bokningsförfrågan" }).click();
  await expect(owner.getByRole("status")).toContainText(
    "Din bokningsförfrågan har skickats",
  );
  await login(admin, 0);
  await admin.getByRole("button", { name: /Bokningsförfrågningar/ }).click();
  const luna = admin.locator(".booking-row").filter({ hasText: "Luna" });
  await expect(luna).toContainText("Owner Alice");
  await admin.screenshot({
    path: ".local/approval-admin-desktop.png",
    fullPage: true,
  });
  await admin.setViewportSize({ width: 390, height: 844 });
  expect(
    await admin.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await admin.screenshot({
    path: ".local/approval-admin-mobile.png",
    fullPage: true,
  });
  await luna.getByRole("button", { name: "Godkänn", exact: true }).click();
  await expect(admin.getByRole("status")).toContainText("Bokningen är godkänd");
  await expect(luna).toHaveCount(0);
  await owner.reload();
  await expect(
    owner.getByRole("heading", {
      name: "Vistelse för Luna Godkänd",
      exact: true,
    }),
  ).toBeVisible();
  await dates(owner, day(33));
  await owner.getByRole("button", { name: "Skicka bokningsförfrågan" }).click();
  await expect(owner.getByRole("status")).toContainText(
    "Din bokningsförfrågan har skickats",
  );
  await admin.reload();
  await admin.getByRole("button", { name: /Bokningsförfrågningar/ }).click();
  await luna.getByRole("button", { name: "Neka", exact: true }).click();
  await expect(admin.getByRole("status")).toContainText("har nekats");
  await owner.reload();
  await expect(
    owner.getByRole("heading", {
      name: "Vistelse för Luna Nekad",
      exact: true,
    }),
  ).toBeVisible();
  await dates(owner, day(33));
  await owner.getByRole("button", { name: "Skicka bokningsförfrågan" }).click();
  await expect(owner.getByRole("status")).toContainText(
    "Din bokningsförfrågan har skickats",
  );
  await adminContext.close();
  await ownerContext.close();
});
test("arrival selector, private details, owner deadline and administrator historical edits", async ({
  browser,
}) => {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const [admin, owner, other] = await Promise.all(
    contexts.map((c) => c.newPage()),
  );
  await login(admin, 0);
  await login(owner, 1);
  await login(other, 2);
  await dates(owner, day(45), day(47));
  await owner.getByLabel("Lämningstid", { exact: true }).selectOption("10:15");
  await owner.getByRole("button", { name: "Skicka bokningsförfrågan" }).click();
  await expect(owner.getByRole("status")).toContainText(
    "Din bokningsförfrågan har skickats",
  );
  const state = await (await owner.request.get("/api/calendar")).json();
  const booking = state.bookings.find(
    (b: { startDate: string }) => b.startDate === day(45),
  );
  const row = owner.locator(`[data-booking-id="${booking.id}"]`);
  await expect(row.locator(".arrival-details")).toContainText("kl. 10:15");
  await admin.reload();
  await admin.getByRole("button", { name: /Bokningsförfrågningar/ }).click();
  await admin
    .locator(`[data-booking-id="${booking.id}"]`)
    .getByRole("button", { name: "Godkänn", exact: true })
    .click();
  await expect(admin.locator(`[data-booking-id="${booking.id}"]`)).toHaveCount(
    0,
  );
  await owner.reload();
  await row
    .getByRole("button", { name: "Begär tidsändring", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toContainText("23:59:59");
  await owner
    .getByRole("dialog")
    .getByLabel("Lämningstid", { exact: true })
    .selectOption("11:30");
  await owner
    .getByRole("button", { name: "Skicka ändringsförfrågan", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await expect(row.locator(".arrival-details")).toContainText("kl. 10:15");
  await admin.reload();
  await admin.getByRole("button", { name: /Bokningsförfrågningar/ }).click();
  await admin
    .locator(`[data-booking-id="${booking.id}"]`)
    .getByRole("button", { name: "Godkänn tidsändring", exact: true })
    .click();
  await expect(admin.locator(`[data-booking-id="${booking.id}"]`)).toHaveCount(
    0,
  );
  await owner.reload();
  await expect(row.locator(".arrival-details")).toContainText("kl. 11:30");
  await expect(row.locator(".badge")).toHaveText("Godkänd");
  const shared = await (await other.request.get("/api/calendar")).json();
  expect(JSON.stringify(shared)).not.toMatch(/10:15|11:30/);
  expect(
    shared.entries.some(
      (e: { state: string; dogName: string }) =>
        e.state === "companion" && e.dogName === "Luna",
    ),
  ).toBe(true);
  await owner.setViewportSize({ width: 390, height: 844 });
  await row
    .getByRole("button", { name: "Begär tidsändring", exact: true })
    .click();
  expect(
    await owner.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await owner.screenshot({
    path: ".local/arrival-owner-mobile.png",
    fullPage: true,
  });
  await owner.keyboard.press("Escape");
  // Only isolated fixture rows are adjusted to exercise the real server deadline.
  await pool.query("UPDATE entries SET start_date=$2,end_date=$3 WHERE id=$1", [
    booking.id,
    day(-1),
    day(1),
  ]);
  await owner.reload();
  await row
    .getByRole("button", { name: "Begär tidsändring", exact: true })
    .click();
  await expect(
    owner.getByRole("dialog").getByLabel("Lämningstid", { exact: true }),
  ).toBeDisabled();
  await expect(
    owner.getByRole("dialog").getByLabel("Hämtningstid", { exact: true }),
  ).toBeEnabled();
  await owner.keyboard.press("Escape");
  await expect(row).toContainText("Lämningsdagen har passerat");
  const rejected = await owner.request.patch(
    `/api/bookings/${booking.id}/arrival`,
    {
      headers: { origin: "http://localhost:3000" },
      data: { arrivalTime: "12:00", expectedRevision: 1 },
    },
  );
  expect(rejected.status()).toBe(403);
  const past = day(-40);
  await pool.query("UPDATE entries SET start_date=$2,end_date=$2 WHERE id=$1", [
    booking.id,
    past,
  ]);
  await admin.goto("/");
  const current = todayStockholm().slice(0, 7),
    target = past.slice(0, 7);
  const months =
    (Number(current.slice(0, 4)) - Number(target.slice(0, 4))) * 12 +
    Number(current.slice(5)) -
    Number(target.slice(5));
  for (let i = 0; i < months; i++) {
    const response = admin.waitForResponse((r) =>
      r.url().includes("/api/calendar?month="),
    );
    await admin
      .getByRole("button", { name: "Föregående månad", exact: true })
      .click();
    await response;
    await expect(admin.locator(".calendar-card")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  }
  const historical = admin.locator(`[data-booking-id="${booking.id}"]`);
  await historical
    .getByRole("button", { name: "Ändra tider", exact: true })
    .click();
  await admin
    .getByRole("dialog")
    .getByLabel("Lämningstid", { exact: true })
    .selectOption("12:45");
  await admin.getByRole("button", { name: "Spara tider", exact: true }).click();
  await expect(admin.getByRole("dialog")).toHaveCount(0);
  await expect(historical.locator(".arrival-details")).toContainText(
    "kl. 12:45",
  );
  await expect(historical.locator(".badge")).toHaveText("Godkänd");
  await Promise.all(contexts.map((c) => c.close()));
});
test("pickup selector, same-day ordering and separate time deadlines", async ({
  browser,
}) => {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const [admin, owner, other] = await Promise.all(
    contexts.map((c) => c.newPage()),
  );
  try {
    await login(admin, 0);
    await login(owner, 1);
    await login(other, 2);
    await dates(owner, day(160));
    for (const label of ["Lämningstid", "Hämtningstid"]) {
      const select = owner.getByLabel(label, { exact: true });
      await expect(select.locator("option")).toHaveCount(70);
      await expect(select.locator('option[value="06:00"]')).toHaveCount(1);
      await expect(select.locator('option[value="23:00"]')).toHaveCount(1);
      await expect(
        select.locator('option[value="05:45"],option[value="23:15"]'),
      ).toHaveCount(0);
    }
    await owner
      .getByLabel("Lämningstid", { exact: true })
      .selectOption("10:15");
    await owner
      .getByLabel("Hämtningstid", { exact: true })
      .selectOption("10:15");
    await owner
      .getByRole("button", { name: "Skicka bokningsförfrågan" })
      .click();
    await expect(owner.locator(".alert.error")).toContainText(
      "senare än lämningstiden",
    );
    await owner
      .getByLabel("Hämtningstid", { exact: true })
      .selectOption("18:45");
    await owner
      .getByRole("button", { name: "Skicka bokningsförfrågan" })
      .click();
    await expect(owner.getByRole("status")).toContainText(
      "Din bokningsförfrågan har skickats",
    );
    const data = await (await owner.request.get("/api/calendar")).json();
    const booking = data.bookings.find(
      (b: { startDate: string }) => b.startDate === day(160),
    );
    const row = owner.locator(`[data-booking-id="${booking.id}"]`);
    await expect(row.locator(".pickup-details")).toContainText("18:45");
    await admin.reload();
    await admin.getByRole("button", { name: /Bokningsförfrågningar/ }).click();
    const ar = admin.locator(`[data-booking-id="${booking.id}"]`);
    await expect(ar.locator(".pickup-details")).toContainText("18:45");
    await ar.getByRole("button", { name: "Godkänn", exact: true }).click();
    await expect(ar).toHaveCount(0);
    await pool.query(
      "UPDATE entries SET start_date=$2,end_date=$3 WHERE id=$1",
      [booking.id, day(-1), day(0)],
    );
    await owner.reload();
    await row
      .getByRole("button", { name: "Begär tidsändring", exact: true })
      .click();
    const dialog = owner.getByRole("dialog");
    await expect(
      dialog.getByLabel("Lämningstid", { exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByLabel("Hämtningstid", { exact: true }),
    ).toBeEnabled();
    await dialog
      .getByLabel("Hämtningstid", { exact: true })
      .selectOption("19:45");
    await owner.setViewportSize({ width: 390, height: 844 });
    expect(
      await owner.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await owner.screenshot({
      path: ".local/pickup-owner-mobile.png",
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Skicka ändringsförfrågan" })
      .click();
    await expect(owner.getByRole("dialog")).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    await expect(row.locator(".pickup-details")).toContainText("18:45");
    await admin.reload();
    await admin.getByRole("button", { name: /Bokningsförfrågningar/ }).click();
    await ar
      .getByRole("button", { name: "Godkänn tidsändring", exact: true })
      .click();
    await expect(ar).toHaveCount(0);
    await owner.reload();
    await expect(row.locator(".pickup-details")).toContainText("19:45");
    await expect(row.locator(".badge")).toHaveText("Godkänd");
    const shared = await (await other.request.get("/api/calendar")).json();
    expect(JSON.stringify(shared)).not.toMatch(/18:45|19:45/);
    await pool.query("UPDATE entries SET end_date=start_date WHERE id=$1", [
      booking.id,
    ]);
    const forbidden = await owner.request.patch(
      `/api/bookings/${booking.id}/times`,
      {
        headers: { origin: "http://localhost:3000" },
        data: { pickupTime: "20:00", expectedRevision: 1 },
      },
    );
    expect(forbidden.status()).toBe(403);
    await admin
      .getByRole("button", { name: "Bokningshistorik", exact: true })
      .click();
    await admin
      .locator(`[data-booking-id="${booking.id}"]`)
      .getByRole("button", { name: "Ändra tider", exact: true })
      .click();
    await admin
      .getByRole("dialog")
      .getByLabel("Hämtningstid", { exact: true })
      .selectOption("20:00");
    await admin
      .getByRole("dialog")
      .getByRole("button", { name: "Spara tider" })
      .click();
    await expect(
      admin.locator(`[data-booking-id="${booking.id}"] .pickup-details`),
    ).toContainText("20:00");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
test("cancelled stays expire automatically for both roles and remain in private history", async ({
  browser,
}) => {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const [admin, owner, other] = await Promise.all(
    contexts.map((c) => c.newPage()),
  );
  try {
    await login(owner, 1);
    await login(admin, 0);
    await login(other, 2);
    const result = await owner.request.post("/api/bookings", {
      headers: { origin: "http://localhost:3000" },
      data: {
        startDate: day(130),
        endDate: day(130),
        arrivalTime: "10:00",
        pickupTime: "18:00",
      },
    });
    expect(result.status()).toBe(201);
    const { id } = await result.json();
    await owner.reload();
    const row = owner.locator(`[data-booking-id="${id}"]`);
    await row.getByRole("button", { name: "Avboka", exact: true }).click();
    await owner
      .getByRole("dialog")
      .getByRole("button", { name: "Avboka", exact: true })
      .click();
    await expect(row.locator(".badge")).toHaveText("Avbokad");
    expect(
      (await pool.query("SELECT cancelled_at FROM entries WHERE id=$1", [id]))
        .rows[0].cancelled_at,
    ).toBeInstanceOf(Date);
    // Age only the fixture, then observe actual timer expiry without a reload.
    await pool.query(
      "UPDATE entries SET cancelled_at=clock_timestamp()-interval '24 hours'+interval '8 seconds' WHERE id=$1",
      [id],
    );
    await Promise.all([owner.reload(), admin.reload()]);
    for (const page of [owner, admin])
      await expect(page.locator(`[data-booking-id="${id}"] .badge`)).toHaveText(
        "Avbokad",
      );
    for (const page of [owner, admin])
      await expect(page.locator(`[data-booking-id="${id}"]`)).toHaveCount(0, {
        timeout: 15000,
      });
    for (const page of [owner, admin]) {
      await page
        .getByRole("button", { name: "Bokningshistorik", exact: true })
        .click();
      await expect(page.locator(`[data-booking-id="${id}"] .badge`)).toHaveText(
        "Avbokad",
      );
    }
    await other
      .getByRole("button", { name: "Bokningshistorik", exact: true })
      .click();
    await expect(other.locator(".bookings-section")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(other.locator(`[data-booking-id="${id}"]`)).toHaveCount(0);
    await owner.setViewportSize({ width: 390, height: 844 });
    expect(
      await owner.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await owner.screenshot({
      path: ".local/cancellation-history-mobile.png",
      fullPage: true,
    });
    expect(
      (await pool.query("SELECT booking_status FROM entries WHERE id=$1", [id]))
        .rows[0].booking_status,
    ).toBe("cancelled");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
test("mobile calendar supports single-day tapping and month navigation without overflow", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await login(page, 1);
  await page.getByRole("button", { name: "Nästa månad", exact: true }).click();
  await expect(page.locator(".calendar-card")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page
    .getByRole("button", { name: "Föregående månad", exact: true })
    .click();
  await expect(page.locator(".calendar-card")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const available = page.locator(".day.available:not(:disabled)").first();
  const chosen = await available.getAttribute("data-date");
  await available.click();
  await expect(page.getByLabel("Från", { exact: true })).toHaveValue(chosen!);
  await expect(page.getByLabel("Till och med", { exact: true })).toHaveValue(
    chosen!,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".local/mobile-calendar.png", fullPage: true });
  await context.close();
});
test("date windows, owner change approval, rejection and counter-proposals", async ({
  browser,
}) => {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const [admin, owner, other] = await Promise.all(
    contexts.map((c) => c.newPage()),
  );
  try {
    await login(admin, 0);
    await login(owner, 1);
    await login(other, 2);
    await admin
      .getByRole("button", { name: "Tidsfönster", exact: true })
      .click();
    const defaults = admin.locator("form").filter({
      has: admin.getByRole("heading", { name: "Standardtider", exact: true }),
    });
    await defaults
      .getByLabel("Lämning från", { exact: true })
      .selectOption("07:00");
    await defaults
      .getByLabel("Lämning till", { exact: true })
      .selectOption("10:00");
    await defaults
      .getByLabel("Hämtning från", { exact: true })
      .selectOption("16:00");
    await defaults
      .getByLabel("Hämtning till", { exact: true })
      .selectOption("20:00");
    await defaults.getByRole("button", { name: "Spara standardtider" }).click();
    await expect(admin.getByRole("status")).toContainText(
      "Tidsfönstren har sparats",
    );
    const exception = admin.locator("form").filter({
      has: admin.getByRole("heading", {
        name: "Undantag för ett datum",
        exact: true,
      }),
    });
    await exception.getByLabel("Datum", { exact: true }).fill(day(180));
    await exception
      .getByLabel("Lämning från", { exact: true })
      .selectOption("08:00");
    await exception
      .getByRole("button", { name: "Spara datumundantag" })
      .click();
    await expect(
      admin.getByRole("button", { name: "Ta bort undantag" }),
    ).toBeVisible();
    await owner.reload();
    await dates(owner, day(180), day(182));
    await expect(
      owner
        .getByLabel("Lämningstid", { exact: true })
        .locator('option[value="07:00"]'),
    ).toHaveCount(0);
    await expect(
      owner
        .getByLabel("Lämningstid", { exact: true })
        .locator('option[value="08:00"]'),
    ).toHaveCount(1);
    await owner
      .getByLabel("Lämningstid", { exact: true })
      .selectOption("08:00");
    await owner
      .getByLabel("Hämtningstid", { exact: true })
      .selectOption("18:00");
    await owner
      .getByRole("button", { name: "Skicka bokningsförfrågan" })
      .click();
    await expect(owner.getByRole("status")).toContainText("skickats");
    const state = await (await owner.request.get("/api/calendar")).json();
    const b = state.bookings.find(
      (b: { startDate: string }) => b.startDate === day(180),
    );
    const ar = admin.locator(`[data-booking-id="${b.id}"]`),
      or = owner.locator(`[data-booking-id="${b.id}"]`);
    await admin.reload();
    await admin.getByRole("button", { name: /Bokningsförfrågningar/ }).click();
    await ar
      .getByRole("button", { name: "Föreslå tider", exact: true })
      .click();
    await admin
      .getByRole("dialog")
      .getByLabel("Lämningstid", { exact: true })
      .selectOption("08:30");
    await admin
      .getByRole("button", { name: "Skicka tidsförslag", exact: true })
      .click();
    await expect(admin.getByRole("dialog")).toHaveCount(0);
    await expect(
      ar.getByRole("button", { name: "Godkänn", exact: true }),
    ).toBeDisabled();
    await owner.reload();
    await expect(or.locator(".arrival-details")).toContainText("08:00");
    await or
      .getByRole("button", { name: "Acceptera tider", exact: true })
      .click();
    await expect(or.locator(".arrival-details")).toContainText("08:30");
    await expect(or.locator(".badge")).toHaveText("Väntar på godkännande");
    await admin.reload();
    await admin.getByRole("button", { name: /Bokningsförfrågningar/ }).click();
    await ar.getByRole("button", { name: "Godkänn", exact: true }).click();
    await expect(ar).toHaveCount(0);
    await owner.reload();
    await or
      .getByRole("button", { name: "Begär tidsändring", exact: true })
      .click();
    await owner
      .getByRole("dialog")
      .getByLabel("Hämtningstid", { exact: true })
      .selectOption("19:00");
    await owner
      .getByRole("button", { name: "Skicka ändringsförfrågan" })
      .click();
    await expect(owner.getByRole("dialog")).toHaveCount(0);
    await expect(or.locator(".pickup-details")).toContainText("18:00");
    await expect(or.locator(".badge")).toHaveText("Godkänd");
    await admin.reload();
    await admin.getByRole("button", { name: /Bokningsförfrågningar/ }).click();
    await ar
      .getByRole("button", { name: "Neka tidsändring", exact: true })
      .click();
    await expect(ar).toHaveCount(0);
    await owner.reload();
    await expect(or.locator(".pickup-details")).toContainText("18:00");
    await expect(or).toContainText("Ett nytt förslag behövs för hämtning");
    await or
      .getByRole("button", { name: "Begär tidsändring", exact: true })
      .click();
    await owner
      .getByRole("dialog")
      .getByLabel("Hämtningstid", { exact: true })
      .selectOption("18:00");
    await owner
      .getByRole("button", { name: "Skicka ändringsförfrågan" })
      .click();
    await expect(owner.getByRole("dialog")).toHaveCount(0);
    await admin.reload();
    await admin.getByRole("button", { name: /Bokningsförfrågningar/ }).click();
    await ar
      .getByRole("button", { name: "Godkänn tidsändring", exact: true })
      .click();
    await expect(ar).toHaveCount(0);
    await owner.reload();
    await expect(or.locator(".pickup-details")).toContainText("18:00");
    await expect(or).not.toContainText("Ett nytt förslag behövs");
    const privateData = await (await other.request.get("/api/calendar")).json();
    expect(JSON.stringify(privateData)).not.toMatch(/08:30|19:15|proposalId/);
    await admin
      .getByRole("button", { name: "Tidsfönster", exact: true })
      .click();
    await admin.setViewportSize({ width: 390, height: 844 });
    expect(
      await admin.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await admin.screenshot({
      path: ".local/time-window-settings-mobile.png",
      fullPage: true,
    });
  } finally {
    // Restore only the isolated fixture settings for the remaining browser scenarios.
    await pool.query("DELETE FROM time_window_overrides");
    await pool.query(
      "UPDATE time_window_settings SET arrival_start='06:00',arrival_end='23:00',pickup_start='06:00',pickup_end='23:00',revision=revision+1",
    );
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test("administrator shares an invite; owner chooses a password and signs in", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, 0);
  await page.getByRole("button", { name: "Hundar och ägare" }).click();
  await page
    .getByRole("button", { name: "Ny aktiveringslänk" })
    .first()
    .click();
  const url = await page.getByLabel("Privat aktiveringslänk").inputValue();
  const other = await browser.newContext();
  const invite = await other.newPage();
  await invite.goto(url);
  await invite
    .getByLabel("Välj ett lösenord", { exact: true })
    .fill(people[1].password + "new");
  await invite.getByRole("button", { name: "Spara lösenord" }).click();
  await expect(
    invite.getByRole("heading", { name: "Allt är klart." }),
  ).toBeVisible();
  await invite.getByRole("link", { name: "Till inloggningen" }).click();
  await invite.getByLabel("E-postadress").fill(people[1].email);
  await invite
    .getByLabel("Lösenord", { exact: true })
    .fill(people[1].password + "new");
  await invite.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(invite.getByRole("button", { name: "Logga ut" })).toBeVisible();
  await other.close();
  await ctx.close();
});

test("administrator invites a third dog and the calendar supports all three", async ({
  page,
}) => {
  const accounts = await seedTestDatabase();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/login");
  await expect(page.locator(".auth-form")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.getByLabel("E-postadress").fill(accounts[0].email);
  await page.getByLabel("Lösenord", { exact: true }).fill(accounts[0].password);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await page
    .getByRole("button", { name: "Hundar och ägare", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Bjud in hundägare", exact: true })
    .click();
  await page
    .getByLabel("Hundägarens namn", { exact: true })
    .fill("Owner Charlie");
  await page
    .getByLabel("E-postadress", { exact: true })
    .fill("charlie@example.test");
  await page.getByLabel("Hundens namn", { exact: true }).fill("Nova");
  await page
    .getByRole("button", { name: "Skapa inbjudan", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Inbjudan är klar" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".owner-card")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Bjud in hundägare", exact: true }),
  ).toBeEnabled();
  if (process.env.UPDATE_SCREENSHOTS === "1") {
    await mkdir("docs/screenshots", { recursive: true });
    await page.screenshot({
      path: "docs/screenshots/owners.png",
      fullPage: true,
    });
  }
  const response = await page.request.get("/api/calendar");
  const data = await response.json();
  const startDate = addDays(todayStockholm(), 3),
    endDate = addDays(startDate, 2);
  for (const owner of data.owners) {
    const booking = await page.request.post("/api/bookings", {
      headers: { origin: "http://localhost:3000" },
      data: {
        ownerId: owner.id,
        startDate,
        endDate,
        arrivalTime: "10:00",
        pickupTime: "18:00",
      },
    });
    expect(booking.status()).toBe(201);
  }
  await page.goto("/");
  await expect(page.locator(".app-shell:not([inert])")).toBeVisible();
  await expect(page.locator(".calendar-card")).toBeVisible();
  // The sample dates may fall in the next month near month-end.
  if (startDate.slice(0, 7) !== todayStockholm().slice(0, 7))
    await page
      .getByRole("button", { name: "Nästa månad", exact: true })
      .click();
  await expect(page.locator(`[data-date="${startDate}"]`)).toHaveAttribute(
    "aria-label",
    /3 hundar kommer/,
  );
  if (process.env.UPDATE_SCREENSHOTS === "1")
    await page.screenshot({
      path: "docs/screenshots/calendar.png",
      fullPage: true,
    });
});
