import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const isVercel = process.env.VERCEL === "1";
const shouldRunMigrations = isVercel || process.env.RUN_MIGRATIONS === "1";

run("prisma", ["generate"]);

if (shouldRunMigrations) {
  run("prisma", ["migrate", "deploy"]);
}

run("next", ["build"]);
