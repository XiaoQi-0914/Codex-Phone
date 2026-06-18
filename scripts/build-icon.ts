import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(process.cwd());
const sourceSvgPath = path.resolve(projectRoot, "assets", "codex-light.svg");
const buildDir = path.resolve(projectRoot, "build");
const targetSvgPath = path.resolve(buildDir, "icon.svg");
const targetPngPath = path.resolve(buildDir, "icon.png");
const targetIcoPath = path.resolve(buildDir, "icon.ico");
const targetTrayPngPath = path.resolve(buildDir, "tray-icon.png");
const tempIconHtmlPath = path.resolve(buildDir, "icon-render.html");
const tempTrayHtmlPath = path.resolve(buildDir, "tray-icon-render.html");
const tempPngDir = path.resolve(buildDir, "icon-png");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const icoSizes = [16, 24, 32, 48, 64, 128, 256];

function renderPng(size: number, outputPath: string, htmlPath: string) {
  rmSync(outputPath, { force: true });

  const result = spawnSync(
    edgePath,
    [
      "--headless=new",
      "--disable-gpu",
      `--screenshot=${outputPath}`,
      `--window-size=${size},${size}`,
      htmlPath
    ],
    {
      stdio: "pipe"
    }
  );

  if (result.status !== 0) {
    throw new Error(`Failed to render ${size}px icon with Edge: ${result.stderr.toString("utf8")}`);
  }
}

function buildRenderHtml(svgContent: string, insetPercent: number) {
  const iconSize = `${100 - insetPercent * 2}vw`;
  const inset = `${insetPercent}vw`;

  return `<!doctype html>
<html>
  <body style="margin:0;background:transparent;width:100vw;height:100vh;overflow:hidden;">
    <div style="box-sizing:border-box;width:100vw;height:100vh;padding:${inset};display:grid;place-items:center;">
      <div style="width:${iconSize};height:${iconSize};display:grid;place-items:center;">
        ${svgContent}
      </div>
    </div>
  </body>
</html>`;
}

mkdirSync(buildDir, { recursive: true });
mkdirSync(tempPngDir, { recursive: true });

const svg = readFileSync(sourceSvgPath, "utf8");
const normalizedSvg = svg.replace(/\swidth="[^"]*"/gi, "").replace(/\sheight="[^"]*"/gi, "");
const sizedSvg = normalizedSvg.replace("<svg ", '<svg width="100%" height="100%" ');

writeFileSync(targetSvgPath, svg, "utf8");

writeFileSync(tempIconHtmlPath, buildRenderHtml(sizedSvg, 0), "utf8");
writeFileSync(tempTrayHtmlPath, buildRenderHtml(sizedSvg, 14), "utf8");

const pngBuffers = icoSizes.map((size) => {
  const pngPath = path.resolve(tempPngDir, `icon-${size}.png`);
  renderPng(size, pngPath, tempIconHtmlPath);
  return { size, buffer: readFileSync(pngPath) };
});

writeFileSync(targetPngPath, pngBuffers[pngBuffers.length - 1].buffer);
renderPng(64, targetTrayPngPath, tempTrayHtmlPath);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngBuffers.length, 4);

let currentOffset = 6 + pngBuffers.length * 16;
const entries = pngBuffers.map(({ size, buffer }) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0);
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(buffer.length, 8);
  entry.writeUInt32LE(currentOffset, 12);
  currentOffset += buffer.length;
  return entry;
});

writeFileSync(targetIcoPath, Buffer.concat([header, ...entries, ...pngBuffers.map(({ buffer }) => buffer)]));

console.log(`Icon assets generated:
- ${sourceSvgPath}
- ${targetSvgPath}
- ${targetPngPath}
- ${targetTrayPngPath}
- ${targetIcoPath}`);
