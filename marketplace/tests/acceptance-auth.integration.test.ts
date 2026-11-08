import { afterAll, expect, it, vi } from "vitest";
// Better Auth disables origin checks under NODE_ENV=test. Exercise the deployed mode.
vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TEST", "false");
});
import { randomUUID } from "node:crypto";
import { auth, authPool } from "../lib/auth";
import { pool } from "../lib/db";
import { adminPool } from "../scripts/migrate";
import { GET, POST } from "../app/api/marketplace/[resource]/route";

const admin = adminPool();
const origin = "http://127.0.0.1:3100";
afterAll(async () => {
  await Promise.all([admin.end(), authPool.end(), pool.end()]);
  vi.unstubAllEnvs();
});
async function authRequest(
  path: string,
  body: unknown,
  cookie?: string,
  requestOrigin = origin,
) {
  return auth.handler(
    new Request(`${origin}/api/auth/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: requestOrigin,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}
function sessionCookie(response: Response) {
  const cookies = response.headers.getSetCookie();
  const session = cookies.find((c) =>
    c.startsWith("dogbooker-marketplace.session_token="),
  );
  expect(session).toBeDefined();
  expect(session).toMatch(/HttpOnly/i);
  expect(session).toMatch(/SameSite=Lax/i);
  expect(session).toMatch(/Path=\//i);
  expect(session).not.toMatch(/Domain=/i);
  return session!.split(";")[0];
}
const me = (cookie: string) =>
  GET(new Request(`${origin}/api/marketplace/me`, { headers: { cookie } }), {
    params: Promise.resolve({ resource: "me" }),
  });

it("verifies password hashing, session expiry, tamper rejection, logout revocation and auth-origin checks", async () => {
  await admin.query('DELETE FROM "rateLimit"');
  const email = `${randomUUID()}@example.test`,
    password = `Synthetic-${randomUUID()}`;
  const signup = await authRequest("sign-up/email", {
    name: "Acceptance auth",
    email,
    password,
    isActive: false,
  });
  expect(signup.status).toBe(200);
  const cookie = sessionCookie(signup);
  const user = (await signup.json()).user;
  const account = (
    await admin.query('SELECT password FROM account WHERE "userId"=$1', [
      user.id,
    ])
  ).rows[0];
  expect(account.password).not.toBe(password);
  expect(account.password).toMatch(/^[a-f0-9]+:[a-f0-9]+$/);
  expect((await me(cookie)).status).toBe(200);
  expect((await me(`${cookie}tampered`)).status).toBe(401);
  const expiry = (
    await admin.query(
      'SELECT extract(epoch FROM ("expiresAt"-"createdAt"))::int AS seconds FROM "session" WHERE "userId"=$1',
      [user.id],
    )
  ).rows[0].seconds;
  expect(expiry).toBeGreaterThanOrEqual(86399);
  expect(expiry).toBeLessThanOrEqual(86401);
  expect(
    (
      await authRequest("sign-in/email", {
        email,
        password: "Incorrect-acceptance-password",
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await authRequest(
        "sign-in/email",
        { email, password },
        undefined,
        "https://evil.test",
      )
    ).status,
  ).toBe(403);
  expect(
    (await authRequest("sign-out", {}, cookie, "https://evil.test")).status,
  ).toBe(403);
  expect((await me(cookie)).status).toBe(200);
  expect((await authRequest("sign-out", {}, cookie)).status).toBe(200);
  expect((await me(cookie)).status).toBe(401);
  const login = await authRequest("sign-in/email", { email, password });
  expect(login.status).toBe(200);
  const second = sessionCookie(login);
  await admin.query(
    'UPDATE "session" SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE "userId"=$1',
    [user.id],
  );
  expect((await me(second)).status).toBe(401);
  await admin.query('UPDATE "user" SET "isActive"=false WHERE id=$1', [
    user.id,
  ]);
  expect(
    (await authRequest("sign-in/email", { email, password })).status,
  ).not.toBe(200);
  expect(
    (
      await admin.query(
        'SELECT 1 FROM "session" WHERE "userId"=$1 AND "expiresAt">clock_timestamp()',
        [user.id],
      )
    ).rowCount,
  ).toBe(0);
});

it("enforces persistent sign-in rate limits and refuses foreign/missing mutation origins", async () => {
  await admin.query('DELETE FROM "rateLimit"');
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++)
      statuses.push(
        (
          await authRequest("sign-in/email", {
            email: "absent-acceptance@example.test",
            password: "Synthetic-password-123",
          })
        ).status,
      );
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);
    expect(
      (await admin.query('SELECT count(*)::int AS n FROM "rateLimit"')).rows[0]
        .n,
    ).toBeGreaterThan(0);
    for (const requestOrigin of [
      undefined,
      "https://evil.test",
      "http://localhost:3100",
    ]) {
      const result = await POST(
        new Request(`${origin}/api/marketplace/dogs`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(requestOrigin ? { origin: requestOrigin } : {}),
          },
          body: "{}",
        }),
        { params: Promise.resolve({ resource: "dogs" }) },
      );
      expect(result.status).toBe(403);
      expect(result.headers.get("cache-control")).toBe("private, no-store");
    }
  } finally {
    await admin.query('DELETE FROM "rateLimit"');
  }
});
