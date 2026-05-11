const { app, BrowserWindow, ipcMain, net, Menu, Tray, nativeImage, safeStorage, shell } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const http = require('http')
const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

const PROTOCOL = 'ordr-terminal'
const API_BASE_URL = 'https://api.panelordr.com.br'
const SESSION_FILE = 'terminal-session.json'
const DEVICE_IDS_FILE = 'terminal-device-ids.json'

let mainWindow = null
let staticServer = null
let tray = null
let pendingLaunchToken = null
let lastHandledProtocolRequestId = null
let isQuitting = false
let terminalSessionActive = false

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
}

function getSessionPath() {
  return path.join(app.getPath('userData'), SESSION_FILE)
}

function readSavedSession() {
  const filePath = getSessionPath()

  if (!fs.existsSync(filePath)) return null

  try {
    const encrypted = fs.readFileSync(filePath, 'utf8')
    const raw = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
      : Buffer.from(encrypted, 'base64').toString('utf8')

    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch (error) {
    console.warn('[terminal] Failed to read saved session:', error)
    return null
  }
}

async function disconnectSavedTerminalSession() {
  const session = readSavedSession()
  const token = typeof session?.token === 'string' ? session.token : null
  const companyId = normalizeCompanyId(session?.user?.currentCompany?.id || session?.user?.companyId)

  if (!token || !companyId) return { ok: false, reason: 'missing-session' }

  const deviceId = readDeviceIds()[companyId]

  if (!deviceId) return { ok: false, reason: 'missing-device-id' }

  try {
    await electronNetJsonRequest({
      url: `${API_BASE_URL}/devices/terminal-disconnect`,
      method: 'POST',
      token,
      body: { deviceId },
    })

    return { ok: true }
  } catch (error) {
    console.warn('[terminal] Failed to disconnect terminal before quitting:', error)
    return { ok: false, reason: error?.message || 'request-failed' }
  }
}

function getDeviceIdsPath() {
  return path.join(app.getPath('userData'), DEVICE_IDS_FILE)
}

function readDeviceIds() {
  const filePath = getDeviceIdsPath()

  if (!fs.existsSync(filePath)) return {}

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    console.warn('[terminal] Failed to read saved device ids:', error)
    return {}
  }
}

function writeDeviceIds(deviceIds) {
  const filePath = getDeviceIdsPath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(deviceIds || {}, null, 2), 'utf8')
}

function normalizeCompanyId(companyId) {
  return typeof companyId === 'string' && companyId.trim() ? companyId.trim() : null
}

function bringMainWindowToFront() {
  if (!mainWindow) return

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()

  if (process.platform === 'win32') {
    mainWindow.setAlwaysOnTop(true)
    mainWindow.setAlwaysOnTop(false)
  }
}

function sendLaunchTokenToRenderer(launchToken) {
  if (!mainWindow || !launchToken) return

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('terminal:launch-token', launchToken)
    })
    return
  }

  mainWindow.webContents.send('terminal:launch-token', launchToken)
}

