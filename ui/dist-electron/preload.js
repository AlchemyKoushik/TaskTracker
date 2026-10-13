"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
// Add any required IPC methods here
// The UI primarily communicates with the local FastAPI server directly via HTTP
});
