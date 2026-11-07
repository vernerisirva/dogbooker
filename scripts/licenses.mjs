import { readFile, writeFile, mkdir } from "node:fs/promises";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const rows = [];
for (const [path, pkg] of Object.entries(lock.packages)) {
  if (!path) continue;
  let license = pkg.license;
  // This published package omits the field but ships an Apache-2.0 license file.
  if (!license && path === "node_modules/@vercel/cli-auth") {
    const text = await readFile(`${path}/LICENSE`, "utf8");
    if (text.includes("Apache License") && text.includes("Version 2.0"))
      license = "Apache-2.0 (LICENSE file)";
  }
  if (!license) throw new Error(`License review required: ${path}`);
  rows.push({
    path,
    version: pkg.version,
    license,
    dev: !!pkg.dev,
    optional: !!pkg.optional,
    resolved: pkg.resolved,
    integrity: pkg.integrity,
  });
}
await mkdir("docs", { recursive: true });
await writeFile("docs/dependencies.json", JSON.stringify(rows, null, 2) + "\n");
console.log(
  `Reviewed ${rows.length} locked dependency entries; inventory written to docs/dependencies.json.`,
);
