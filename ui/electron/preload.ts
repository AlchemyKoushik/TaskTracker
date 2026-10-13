import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Add any required IPC methods here
  // The UI primarily communicates with the local FastAPI server directly via HTTP
});

