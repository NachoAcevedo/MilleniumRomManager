import { BrowserWindow, dialog, shell, OpenDialogOptions } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { stopSteam, startSteam } from "../lib/helpers/steam/stop-start-steam";
import type { Core } from "../core/core";
import type { PreviewData, OnlineImages } from "../models";
import * as paths from "../paths";

async function windowsSteamExecutable(steamDirectory?: string) {
      const fallback = path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Steam");
      const directory = steamDirectory && await fs.pathExists(path.join(steamDirectory, "steam.exe"))
        ? steamDirectory : fallback;
      const executable = path.join(directory, "steam.exe");
  await fs.access(executable);
  return executable;
}

async function windowsSteamRunning() {
  const { stdout } = await promisify(execFile)("tasklist.exe", [
    "/FI", "IMAGENAME eq steam.exe", "/FO", "CSV", "/NH",
  ], { windowsHide: true, timeout: 5000 });
  return /^"steam\.exe",/im.test(stdout);
}

async function waitForSteam(running: boolean, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await windowsSteamRunning()) === running) return;
    await delay(400);
  }
  throw new Error(running ? "Steam no volvió a abrirse." : "Steam sigue abierto.");
}

async function launchSteamProcess(executable: string, argument: string) {
  return spawnDetached(executable, [argument]);
}

async function spawnDetached(executable: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: path.dirname(executable), detached: true, stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

const pendingImportPath = () => path.join(paths.userDataDir, "pending-import.json");
const pendingRegistryArgs = ["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "MillenniumRomImport"];

export async function runPendingImport(core: Core) {
  const pending = pendingImportPath();
  if (!(await fs.pathExists(pending))) return;
  const job: { preview: PreviewData; images: OnlineImages; directory: string; restart: boolean } = await fs.readJson(pending);
  const target = appTarget(() => null, core);
  const log = (text: string) => fs.appendFile(path.join(paths.userDataDir, "steam-restart.log"),
    new Date().toISOString() + " " + text + "\n").catch(() => {});
  let reopen = false;
  try {
    if (job.restart) {
      await target.stopSteam(job.directory);
      reopen = true;
    } else {
      while (await windowsSteamRunning()) await delay(1000);
    }
    await log("Steam cerrado; aplicando importación pendiente");
    const settings = core.settings.get();
    settings.autoKillSteam = false;
    settings.autoRestartSteam = false;
    const result = await core.writer.save(job.preview, job.images, {
      batchWrite: true, removeAll: false, keepOtherParsers: true,
    });
    if (!result.ok) throw new Error("No se completó el guardado en Steam.");
    await fs.remove(pending);
    await promisify(execFile)("reg.exe", ["delete", ...pendingRegistryArgs, "/f"],
      { windowsHide: true }).catch(() => {});
    await log("Importación aplicada");
  } catch (error) {
    await log(String(error));
    throw error;
  } finally {
    if (reopen) {
      await target.startSteam(job.directory);
      await log("Steam volvió a abrirse");
    }
  }
}

// The last picked folder, if it's still there.
async function lastFolder(): Promise<string | undefined> {
  try {
    const { folder } = await fs.readJson(paths.lastDialogFolder);
    return typeof folder === "string" && (await fs.pathExists(folder))
      ? folder
      : undefined;
  } catch {
    return undefined;
  }
}

// The "app" RPC target: what the UI needs from Electron itself (it has no
// access to Electron or Node).
export function appTarget(getWindow: () => BrowserWindow | null, core: Core) {
  const window = () => {
    const w = getWindow();
    if (!w || w.isDestroyed()) {
      throw new Error("No window");
    }
    return w;
  };
  const target = {
    stopSteam: async (steamDirectory?: string) => {
      if (process.platform !== "win32") return stopSteam();
      const executable = await windowsSteamExecutable(steamDirectory);
      if (!(await windowsSteamRunning())) return;
      await launchSteamProcess(executable, "-shutdown");
      await waitForSteam(false);
    },
    startSteam: async (steamDirectory?: string) => {
      if (process.platform !== "win32") return startSteam();
      const executable = await windowsSteamExecutable(steamDirectory);
      await delay(1500);
      try {
        await shell.openExternal("steam://open/main");
        await waitForSteam(true, 8_000);
      } catch {
        await launchSteamProcess(executable, "steam://open/main");
        await waitForSteam(true);
      }
    },
    async saveAndRestart(preview: PreviewData, images: OnlineImages, directory: string, restart: boolean) {
      if (process.platform !== "win32") throw new Error("Esta opción está disponible en Windows.");
      const args = [__filename, "--millennium-data=" + paths.userDataDir, "--millennium-pending"];
      await fs.writeJson(pendingImportPath(), { preview, images, directory, restart }, { flag: "wx" })
        .catch(error => {
          if (error.code === "EEXIST") throw new Error("Ya hay una importación pendiente.");
          throw error;
        });
      try {
        await promisify(execFile)("reg.exe", ["add", ...pendingRegistryArgs,
          "/t", "REG_SZ", "/d", [process.execPath, ...args].map(value => '"' + value + '"').join(" "), "/f"],
          { windowsHide: true });
        await spawnDetached(process.execPath, args);
      } catch (error) {
        await fs.remove(pendingImportPath());
        throw error;
      }
    },
    windowInfo: () => ({
      minimizable: window().minimizable,
      maximizable: window().maximizable,
    }),
    // Opens in the folder of the last pick (unless the caller says where):
    // since Electron 43 the dialogs don't remember it themselves.
    openDialog: async (options: OpenDialogOptions) => {
      const defaultPath = options.defaultPath ?? (await lastFolder());
      const result = await dialog.showOpenDialog(window(), {
        ...options,
        ...(defaultPath && { defaultPath }),
      });
      if (!result.canceled && result.filePaths.length) {
        const picked = result.filePaths[0];
        const folder = options.properties?.includes("openDirectory")
          ? picked
          : path.dirname(picked);
        await fs.outputJson(paths.lastDialogFolder, { folder }).catch(() => {});
      }
      return result;
    },
    // Shows a folder (SRM's userData by default) in the file manager. Only
    // folders: opening a file could run it.
    openFolder: async (dir: string = paths.userDataDir) => {
      if (!(await fs.stat(dir)).isDirectory()) {
        throw new Error(`Not a folder: ${dir}`);
      }
      const error = await shell.openPath(dir);
      if (error) {
        throw new Error(error);
      }
    },
    minimize: async () => {
      const w = window();
      if (w.isMinimized()) w.restore();
      else w.minimize();
    },
    toggleMaximize: async () => {
      const w = window();
      if (w.isMaximized()) w.unmaximize();
      else w.maximize();
    },
    close: async () => window().close(),
  };
  return target;
}