function handleProtocolUrl(url) {
  console.log('Protocol URL:', url)

  try {
    const parsed = new URL(url)
    const launchToken = parsed.searchParams.get('launchToken')
    const requestId = parsed.searchParams.get('requestId')

    if (requestId && requestId === lastHandledProtocolRequestId) {
      bringMainWindowToFront()
      return
    }

    if (requestId) {
      lastHandledProtocolRequestId = requestId
    }

    if (launchToken) {
      pendingLaunchToken = launchToken
      sendLaunchTokenToRenderer(launchToken)
    }
  } catch (error) {
    console.error('Protocol parse error:', error)
  }

  bringMainWindowToFront()
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()

  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json; charset=utf-8',
  }

  return types[ext] || 'application/octet-stream'
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const outDir = path.join(app.getAppPath(), 'out')

    if (!fs.existsSync(path.join(outDir, 'index.html'))) {
      reject(new Error(`index.html não encontrado em: ${outDir}`))
      return
    }

    if (staticServer) {
      const address = staticServer.address()
      const port = typeof address === 'object' && address ? address.port : null

      if (port) {
        resolve(`http://127.0.0.1:${port}`)
        return
      }
    }

    staticServer = http.createServer((req, res) => {
      try {
        const rawUrl = req.url || '/'
        const safeUrl = decodeURIComponent(rawUrl.split('?')[0]).replace(/^\/+/, '')

        let filePath = path.join(outDir, safeUrl)

        if (rawUrl === '/' || rawUrl === '') {
          filePath = path.join(outDir, 'index.html')
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html')
        }

        if (!fs.existsSync(filePath)) {
          filePath = path.join(outDir, 'index.html')
        }

        res.writeHead(200, {
          'Content-Type': getMimeType(filePath),
          'Cache-Control': 'no-cache',
        })

        fs.createReadStream(filePath).pipe(res)
      } catch (error) {
        console.error('Static server error:', error)
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(String(error?.message || error))
      }
    })

    staticServer.listen(0, '127.0.0.1', () => {
      const address = staticServer.address()
      const port = typeof address === 'object' && address ? address.port : null

      if (!port) {
        reject(new Error('Não foi possível iniciar servidor local do terminal.'))
        return
      }

      resolve(`http://127.0.0.1:${port}`)
    })

    staticServer.on('error', reject)
  })
}

function getIconPath() {
  return path.join(__dirname, 'assets', 'icon.ico')
}

function getTrayIcon() {
  const iconPath = getIconPath()

  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath)
  }

  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGElEQVR4AWP4z8Dwn4ECwESJ5lEDRgYAUQ4CH2bzdlQAAAAASUVORK5CYII='
  )
}

function createTray() {
  if (tray) return

  tray = new Tray(getTrayIcon())
  tray.setToolTip('ORDR Terminal')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir ORDR Terminal',
      click: () => {
        bringMainWindowToFront()
      },
    },
    { type: 'separator' },
    {
      label: 'Desligar terminal',
      click: async () => {
        isQuitting = true
        await disconnectSavedTerminalSession()
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    bringMainWindowToFront()
  })
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    autoHideMenuBar: true,
    title: 'ORDR Terminal',
    backgroundColor: '#050816',
    icon: fs.existsSync(getIconPath()) ? getIconPath() : undefined,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  Menu.setApplicationMenu(null)
  mainWindow.setMenu(null)

  createTray()

  mainWindow.on('close', (event) => {
    if (isQuitting) return

    if (!terminalSessionActive) {
      isQuitting = true
      return
    }

    event.preventDefault()
    mainWindow.hide()
  })

  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingLaunchToken) {
      mainWindow?.webContents.send('terminal:launch-token', pendingLaunchToken)
      pendingLaunchToken = null
    }
  })

  const shouldUseDevServer =
    process.defaultApp === true &&
    process.env.ORDR_TERMINAL_URL &&
    process.env.ORDR_TERMINAL_URL.includes('localhost')

  if (shouldUseDevServer) {
    console.log('Loading terminal from dev server:', process.env.ORDR_TERMINAL_URL)
    await mainWindow.loadURL(process.env.ORDR_TERMINAL_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
    return
  }

  const localUrl = await startStaticServer()
  console.log('Loading terminal from local static server:', localUrl)

  await mainWindow.loadURL(localUrl)
}

ipcMain.handle('terminal:device-info', async () => {
  return {
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    release: os.release(),
    username: os.userInfo().username,
    isElectron: true,
    isPackaged: app.isPackaged,
  }
})


ipcMain.handle('terminal:app-info', async () => {
  return {
    name: app.getName(),
    version: app.getVersion(),
    isPackaged: app.isPackaged,
  }
})

ipcMain.handle('terminal:open-external', async (_event, url) => {
  if (!url || typeof url !== 'string') {
    throw new Error('URL obrigatória.')
  }

  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    throw new Error('URL externa inválida.')
  }

  await shell.openExternal(url)
  return { ok: true }
})

ipcMain.handle('terminal:shutdown', async () => {
  isQuitting = true
  await disconnectSavedTerminalSession()

  if (staticServer) {
    staticServer.close()
    staticServer = null
  }

  app.quit()

  return { ok: true }
})


