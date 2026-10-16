import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

if (process.platform !== "win32") {
  console.error("Native helper must be built on Windows. Use a Windows x64 terminal.");
  process.exit(1);
}

const project = resolve("native/media-keys");
execFileSync("cargo", ["build", "--locked", "--release", "--manifest-path", resolve(project, "Cargo.toml")], {
  stdio: "inherit",
  windowsHide: true
});
const source = resolve(project, "target/release/media-keys.exe");
if (!existsSync(source)) throw new Error(`Native binary missing: ${source}`);
const target = resolve("dev.local.media-controls.sdPlugin/native");
mkdirSync(target, { recursive: true });
copyFileSync(source, resolve(target, "media-keys.exe"));

const infoProject = resolve("native/media-info");
execFileSync("cargo", ["build", "--locked", "--release", "--manifest-path", resolve(infoProject, "Cargo.toml")], {
  stdio: "inherit", windowsHide: true
});
const infoSource = resolve(infoProject, "target/release/media-info.exe");
if (!existsSync(infoSource)) throw new Error(`Media-info binary missing: ${infoSource}`);
copyFileSync(infoSource, resolve(target, "media-info.exe"));
console.log("Media-key and GSMTC metadata helpers copied into plugin bundle.");
