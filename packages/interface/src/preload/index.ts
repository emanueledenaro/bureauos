import { contextBridge, ipcRenderer } from "electron";

const api = {
  apiUrl: () => ipcRenderer.invoke("bureau:api-url") as Promise<string>,
  openExternal: (url: string) => ipcRenderer.invoke("bureau:open-external", url),
};

contextBridge.exposeInMainWorld("bureau", api);

export type BureauApi = typeof api;
