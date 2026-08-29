const { app, BrowserWindow, globalShortcut } = require("electron");
const path = require("path");

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Sistema de Atendimento",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "public/favicon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false, // Impede a suspensão do app ao minimizar
    },
  });

  win.loadURL("https://sistemadesenha-1w3x.vercel.app/login");

  win.webContents.on("did-finish-load", () => {
    win.webContents.setAudioMuted(false);
  });
}

// Atalhos Globais: funcionam mesmo com a janela em segundo plano/minimizada
function registerGlobalShortcuts() {
  const shortcuts = [
    { keys: ["Right"],  triggerKey: "ArrowRight" }, // Próxima normal
    { keys: ["Left"],   triggerKey: "ArrowLeft"  }, // Preferencial
    { keys: ["Up"],     triggerKey: "ArrowUp"    }, // Repetir
  ];

  shortcuts.forEach(({ keys, triggerKey }) => {
    keys.forEach((key) => {
      try {
        globalShortcut.register(key, () => {
          if (win && !win.isDestroyed()) {
            win.webContents.executeJavaScript(`
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: '${triggerKey}', bubbles: true }));
              }
            `);
          }
        });
      } catch {
        // Ignora caso o atalho esteja em uso por outro aplicativo do sistema
      }
    });
  });
}

app.whenReady().then(() => {
  createWindow();
  registerGlobalShortcuts();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});