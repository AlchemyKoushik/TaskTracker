"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const http = __importStar(require("http"));
const url_1 = require("url");
let mainWindow = null;
let tray = null;
let backendProcess = null;
let isQuitting = false;
let shutdownStarted = false;
let logFile = path.join(process.env.TEMP || process.cwd(), 'tasktracker-electron.log');
function log(message) {
    console.log(message);
    if (logFile) {
        try {
            fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`, 'utf8');
        }
        catch { /* startup logging is best effort */ }
    }
}
log('Electron main module loaded');
try {
    electron_1.protocol.registerSchemesAsPrivileged([
        { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
    ]);
    log('Registered secure app:// protocol');
}
catch (error) {
    log(`Could not register app:// protocol: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    throw error;
}
const BACKEND_URL = 'http://127.0.0.1:8765';
const isDev = !electron_1.app.isPackaged;
const hasSingleInstanceLock = electron_1.app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        if (!mainWindow)
            return;
        if (mainWindow.isMinimized())
            mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    });
}
function waitForBackend() {
    return new Promise((resolve, reject) => {
        let finished = false;
        const timeout = setTimeout(() => finish(new Error('The TaskTracker service did not become ready within 45 seconds.')), 45_000);
        const finish = (error) => {
            if (finished)
                return;
            finished = true;
            clearTimeout(timeout);
            if (error)
                reject(error);
            else
                resolve();
        };
        const poll = () => {
            if (isQuitting)
                return finish(new Error('TaskTracker is closing.'));
            const request = http.get(`${BACKEND_URL}/health`, (response) => {
                response.resume();
                if (response.statusCode === 200)
                    finish();
                else
                    setTimeout(poll, 500);
            });
            request.setTimeout(1500, () => request.destroy());
            request.on('error', () => {
                if (!finished)
                    setTimeout(poll, 500);
            });
        };
        poll();
    });
}
function startBackend() {
    const projectRoot = path.resolve(__dirname, '../..'); // ui/dist-electron -> repository root
    const userData = electron_1.app.getPath('userData');
    fs.mkdirSync(userData, { recursive: true });
    if (isDev) {
        const venvPython = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
        const python = fs.existsSync(venvPython) ? venvPython : 'py';
        const args = python === 'py' ? ['-3', '-m', 'tasktracker'] : ['-m', 'tasktracker'];
        backendProcess = (0, child_process_1.spawn)(python, args, {
            cwd: userData,
            env: { ...process.env, PYTHONPATH: path.join(projectRoot, 'src'), APP_MODE: 'local', APP_HOST: '127.0.0.1', APP_PORT: '8765' },
            stdio: 'pipe',
            windowsHide: true,
        });
    }
    else {
        const executable = path.join(process.resourcesPath, 'backend', 'tasktracker-backend.exe');
        if (!fs.existsSync(executable)) {
            throw new Error(`Bundled backend executable was not found: ${executable}`);
        }
        backendProcess = (0, child_process_1.spawn)(executable, [], {
            cwd: userData,
            env: { ...process.env, APP_MODE: 'local', APP_HOST: '127.0.0.1', APP_PORT: '8765' },
            stdio: 'pipe',
            windowsHide: true,
        });
    }
    backendProcess.stdout?.on('data', (data) => log(`TaskTracker API: ${data}`));
    backendProcess.stderr?.on('data', (data) => log(`TaskTracker API error: ${data}`));
    backendProcess.once('error', (error) => log(`Could not launch TaskTracker API: ${error.stack || error.message}`));
    backendProcess.once('exit', (code) => {
        log(`TaskTracker API exited with code ${code}`);
    });
    return waitForBackend();
}
function registerAppProtocol() {
    electron_1.protocol.handle('app', async (request) => {
        const url = new URL(request.url);
        if (url.hostname !== 'tasktracker')
            return new Response('Not found', { status: 404 });
        let relativePath;
        try {
            relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        }
        catch {
            return new Response('Bad request', { status: 400 });
        }
        if (!relativePath)
            relativePath = 'index.html';
        const distRoot = path.resolve(__dirname, '../dist');
        let filePath = path.resolve(distRoot, relativePath);
        if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${path.sep}`)) {
            return new Response('Forbidden', { status: 403 });
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            if (path.extname(relativePath))
                return new Response('Not found', { status: 404 });
            filePath = path.join(distRoot, 'index.html');
        }
        return electron_1.net.fetch((0, url_1.pathToFileURL)(filePath).toString());
    });
}
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 720,
        minHeight: 560,
        title: 'TaskTracker',
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
        },
    });
    if (isDev)
        void mainWindow.loadURL('http://localhost:5173');
    else
        void mainWindow.loadURL('app://tasktracker/');
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    mainWindow.webContents.on('did-finish-load', () => log(`Renderer loaded: ${mainWindow?.webContents.getURL()}`));
    mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => log(`Renderer load failed (${code}): ${description} ${url}`));
    mainWindow.webContents.on('render-process-gone', (_event, details) => log(`Renderer process exited: ${details.reason}`));
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow?.hide();
        }
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://'))
            void electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
}
function createTray() {
    const iconPath = path.join(__dirname, '../dist/tasktracker-tray.png');
    const icon = electron_1.nativeImage.createFromPath(iconPath);
    if (icon.isEmpty())
        throw new Error(`TaskTracker tray icon was not found: ${iconPath}`);
    tray = new electron_1.Tray(icon);
    tray.setToolTip('TaskTracker');
    tray.setContextMenu(electron_1.Menu.buildFromTemplate([
        { label: 'Open TaskTracker', click: () => mainWindow?.show() },
        { type: 'separator' },
        { label: 'Quit', click: () => electron_1.app.quit() },
    ]));
    tray.on('click', () => mainWindow?.show());
}
function stopBackend() {
    const child = backendProcess;
    if (!child || child.exitCode !== null)
        return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            if (process.platform === 'win32' && child.pid) {
                const killer = (0, child_process_1.spawn)('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
                killer.once('exit', () => resolve());
                killer.once('error', () => resolve());
            }
            else {
                child.kill('SIGKILL');
                resolve();
            }
        }, 2500);
        child.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
        child.kill();
    });
}
electron_1.app.whenReady().then(async () => {
    if (!hasSingleInstanceLock)
        return;
    logFile = path.join(electron_1.app.getPath('userData'), 'tasktracker-electron.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    log(`Starting TaskTracker packaged=${electron_1.app.isPackaged} resources=${process.resourcesPath}`);
    try {
        if (electron_1.app.isPackaged)
            electron_1.app.setLoginItemSettings({ openAtLogin: true });
        registerAppProtocol();
        await startBackend();
        createWindow();
        createTray();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Startup failed: ${error instanceof Error ? error.stack || message : message}`);
        electron_1.dialog.showErrorBox('TaskTracker could not start', message);
        electron_1.app.quit();
        return;
    }
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
        else
            mainWindow?.show();
    });
}).catch((error) => {
    log(`Electron ready handler failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
});
electron_1.app.on('before-quit', (event) => {
    isQuitting = true;
    if (shutdownStarted || !backendProcess || backendProcess.exitCode !== null)
        return;
    event.preventDefault();
    shutdownStarted = true;
    void stopBackend().finally(() => electron_1.app.quit());
});
