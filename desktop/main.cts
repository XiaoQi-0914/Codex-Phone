import { app, BrowserWindow, Menu, Tray, clipboard, nativeImage, screen, shell } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

delete process.env.ELECTRON_RUN_AS_NODE;

const isPackaged = app.isPackaged;
const devProjectRoot = path.resolve(__dirname, "..", "..", "..");
const electronLogPath = path.resolve(process.env.TEMP ?? os.tmpdir(), "codex-phone-electron.log");
const serverHost = "127.0.0.1";
const serverPort = 5179;

let tray: Tray | null = null;
let toastWindow: BrowserWindow | null = null;
let backendProcess: ChildProcessWithoutNullStreams | null = null;
let isQuitting = false;
let backendStdout = "";
let backendStderr = "";
let runtimePaths: {
  codeRoot: string;
  resourcesRoot: string;
  distDir: string;
  serverEntry: string;
  configPath: string;
  dataDir: string;
  installDir: string;
  trayIconPath: string;
} | null = null;

function logLine(message: string) {
  const line = `[${new Date().toISOString()}] ${message}`;
  try {
    appendFileSync(electronLogPath, `${line}\n`, "utf8");
  } catch {}
}

logLine("main module loaded");

function initRuntimePaths() {
  const codeRoot = isPackaged ? app.getAppPath() : devProjectRoot;
  const resourcesRoot = isPackaged ? process.resourcesPath : codeRoot;
  const distDir = path.resolve(codeRoot, "dist");
  const serverEntry = path.resolve(distDir, "main", "server", "index.js");
  const configPath = path.resolve(resourcesRoot, "config.json");
  const dataDir = path.resolve(app.getPath("userData"), "data");
  const installDir = isPackaged ? path.dirname(process.execPath) : codeRoot;
  const trayIconPath = path.resolve(resourcesRoot, "build", "tray-icon.png");

  runtimePaths = {
    codeRoot,
    resourcesRoot,
    distDir,
    serverEntry,
    configPath,
    dataDir,
    installDir,
    trayIconPath
  };

  logLine(
    [
      "runtime paths initialized",
      `isPackaged=${isPackaged}`,
      `codeRoot=${codeRoot}`,
      `resourcesRoot=${resourcesRoot}`,
      `serverEntry=${serverEntry}`,
      `configPath=${configPath}`,
      `dataDir=${dataDir}`,
      `installDir=${installDir}`,
      `trayIconPath=${trayIconPath}`
    ].join(" | ")
  );
}

function getRuntimePaths() {
  if (!runtimePaths) {
    throw new Error("Runtime paths are not initialized yet.");
  }

  return runtimePaths;
}

