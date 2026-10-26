import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CORE_METHODS, type CoreEvent, type RipperdocApi } from '@shared/api'

// Einzige Brücke zwischen Oberfläche und Main-Prozess. Die Oberfläche bekommt keine Node-APIs.
const api: Record<string, unknown> = {}
for (const name of CORE_METHODS) api[name] = (...args: unknown[]) => ipcRenderer.invoke(`rd:${name}`, ...args)

api.pathForFile = (file: File) => webUtils.getPathForFile(file)
api.on = (event: CoreEvent, cb: (payload: unknown) => void) => {
  const channel = `rd:event:${event}`
  const listener = (_e: unknown, payload: unknown) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('rd', api as unknown as RipperdocApi)
