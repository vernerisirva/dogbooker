import { test, expect } from "@playwright/test";

test("invitation fragment survives hydration, stays out of URLs and submits once", async ({
  page,
}) => {
  const token = "a".repeat(64);
  let submissions = 0;
  await page.route("**/api/invitations/accept", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.token).toBe(token);
    expect(body.password).toBe("a sufficiently long test phrase");
    expect(route.request().url()).not.toContain(token);
    submissions++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.goto(`/invite#${token}`);
  await expect(page.locator(".auth-form")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page).toHaveURL(/\/invite$/);
  await page
    .getByLabel("Välj ett lösenord", { exact: true })
    .fill("a sufficiently long test phrase");
  await page
    .getByRole("button", { name: "Spara lösenord", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Allt är klart." }),
  ).toBeVisible();
  expect(submissions).toBe(1);
});

test("missing invitation fails closed and login fields wait for hydration", async ({
  page,
}) => {
  await page.goto("/invite");
  await expect(
    page.getByRole("button", { name: "Spara lösenord" }),
  ).toBeDisabled();
  await page.goto("/login");
  await expect(page.locator(".auth-form")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.getByLabel("E-postadress")).toBeEnabled();
  await expect(page.getByLabel("Lösenord", { exact: true })).toBeEnabled();
  await expect(page.locator(".auth-form")).toHaveAttribute("method", "post");
});
