import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(process.cwd());
const now = new Date();
const timestamp = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, "0"),
  String(now.getDate()).padStart(2, "0"),
  "-",
  String(now.getHours()).padStart(2, "0"),
  String(now.getMinutes()).padStart(2, "0"),
  String(now.getSeconds()).padStart(2, "0")
].join("");
const outputDir = path.join("release", timestamp);

const result =
  process.platform === "win32"
    ? spawnSync(
        process.env.ComSpec || "cmd.exe",
        [
          "/d",
          "/s",
          "/c",
          `npx electron-builder --win --x64 --config.directories.output=${outputDir}`
        ],
        {
          cwd: projectRoot,
          stdio: "inherit",
          shell: false,
          env: process.env
        }
      )
    : spawnSync(
        "npx",
        ["electron-builder", "--win", "--x64", `--config.directories.output=${outputDir}`],
        {
          cwd: projectRoot,
          stdio: "inherit",
          shell: false,
          env: process.env
        }
      );

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  throw new Error(`Windows package build failed with exit code ${result.status ?? "unknown"}.`);
}

console.log(`Windows package generated at: ${outputDir}`);
