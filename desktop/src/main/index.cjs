const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const DESKTOP_DIR = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(DESKTOP_DIR, '..');
const FRONTEND_DIR = path.join(PROJECT_ROOT, 'frontend');
const FRONTEND_DIST_DIR = path.join(FRONTEND_DIR, 'dist');
const BACKEND_DIR = path.join(PROJECT_ROOT, 'backend');
const DEFAULT_BACKEND_PORT = Number(process.env.CHAT2CARTOON_BACKEND_PORT || process.env._FAAS_RUNTIME_PORT || 8889);
const DEFAULT_RENDERER_URL = process.env.CHAT2CARTOON_RENDERER_URL || 'http://localhost:8080';
const DEV_ASSET_ROOT = process.env.CHAT2CARTOON_ASSET_ROOT || path.join(PROJECT_ROOT, 'assets', 'generated');

let mainWindow = null;
let adminWindow = null;
let backendProcess = null;
let backendOrigin = `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`;
let staticServer = null;
let staticServerUrl = '';
let logsDir = '';
let configPath = '';

const ensureDir = dir => {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const writeLogLine = (filePath, line) => {
  fs.appendFile(filePath, line, error => {
    if (error) {
      console.error(error);
    }
  });
};

const writeAppLog = message => {
  const line = `${new Date().toISOString()} ${message}${os.EOL}`;
  if (!logsDir) {
    console.warn(line.trim());
    return;
  }
  writeLogLine(path.join(logsDir, 'app.log'), line);
};

const sanitizeProjectId = projectId => {
  const value = String(projectId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return value || 'default';
};

const maskSecret = value => {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  if (text.length <= 8) {
    return '****';
  }
  return `${text.slice(0, 4)}****${text.slice(-4)}`;
};

const getDefaultAssetRoot = () =>
  app.isPackaged
    ? path.join(app.getPath('userData'), 'assets', 'generated')
    : DEV_ASSET_ROOT;

const getDefaultDesktopConfig = () => ({
  volcengine: {
    apiKey: process.env.API_KEY || process.env.ARK_API_KEY || '',
    llmEndpointId: process.env.LLM_ENDPOINT_ID || '',
    imageEndpointId: process.env.T2V_ENDPOINT_ID || '',
    videoEndpointId: process.env.CGT_ENDPOINT_ID || '',
    tosAccessKey: process.env.TOS_ACCESSKEY || '',
    tosSecretKey: process.env.TOS_SECRETKEY || '',
    tosBucket: process.env.TOS_BUCKET || '',
    ttsAccessKey: process.env.TTS_ACCESS_KEY || process.env.TTS_ACCESS_TOKEN || '',
    ttsAppKey: process.env.TTS_APP_KEY || process.env.TTS_APP_ID || '',
    ttsApiResourceId: process.env.TTS_API_RESOURCE_ID || 'volc.service_type.10029',
    ttsBaseUrl: process.env.TTS_BASE_URL || 'wss://openspeech.bytedance.com/api/v3/tts/bidirection',
    ttsNamespace: process.env.TTS_NAMESPACE || 'BidirectionalTTS',
    ttsSpeaker: process.env.TTS_SPEAKER || 'zh_female_xiaohe_uranus_bigtts',
  },
  runtime: {
    assetRoot: getDefaultAssetRoot(),
    backendPort: DEFAULT_BACKEND_PORT,
  },
});

const mergeDesktopConfig = config => {
  const defaults = getDefaultDesktopConfig();
  const next = {
    volcengine: {
      ...defaults.volcengine,
      ...(config?.volcengine || {}),
    },
    runtime: {
      ...defaults.runtime,
      ...(config?.runtime || {}),
    },
  };
  next.runtime.assetRoot = next.runtime.assetRoot || defaults.runtime.assetRoot;
  next.runtime.backendPort = Number(next.runtime.backendPort || DEFAULT_BACKEND_PORT);
  return next;
};

const loadDesktopConfig = () => {
  if (!configPath || !fs.existsSync(configPath)) {
    return mergeDesktopConfig({});
  }
  try {
    return mergeDesktopConfig(JSON.parse(fs.readFileSync(configPath, 'utf-8')));
  } catch (error) {
    writeLogLine(
      path.join(logsDir || app.getPath('logs'), 'app.log'),
      `${new Date().toISOString()} failed to read config: ${String(error)}${os.EOL}`,
    );
    return mergeDesktopConfig({});
  }
};

const saveDesktopConfig = config => {
  const next = mergeDesktopConfig(config);
  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf-8');
  ensureDir(next.runtime.assetRoot);
  return next;
};

const getConfigMissingFields = config => {
  const volcengine = config.volcengine || {};
  const missing = [];
  const requiredFields = [
    ['volcengine.apiKey', volcengine.apiKey],
    ['volcengine.llmEndpointId', volcengine.llmEndpointId],
    ['volcengine.imageEndpointId', volcengine.imageEndpointId],
    ['volcengine.videoEndpointId', volcengine.videoEndpointId],
    ['volcengine.tosAccessKey', volcengine.tosAccessKey],
    ['volcengine.tosSecretKey', volcengine.tosSecretKey],
    ['volcengine.tosBucket', volcengine.tosBucket],
  ];
  requiredFields.forEach(([key, value]) => {
    if (!String(value || '').trim()) {
      missing.push(key);
    }
  });
  return missing;
};

const getDesktopConfigStatus = config => {
  const missing = getConfigMissingFields(config);
  return {
    configured: missing.length === 0,
    missing,
  };
};

const sanitizeDesktopConfigForRenderer = config => {
  const status = getDesktopConfigStatus(config);
  return {
    ...config,
    status,
    masked: {
      apiKey: maskSecret(config.volcengine.apiKey),
      tosAccessKey: maskSecret(config.volcengine.tosAccessKey),
      tosSecretKey: maskSecret(config.volcengine.tosSecretKey),
      ttsAccessKey: maskSecret(config.volcengine.ttsAccessKey),
      ttsAppKey: maskSecret(config.volcengine.ttsAppKey),
    },
  };
};

const getAssetRoot = () => loadDesktopConfig().runtime.assetRoot || getDefaultAssetRoot();

const getMimeType = filePath => {
  const ext = path.extname(filePath).toLowerCase();
  if (['.jpg', '.jpeg'].includes(ext)) {
    return 'image/jpeg';
  }
  if (ext === '.png') {
    return 'image/png';
  }
  if (ext === '.webp') {
    return 'image/webp';
  }
  return 'application/octet-stream';
};

const getPythonExecutable = () => {
  if (process.env.CHAT2CARTOON_BACKEND_PYTHON) {
    return process.env.CHAT2CARTOON_BACKEND_PYTHON;
  }
  const condaPython = '/opt/anaconda3/envs/video-gen1/bin/python';
  if (fs.existsSync(condaPython)) {
    return condaPython;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
};

const getPackagedBackendExecutable = () => {
  if (!app.isPackaged) {
    return '';
  }
  const executableName =
    process.platform === 'win32'
      ? 'chat2cartoon-backend.exe'
      : 'chat2cartoon-backend';
  const candidates = [
    path.join(process.resourcesPath, 'backend-runtime', 'dist', 'chat2cartoon-backend', executableName),
    path.join(process.resourcesPath, 'backend-runtime', executableName),
    path.join(process.resourcesPath, 'backend-runtime', 'dist', executableName),
  ];
  return candidates.find(candidate => {
    if (!fs.existsSync(candidate)) {
      return false;
    }
    const sidecarDir = path.join(path.dirname(candidate), '_internal');
    if (fs.existsSync(sidecarDir)) {
      return true;
    }
    writeAppLog(`skipping packaged backend candidate without _internal sidecar: ${candidate}`);
    return false;
  }) || '';
};

const getBackendLaunchConfig = () => {
  const packagedExecutable = getPackagedBackendExecutable();
  if (packagedExecutable) {
    return {
      command: packagedExecutable,
      args: [],
      cwd: ensureDir(path.join(app.getPath('userData'), 'runtime')),
      mode: 'packaged-runtime',
    };
  }
  return {
    command: getPythonExecutable(),
    args: ['index.py'],
    cwd: app.isPackaged ? path.join(process.resourcesPath, 'backend') : BACKEND_DIR,
    mode: 'python-source',
  };
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const pingBackend = async origin => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(`${origin}/v1/ping`, {
      method: 'GET',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

const checkDesktopBackend = async origin => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(`${origin}/v1/desktop/status`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      return false;
    }
    const payload = await response.json();
    return payload?.status === 'ok';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

const isPortAvailable = port =>
  new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });

const findAvailablePort = async startPort => {
  for (let port = startPort; port < startPort + 40; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available local port near ${startPort}`);
};

const waitForBackend = async origin => {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (await checkDesktopBackend(origin)) {
      return true;
    }
    await wait(500);
  }
  return false;
};

const waitForBackendStart = async (origin, processToWatch) => {
  const processFailure = new Promise((resolve, reject) => {
    processToWatch.once('error', error => {
      reject(error);
    });
    processToWatch.once('exit', (code, signal) => {
      reject(new Error(`Backend exited before ready: code=${code ?? ''} signal=${signal ?? ''}`));
    });
  });
  return Promise.race([waitForBackend(origin), processFailure]);
};

const notifyBackendStatus = status => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('backend:status-changed', status);
};

const stopBackend = async () => {
  if (!backendProcess) {
    return;
  }
  const processToStop = backendProcess;
  backendProcess = null;
  if (processToStop.exitCode !== null || processToStop.killed) {
    return;
  }
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 3000);
    processToStop.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    processToStop.kill();
  });
};

const startBackend = async ({ reuseExisting = true } = {}) => {
  const desktopConfig = loadDesktopConfig();
  const preferredPort = Number(desktopConfig.runtime.backendPort || DEFAULT_BACKEND_PORT);
  const preferredOrigin = `http://127.0.0.1:${preferredPort}`;
  if (reuseExisting && (await checkDesktopBackend(preferredOrigin))) {
    backendOrigin = preferredOrigin;
    return backendOrigin;
  }

  const port = (await isPortAvailable(preferredPort))
    ? preferredPort
    : await findAvailablePort(preferredPort + 1);
  backendOrigin = `http://127.0.0.1:${port}`;

  const launchConfig = getBackendLaunchConfig();
  const backendLog = path.join(logsDir, 'backend.log');
  const assetRoot = desktopConfig.runtime.assetRoot || getDefaultAssetRoot();
  ensureDir(assetRoot);
  const env = {
    ...process.env,
    _FAAS_RUNTIME_PORT: String(port),
    ADMIN_DATABASE_PATH: path.join(app.getPath('userData'), 'admin.db'),
    ASSET_ROOT: assetRoot,
    API_KEY: desktopConfig.volcengine.apiKey,
    ARK_API_KEY: desktopConfig.volcengine.apiKey,
    LLM_ENDPOINT_ID: desktopConfig.volcengine.llmEndpointId,
    T2V_ENDPOINT_ID: desktopConfig.volcengine.imageEndpointId,
    CGT_ENDPOINT_ID: desktopConfig.volcengine.videoEndpointId,
    TOS_ACCESSKEY: desktopConfig.volcengine.tosAccessKey,
    TOS_SECRETKEY: desktopConfig.volcengine.tosSecretKey,
    TOS_BUCKET: desktopConfig.volcengine.tosBucket,
    TTS_ACCESS_KEY: desktopConfig.volcengine.ttsAccessKey,
    TTS_APP_KEY: desktopConfig.volcengine.ttsAppKey,
    TTS_API_RESOURCE_ID: desktopConfig.volcengine.ttsApiResourceId,
    TTS_BASE_URL: desktopConfig.volcengine.ttsBaseUrl,
    TTS_NAMESPACE: desktopConfig.volcengine.ttsNamespace,
    TTS_SPEAKER: desktopConfig.volcengine.ttsSpeaker,
  };

  writeLogLine(
    backendLog,
    `${new Date().toISOString()} starting backend mode=${launchConfig.mode} command=${launchConfig.command}${os.EOL}`,
  );

  const spawnedProcess = childProcess.spawn(launchConfig.command, launchConfig.args, {
    cwd: launchConfig.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backendProcess = spawnedProcess;

  spawnedProcess.stdout.on('data', data => {
    writeLogLine(backendLog, data.toString());
  });
  spawnedProcess.stderr.on('data', data => {
    writeLogLine(backendLog, data.toString());
  });
  spawnedProcess.on('error', error => {
    writeLogLine(
      backendLog,
      `${new Date().toISOString()} backend spawn error: ${String(error.stack || error)}${os.EOL}`,
    );
    notifyBackendStatus({
      running: false,
      backendOrigin,
      message: `Backend spawn error: ${error.message}`,
    });
  });
  spawnedProcess.on('exit', (code, signal) => {
    notifyBackendStatus({
      running: false,
      backendOrigin,
      message: `Backend exited: code=${code ?? ''} signal=${signal ?? ''}`,
    });
  });

  if (!(await waitForBackendStart(backendOrigin, spawnedProcess))) {
    throw new Error(`Backend did not become ready at ${backendOrigin}`);
  }

  notifyBackendStatus({
    backendOrigin,
    desktopReady: true,
    running: true,
  });

  return backendOrigin;
};

const getStaticContentType = filePath => {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  };
  return types[ext] || 'application/octet-stream';
};

const startStaticServer = async distDir => {
  const port = await findAvailablePort(39100);
  const indexCandidates = [
    path.join(distDir, 'index.html'),
    path.join(distDir, 'html', 'main', 'index.html'),
  ];
  const fallbackIndex =
    indexCandidates.find(candidate => fs.existsSync(candidate)) ||
    indexCandidates[0];

  staticServer = http.createServer((request, response) => {
    const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
    const pathname = decodeURIComponent(url.pathname);
    const safePath = pathname.replace(/^\/+/, '');
    let filePath = path.join(distDir, safePath);

    if (!filePath.startsWith(distDir)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = fallbackIndex;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': getStaticContentType(filePath) });
      response.end(content);
    });
  });

  await new Promise(resolve => staticServer.listen(port, '127.0.0.1', resolve));
  staticServerUrl = `http://127.0.0.1:${port}`;
  return staticServerUrl;
};

const getRendererUrl = async () => {
  if (process.env.CHAT2CARTOON_RENDERER_URL) {
    return process.env.CHAT2CARTOON_RENDERER_URL;
  }
  const packagedDist = path.join(process.resourcesPath || '', 'frontend-dist');
  if (app.isPackaged && fs.existsSync(packagedDist)) {
    return startStaticServer(packagedDist);
  }
  if (
    process.env.CHAT2CARTOON_USE_FRONTEND_DIST === '1' &&
    (fs.existsSync(path.join(FRONTEND_DIST_DIR, 'index.html')) ||
      fs.existsSync(path.join(FRONTEND_DIST_DIR, 'html', 'main', 'index.html')))
  ) {
    return startStaticServer(FRONTEND_DIST_DIR);
  }
  return DEFAULT_RENDERER_URL;
};

const withPath = (baseUrl, pathname) => {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  url.search = '';
  url.hash = '';
  return url.toString();
};

const createWindowOpenHandler = () => ({ url }) => {
  shell.openExternal(url);
  return { action: 'deny' };
};

const buildWebPreferences = () => ({
  preload: path.join(DESKTOP_DIR, 'src', 'preload', 'index.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  additionalArguments: [
    `--chat2cartoon-backend-origin=${backendOrigin}`,
    `--chat2cartoon-asset-root=${getAssetRoot()}`,
  ],
});

const openAdminWindow = async () => {
  const rendererUrl = await getRendererUrl();
  if (adminWindow && !adminWindow.isDestroyed()) {
    await adminWindow.loadURL(withPath(rendererUrl, '/admin'));
    adminWindow.show();
    adminWindow.focus();
    return;
  }

  adminWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    title: '后台管理',
    backgroundColor: '#f5f7fa',
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    webPreferences: buildWebPreferences(),
  });
  adminWindow.on('closed', () => {
    adminWindow = null;
  });
  adminWindow.webContents.setWindowOpenHandler(createWindowOpenHandler());
  await adminWindow.loadURL(withPath(rendererUrl, '/admin'));
};

const createMenu = () => {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开素材目录',
          click: () => shell.openPath(getAssetRoot()),
        },
        {
          label: '打开日志目录',
          click: () => shell.openPath(logsDir),
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '管理后台',
          click: () => openAdminWindow(),
        },
        { type: 'separator' },
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '检查后端状态',
          click: async () => {
            const running = await pingBackend(backendOrigin);
            dialog.showMessageBox(mainWindow, {
              type: running ? 'info' : 'warning',
              message: running ? '本地后端运行中' : '本地后端未响应',
              detail: backendOrigin,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const createWindow = async rendererUrl => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    title: '历史知识视频生成器',
    backgroundColor: '#f6f7f9',
    webPreferences: buildWebPreferences(),
  });

  mainWindow.webContents.setWindowOpenHandler(createWindowOpenHandler());

  await mainWindow.loadURL(rendererUrl);
};

const registerIpcHandlers = () => {
  ipcMain.handle('runtime:get-info', () => ({
    appVersion: app.getVersion(),
    assetRoot: getAssetRoot(),
    backendOrigin,
    isPackaged: app.isPackaged,
    platform: process.platform,
  }));

  ipcMain.handle('backend:get-status', async () => ({
    backendOrigin,
    desktopReady: await checkDesktopBackend(backendOrigin),
    running: await pingBackend(backendOrigin),
  }));

  ipcMain.handle('backend:restart', async () => {
    await stopBackend();
    await startBackend({ reuseExisting: false });
    return {
      backendOrigin,
      desktopReady: true,
      running: true,
    };
  });

  ipcMain.handle('config:get', () =>
    sanitizeDesktopConfigForRenderer(loadDesktopConfig()));

  ipcMain.handle('config:save', async (_event, config) => {
    const savedConfig = saveDesktopConfig(config);
    return sanitizeDesktopConfigForRenderer(savedConfig);
  });

  ipcMain.handle('config:save-and-restart', async (_event, config) => {
    const savedConfig = saveDesktopConfig(config);
    await stopBackend();
    await startBackend({ reuseExisting: false });
    return {
      config: sanitizeDesktopConfigForRenderer(savedConfig),
      backend: {
        backendOrigin,
        desktopReady: true,
        running: true,
      },
    };
  });

  ipcMain.handle('config:test', async (_event, config) => {
    const nextConfig = mergeDesktopConfig(config || loadDesktopConfig());
    const status = getDesktopConfigStatus(nextConfig);
    return {
      ...status,
      checks: {
        apiKey: Boolean(nextConfig.volcengine.apiKey),
        llmEndpointId: Boolean(nextConfig.volcengine.llmEndpointId),
        imageEndpointId: Boolean(nextConfig.volcengine.imageEndpointId),
        videoEndpointId: Boolean(nextConfig.volcengine.videoEndpointId),
        tos: Boolean(
          nextConfig.volcengine.tosAccessKey &&
            nextConfig.volcengine.tosSecretKey &&
            nextConfig.volcengine.tosBucket,
        ),
        tts: Boolean(
          nextConfig.volcengine.ttsAccessKey && nextConfig.volcengine.ttsAppKey,
        ),
      },
      backend: {
        backendOrigin,
        desktopReady: await checkDesktopBackend(backendOrigin),
        running: await pingBackend(backendOrigin),
      },
    };
  });

  ipcMain.handle('dialog:select-asset-root', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:select-script-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Text', extensions: ['txt', 'md', 'text'] }],
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    const filePath = result.filePaths[0];
    const stat = fs.statSync(filePath);
    const text = fs.readFileSync(filePath, 'utf-8');
    return {
      fileName: path.basename(filePath),
      path: filePath,
      size: stat.size,
      text,
    };
  });

  ipcMain.handle('dialog:select-reference-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    const filePath = result.filePaths[0];
    const stat = fs.statSync(filePath);
    const mimeType = getMimeType(filePath);
    const base64 = fs.readFileSync(filePath).toString('base64');
    return {
      dataUrl: `data:${mimeType};base64,${base64}`,
      fileName: path.basename(filePath),
      mimeType,
      path: filePath,
      size: stat.size,
    };
  });

  ipcMain.handle('shell:open-project-folder', async (_event, projectId) => {
    const projectDir = path.join(getAssetRoot(), sanitizeProjectId(projectId));
    ensureDir(projectDir);
    return shell.openPath(projectDir);
  });

  ipcMain.handle('shell:open-logs-folder', async () => {
    ensureDir(logsDir);
    return shell.openPath(logsDir);
  });

  ipcMain.handle('window:open-admin', async () => {
    await openAdminWindow();
    return { ok: true };
  });

  ipcMain.handle('window:focus-main', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      const rendererUrl = await getRendererUrl();
      await createWindow(rendererUrl);
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
    return { ok: true };
  });

  ipcMain.handle('download:save-url-as-file', async (_event, url, suggestedName) => {
    const resolvedUrl = String(url || '').startsWith('/')
      ? `${backendOrigin}${url}`
      : String(url || '');
    if (!/^https?:\/\//.test(resolvedUrl)) {
      throw new Error('Only http(s) downloads are supported');
    }

    const saveResult = await dialog.showSaveDialog(mainWindow, {
      defaultPath: suggestedName || path.basename(new URL(resolvedUrl).pathname) || 'asset',
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return null;
    }

    const response = await fetch(resolvedUrl);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(saveResult.filePath, buffer);
    return {
      filePath: saveResult.filePath,
    };
  });
};

app.whenReady().then(async () => {
  app.setName('历史知识视频生成器');
  configPath = path.join(app.getPath('userData'), 'config.json');
  logsDir = ensureDir(path.join(app.getPath('logs'), 'chat2cartoon'));
  ensureDir(getAssetRoot());
  registerIpcHandlers();
  createMenu();

  try {
    await startBackend();
  } catch (error) {
    writeLogLine(path.join(logsDir, 'app.log'), `${new Date().toISOString()} ${String(error.stack || error)}${os.EOL}`);
  }

  const rendererUrl = await getRendererUrl();
  await createWindow(rendererUrl);

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow(rendererUrl);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  if (staticServer) {
    staticServer.close();
    staticServer = null;
  }
});