process.on("uncaughtException", (error) => {
  logLine(`uncaughtException: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
});

process.on("unhandledRejection", (error) => {
  logLine(`unhandledRejection: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
});

function getIpv4Addresses() {
  const interfaces = os.networkInterfaces();
  const entries = Object.values(interfaces).flat().filter(Boolean) as os.NetworkInterfaceInfo[];
  return entries.filter((entry) => entry.family === "IPv4" && !entry.internal).map((entry) => entry.address);
}

function getPrimaryIp() {
  return getIpv4Addresses()[0] ?? "127.0.0.1";
}

function getAccessAddress() {
  return `http://${getPrimaryIp()}:${serverPort}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildRuntimeDetails(message: string) {
  const paths = runtimePaths;
  return [
    `错误信息: ${message}`,
    "",
    `EXE 路径: ${process.execPath}`,
    `日志文件: ${electronLogPath}`,
    `安装目录: ${paths?.installDir ?? "(not ready)"}`,
    `代码目录: ${paths?.codeRoot ?? "(not ready)"}`,
    `资源目录: ${paths?.resourcesRoot ?? "(not ready)"}`,
    `配置文件: ${paths?.configPath ?? "(not ready)"}`,
    `数据目录: ${paths?.dataDir ?? "(not ready)"}`,
    `服务入口: ${paths?.serverEntry ?? "(not ready)"}`,
    "",
    "stderr:",
    backendStderr || "(empty)",
    "",
    "stdout:",
    backendStdout || "(empty)"
  ].join("\n");
}

function createTrayIcon() {
  const { trayIconPath } = getRuntimePaths();
  const image = nativeImage.createFromPath(trayIconPath);
  return image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 });
}

function buildToastHtml() {
  const ip = getPrimaryIp();
  const address = getAccessAddress();
  return `
    <!doctype html>
    <html>
      <body style="margin:0;background:#0f172a;color:#e2e8f0;font-family:'Segoe UI',sans-serif;">
        <div style="padding:18px 20px;">
          <div style="font-size:18px;font-weight:700;color:#f8fafc;">Codex Phone 已启动</div>
          <div style="margin-top:8px;font-size:13px;line-height:1.5;color:#cbd5e1;">
            服务正在后台运行，可从右下角托盘菜单操作。
          </div>
          <div style="margin-top:14px;padding:12px;border-radius:10px;background:#111827;">
            <div style="font-size:12px;color:#94a3b8;">本机 IP</div>
            <div style="margin-top:4px;font-size:14px;color:#f8fafc;">${ip}</div>
            <div style="margin-top:10px;font-size:12px;color:#94a3b8;">端口</div>
            <div style="margin-top:4px;font-size:14px;color:#f8fafc;">${serverPort}</div>
            <div style="margin-top:10px;font-size:12px;color:#94a3b8;">访问地址</div>
            <div style="margin-top:4px;font-size:14px;color:#99f6e4;word-break:break-all;">${address}</div>
          </div>
        </div>
      </body>
    </html>
  `;
}

function buildStatusHtml() {
  const ip = getPrimaryIp();
  const address = getAccessAddress();
  const { installDir, configPath, dataDir } = getRuntimePaths();
  return `
    <!doctype html>
    <html>
      <body style="margin:0;background:#0f172a;color:#e2e8f0;font-family:'Segoe UI',sans-serif;">
        <div style="padding:20px 22px;">
          <div style="font-size:18px;font-weight:700;color:#f8fafc;">Codex Phone 后台服务</div>
          <div style="margin-top:8px;font-size:13px;line-height:1.5;color:#cbd5e1;">
            这是纯后台运行模式，不会打开桌面前端窗口。手机或浏览器直接访问下面地址即可。
          </div>
          <div style="margin-top:14px;padding:12px;border-radius:10px;background:#111827;line-height:1.7;font-size:13px;">
            <div><span style="color:#94a3b8;">本机 IP：</span>${ip}</div>
            <div><span style="color:#94a3b8;">端口：</span>${serverPort}</div>
            <div><span style="color:#94a3b8;">访问地址：</span><span style="color:#99f6e4;">${address}</span></div>
            <div><span style="color:#94a3b8;">安装目录：</span>${escapeHtml(installDir)}</div>
            <div><span style="color:#94a3b8;">配置文件：</span>${escapeHtml(configPath)}</div>
            <div><span style="color:#94a3b8;">数据目录：</span>${escapeHtml(dataDir)}</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px;">
            <button id="open-url" style="border:0;border-radius:10px;background:#10b981;color:#052e2b;padding:12px 10px;font-size:13px;font-weight:700;cursor:pointer;">打开访问页</button>
            <button id="copy-url" style="border:0;border-radius:10px;background:#f59e0b;color:#111827;padding:12px 10px;font-size:13px;font-weight:700;cursor:pointer;">复制访问地址</button>
          </div>
          <div id="status" style="margin-top:10px;font-size:12px;color:#93c5fd;">可直接打开访问页或复制地址。</div>
        </div>
        <script>
          const { clipboard, shell } = require("electron");
          const address = ${JSON.stringify(address)};
          const statusEl = document.getElementById("status");

          function setStatus(message) {
            statusEl.textContent = message;
          }

          document.getElementById("open-url").addEventListener("click", async () => {
            await shell.openExternal(address);
            setStatus("已在默认浏览器打开访问页。");
          });

          document.getElementById("copy-url").addEventListener("click", () => {
            clipboard.writeText(address);
            setStatus("访问地址已复制到剪贴板。");
          });
        </script>
      </body>
    </html>
  `;
}

function buildErrorHtml(message: string) {
  const { installDir, configPath, dataDir } = getRuntimePaths();
  const details = buildRuntimeDetails(message);
  const escapedDetails = escapeHtml(details);
  const copyPayload = JSON.stringify(details);
  const installPayload = JSON.stringify(installDir);
  const configPayload = JSON.stringify(path.dirname(configPath));
  const dataPayload = JSON.stringify(dataDir);
  const statusText = "可直接复制错误内容，或打开下面这些目录排查。";

  return `
    <!doctype html>
    <html>
      <body style="margin:0;background:#111827;color:#e5e7eb;font-family:'Segoe UI',sans-serif;">
        <div style="padding:18px 20px;">
          <div style="font-size:18px;font-weight:700;color:#f8fafc;">Codex Phone 启动失败</div>
          <div style="margin-top:8px;font-size:13px;line-height:1.5;color:#cbd5e1;">
            ${escapeHtml(statusText)}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:14px;">
            <button id="open-install" style="border:0;border-radius:10px;background:#1d4ed8;color:#eff6ff;padding:12px 10px;font-size:13px;cursor:pointer;">打开安装目录</button>
            <button id="open-config" style="border:0;border-radius:10px;background:#0f766e;color:#ecfeff;padding:12px 10px;font-size:13px;cursor:pointer;">打开配置目录</button>
            <button id="open-data" style="border:0;border-radius:10px;background:#7c3aed;color:#f5f3ff;padding:12px 10px;font-size:13px;cursor:pointer;">打开数据目录</button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
            <button id="copy-details" style="border:0;border-radius:10px;background:#f59e0b;color:#111827;padding:12px 10px;font-size:13px;font-weight:700;cursor:pointer;">复制完整错误信息</button>
            <button id="close-window" style="border:1px solid #374151;border-radius:10px;background:#111827;color:#e5e7eb;padding:12px 10px;font-size:13px;cursor:pointer;">关闭</button>
          </div>
          <div id="status" style="margin-top:10px;font-size:12px;color:#93c5fd;">${escapeHtml(statusText)}</div>
          <pre style="margin-top:14px;height:320px;overflow:auto;border:1px solid #374151;border-radius:10px;background:#0f172a;color:#e5e7eb;padding:12px;font-family:Consolas,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${escapedDetails}</pre>
        </div>
        <script>
          const { clipboard, shell } = require("electron");
          const details = ${copyPayload};
          const installDir = ${installPayload};
          const configDir = ${configPayload};
          const dataDir = ${dataPayload};
          const statusEl = document.getElementById("status");

          function setStatus(message) {
            statusEl.textContent = message;
          }

          document.getElementById("copy-details").addEventListener("click", async () => {
            clipboard.writeText(details);
            setStatus("完整错误信息已复制到剪贴板。");
          });

          document.getElementById("open-install").addEventListener("click", async () => {
            await shell.openPath(installDir);
            setStatus("已尝试打开安装目录。");
          });

          document.getElementById("open-config").addEventListener("click", async () => {
            await shell.openPath(configDir);
            setStatus("已尝试打开配置目录。");
          });

          document.getElementById("open-data").addEventListener("click", async () => {
            await shell.openPath(dataDir);
            setStatus("已尝试打开数据目录。");
          });

          document.getElementById("close-window").addEventListener("click", () => {
            window.close();
          });
        </script>
      </body>
    </html>
  `;
}

async function showStartupError(message: string) {
  const errorWindow = new BrowserWindow({
    width: 820,
    height: 520,
    show: false,
    autoHideMenuBar: true,
    title: "Codex Phone 启动失败",
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true
    }
  });

  await errorWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildErrorHtml(message))}`);
  await new Promise<void>((resolve) => {
    errorWindow.once("ready-to-show", () => {
      errorWindow.show();
      errorWindow.focus();
    });
    errorWindow.once("closed", () => {
      resolve();
    });
  });
}

