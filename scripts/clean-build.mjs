import { existsSync, rmSync } from "node:fs";

const target = "build";

if (existsSync(target)) {
  rmSync(target, { recursive: true, force: true });
}
