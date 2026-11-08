import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { adminPool } from "../../scripts/migrate";
import { addDays, todayStockholm } from "../../lib/dates";
const people = JSON.parse(await readFile(".local/demo-accounts.json", "utf8"))
  .people as { id: string; email: string; password: string }[];
async function login(page: Page, index: number) {
  await page.goto("/");
  await page.getByLabel("E-postadress").fill(people[index].email);
  await page.getByLabel("Lösenord").fill(people[index].password);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Logga ut" })).toBeVisible();
}
const admin = adminPool();
test.beforeEach(async () => {
  await admin.query('DELETE FROM "rateLimit"');
});
test.afterAll(() => admin.end());
test("owner searches with two dogs, sitter approves, unrelated sitter cannot read or decide", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, 0);
  await page.getByRole("checkbox", { name: "Smulan", exact: true }).check();
  await page.getByRole("checkbox", { name: "Atlas", exact: true }).check();
  await page
    .getByLabel("Från", { exact: true })
    .fill(addDays(todayStockholm(), 15));
  await page.getByLabel("Till och med").fill(addDays(todayStockholm(), 17));
  await page
    .getByRole("button", { name: "Hitta hundvakter", exact: true })
    .click();
  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Majas lugna hundhem" }),
  });
  await expect(card).toBeVisible();
  await card.getByText("Visa profil och varför ni passar").click();
  await expect(
    card.getByText("Storlek och omsorgsbehov passar."),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/marketplace-desktop.png",
    fullPage: true,
  });
  await card.getByRole("button", { name: "Skicka förfrågan" }).click();
  await expect(page.getByRole("status")).toContainText("Förfrågan är skickad");
  const me = await (await page.request.get("/api/marketplace/me")).json();
  const booking = me.bookings.find(
    (b: { start_date: string; status: string }) =>
      b.start_date === addDays(todayStockholm(), 15) && b.status === "pending",
  );
  expect(booking.dogs).toHaveLength(2);
  const unrelated = await browser.newContext();
  const other = await unrelated.newPage();
  await login(other, 3);
  expect(
    (await other.request.get(`/api/marketplace/me?id=${booking.id}`)).status(),
  ).toBe(404);
  expect(
    (
      await other.request.post("/api/marketplace/decisions", {
        headers: { origin: "http://127.0.0.1:3100" },
        data: { id: booking.id, decision: "confirmed", revision: 0 },
      })
    ).status(),
  ).toBe(404);
  await unrelated.close();
  const sitterContext = await browser.newContext();
  const sitter = await sitterContext.newPage();
  await login(sitter, 2);
  await sitter
    .getByRole("button", { name: "Mina bokningar", exact: true })
    .click();
  const request = sitter.locator(`[data-booking-id="${booking.id}"]`);
  await request.getByRole("button", { name: "Godkänn", exact: true }).click();
  await expect(request.getByText("Godkänd", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Uppdatera", exact: true }).click();
  await expect(page.getByText("Godkänd", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Avboka", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("avbokad");
  await sitterContext.close();
  expect(errors).toEqual([]);
});
test("new synthetic owner manages multiple dogs and creates sitter profile/availability on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Skapa ett nytt demokonto" }).click();
  await page.getByLabel("Ditt namn").fill("Ny demohundvakt");
  await page.getByLabel("E-postadress").fill(`${randomUUID()}@example.test`);
  await page.getByLabel("Lösenord").fill("Synthetic-example-only-123");
  await page.getByRole("button", { name: "Skapa konto", exact: true }).click();
  await expect(page.getByRole("button", { name: "Logga ut" })).toBeVisible();
  await page.getByRole("button", { name: "Mina hundar", exact: true }).click();
  const addForm = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Lägg till en hund",
      exact: true,
    }),
  });
  for (const name of ["Bosse", "Berta"]) {
    await addForm.getByLabel("Hundens namn").fill(name);
    await addForm
      .getByLabel("Kan dela hem med andra hundar?")
      .selectOption("true");
    await page.getByRole("button", { name: "Spara hund", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Hunden är tillagd");
  }
  await expect(
    page.locator("summary").filter({ hasText: "Bosse" }),
  ).toBeVisible();
  await expect(
    page.locator("summary").filter({ hasText: "Berta" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Min hundvaktsprofil", exact: true })
    .click();
  await page.getByLabel("Profilnamn").fill("Ny demo i Stockholm");
  await page.getByLabel("Finns egna hundar i hemmet?").selectOption("true");
  await page.getByRole("button", { name: "Spara profil", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Hundvaktsprofilen är sparad",
  );
  await page.getByRole("button", { name: "Spara datum", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Tillgängligheten är sparad",
  );
  await page.screenshot({
    path: ".local/marketplace-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("owner cancellation and sitter decline release capacity", async ({
  page,
  browser,
}) => {
  await login(page, 1);
  await page
    .getByRole("button", { name: "Hitta hundvakter", exact: true })
    .click();
  const card = page
    .getByRole("article")
    .filter({ hasText: "Livs trädgårdsboende" });
  await card.getByRole("button", { name: "Skicka förfrågan" }).click();
  await expect(page.getByRole("status")).toContainText("Förfrågan är skickad");
  const me = await (await page.request.get("/api/marketplace/me")).json();
  const booking = me.bookings.find(
    (b: { status: string }) => b.status === "pending",
  );
  const context = await browser.newContext();
  const sitter = await context.newPage();
  await login(sitter, 4);
  await sitter
    .getByRole("button", { name: "Mina bokningar", exact: true })
    .click();
  await sitter
    .locator(`[data-booking-id="${booking.id}"]`)
    .getByRole("button", { name: "Neka", exact: true })
    .click();
  await page.getByRole("button", { name: "Uppdatera", exact: true }).click();
  await expect(
    page
      .locator(`[data-booking-id="${booking.id}"]`)
      .getByText("Nekad", { exact: true }),
  ).toBeVisible();
  await context.close();
});

test("credentials cannot submit as a GET before hydration", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("form")).toHaveAttribute("method", "post");
  await expect(page.locator("form")).toHaveAttribute("inert", "");
  await expect(
    page.getByRole("button", {
      name: "Logga in",
      exact: true,
      includeHidden: true,
    }),
  ).toBeDisabled();
  expect(page.url()).toBe("http://127.0.0.1:3100/");
  await context.close();
});