ipcMain.handle('terminal:set-session-active', async (_event, active) => {
  terminalSessionActive = Boolean(active)
  return { ok: true }
})

ipcMain.handle('terminal:save-session', async (_event, payload) => {
  const raw = JSON.stringify(payload || {})

  const encrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(raw).toString('base64')
    : Buffer.from(raw, 'utf8').toString('base64')

  fs.writeFileSync(getSessionPath(), encrypted, 'utf8')

  return { ok: true }
})

ipcMain.handle('terminal:load-session', async () => {
  const filePath = getSessionPath()

  if (!fs.existsSync(filePath)) return null

  const encrypted = fs.readFileSync(filePath, 'utf8')

  const raw = safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    : Buffer.from(encrypted, 'base64').toString('utf8')

  return JSON.parse(raw)
})

ipcMain.handle('terminal:clear-session', async () => {
  const filePath = getSessionPath()

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }

  return { ok: true }
})


ipcMain.handle('terminal:get-device-id', async (_event, companyId) => {
  const normalizedCompanyId = normalizeCompanyId(companyId)
  if (!normalizedCompanyId) return null

  const deviceIds = readDeviceIds()
  return typeof deviceIds[normalizedCompanyId] === 'string'
    ? deviceIds[normalizedCompanyId]
    : null
})

ipcMain.handle('terminal:set-device-id', async (_event, payload) => {
  const companyId = normalizeCompanyId(payload?.companyId)
  const deviceId = typeof payload?.deviceId === 'string' && payload.deviceId.trim()
    ? payload.deviceId.trim()
    : null

  if (!companyId || !deviceId) {
    throw new Error('companyId e deviceId são obrigatórios.')
  }

  const deviceIds = readDeviceIds()
  deviceIds[companyId] = deviceId
  writeDeviceIds(deviceIds)

  return { ok: true }
})

ipcMain.handle('terminal:clear-device-id', async (_event, companyId) => {
  const normalizedCompanyId = normalizeCompanyId(companyId)
  if (!normalizedCompanyId) return { ok: true }

  const deviceIds = readDeviceIds()
  delete deviceIds[normalizedCompanyId]
  writeDeviceIds(deviceIds)

  return { ok: true }
})

ipcMain.handle('printers:list', async () => {
  const electronPrinters = await listElectronPrinters()

  if (electronPrinters.length > 0) {
    return electronPrinters
  }

  if (process.platform === 'win32') {
    const windowsPrinters = await listWindowsPrintersByPowerShell()

    if (windowsPrinters.length > 0) {
      return windowsPrinters
    }
  }

  return []
})

async function listElectronPrinters() {
  if (!mainWindow) return []

  try {
    const printers = await mainWindow.webContents.getPrintersAsync()

    return printers.map((printer) => ({
      name: printer.name,
      displayName: printer.displayName || printer.name,
      description: printer.description || null,
      isDefault: Boolean(printer.isDefault),
      source: 'electron',
    }))
  } catch (error) {
    console.error('Electron printer list error:', error)
    return []
  }
}

function listWindowsPrintersByPowerShell() {
  return new Promise((resolve) => {
    const script = [
      'Get-Printer',
      '| Select-Object Name, DriverName, PortName, Default',
      '| ConvertTo-Json -Compress',
    ].join(' ')

    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          console.error('PowerShell printer list error:', error)
          resolve([])
          return
        }

        try {
          const parsed = JSON.parse(stdout || '[]')
          const list = Array.isArray(parsed) ? parsed : [parsed]

          resolve(
            list
              .filter((printer) => printer && printer.Name)
              .map((printer) => ({
                name: printer.Name,
                displayName: printer.Name,
                description: printer.DriverName || printer.PortName || null,
                isDefault: Boolean(printer.Default),
                source: 'powershell',
              }))
          )
        } catch (parseError) {
          console.error('PowerShell printer parse error:', parseError, stdout)
          resolve([])
        }
      }
    )
  })
}

