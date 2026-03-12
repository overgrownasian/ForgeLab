import { existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";

const nextDir = ".next";

if (existsSync(nextDir)) {
  rmSync(nextDir, { recursive: true, force: true });
}

const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "dev"], {
  stdio: "inherit",
  shell: false
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
