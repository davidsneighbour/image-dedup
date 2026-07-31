import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function readPackageVersion(): string {
  const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));
  const raw = readFileSync(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as { version: string };
  return parsed.version;
}
