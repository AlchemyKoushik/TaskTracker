import { app, BrowserWindow, Tray, Menu, protocol, net, shell, dialog, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import { pathToFileURL } from 'url';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let backendProcess: ChildProcess | null = null;
let isQuitting = false;
let shutdownStarted = false;
let logFile = path.join(process.env.TEMP || process.cwd(), 'tasktracker-electron.log');

function log(message: string): void {
  console.log(message);
  if (logFile) {
    try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`, 'utf8'); } catch { /* startup logging is best effort */ }
  }
}

log('Electron main module loaded');

try {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  ]);
  log('Registered secure app:// protocol');
} catch (error) {
  log(`Could not register app:// protocol: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  throw error;
}

const BACKEND_URL = 'http://127.0.0.1:8765';
const isDev = !app.isPackaged;

function waitForBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timeout = setTimeout(() => finish(new Error('The TaskTracker service did not become ready within 45 seconds.')), 45_000);
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      error ? reject(error) : resolve();
    };

    const poll = () => {
      if (isQuitting) return finish(new Error('TaskTracker is closing.'));
      const request = http.get(`${BACKEND_URL}/health`, (response) => {
        response.resume();
        if (response.statusCode === 200) finish();
        else setTimeout(poll, 500);
      });
      request.setTimeout(1500, () => request.destroy());
      request.on('error', () => {
        if (!finished) setTimeout(poll, 500);
      });
    };

    poll();
  });
}

function startBackend(): Promise<void> {
  const projectRoot = path.resolve(__dirname, '../..'); // ui/dist-electron -> repository root
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });

  if (isDev) {
    const venvPython = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
    const python = fs.existsSync(venvPython) ? venvPython : 'py';
    const args = python === 'py' ? ['-3', '-m', 'tasktracker'] : ['-m', 'tasktracker'];
    backendProcess = spawn(python, args, {
      cwd: userData,
      env: { ...process.env, PYTHONPATH: path.join(projectRoot, 'src'), APP_MODE: 'local', APP_HOST: '127.0.0.1', APP_PORT: '8765' },
      stdio: 'pipe',
      windowsHide: true,
    });
  } else {
    const executable = path.join(process.resourcesPath, 'backend', 'tasktracker-backend.exe');
    if (!fs.existsSync(executable)) {
      throw new Error(`Bundled backend executable was not found: ${executable}`);
    }
    backendProcess = spawn(executable, [], {
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

function registerAppProtocol(): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'tasktracker') return new Response('Not found', { status: 404 });

    let relativePath: string;
    try {
      relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (!relativePath) relativePath = 'index.html';

    const distRoot = path.resolve(__dirname, '../dist');
    let filePath = path.resolve(distRoot, relativePath);
    if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${path.sep}`)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      if (path.extname(relativePath)) return new Response('Not found', { status: 404 });
      filePath = path.join(distRoot, 'index.html');
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
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

  if (isDev) void mainWindow.loadURL('http://localhost:5173');
  else void mainWindow.loadURL('app://tasktracker/');

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
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray(): void {
  const iconPath = path.join(__dirname, '../dist/tasktracker-tray.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) throw new Error(`TaskTracker tray icon was not found: ${iconPath}`);
  tray = new Tray(icon);
  tray.setToolTip('TaskTracker');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open TaskTracker', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', () => mainWindow?.show());
}

function stopBackend(): Promise<void> {
  const child = backendProcess;
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        killer.once('exit', () => resolve());
        killer.once('error', () => resolve());
      } else {
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

app.whenReady().then(async () => {
  logFile = path.join(app.getPath('userData'), 'tasktracker-electron.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  log(`Starting TaskTracker packaged=${app.isPackaged} resources=${process.resourcesPath}`);
  try {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
    registerAppProtocol();
    await startBackend();
    createWindow();
    createTray();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Startup failed: ${error instanceof Error ? error.stack || message : message}`);
    dialog.showErrorBox('TaskTracker could not start', message);
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
}).catch((error: unknown) => {
  log(`Electron ready handler failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
});

app.on('before-quit', (event) => {
  isQuitting = true;
  if (shutdownStarted || !backendProcess || backendProcess.exitCode !== null) return;
  event.preventDefault();
  shutdownStarted = true;
  void stopBackend().finally(() => app.quit());
});