ipcMain.handle('terminal:api-fetch', async (_event, payload) => {
  const { url, method = 'GET', body, token } = payload || {}

  if (!url || typeof url !== 'string') {
    throw new Error('API URL inválida.')
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('A API URL precisa começar com http:// ou https://.')
  }

  return electronNetJsonRequest({
    url,
    method,
    body,
    token,
  })
})

function electronNetJsonRequest({ url, method, body, token }) {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method,
      url,
    })

    request.setHeader('Content-Type', 'application/json')

    if (token) {
      request.setHeader('Authorization', `Bearer ${token}`)
    }

    let responseBody = ''
    let statusCode = 0

    request.on('response', (response) => {
      statusCode = response.statusCode

      response.on('data', (chunk) => {
        responseBody += chunk.toString()
      })

      response.on('end', () => {
        let data = null

        try {
          data = responseBody ? JSON.parse(responseBody) : null
        } catch {
          reject(new Error(`Resposta inválida da API: ${responseBody.slice(0, 180)}`))
          return
        }

        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(data?.error || `Erro HTTP ${statusCode}`))
          return
        }

        resolve(data)
      })
    })

    request.on('error', (error) => {
      reject(new Error(error?.message || 'Erro de conexão com a API.'))
    })

    if (body !== undefined) {
      request.write(JSON.stringify(body))
    }

    request.end()
  })
}


function escapePowerShellString(value) {
  return String(value ?? '').replace(/'/g, "''")
}

async function runPowerShellScript(psScript) {
  const { stdout, stderr } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    psScript,
  ], { windowsHide: true })

  if (stderr?.trim()) {
    console.warn('[ORDR Terminal] PowerShell stderr:', stderr.trim())
  }

  return {
    stdout: stdout?.trim() || '',
    stderr: stderr?.trim() || '',
  }
}

async function printRawThermalText(content, options = {}) {
  const {
    printerName,
    feedLines = 6,
    cut = true,
  } = options

  if (!printerName || typeof printerName !== 'string') {
    throw new Error('Nome da impressora é obrigatório.')
  }

  const text = String(content ?? '')

  if (!text.trim()) {
    throw new Error('Texto de impressão é obrigatório.')
  }

  const escapedPrinterName = escapePowerShellString(printerName)
  const escapedContent = escapePowerShellString(text)
  const safeFeedLines = Number.isFinite(Number(feedLines)) ? Math.max(0, Math.min(20, Number(feedLines))) : 6
  const cutCommand = cut
    ? '$allBytes += [byte[]](0x1D, 0x56, 0x00)'
    : ''

  const psScript = `
$printerName = '${escapedPrinterName}'
$content = @'
${escapedContent}
'@
$feedLines = ${safeFeedLines}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public class DOCINFO
    {
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.Drv", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, DOCINFO di);

    [DllImport("winspool.Drv", SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] data, int buf, out int pcWritten);
}
"@

function Send-RawBytesToPrinter {
    param(
        [Parameter(Mandatory=$true)][string]$PrinterName,
        [Parameter(Mandatory=$true)][byte[]]$Bytes
    )

    $hPrinter = [IntPtr]::Zero
    $docInfo = New-Object RawPrinterHelper+DOCINFO
    $docInfo.pDocName = "ORDR Thermal Print"
    $docInfo.pDataType = "RAW"

    $opened = [RawPrinterHelper]::OpenPrinter($PrinterName, [ref]$hPrinter, [IntPtr]::Zero)
    if (-not $opened) {
        throw "Could not open printer '$PrinterName'. Win32 error: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }

    try {
        $startedDoc = [RawPrinterHelper]::StartDocPrinter($hPrinter, 1, $docInfo)
        if (-not $startedDoc) {
            throw "Could not start print document. Win32 error: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
        }

        try {
            $startedPage = [RawPrinterHelper]::StartPagePrinter($hPrinter)
            if (-not $startedPage) {
                throw "Could not start print page. Win32 error: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
            }

            try {
                $written = 0
                $ok = [RawPrinterHelper]::WritePrinter($hPrinter, $Bytes, $Bytes.Length, [ref]$written)
                if (-not $ok) {
                    throw "Could not write to printer. Win32 error: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
                }

                if ($written -ne $Bytes.Length) {
                    throw "Incomplete write. Expected $($Bytes.Length) bytes, wrote $written bytes."
                }
            }
            finally {
                [void][RawPrinterHelper]::EndPagePrinter($hPrinter)
            }
        }
        finally {
            [void][RawPrinterHelper]::EndDocPrinter($hPrinter)
        }
    }
    finally {
        [void][RawPrinterHelper]::ClosePrinter($hPrinter)
    }
}

$printer = Get-Printer -Name $printerName -ErrorAction SilentlyContinue
if (-not $printer) {
    throw "Printer '$printerName' not found."
}

[System.Text.Encoding]::RegisterProvider([System.Text.CodePagesEncodingProvider]::Instance)

# ESC @ reset
$initBytes = [byte[]](0x1B, 0x40)

# ESC t 16 = WPC1252 on many Epson/ESC-POS printers
$codePageBytes = [byte[]](0x1B, 0x74, 0x10)

$textBytes = [System.Text.Encoding]::GetEncoding(1252).GetBytes($content)

$feedText = ""
for ($i = 0; $i -lt $feedLines; $i++) {
    $feedText += [Environment]::NewLine
}

$feedBytes = [System.Text.Encoding]::GetEncoding(1252).GetBytes($feedText)

$allBytes = $initBytes + $codePageBytes + $textBytes + $feedBytes
${cutCommand}

Send-RawBytesToPrinter -PrinterName $printerName -Bytes $allBytes
Write-Host "Print job sent successfully."
`

  await runPowerShellScript(psScript)
}

