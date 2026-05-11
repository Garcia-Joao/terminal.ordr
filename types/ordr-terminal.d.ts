export {}

type OrdrTerminalCompany = {
  id: string
  name: string
  isTest: boolean
  systemRole?: 'ADMIN' | 'CUSTOM'
}

type OrdrTerminalUser = {
  id: string
  username: string
  name?: string | null
  companyId: string
  currentCompany?: OrdrTerminalCompany | null
  companies?: OrdrTerminalCompany[]
}

type OrdrTerminalSavedSession = {
  token: string
  user: OrdrTerminalUser
  savedAt?: string
}

declare global {
  interface Window {
    ordrTerminal?: {
      isElectron: boolean

      getDeviceInfo: () => Promise<{
        platform: string
        arch: string
        hostname: string
        release: string
        username: string
        isElectron: boolean
        isPackaged?: boolean
      }>

      getAppInfo: () => Promise<{
        name: string
        version: string
        isPackaged: boolean
      }>

      openExternal: (url: string) => Promise<{ ok: boolean }>

      getPrinters: () => Promise<Array<{
        name: string
        displayName?: string | null
        description?: string | null
        isDefault?: boolean | null
        source?: string | null
      }>>

      apiFetch: <T>(payload: {
        url: string
        method?: string
        body?: unknown
        token?: string | null
      }) => Promise<T>

      printText: (payload: {
        printerName: string
        text?: string
        content?: string
      }) => Promise<{ ok: boolean }>

      printRawText: (payload: {
        printerName: string
        text?: string
        content?: string
        feedLines?: number
        cut?: boolean
      }) => Promise<{ ok: boolean }>

      shutdown: () => Promise<{ ok: boolean }>

      saveSession: (payload: OrdrTerminalSavedSession) => Promise<{ ok: boolean }>

      loadSession: () => Promise<OrdrTerminalSavedSession | null>

      clearSession: () => Promise<{ ok: boolean }>

      getDeviceId: (companyId: string) => Promise<string | null>

      setDeviceId: (payload: {
        companyId: string
        deviceId: string
      }) => Promise<{ ok: boolean }>

      clearDeviceId: (companyId: string) => Promise<{ ok: boolean }>

      setSessionActive: (active: boolean) => Promise<{ ok: boolean }>

      onLaunchToken: (callback: (launchToken: string) => void) => () => void
    }
  }
}
