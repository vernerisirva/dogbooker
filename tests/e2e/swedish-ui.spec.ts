import { test, expect } from "@playwright/test";

test("public pages and native validation stay Swedish in an English browser", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  await expect(page).toHaveTitle("DogBooker · Ett andra hem för din hund");
  await expect(
    page.getByRole("heading", { name: "Välkommen tillbaka." }),
  ).toBeVisible();
  await expect(page.locator(".auth-form")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  expect(
    await page
      .getByLabel("E-postadress")
      .evaluate((el: HTMLInputElement) => el.validationMessage),
  ).toBe("Fyll i det här fältet.");
  await page.getByLabel("E-postadress").fill("invalid");
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  expect(
    await page
      .getByLabel("E-postadress")
      .evaluate((el: HTMLInputElement) => el.validationMessage),
  ).toBe("Ange en giltig e-postadress.");
  await page.getByLabel("E-postadress").fill("example@example.test");
  await page
    .getByLabel("Lösenord", { exact: true })
    .fill("a long test password");
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.abort("failed"),
  );
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Det gick inte att ansluta." }),
  ).toBeVisible();
  await page.unroute("**/api/auth/sign-in/email");
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Invalid email or password" }),
    }),
  );
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Kontrollera e-postadress och lösenord." }),
  ).toBeVisible();
  await page.goto("/invite");
  await expect(
    page.getByRole("button", { name: "Spara lösenord", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".auth-form")).toContainText(
    "Öppna hela inbjudningslänken",
  );
  await page.goto("/missing-page");
  await expect(
    page.getByRole("heading", { name: "Sidan kunde inte hittas." }),
  ).toBeVisible();
  await context.close();
});
