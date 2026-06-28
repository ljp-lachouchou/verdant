export const app = {
  getPath: (name: string) => `/tmp/test-${name}`,
  whenReady: () => Promise.resolve(),
  on: () => {}
}

export const BrowserWindow = class {
  static getAllWindows() { return [] }
  constructor(_opts: unknown) {}
  loadURL() {}
  loadFile() {}
  on() {}
  show() {}
  webContents = {
    setWindowOpenHandler() {},
    send() {}
  }
}

export const ipcMain = {
  handle() {},
  on() {}
}

export const ipcRenderer = {
  invoke: () => Promise.resolve(),
  on() {},
  removeListener() {}
}

export const contextBridge = {
  exposeInMainWorld() {}
}

export const shell = {
  openExternal() {}
}