ipcMain.handle('printers:print-raw-text', async (_event, payload) => {
  const { printerName, feedLines = 6, cut = true } = payload || {}
  const text =
    typeof payload?.text === 'string'
      ? payload.text
      : typeof payload?.content === 'string'
        ? payload.content
        : ''

  await printRawThermalText(text, {
    printerName,
    feedLines,
    cut,
  })

  return { ok: true }
})

ipcMain.handle('printers:print-text', async (_event, payload) => {
  const { printerName } = payload || {}

  const text =
    typeof payload?.text === 'string'
      ? payload.text
      : typeof payload?.content === 'string'
        ? payload.content
        : ''

  if (!printerName || typeof printerName !== 'string') {
    throw new Error('Nome da impressora é obrigatório.')
  }

  if (!text) {
    throw new Error('Texto de impressão é obrigatório.')
  }

  const printWindow = new BrowserWindow({
    show: false,
    width: 420,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          html,
          body {
            margin: 0;
            padding: 0;
            background: #fff;
            color: #000;
          }

          body {
            padding: 12px;
            font-family: monospace;
            font-size: 12px;
            line-height: 1.35;
            white-space: pre-wrap;
          }
        </style>
      </head>
      <body>${escapeHtml(text)}</body>
    </html>
  `

  await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

  await new Promise((resolve, reject) => {
    printWindow.webContents.print(
      {
        silent: true,
        deviceName: printerName,
        printBackground: true,
      },
      (success, failureReason) => {
        printWindow.close()

        if (!success) {
          reject(new Error(failureReason || 'Falha ao imprimir.'))
          return
        }

        resolve()
      }
    )
  })

  return { ok: true }
})

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

app.on('second-instance', (_event, argv) => {
  const protocolUrl = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`))

  if (protocolUrl) {
    handleProtocolUrl(protocolUrl)
    return
  }

  bringMainWindowToFront()
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  handleProtocolUrl(url)
})

app.whenReady().then(async () => {
  await createWindow()

  const launchUrl = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`))

  if (launchUrl) {
    handleProtocolUrl(launchUrl)
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    } else {
      bringMainWindowToFront()
    }
  })
})

app.on('before-quit', () => {
  isQuitting = true
  disconnectSavedTerminalSession().catch(() => null)
})

app.on('window-all-closed', () => {
  // Mantém o terminal vivo na gaveta/tray.
  // O app só fecha de verdade pelo botão "Desligar terminal" ou pelo menu da tray.
})
