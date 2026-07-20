const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // We want a small modal in the bottom right corner
  const winWidth = 80; // Start as a small bubble
  const winHeight = 80;

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: width - winWidth - 40,
    y: height - winHeight - 40,
    transparent: true,
    backgroundColor: '#00000000', 
    frame: false, 
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Make the window ignore mouse events where the background is transparent
  // We'll toggle this if needed, but for now it's fine.
  
  mainWindow.loadFile('index.html');

  // Handle IPC to show/hide window
  ipcMain.on('show-window', () => {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message} (${sourceId}:${line})`);
  });

  ipcMain.on('hide-window', () => {
    mainWindow.hide();
  });

  ipcMain.on('resize-window', (event, { width, height }) => {
    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
    mainWindow.setBounds({
      width: width,
      height: height,
      x: screenW - width - 24,
      y: screenH - height - 24
    });
  });
}

// Hide dock icon on macOS
if (process.platform === 'darwin') {
  app.dock.hide();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
