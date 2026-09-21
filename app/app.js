import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import fs from "fs";

let electronWindow = null;
let startTimestamp = null

function createWindow() {
    electronWindow = new BrowserWindow({
        height: 1000,
        width: 1000,
        webPreferences: {
            devTools: true,
            preload: path.join(import.meta.dirname, 'preload.js')
        }
    })

    electronWindow.loadURL('http://localhost:5173')
}

ipcMain.handle('start-timer', (event) => {
    startTimestamp = Date.now();

    // Send Timer Tick every 1s
    setInterval(() => {
        electronWindow.webContents.send('timer', (Date.now() - startTimestamp) / 1000);
    }, 1000);

    // Capture user's camera snap every 5s
    setInterval(() => {
        electronWindow.webContents.send('camera-shot')
    }, 5000);
})


ipcMain.handle('store-camera-snap-image-on-disk', (_event, data) => {
    const filePath = path.join(import.meta.dirname, "user-camera-snap", `${Date.now()}.jpg`);
    fs.writeFileSync(filePath, Buffer.from(data));
})


ipcMain.on("show-rules", () => {
    dialog.showMessageBox(electronWindow, {
        type: "info",
        title: "Athena Exam Rules",
        message: "Exam Rules",
        detail:
            "1. Stay on the exam screen.\n" +
            "2. Camera must remain enabled.\n" +
            "3. Do not leave the exam.\n" +
            "4. Do not use external assistance.\n" +
            "5. Click Exit Exam when finished."
    });
});


app.whenReady().then(createWindow);