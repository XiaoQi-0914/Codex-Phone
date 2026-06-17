import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "./types.js";

export async function loadConfig(): Promise<AppConfig> {
  const configPath = path.resolve(process.cwd(), "config.json");
  const raw = await readFile(configPath, "utf8");
  const config = JSON.parse(raw) as AppConfig;

  if (!config.project?.path) {
    throw new Error("config.json is missing project.path");
  }

  if (!config.server?.port) {
    throw new Error("config.json is missing server.port");
  }

  return config;
}
