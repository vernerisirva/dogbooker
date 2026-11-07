import { writeFile, mkdir } from "node:fs/promises";
import { bootstrapAdmin, recoverAdmin } from "../src/lib/invitations";
import { pool } from "../src/db";
import { z } from "zod";
async function main() {
  const [name, email, mode] = process.argv.slice(2);
  if (!name || !z.email().safeParse(email).success)
    throw new Error(
      'Usage: npm run account:admin -- "Full name" email@example.com [recover]',
    );
  const invite =
    mode === "recover"
      ? await recoverAdmin(email)
      : await bootstrapAdmin(name, email);
  await mkdir(".local", { recursive: true });
  await writeFile(
    ".local/admin-invitation.txt",
    `Administrator invitation (expires in 48 hours; single use)\n${invite.url}\n`,
    { mode: 0o600 },
  );
  console.log(
    "Administrator invitation saved to .local/admin-invitation.txt. Open it privately; do not commit or publish it.",
  );
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Account setup failed");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
