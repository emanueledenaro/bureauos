import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OctokitGitHubClient } from "@bureauos/capabilities";
import { startApiServer, loadConfig, workspacePaths, type ApiServer } from "@bureauos/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let _mainWindow: BrowserWindow | null = null;
let apiServer: ApiServer | null = null;

async function bootApiServer(): Promise<void> {
  const root = process.env["BUREAUOS_WORKSPACE"] ?? process.cwd();
  const paths = workspacePaths(root);
  try {
    const config = await loadConfig(paths.configFile);
    const token = process.env["GITHUB_TOKEN"];
    apiServer = await startApiServer({
      workspaceRoot: root,
      config,
      port: 0,
      ...(token ? { githubClient: new OctokitGitHubClient({ token }) } : {}),
    });
    console.log(`[bureauos] API server at ${apiServer.url}`);
  } catch (err) {
    console.warn(`[bureauos] could not start API server: ${(err as Error).message}`);
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    title: "BureauOS - Operating Room",
    backgroundColor: "#fafaf9",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.on("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}

ipcMain.handle("bureau:api-url", () => apiServer?.url ?? "");
ipcMain.handle("bureau:open-external", (_e, url: string) => shell.openExternal(url));

app.whenReady().then(async () => {
  await bootApiServer();
  _mainWindow = createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      _mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (apiServer) {
    void apiServer.close();
    apiServer = null;
  }
  if (process.platform !== "darwin") app.quit();
});