function showToast() {
  toastWindow?.close();
  toastWindow = new BrowserWindow({
    width: 420,
    height: 200,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    movable: false,
    webPreferences: {
      contextIsolation: true
    }
  });

  toastWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildToastHtml())}`);
  toastWindow.once("ready-to-show", () => {
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;
    const x = Math.max(0, width - 440);
    const y = Math.max(0, height - 240);
    toastWindow?.setPosition(x, y);
    toastWindow?.showInactive();
    setTimeout(() => toastWindow?.close(), 3200);
  });
  toastWindow.on("closed", () => {
    toastWindow = null;
  });
}

async function showStatusWindow() {
  const statusWindow = new BrowserWindow({
    width: 620,
    height: 360,
    show: false,
    autoHideMenuBar: true,
    title: "Codex Phone 后台服务",
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true
    }
  });

  await statusWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildStatusHtml())}`);
  await new Promise<void>((resolve) => {
    statusWindow.once("ready-to-show", () => {
      statusWindow.show();
      statusWindow.focus();
    });
    statusWindow.once("closed", () => resolve());
  });
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  const { dataDir, installDir, configPath } = getRuntimePaths();
  const address = getAccessAddress();
  tray.setToolTip(`Codex Phone\n${address}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开访问页",
        click: () => {
          void shell.openExternal(address);
        }
      },
      {
        label: "复制访问地址",
        click: () => {
          clipboard.writeText(address);
        }
      },
      {
        label: "显示服务信息",
        click: () => {
          void showStatusWindow();
        }
      },
      {
        label: "打开数据目录",
        click: () => {
          void shell.openPath(dataDir);
        }
      },
      {
        label: "打开安装目录",
        click: () => {
          void shell.openPath(installDir);
        }
      },
      {
        label: "打开配置文件目录",
        click: () => {
          void shell.openPath(path.dirname(configPath));
        }
      },
      {
        label: "重启服务",
        click: () => {
          void restartBackend();
        }
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
}

function waitForPort(host: string, port: number, timeoutMs = 15000) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();

    const tryConnect = () => {
      const socket = net.createConnection({ host, port }, () => {
        socket.end();
        resolve();
      });

      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Backend did not start on ${host}:${port} in time.`));
          return;
        }
        setTimeout(tryConnect, 250);
      });
    };

    tryConnect();
  });
}

