import { contextBridge } from 'electron'

// IPC surface grows here as features land (storage in roadmap item 7).
const api = {
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
