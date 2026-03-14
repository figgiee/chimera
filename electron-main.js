// ═══════════════════════════════════════════════════════════════════
// Chimera — Electron main process
//
// Starts the Chimera backend (chimera-chat.js) as a child process,
// waits for it to be ready, then opens a native app window.
// ═══════════════════════════════════════════════════════════════════

const { app, BrowserWindow, shell, Menu, Tray, nativeImage } = require('electron');
const { spawn }  = require('node:child_process');
const path       = require('node:path');
const fs         = require('node:fs');

// Prevent multiple instances
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const PORT       = process.env.CHIMERA_PORT || 3210;
const SERVER_URL = `http://127.0.0.1:${PORT}`;
const IS_DEV     = !app.isPackaged;

let win            = null;
let tray           = null;
let serverProcess  = null;
let serverReady    = false;

// ─── Backend process ─────────────────────────────────────────────
function startServer() {
  // In packaged app, node is bundled alongside. In dev, use system node.
  const nodeBin = IS_DEV
    ? process.platform === 'win32' ? 'node.exe' : 'node'
    : path.join(process.resourcesPath, 'node', 'node' + (process.platform === 'win32' ? '.exe' : ''));

  const serverPath = IS_DEV
    ? path.join(__dirname, 'chimera-chat.js')
    : path.join(process.resourcesPath, 'app', 'chimera-chat.js');

  // Fall back to system node if bundled one not found
  const node = fs.existsSync(nodeBin) ? nodeBin : (process.platform === 'win32' ? 'node.exe' : 'node');

  serverProcess = spawn(node, [serverPath], {
    env: {
      ...process.env,
      // Point sessions and DB to user data dir so they survive updates
      RAG_DB: path.join(app.getPath('userData'), 'chimera-rag.db'),
    },
    cwd: IS_DEV ? __dirname : path.join(process.resourcesPath, 'app'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout?.on('data', d => process.stdout.write(d));
  serverProcess.stderr?.on('data', d => process.stderr.write(d));

  serverProcess.on('error', e => {
    console.error('[Chimera] Backend failed to start:', e.message);
  });

  serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[Chimera] Backend exited with code ${code}`);
    }
  });
}

async function waitForServer(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${SERVER_URL}/api/health`);
      if (r.ok) { serverReady = true; return true; }
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}

// ─── Window ──────────────────────────────────────────────────────
async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth:  900,
    minHeight: 600,
    title: 'Chimera',
    backgroundColor: '#09090b',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      // Allow loading localhost
      webSecurity: true,
    },
  });

  // Remove menu bar (keep native window chrome)
  Menu.setApplicationMenu(null);

  // Open external links in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.on('closed', () => { win = null; });

  win.once('ready-to-show', () => {
    win.show();
    if (IS_DEV) win.webContents.openDevTools({ mode: 'detach' });
  });

  // Show loading screen while backend starts
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(LOADING_HTML)}`);
  win.show();

  // Start the backend
  startServer();
  const ready = await waitForServer();

  if (win && !win.isDestroyed()) {
    if (ready) {
      win.loadURL(SERVER_URL);
    } else {
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(ERROR_HTML)}`);
    }
  }
}

// ─── Tray ────────────────────────────────────────────────────────
function createTray() {
  try {
    // Use a minimal built-in icon; replace assets/tray-icon.png for a custom one
    const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
    const icon = fs.existsSync(iconPath)
      ? nativeImage.createFromPath(iconPath)
      : nativeImage.createEmpty();

    tray = new Tray(icon);
    tray.setToolTip('Chimera');

    const menu = Menu.buildFromTemplate([
      { label: 'Open Chimera', click: () => { if (win) { win.show(); win.focus(); } else { createWindow(); } } },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } },
    ]);
    tray.setContextMenu(menu);

    tray.on('double-click', () => {
      if (win) { win.show(); win.focus(); } else { createWindow(); }
    });
  } catch {
    // Tray is optional — skip if icon load fails
  }
}

// ─── App lifecycle ────────────────────────────────────────────────
app.setName('Chimera');

app.whenReady().then(async () => {
  createTray();
  await createWindow();
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  } else {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  // On macOS keep app alive in tray; on other platforms quit
  if (process.platform !== 'darwin') {
    killServer();
    app.quit();
  }
});

app.on('activate', () => {
  if (!win) createWindow();
});

app.on('before-quit', () => {
  app.isQuiting = true;
  killServer();
});

function killServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

// ─── HTML screens ─────────────────────────────────────────────────
const LOADING_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #09090b;
    color: #a1a1aa;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 16px;
  }
  .spinner {
    width: 32px; height: 32px;
    border: 2px solid #27272a;
    border-top-color: #6366f1;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size: 20px; font-weight: 600; color: #f4f4f5; }
  p  { font-size: 13px; }
</style>
</head>
<body>
  <div class="spinner"></div>
  <h1>Chimera</h1>
  <p>Starting up...</p>
</body>
</html>`;

const ERROR_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #09090b;
    color: #a1a1aa;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 12px;
    padding: 40px;
    text-align: center;
  }
  h1 { font-size: 20px; font-weight: 600; color: #f87171; }
  p  { font-size: 13px; max-width: 480px; line-height: 1.6; }
  code {
    background: #18181b;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: monospace;
    color: #a3e635;
  }
</style>
</head>
<body>
  <h1>Failed to start</h1>
  <p>Chimera's backend did not respond in time.</p>
  <p>Make sure <code>Node.js</code> and <code>Ollama</code> are installed, then relaunch.</p>
  <p>Run <code>ollama pull qwen3:8b</code> and <code>ollama pull nomic-embed-text</code> if this is your first launch.</p>
</body>
</html>`;