async function startBackend() {
  if (backendProcess) {
    return;
  }

  const { dataDir, resourcesRoot, codeRoot, configPath, serverEntry } = getRuntimePaths();
  mkdirSync(dataDir, { recursive: true });
  backendStdout = "";
  backendStderr = "";
  logLine(`starting backend: execPath=${process.execPath} | serverEntry=${serverEntry}`);

  backendProcess = spawn(process.execPath, [serverEntry], {
    cwd: resourcesRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      CODEX_PHONE_BASE_DIR: codeRoot,
      CODEX_PHONE_CONFIG_PATH: configPath,
      CODEX_PHONE_DATA_DIR: dataDir
    },
    stdio: "pipe"
  });

  backendProcess.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    backendStdout += text;
    logLine(`backend stdout: ${text.trimEnd()}`);
    process.stdout.write(chunk);
  });
  backendProcess.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    backendStderr += text;
    logLine(`backend stderr: ${text.trimEnd()}`);
    process.stderr.write(chunk);
  });
  backendProcess.on("exit", (code, signal) => {
    logLine(`backend exit: code=${code ?? "null"} signal=${signal ?? "null"}`);
    backendProcess = null;
  });

  logLine(`waiting for backend port ${serverHost}:${serverPort}`);
  await waitForPort(serverHost, serverPort);
  logLine(`backend port is ready on ${serverHost}:${serverPort}`);
}

function stopBackend() {
  if (!backendProcess) {
    return;
  }

  logLine("stopping backend process");
  backendProcess.kill();
  backendProcess = null;
}

async function restartBackend() {
  stopBackend();
  await startBackend();
  updateTrayMenu();
  showToast();
}

async function bootstrap() {
  initRuntimePaths();
  tray = new Tray(createTrayIcon());
  tray.on("double-click", () => {
    void shell.openExternal(getAccessAddress());
  });
  updateTrayMenu();
  logLine("tray initialized");

  try {
    await startBackend();
    showToast();
    logLine("backend service started in tray mode");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logLine(`bootstrap failed: ${message}`);
    await showStartupError(message);
    isQuitting = true;
    app.quit();
  }
}

app.whenReady().then(() => {
  logLine("app.whenReady resolved");
  void bootstrap();
});

app.on("before-quit", () => {
  isQuitting = true;
  stopBackend();
});

app.on("window-all-closed", () => {
  // Keep the app alive in the tray on Windows until the user exits explicitly.
});
