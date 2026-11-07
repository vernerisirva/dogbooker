import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const random = () => randomBytes(32).toString("base64url");
const template = await readFile(".env.example", "utf8");
await writeFile(
  ".env.local",
  template
    .replaceAll("replace-local-password", random())
    .replace("replace-with-random-secret", random())
    .replace("replace-with-random-cron-secret", random()),
  { flag: "wx", mode: 0o600 },
);
console.log(
  "Created .env.local with unique local credentials. Existing files are never overwritten.",
);
