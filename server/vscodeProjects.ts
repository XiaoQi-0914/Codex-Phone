import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectConfig } from "./types.js";

type VscodeWindowState = {
  folder?: string;
  workspace?: string;
};

type VscodeStorage = {
  windowsState?: {
    lastActiveWindow?: VscodeWindowState;
    openedWindows?: VscodeWindowState[];
  };
};

const vscodeStorageCandidates =
  process.platform === "win32"
    ? [
        path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Code", "User", "globalStorage", "storage.json"),
        path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Code - Insiders", "User", "globalStorage", "storage.json")
      ]
    : process.platform === "darwin"
      ? [
          path.join(os.homedir(), "Library", "Application Support", "Code", "User", "globalStorage", "storage.json"),
          path.join(os.homedir(), "Library", "Application Support", "Code - Insiders", "User", "globalStorage", "storage.json")
        ]
      : [
          path.join(os.homedir(), ".config", "Code", "User", "globalStorage", "storage.json"),
          path.join(os.homedir(), ".config", "Code - Insiders", "User", "globalStorage", "storage.json")
        ];

function uriToPath(uri: string) {
  if (!uri.startsWith("file://")) {
    return "";
  }

  try {
    return fileURLToPath(uri);
  } catch {
    return "";
  }
}

function normalizeProjectPath(projectPath: string) {
  return path.resolve(projectPath);
}

function getProjectName(projectPath: string) {
  const parsed = path.parse(projectPath);
  return path.basename(projectPath) || parsed.root || projectPath;
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "vscode-project";
}

function createProjectId(projectPath: string) {
  const name = slugify(getProjectName(projectPath));
  const hash = createHash("sha1").update(projectPath.toLowerCase()).digest("hex").slice(0, 8);
  return `${name}-${hash}`;
}

function workspaceUriToProjectPath(uri: string) {
  const candidate = uriToPath(uri);
  if (!candidate) {
    return "";
  }

  return candidate.toLowerCase().endsWith(".code-workspace") ? path.dirname(candidate) : candidate;
}

async function readStorage(storagePath: string) {
  try {
    const raw = await readFile(storagePath, "utf8");
    return JSON.parse(raw) as VscodeStorage;
  } catch {
    return null;
  }
}

export async function discoverVscodeProjects(): Promise<ProjectConfig[]> {
  const discovered = new Map<string, ProjectConfig>();

  for (const storagePath of vscodeStorageCandidates) {
    const storage = await readStorage(storagePath);
    const windows = [
      ...(storage?.windowsState?.openedWindows ?? []),
      ...(storage?.windowsState?.lastActiveWindow ? [storage.windowsState.lastActiveWindow] : [])
    ];

    for (const windowState of windows) {
      const rawPath = windowState.folder
        ? uriToPath(windowState.folder)
        : windowState.workspace
          ? workspaceUriToProjectPath(windowState.workspace)
          : "";

      if (!rawPath) {
        continue;
      }

      const projectPath = normalizeProjectPath(rawPath);
      if (!existsSync(projectPath)) {
        continue;
      }

      const key = process.platform === "win32" ? projectPath.toLowerCase() : projectPath;
      if (discovered.has(key)) {
        continue;
      }

      discovered.set(key, {
        id: createProjectId(projectPath),
        name: getProjectName(projectPath),
        path: projectPath
      });
    }
  }

  return [...discovered.values()];
}
