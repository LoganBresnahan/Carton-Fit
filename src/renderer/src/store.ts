import { create } from 'zustand'

export interface LoadedFile {
  name: string
  sizeBytes: number
}

interface AppState {
  file: LoadedFile | null
  setFile: (file: LoadedFile) => void
}

export const useAppStore = create<AppState>((set) => ({
  file: null,
  setFile: (file) => set({ file })
}))
