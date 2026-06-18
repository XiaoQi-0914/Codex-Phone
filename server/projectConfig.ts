import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "./types.js";
import { discoverVscodeProjects } from "./vscodeProjects.js";

function normalizeProjectPath(projectPath: string) {
  return path.resolve(projectPath);
}

function projectPathKey(projectPath: string) {
  const normalized = normalizeProjectPath(projectPath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function normalizeProjects(projects: AppConfig["projects"]) {
  return projects
    .filter((project) => project?.id && project?.name && project?.path)
    .map((project) => ({
      ...project,
      path: normalizeProjectPath(project.path)
    }));
}

function mergeProjects(configProjects: AppConfig["projects"], discoveredProjects: AppConfig["projects"]) {
  const merged: AppConfig["projects"] = [];
  const seenPaths = new Set<string>();
  const seenIds = new Set<string>();

  for (const project of [...normalizeProjects(configProjects), ...normalizeProjects(discoveredProjects)]) {
    const pathKey = projectPathKey(project.path);
    if (seenPaths.has(pathKey)) {
      continue;
    }

    let id = project.id;
    let suffix = 2;
    while (seenIds.has(id)) {
      id = `${project.id}-${suffix}`;
      suffix += 1;
    }

    merged.push({ ...project, id });
    seenPaths.add(pathKey);
    seenIds.add(id);
  }

  return merged;
}

export async function loadConfig(): Promise<AppConfig> {
  const configPath = path.resolve(process.env.CODEX_PHONE_CONFIG_PATH ?? path.resolve(process.cwd(), "config.json"));
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as AppConfig & {
    project?: {
      id: string;
      name: string;
      path: string;
    };
    projects?: AppConfig["projects"];
  };

  const projects = parsed.projects ?? (parsed.project ? [parsed.project] : []);
  const discoveredProjects = await discoverVscodeProjects();
  const normalizedProjects = mergeProjects(projects, discoveredProjects);
  if (normalizedProjects.length === 0) {
    throw new Error("config.json has no valid projects and no VS Code projects were discovered");
  }

  if (!parsed.server?.port) {
    throw new Error("config.json is missing server.port");
  }

  return {
    codexCommand: parsed.codexCommand,
    projects: normalizedProjects,
    server: parsed.server
  };
}
