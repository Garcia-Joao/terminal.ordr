'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'

const API_BASE_URL = 'https://api.panelordr.com.br'
const DOWNLOAD_PAGE_URL = 'https://panelordr.com.br/terminal'
const CURRENT_TERMINAL_VERSION = '1.0.0'

type PrinterInfo = {
  name: string
  displayName?: string | null
  description?: string | null
  isDefault?: boolean | null
  source?: string | null
}

type DeviceInfo = {
  platform: string
  arch: string
  hostname: string
  release: string
  username: string
  isElectron: boolean
  isPackaged?: boolean
}

type AuthCompany = {
  id: string
  name: string
  isTest: boolean
  systemRole?: 'ADMIN' | 'CUSTOM'
}

type AuthUser = {
  id: string
  username: string
  name?: string | null
  companyId: string
  currentCompany?: AuthCompany | null
  companies?: AuthCompany[]
}

type LoginResult = {
  user: AuthUser
  token: string
}

type TerminalSavedSession = {
  token: string
  user: AuthUser
  savedAt: string
}

type RegisteredDevice = {
  id: string
  name: string
  clientType?: 'WEB' | 'ELECTRON'
  printTerminalEnabled?: boolean
  isPrintTerminal?: boolean
  lastSeenAt?: string
}

type PrintPortBinding = {
  id: string
  portId: string
  terminalDeviceId: string
  localPrinterName: string
  localPrinterLabel?: string | null
}

type PrintPort = {
  id: string
  name: string
  description?: string | null
  active?: boolean
  terminalDeviceId?: string | null
  localPrinterName?: string | null
  localPrinterLabel?: string | null
  bindings?: PrintPortBinding[]
}

type PrintJob = {
  id: string
  type?: string
  payload: any
  port?: PrintPort | null
  status: string
  attempts: number
  createdAt: string
}

type VersionCheckResult = {
  latestVersion: string
  currentVersion?: string
  updateAvailable?: boolean
  downloadPageUrl?: string
  installerUrl?: string
  releaseNotes?: string
  minSupportedVersion?: string | null
}

type ToastState = {
  tone: 'success' | 'warning' | 'danger' | 'info'
  title: string
  text?: string
  actionLabel?: string
  action?: () => void
}

function normalizeApiBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}

function getStoredAuthToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('ordr-terminal-auth-token')
}

function setStoredAuthToken(token: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem('ordr-terminal-auth-token', token)
}

function clearStoredAuthToken() {
  if (typeof window === 'undefined') return
  localStorage.removeItem('ordr-terminal-auth-token')
}

async function getStoredDeviceId(companyId?: string | null) {
  if (!companyId || typeof window === 'undefined') return null

  const nativeDeviceId = await window.ordrTerminal?.getDeviceId?.(companyId)

  if (nativeDeviceId) {
    localStorage.setItem(`ordr-terminal-device-id:${companyId}`, nativeDeviceId)
    return nativeDeviceId
  }

  return localStorage.getItem(`ordr-terminal-device-id:${companyId}`)
}

async function setStoredDeviceId(companyId: string, deviceId: string) {
  if (typeof window === 'undefined') return

  await window.ordrTerminal?.setDeviceId?.({ companyId, deviceId })
  localStorage.setItem(`ordr-terminal-device-id:${companyId}`, deviceId)
}

function getPrinterLabel(printer: PrinterInfo) {
  return printer.displayName || printer.name
}

function getBindingsForTerminal(port: PrintPort, terminalDeviceId?: string | null) {
  return (port.bindings ?? []).filter((binding) => binding.terminalDeviceId === terminalDeviceId)
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatRelativeStatus(value?: string | null) {
  if (!value) return 'Sem leitura'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Sem leitura'

  const diff = Date.now() - date.getTime()
  const seconds = Math.max(0, Math.floor(diff / 1000))

  if (seconds < 10) return 'Agora'
  if (seconds < 60) return `${seconds}s atrás`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}min atrás`

  const hours = Math.floor(minutes / 60)
  return `${hours}h atrás`
}

function isFieldEnabled(template: any, field: string, fallback = true) {
  if (!template?.enabledFields) return fallback
  if (template.enabledFields[field] === undefined) return fallback
  return Boolean(template.enabledFields[field])
}

function formatJobDate(value?: string | null) {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.getTime()) ? new Date().toLocaleString('pt-BR') : date.toLocaleString('pt-BR')
}

function buildBuyListText(job: PrintJob) {
  const payload = job.payload ?? {}
  const template = payload.template ?? {}
  const lines: string[] = []
  lines.push(template.headerText?.trim() || '*** LISTA DE COMPRAS ***')

  if (isFieldEnabled(template, 'requestTitle') && payload.buyRequestTitle) {
    lines.push(String(payload.buyRequestTitle))
  }

  if (isFieldEnabled(template, 'requestId')) {
    lines.push(`REQ: ${payload.buyRequestId || job.id}`)
  }

  if (isFieldEnabled(template, 'supplierName') && payload.supplierName) {
    lines.push(`LOCAL: ${payload.supplierName}`)
  }

  if (isFieldEnabled(template, 'eventName') && payload.eventName) {
    lines.push(`EVENTO: ${payload.eventName}`)
  }

  if (isFieldEnabled(template, 'date')) {
    lines.push(`DATA: ${formatJobDate(payload.createdAt)}`)
  }

  if (isFieldEnabled(template, 'notes') && payload.notes) {
    lines.push('OBS REQUISICAO:')
    lines.push(String(payload.notes))
  }

  lines.push('------------------------------')

  let currentCategory = ''

  for (const item of payload.items ?? []) {
    const categoryName = item.categoryName || 'Sem categoria'

    if (isFieldEnabled(template, 'categories') && categoryName !== currentCategory) {
      currentCategory = categoryName
      lines.push(categoryName.toUpperCase())
    }

    const box = isFieldEnabled(template, 'checklistBoxes') ? '[ ] ' : ''
    const quantity = item.quantityLabel || item.quantity || ''
    lines.push(`${box}${quantity} ${item.name}`.trim())

    if (isFieldEnabled(template, 'itemNotes') && item.notes) {
      lines.push(`  Obs: ${item.notes}`)
    }
  }

  lines.push('------------------------------')

  if (template.footerText?.trim()) {
    lines.push(template.footerText.trim())
  }

  lines.push('', '', '')
  return lines.join('\n')
}

function buildOrderTicketText(job: PrintJob, ticket?: any) {
  const payload = job.payload ?? {}
  const template = payload.template ?? {}
  const ticketItems = Array.isArray(ticket?.items)
    ? ticket.items
    : Array.isArray(payload.items)
      ? payload.items
      : []
  const lines: string[] = []
  lines.push(template.headerText?.trim() || '*** ORDR ***')

  if (isFieldEnabled(template, 'portName')) {
    lines.push(payload.port?.name || job.port?.name || 'TICKET')
  }

  if (isFieldEnabled(template, 'orderId')) {
    lines.push(`Pedido: ${payload.orderId || job.id}`)
  }

  if (isFieldEnabled(template, 'comanda') && payload.comanda) lines.push(`Comanda: ${payload.comanda}`)
  if (isFieldEnabled(template, 'comandaName') && payload.comandaName) lines.push(`Nome: ${payload.comandaName}`)

  lines.push('------------------------------')

  if (isFieldEnabled(template, 'items')) {
    for (const item of ticketItems) {
      lines.push(`${item.quantity}x ${item.name}`)

      if (isFieldEnabled(template, 'variations')) {
        for (const variation of item.variations ?? []) {
          lines.push(`  - ${variation}`)
        }
      }

      if (isFieldEnabled(template, 'notes') && item.notes) {
        lines.push(`  Obs: ${item.notes}`)
      }
    }
  }

  if (isFieldEnabled(template, 'observation') && payload.observation) {
    lines.push('------------------------------')
    lines.push(`Obs: ${payload.observation}`)
  }

  lines.push('------------------------------')

  if (isFieldEnabled(template, 'date')) {
    lines.push(formatJobDate(payload.createdAt))
  }

  if (template.footerText?.trim()) {
    lines.push(template.footerText.trim())
  }

  lines.push('', '', '')
  return lines.join('\n')
}


function formatCurrencyValue(value?: number | string | null) {
  const number = Number(value ?? 0)
  return `R$ ${number.toFixed(2).replace('.', ',')}`
}

function buildReceiptText(job: PrintJob) {
  const payload = job.payload ?? {}
  const lines: string[] = []

  lines.push('*** ORDR ***')
  lines.push('RECIBO DO CAIXA')
  lines.push('------------------------------')
  lines.push(`Pedido: ${payload.orderId || job.id}`)
  if (payload.comanda) lines.push(`Comanda: ${payload.comanda}`)
  if (payload.comandaName) lines.push(`Nome: ${payload.comandaName}`)
  if (payload.paymentMethodLabel) lines.push(`Pagamento: ${payload.paymentMethodLabel}`)

  const dateValue = payload.paidAt || payload.createdAt
  lines.push(`Data: ${formatJobDate(dateValue)}`)
  lines.push('------------------------------')

  for (const item of payload.items ?? []) {
    lines.push(`${item.quantity}x ${item.name}`)

    for (const variation of item.variations ?? []) {
      lines.push(`  - ${variation}`)
    }

    if (item.notes) {
      lines.push(`  Obs: ${item.notes}`)
    }

    lines.push(`  ${formatCurrencyValue(item.totalPrice)}`)
  }

  lines.push('------------------------------')
  lines.push(`Subtotal: ${formatCurrencyValue(payload.subtotal)}`)

  if (payload.taxApplied) {
    lines.push(`Taxa 10%: ${formatCurrencyValue(payload.taxAmount)}`)
  }

  lines.push(`TOTAL: ${formatCurrencyValue(payload.total)}`)
  lines.push('------------------------------')
  lines.push('Obrigado pela preferencia!')
  lines.push('', '', '')

  return lines.join('\n')
}

function buildTicketTexts(job: PrintJob) {
  if (job.payload?.kind === 'BUY_LIST' || job.type === 'BUY_LIST') {
    return [buildBuyListText(job)]
  }

  if (job.payload?.kind === 'RECEIPT') {
    return [buildReceiptText(job)]
  }

  const tickets = Array.isArray(job.payload?.tickets) ? job.payload.tickets : []

  if (tickets.length === 0) {
    return [buildOrderTicketText(job)]
  }

  return tickets.map((ticket: any) => buildOrderTicketText(job, ticket))
}

function buildTestPrintText(target: string) {
  return [
    '*** ORDR TERMINAL ***',
    'TESTE DE IMPRESSAO',
    '------------------------------',
    `Destino: ${target}`,
    `Data: ${new Date().toLocaleString('pt-BR')}`,
    '',
    'Se este papel saiu corretamente,',
    'a impressora esta vinculada.',
    '',
    '',
    '',
  ].join('\n')
}

function getJobSummary(job: PrintJob) {
  const payload = job.payload ?? {}
  const tickets = Array.isArray(payload.tickets) ? payload.tickets.length : 0

  if (tickets > 0) return `${tickets} ticket(s)`

  const count = Array.isArray(payload.items)
    ? payload.items.reduce((sum: number, item: any) => sum + Number(item.quantity ?? 0), 0)
    : 0

  return count > 0 ? `${count} item(ns)` : 'Ticket'
}

function getJobKind(job: PrintJob) {
  const kind = job.payload?.kind

  if (kind === 'BUY_LIST') return 'Lista de compras'
  if (kind === 'RECEIPT') return 'Recibo'
  if (kind === 'ORDER_TICKET') return 'Pedido'
  if (kind === 'TEST') return 'Teste'

  return kind || 'Ticket'
}

function getStatusLabel(status?: string) {
  const labels: Record<string, string> = {
    PENDING: 'Pendente',
    CLAIMED: 'Reservado',
    PRINTING: 'Imprimindo',
    PRINTED: 'Impresso',
    FAILED: 'Falhou',
    CANCELLED: 'Cancelado',
  }

  return labels[status || ''] ?? status ?? '—'
}

function compareVersions(a: string, b: string) {
  const aParts = a.split('.').map((part) => Number(part) || 0)
  const bParts = b.split('.').map((part) => Number(part) || 0)
  const length = Math.max(aParts.length, bParts.length)

  for (let index = 0; index < length; index += 1) {
    const left = aParts[index] ?? 0
    const right = bParts[index] ?? 0

    if (left > right) return 1
    if (left < right) return -1
  }

  return 0
}

async function apiFetch<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  const authToken = token ?? getStoredAuthToken()
  const url = `${normalizeApiBaseUrl(API_BASE_URL)}${path}`
  const method = init?.method || 'GET'

  let body: unknown = undefined

  if (typeof init?.body === 'string' && init.body.length > 0) {
    try {
      body = JSON.parse(init.body)
    } catch {
      body = init.body
    }
  }

  if (typeof window !== 'undefined' && window.ordrTerminal?.apiFetch) {
    return window.ordrTerminal.apiFetch<T>({
      url,
      method,
      body,
      token: authToken,
    })
  }

  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  })

  const text = await response.text()
  let data: any = null

  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`Resposta inválida da API: ${text.slice(0, 160)}`)
  }

  if (!response.ok) {
    throw new Error(data?.error || `Erro HTTP ${response.status}`)
  }

  return data as T
}

export default function TerminalPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null)
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [registeredDevice, setRegisteredDevice] = useState<RegisteredDevice | null>(null)
  const [ports, setPorts] = useState<PrintPort[]>([])
  const [jobs, setJobs] = useState<PrintJob[]>([])
  const [isElectron, setIsElectron] = useState(false)
  const [autoPrint, setAutoPrint] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [isRegistering, setIsRegistering] = useState(false)
  const [bindingPortId, setBindingPortId] = useState<string | null>(null)
  const [processingJobIds, setProcessingJobIds] = useState<string[]>([])
  const [lastPollAt, setLastPollAt] = useState<string | null>(null)
  const [lastUpdateCheckAt, setLastUpdateCheckAt] = useState<string | null>(null)
  const [persistedDeviceId, setPersistedDeviceId] = useState<string | null>(null)
  const [selectedPortId, setSelectedPortId] = useState<string | null>(null)
  const [printerSearch, setPrinterSearch] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [toast, setToast] = useState<ToastState | null>(null)

  const pollingRef = useRef(false)
  const bootedRef = useRef(false)

  const isJobProcessing = (jobId: string) => processingJobIds.includes(jobId)

  function setJobProcessing(jobId: string, processing: boolean) {
    setProcessingJobIds((current) => {
      if (processing) return current.includes(jobId) ? current : [...current, jobId]
      return current.filter((id) => id !== jobId)
    })
  }

  const currentCompany = user?.currentCompany ?? user?.companies?.find((company) => company.id === user.companyId) ?? null
  const canBeTerminal = Boolean(isElectron && currentCompany?.systemRole === 'ADMIN')
  const boundPorts = ports.filter((port) => getBindingsForTerminal(port, registeredDevice?.id).length > 0)
  const unboundPorts = ports.filter((port) => getBindingsForTerminal(port, registeredDevice?.id).length === 0)
  const selectedPort = ports.find((port) => port.id === selectedPortId) ?? boundPorts[0] ?? ports[0] ?? null
  const selectedPortBindings = selectedPort ? getBindingsForTerminal(selectedPort, registeredDevice?.id) : []
  const filteredPrinters = printers.filter((printer) => {
    const term = printerSearch.trim().toLowerCase()
    if (!term) return true

    return (
      printer.name.toLowerCase().includes(term) ||
      (printer.displayName ?? '').toLowerCase().includes(term) ||
      (printer.description ?? '').toLowerCase().includes(term)
    )
  })

  const terminalStatus = useMemo(() => {
    if (!isElectron) {
      return {
        label: 'Fora do Electron',
        tone: 'danger' as const,
        headline: 'Abra pelo aplicativo instalado',
        text: 'O navegador não acessa impressoras locais. Use o ORDR Terminal instalado neste computador.',
      }
    }

    if (!user) {
      return {
        label: 'Aguardando login',
        tone: 'warning' as const,
        headline: 'Conecte uma conta admin',
        text: 'Faça login com um usuário admin para registrar este computador como terminal local.',
      }
    }

    if (!currentCompany) {
      return {
        label: 'Sem empresa',
        tone: 'danger' as const,
        headline: 'Nenhuma empresa ativa',
        text: 'Selecione ou configure uma empresa antes de conectar o terminal.',
      }
    }

    if (currentCompany.systemRole !== 'ADMIN') {
      return {
        label: 'Admin necessário',
        tone: 'danger' as const,
        headline: 'Permissão insuficiente',
        text: 'Somente administradores podem registrar e operar o terminal de impressão.',
      }
    }

    if (!registeredDevice) {
      return {
        label: 'Registrar terminal',
        tone: 'warning' as const,
        headline: 'Pronto para registrar',
        text: 'Finalize a conexão para vincular ports e processar a fila de impressão.',
      }
    }

    if (!registeredDevice.printTerminalEnabled) {
      return {
        label: 'Sem permissão',
        tone: 'warning' as const,
        headline: 'Terminal registrado',
        text: 'O terminal está registrado, mas ainda não foi habilitado para impressão.',
      }
    }

    if (boundPorts.length === 0) {
      return {
        label: 'Online sem ports',
        tone: 'warning' as const,
        headline: 'Terminal online',
        text: 'Vincule pelo menos uma port a uma impressora para começar a imprimir.',
      }
    }

    return {
      label: 'Operando',
      tone: 'success' as const,
      headline: 'Terminal online e pronto',
      text: autoPrint ? 'Auto print ativo. Novos jobs serão impressos automaticamente.' : 'Auto print pausado. Use buscar agora para revisar a fila.',
    }
  }, [autoPrint, boundPorts.length, currentCompany, isElectron, registeredDevice, user])

  const shouldShowConnectionModal = Boolean(!isElectron || !user || !registeredDevice?.printTerminalEnabled)

  const healthScore = useMemo(() => {
    let score = 0

    if (isElectron) score += 20
    if (user) score += 20
    if (registeredDevice?.printTerminalEnabled) score += 25
    if (printers.length > 0) score += 15
    if (boundPorts.length > 0) score += 20

    return score
  }, [boundPorts.length, isElectron, printers.length, registeredDevice?.printTerminalEnabled, user])

  async function saveTerminalSession(token: string, nextUser: AuthUser) {
    setStoredAuthToken(token)

    await window.ordrTerminal?.saveSession?.({
      token,
      user: nextUser,
      savedAt: new Date().toISOString(),
    } satisfies TerminalSavedSession)
  }

  function notify(nextToast: ToastState) {
    setToast(nextToast)
  }

  function isPrinterSelectedForPort(port: PrintPort, printer: PrinterInfo) {
    return getBindingsForTerminal(port, registeredDevice?.id).some(
      (binding) => binding.localPrinterName === printer.name
    )
  }

  async function openExternal(url: string) {
    if (window.ordrTerminal?.openExternal) {
      await window.ordrTerminal.openExternal(url)
      return
    }

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function loadLocalTerminalInfo() {
    setError('')

    if (!window.ordrTerminal?.isElectron) {
      setIsElectron(false)
      setPrinters([])
      return
    }

    setIsElectron(true)

    const [info, localPrinters] = await Promise.all([
      window.ordrTerminal.getDeviceInfo(),
      window.ordrTerminal.getPrinters(),
    ])

    setDeviceInfo(info)
    setPrinters(localPrinters)
  }

  async function loadPorts() {
    const result = await apiFetch<{ ports: PrintPort[] }>('/printers/ports')
    setPorts(result.ports)

    if (!selectedPortId && result.ports[0]?.id) {
      setSelectedPortId(result.ports[0].id)
    }
  }

  async function checkForUpdates(manual = false) {
    try {
      const result = await apiFetch<VersionCheckResult>(
        `/versionCheck?terminalVersion=${encodeURIComponent(CURRENT_TERMINAL_VERSION)}`,
        undefined,
        null
      )

      const latestVersion = result.latestVersion || CURRENT_TERMINAL_VERSION
      const updateAvailable =
        Boolean(result.updateAvailable) ||
        compareVersions(latestVersion, CURRENT_TERMINAL_VERSION) > 0

      setLastUpdateCheckAt(new Date().toISOString())

      if (updateAvailable) {
        notify({
          tone: 'warning',
          title: `Atualização disponível · ${latestVersion}`,
          text: result.releaseNotes || 'Baixe o novo instalador para atualizar o ORDR Terminal.',
          actionLabel: 'Abrir downloads',
          action: () => openExternal(result.downloadPageUrl || DOWNLOAD_PAGE_URL),
        })
        return
      }

      if (manual) {
        notify({
          tone: 'success',
          title: 'Terminal atualizado',
          text: `Você já está na versão ${CURRENT_TERMINAL_VERSION}.`,
        })
      }
    } catch (err) {
      if (manual) {
        notify({
          tone: 'danger',
          title: 'Falha ao checar update',
          text: err instanceof Error ? err.message : 'Não foi possível consultar a versão.',
        })
      }
    }
  }

  async function loginWithLaunchToken(launchToken: string) {
    if (user && registeredDevice?.printTerminalEnabled) {
      notify({
        tone: 'info',
        title: 'Terminal já conectado',
        text: 'A janela foi restaurada e a sessão atual foi mantida.',
      })
      return
    }

    try {
      setIsLoading(true)
      setError('')
      setSuccess('')

      const result = await apiFetch<LoginResult>('/auth/terminal-login', {
        method: 'POST',
        body: JSON.stringify({ launchToken }),
      }, null)

      await saveTerminalSession(result.token, result.user)
      setUser(result.user)
      setRegisteredDevice(null)
      setPorts([])
      setJobs([])
      notify({
        tone: 'success',
        title: 'Terminal conectado',
        text: `Sessão iniciada como ${result.user.name || result.user.username}.`,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao conectar automaticamente.')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    try {
      setIsLoading(true)
      setError('')
      setSuccess('')

      const loginResult = await apiFetch<LoginResult>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }, null)

      await saveTerminalSession(loginResult.token, loginResult.user)
      setUser(loginResult.user)
      setPassword('')
      notify({
        tone: 'success',
        title: 'Login realizado',
        text: `Conectado como ${loginResult.user.name || loginResult.user.username}.`,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login.')
    } finally {
      setIsLoading(false)
    }
  }

  async function disconnectTerminalDevice() {
    const deviceId = registeredDevice?.id

    if (!deviceId) return

    await apiFetch('/devices/terminal-disconnect', {
      method: 'POST',
      body: JSON.stringify({ deviceId }),
    })
  }

  async function clearTerminalSessionLocally() {
    await window.ordrTerminal?.clearSession?.()
    clearStoredAuthToken()
  }

  async function handleLogout() {
    const confirmed = window.confirm('Sair da conta e desligar este terminal? Ele deixará de imprimir até ser aberto novamente.')
    if (!confirmed) return

    try {
      setError('')
      setSuccess('')

      await disconnectTerminalDevice().catch(() => null)
      await clearTerminalSessionLocally()

      setUser(null)
      setRegisteredDevice(null)
      setPorts([])
      setJobs([])
      setUsername('')
      setPassword('')

      await window.ordrTerminal?.shutdown?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao sair da conta.')
    }
  }

  async function handleShutdown() {
    const confirmed = window.confirm('Desligar o ORDR Terminal? Ele deixará de imprimir até ser aberto novamente.')
    if (!confirmed) return

    try {
      setError('')
      await disconnectTerminalDevice().catch(() => null)
      await window.ordrTerminal?.shutdown?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao desligar terminal.')
    }
  }

  async function handleSwitchCompany(companyId: string) {
    try {
      setIsLoading(true)
      setError('')
      setSuccess('')

      const result = await apiFetch<LoginResult>('/auth/switch-company', {
        method: 'POST',
        body: JSON.stringify({ companyId }),
      })

      await saveTerminalSession(result.token, result.user)
      setUser(result.user)
      setRegisteredDevice(null)
      setPorts([])
      setJobs([])
      notify({ tone: 'success', title: 'Empresa alterada', text: result.user.currentCompany?.name ?? 'Empresa ativa atualizada.' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao trocar empresa.')
    } finally {
      setIsLoading(false)
    }
  }

  async function registerAsPrintTerminal() {
    if (!currentCompany || !deviceInfo) return

    try {
      setIsRegistering(true)
      setError('')

      const storedDeviceId = await getStoredDeviceId(currentCompany.id)

      const result = await apiFetch<{ device: RegisteredDevice }>('/devices/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
          deviceId: storedDeviceId,
          name: `Terminal · ${deviceInfo.hostname}`,
          type: 'DESKTOP',
          browser: 'Electron',
          os: `${deviceInfo.platform} ${deviceInfo.release}`,
          userAgent: `ORDR Terminal Electron · ${deviceInfo.platform} · ${deviceInfo.arch}`,
          clientType: 'ELECTRON',
          isPrintTerminal: true,
          printTerminalEnabled: true,
          localPrinters: printers,
        }),
      })

      await setStoredDeviceId(currentCompany.id, result.device.id)
      setPersistedDeviceId(result.device.id)
      setRegisteredDevice(result.device)
      await loadPorts()
      notify({
        tone: 'success',
        title: 'Terminal registrado',
        text: `${deviceInfo.hostname} está online para impressão.`,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao registrar terminal.')
    } finally {
      setIsRegistering(false)
    }
  }

  async function savePortPrinters(port: PrintPort, printerNames: string[]) {
    if (!registeredDevice?.id) {
      setError('Registre este computador como terminal antes de vincular ports.')
      return
    }

    try {
      setBindingPortId(port.id)
      setError('')
      setSuccess('')

      const selectedPrinters = printers
        .filter((printer) => printerNames.includes(printer.name))
        .map((printer) => ({
          localPrinterName: printer.name,
          localPrinterLabel: getPrinterLabel(printer),
        }))

      await apiFetch<{ port: PrintPort }>(`/printers/ports/${port.id}/bindings`, {
        method: 'PATCH',
        body: JSON.stringify({
          terminalDeviceId: registeredDevice.id,
          printers: selectedPrinters,
        }),
      })

      await loadPorts()
      notify({
        tone: selectedPrinters.length > 0 ? 'success' : 'info',
        title: selectedPrinters.length > 0 ? 'Port atualizada' : 'Vínculos removidos',
        text:
          selectedPrinters.length > 0
            ? `${port.name} vinculada a ${selectedPrinters.length} impressora(s).`
            : `A port ${port.name} ficou sem impressoras.`,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao vincular impressoras.')
    } finally {
      setBindingPortId(null)
    }
  }

  async function togglePrinterForPort(port: PrintPort, printer: PrinterInfo) {
    const currentBindings = getBindingsForTerminal(port, registeredDevice?.id)
    const currentNames = currentBindings.map((binding) => binding.localPrinterName)

    const nextNames = currentNames.includes(printer.name)
      ? currentNames.filter((name) => name !== printer.name)
      : [...currentNames, printer.name]

    await savePortPrinters(port, nextNames)
  }

  async function testPrintPrinter(printer: PrinterInfo) {
    try {
      setError('')

      const text = buildTestPrintText(getPrinterLabel(printer))

      if (window.ordrTerminal?.printRawText) {
        await window.ordrTerminal.printRawText({
          printerName: printer.name,
          text,
          cut: true,
        })
      } else {
        await window.ordrTerminal!.printText({
          printerName: printer.name,
          text,
        })
      }

      notify({
        tone: 'success',
        title: 'Teste enviado',
        text: getPrinterLabel(printer),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro no teste de impressão.')
    }
  }

  async function testPrintPort(port: PrintPort) {
    const bindings = getBindingsForTerminal(port, registeredDevice?.id)

    if (bindings.length === 0) {
      setError(`A port ${port.name} não tem impressoras vinculadas neste terminal.`)
      return
    }

    try {
      setError('')

      for (const binding of bindings) {
        const text = buildTestPrintText(`${port.name} · ${binding.localPrinterLabel || binding.localPrinterName}`)

        if (window.ordrTerminal?.printRawText) {
          await window.ordrTerminal.printRawText({
            printerName: binding.localPrinterName,
            text,
            cut: true,
          })
        } else {
          await window.ordrTerminal!.printText({
            printerName: binding.localPrinterName,
            text,
          })
        }
      }

      notify({
        tone: 'success',
        title: 'Teste da port enviado',
        text: `${bindings.length} impressora(s) receberam o teste.`,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro no teste da port.')
    }
  }

  async function updateJobStatus(jobId: string, status: string, errorMessage?: string) {
    if (!registeredDevice?.id) {
      throw new Error('Terminal não registrado.')
    }

    await apiFetch(`/print-jobs/${jobId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        terminalDeviceId: registeredDevice.id,
        status,
        errorMessage,
      }),
    })

    if (status === 'PRINTED') {
      setJobs((current) => current.filter((job) => job.id !== jobId))
    }
  }

  async function claimJob(jobId: string) {
    if (!registeredDevice?.id) {
      throw new Error('Terminal não registrado.')
    }

    await apiFetch(`/print-jobs/${jobId}/claim`, {
      method: 'POST',
      body: JSON.stringify({
        terminalDeviceId: registeredDevice.id,
      }),
    })
  }

  async function removeJob(job: PrintJob) {
    if (!registeredDevice?.id) {
      setError('Terminal não registrado.')
      return
    }

    const confirmed = window.confirm('Remover este item da fila? Ele não será impresso.')
    if (!confirmed) return

    try {
      setJobProcessing(job.id, true)
      setError('')

      await apiFetch(`/print-jobs/${job.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ terminalDeviceId: registeredDevice.id }),
      })

      setJobs((current) => current.filter((currentJob) => currentJob.id !== job.id))
      notify({ tone: 'info', title: 'Job removido', text: `${getJobKind(job)} saiu da fila.` })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover job da fila.')
    } finally {
      setJobProcessing(job.id, false)
    }
  }

  async function printJob(job: PrintJob) {
    if (!registeredDevice?.id) {
      throw new Error('Terminal não registrado.')
    }

    const bindings = (job.port?.bindings ?? []).filter(
      (binding) => binding.terminalDeviceId === registeredDevice.id
    )

    if (bindings.length === 0) {
      throw new Error(
        `Port ${job.port?.name || 'sem nome'} não tem impressora vinculada neste terminal.`
      )
    }

    await updateJobStatus(job.id, 'PRINTING')

    const ticketTexts = buildTicketTexts(job)

    for (const binding of bindings) {
      for (const text of ticketTexts) {
        if (window.ordrTerminal?.printRawText) {
          await window.ordrTerminal.printRawText({
            printerName: binding.localPrinterName,
            text,
            cut: true,
          })
        } else {
          await window.ordrTerminal!.printText({
            printerName: binding.localPrinterName,
            text,
          })
        }
      }
    }

    await updateJobStatus(job.id, 'PRINTED')
  }

  async function manuallyPrintJob(job: PrintJob) {
    try {
      setJobProcessing(job.id, true)
      setError('')

      if (job.status === 'PENDING') {
        await claimJob(job.id)
      }

      await printJob(job)
      notify({ tone: 'success', title: 'Job impresso', text: `${getJobKind(job)} enviado e removido da fila.` })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao imprimir job.'
      setError(message)
      await updateJobStatus(job.id, 'FAILED', message).catch(() => null)
    } finally {
      setJobProcessing(job.id, false)
      await pollJobs().catch(() => null)
    }
  }

  async function pollJobs(options?: { manual?: boolean }) {
    if (!registeredDevice?.id || pollingRef.current) return

    try {
      pollingRef.current = true

      const result = await apiFetch<{ jobs: PrintJob[] }>(
        `/print-jobs/terminal/pending?terminalDeviceId=${encodeURIComponent(registeredDevice.id)}`
      )

      setJobs(result.jobs ?? [])
      setLastPollAt(new Date().toISOString())

      if (options?.manual) {
        notify({
          tone: 'info',
          title: 'Fila atualizada',
          text: `${result.jobs?.length ?? 0} job(s) pendente(s).`,
        })
      }

      if (!autoPrint) return

      for (const job of result.jobs ?? []) {
        try {
          if (job.status === 'PENDING') {
            await claimJob(job.id)
          }
          await printJob(job)
        } catch (err) {
          await updateJobStatus(job.id, 'FAILED', err instanceof Error ? err.message : 'Erro ao imprimir.').catch(() => null)
        }
      }
    } catch (err) {
      if (options?.manual) {
        setError(err instanceof Error ? err.message : 'Erro ao consultar fila de impressão.')
      } else {
        console.error('Erro ao consultar fila de impressão:', err)
      }
    } finally {
      pollingRef.current = false
    }
  }

  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true

    async function boot() {
      await loadLocalTerminalInfo()

      const savedSession = await window.ordrTerminal?.loadSession?.()

      if (savedSession?.token && savedSession?.user) {
        setStoredAuthToken(savedSession.token)
        setUser(savedSession.user)
        notify({
          tone: 'success',
          title: 'Sessão restaurada',
          text: savedSession.user.name || savedSession.user.username,
        })
        return
      }

      const fallbackToken = getStoredAuthToken()
      if (fallbackToken) {
        notify({
          tone: 'info',
          title: 'Token local encontrado',
          text: 'Abra pelo app principal para atualizar a sessão salva.',
        })
      }
    }

    boot().catch((err) => {
      setError(err instanceof Error ? err.message : 'Erro ao iniciar terminal.')
    })
  }, [])

  useEffect(() => {
    const unsubscribe = window.ordrTerminal?.onLaunchToken?.((launchToken: string) => {
      loginWithLaunchToken(launchToken)
    })

    return () => {
      unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, registeredDevice?.printTerminalEnabled])

  useEffect(() => {
    if (!user || !currentCompany || !isElectron) return

    registerAsPrintTerminal()
    const interval = window.setInterval(registerAsPrintTerminal, 30_000)

    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, currentCompany?.id, isElectron, printers.length])

  useEffect(() => {
    window.ordrTerminal?.setSessionActive?.(Boolean(user && registeredDevice?.printTerminalEnabled))
  }, [user, registeredDevice?.printTerminalEnabled])

  useEffect(() => {
    let isMounted = true

    async function loadPersistedDeviceId() {
      if (!currentCompany?.id) {
        setPersistedDeviceId(null)
        return
      }

      const deviceId = await getStoredDeviceId(currentCompany.id)

      if (isMounted) {
        setPersistedDeviceId(deviceId)
      }
    }

    loadPersistedDeviceId().catch(() => null)

    return () => {
      isMounted = false
    }
  }, [currentCompany?.id])

  useEffect(() => {
    if (!registeredDevice?.id) return

    pollJobs()
    const interval = window.setInterval(() => pollJobs(), 2500)

    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registeredDevice?.id, autoPrint])

  useEffect(() => {
    checkForUpdates(false)
    const interval = window.setInterval(() => checkForUpdates(false), 30 * 60 * 1000)

    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (ports.length > 0 && !selectedPortId) {
      setSelectedPortId(boundPorts[0]?.id ?? ports[0].id)
    }
  }, [boundPorts, ports, selectedPortId])

  return (
    <main className="terminal-v100-page">
      <div className="terminal-v100-orb orb-a" />
      <div className="terminal-v100-orb orb-b" />

      {shouldShowConnectionModal && (
        <ConnectionModal
          status={terminalStatus}
          error={error}
          success={success}
          isLoading={isLoading}
          isRegistering={isRegistering}
          username={username}
          password={password}
          user={user}
          currentCompany={currentCompany}
          canBeTerminal={canBeTerminal}
          companies={user?.companies ?? []}
          onUsernameChange={setUsername}
          onPasswordChange={setPassword}
          onLogin={handleLogin}
          onRegister={registerAsPrintTerminal}
          onLogout={handleLogout}
          onSwitchCompany={handleSwitchCompany}
        />
      )}

      {toast && (
        <div className={`terminal-toast toast-${toast.tone}`}>
          <div>
            <strong>{toast.title}</strong>
            {toast.text && <span>{toast.text}</span>}
          </div>

          <div className="toast-actions">
            {toast.action && toast.actionLabel && (
              <button type="button" onClick={toast.action}>
                {toast.actionLabel}
              </button>
            )}
            <button type="button" onClick={() => setToast(null)} aria-label="Fechar aviso">
              ×
            </button>
          </div>
        </div>
      )}

      <aside className="terminal-v100-sidebar">
        <div className="terminal-v100-brand">
          <div className="terminal-v100-logo">
            <img src="./terminal-icon.svg" alt="ORDR" />
          </div>
          <div>
            <span>ORDR</span>
            <strong>Terminal 1.0</strong>
          </div>
        </div>

        <StatusBeacon tone={terminalStatus.tone} label={terminalStatus.label} />

        <div className="terminal-health-card">
          <div className="health-ring" style={{ '--score': `${healthScore}%` } as any}>
            <span>{healthScore}</span>
          </div>
          <div>
            <strong>{terminalStatus.headline}</strong>
            <p>{terminalStatus.text}</p>
          </div>
        </div>

        <nav className="terminal-nav">
          <a href="#overview">Visão geral</a>
          <a href="#queue">Fila de impressão</a>
          <a href="#routing">Roteamento</a>
          <a href="#printers">Impressoras locais</a>
        </nav>

        <div className="terminal-sidebar-cards">
          <MiniInfo label="Empresa" value={currentCompany?.name ?? 'Não conectada'} />
          <MiniInfo label="Computador" value={deviceInfo?.hostname ?? '—'} />
          <MiniInfo label="API" value="api.panelordr.com.br" />
          <MiniInfo label="Última leitura" value={formatRelativeStatus(lastPollAt)} />
        </div>

        <div className="terminal-sidebar-actions">
          <button type="button" onClick={() => checkForUpdates(true)} className="terminal-ghost-button">
            Checar update
          </button>
          <button type="button" onClick={handleLogout} disabled={!user} className="terminal-ghost-button">
            Sair da conta
          </button>
          <button type="button" onClick={handleShutdown} disabled={!isElectron} className="terminal-danger-button">
            Desligar terminal
          </button>
        </div>
      </aside>

      <section className="terminal-v100-main">
        <header className="terminal-hero" id="overview">
          <div>
            <p className="terminal-kicker">Terminal local de impressão</p>
            <h1>Controle de impressão em tempo real.</h1>
            <p>
              Monitore fila, vincule ports, teste impressoras e mantenha o computador pronto para receber tickets do ORDR.
            </p>
          </div>

          <div className="terminal-hero-actions">
            <label className={`terminal-switch ${autoPrint ? 'enabled' : ''}`}>
              <input type="checkbox" checked={autoPrint} onChange={(event) => setAutoPrint(event.target.checked)} />
              <span />
              <strong>{autoPrint ? 'Auto print ativo' : 'Auto print pausado'}</strong>
            </label>

            <button type="button" className="terminal-primary-action" onClick={() => pollJobs({ manual: true })} disabled={!registeredDevice}>
              Atualizar fila
            </button>

            <button type="button" className="terminal-secondary-action" onClick={loadLocalTerminalInfo}>
              Recarregar local
            </button>
          </div>
        </header>

        {(error || success) && (
          <section className="terminal-message-strip">
            {error && <div className="terminal-message error">{error}</div>}
            {success && <div className="terminal-message success">{success}</div>}
          </section>
        )}

        <section className="terminal-metric-grid">
          <MetricCard label="Impressoras" value={printers.length} hint="detectadas neste PC" tone="blue" />
          <MetricCard label="Ports" value={ports.length} hint={`${boundPorts.length} vinculada(s)`} tone="violet" />
          <MetricCard label="Fila" value={jobs.length} hint={autoPrint ? 'processamento automático' : 'revisão manual'} tone="orange" />
          <MetricCard label="Status" value={registeredDevice?.printTerminalEnabled ? 'ON' : 'OFF'} hint={formatRelativeStatus(registeredDevice?.lastSeenAt)} tone="green" />
        </section>

        <section className="terminal-layout-grid">
          <section className="terminal-panel queue-panel" id="queue">
            <div className="panel-head">
              <div>
                <p className="terminal-kicker">Fila</p>
                <h2>Jobs pendentes</h2>
                <span>Última busca: {formatDateTime(lastPollAt)}</span>
              </div>

              <div className="queue-pulse is-live">
                <span />
                consulta contínua
              </div>
            </div>

            <div className="queue-list">
              {jobs.map((job) => {
                const processing = isJobProcessing(job.id)
                const manualActionsEnabled = !autoPrint && registeredDevice?.id

                return (
                  <article key={job.id} className="queue-card">
                    <div className="queue-icon">{getJobKind(job).slice(0, 1)}</div>
                    <div className="queue-main">
                      <strong>{job.port?.name || 'Sem port'}</strong>
                      <span>{getJobKind(job)} · {getJobSummary(job)}</span>
                      <small>{formatDateTime(job.createdAt)}</small>
                    </div>
                    <div className="queue-side">
                      <div className={`queue-status status-${job.status?.toLowerCase?.() ?? 'pending'}`}>
                        {processing ? 'Processando' : getStatusLabel(job.status)}
                      </div>

                      {!autoPrint && (
                        <div className="queue-actions">
                          <button
                            type="button"
                            className="queue-action print"
                            disabled={!manualActionsEnabled || processing}
                            onClick={() => manuallyPrintJob(job)}
                          >
                            Imprimir
                          </button>
                          <button
                            type="button"
                            className="queue-action remove"
                            disabled={!manualActionsEnabled || processing}
                            onClick={() => removeJob(job)}
                          >
                            Remover
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                )
              })}

              {jobs.length === 0 && (
                <EmptyState
                  title="Nenhum job pendente"
                  text={autoPrint ? 'A fila está limpa. Novos tickets serão impressos automaticamente.' : 'Auto print pausado. A fila continua sendo consultada para revisão.'}
                />
              )}
            </div>
          </section>

          <section className="terminal-panel device-panel">
            <div className="panel-head">
              <div>
                <p className="terminal-kicker">Sessão</p>
                <h2>Terminal conectado</h2>
              </div>
              <StatusBeacon tone={terminalStatus.tone} label={terminalStatus.label} compact />
            </div>

            <div className="device-map">
              <InfoTile label="Usuário" value={user ? user.name || user.username : 'Aguardando login'} />
              <InfoTile label="Empresa" value={currentCompany?.name ?? '—'} />
              <InfoTile label="Sistema" value={deviceInfo ? `${deviceInfo.platform} · ${deviceInfo.arch}` : '—'} />
              <InfoTile label="Device ID" value={registeredDevice?.id ?? persistedDeviceId ?? 'Ainda não registrado'} />
              <InfoTile label="Último sinal" value={formatDateTime(registeredDevice?.lastSeenAt)} />
              <InfoTile label="Update" value={lastUpdateCheckAt ? `checado ${formatRelativeStatus(lastUpdateCheckAt)}` : `v${CURRENT_TERMINAL_VERSION}`} />
            </div>

            {user?.companies && user.companies.length > 1 && (
              <label className="terminal-select-row">
                <span>Empresa ativa</span>
                <select value={currentCompany?.id ?? ''} onChange={(event) => handleSwitchCompany(event.target.value)}>
                  {user.companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}{company.isTest ? ' · teste' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>
        </section>

        <section className="terminal-panel routing-panel" id="routing">
          <div className="panel-head">
            <div>
              <p className="terminal-kicker">Roteamento</p>
              <h2>Ports e impressoras</h2>
              <span>Cada port pode enviar para uma ou mais impressoras locais deste computador.</span>
            </div>

            <button type="button" className="terminal-secondary-action" onClick={loadPorts}>
              Atualizar ports
            </button>
          </div>

          <div className="routing-shell">
            <div className="ports-column">
              <div className="routing-column-head">
                <strong>Ports</strong>
                <span>{boundPorts.length} vinculada(s) · {unboundPorts.length} livre(s)</span>
              </div>

              <div className="port-tabs">
                {ports.map((port) => {
                  const bindings = getBindingsForTerminal(port, registeredDevice?.id)
                  const active = selectedPort?.id === port.id

                  return (
                    <button
                      key={port.id}
                      type="button"
                      className={`port-tab ${active ? 'active' : ''}`}
                      onClick={() => setSelectedPortId(port.id)}
                    >
                      <span className="port-dot" />
                      <strong>{port.name}</strong>
                      <small>{bindings.length > 0 ? `${bindings.length} impressora(s)` : 'Sem vínculo'}</small>
                    </button>
                  )
                })}

                {ports.length === 0 && (
                  <EmptyState title="Sem ports" text="Crie as ports na tela Impressoras do app principal." compact />
                )}
              </div>
            </div>

            <div className="binding-column">
              {selectedPort ? (
                <>
                  <div className="selected-port-head">
                    <div>
                      <p>Port selecionada</p>
                      <h3>{selectedPort.name}</h3>
                      <span>{selectedPort.description || 'Sem descrição'}</span>
                    </div>

                    <div className="selected-port-actions">
                      <button
                        type="button"
                        className="terminal-secondary-action small"
                        disabled={selectedPortBindings.length === 0}
                        onClick={() => testPrintPort(selectedPort)}
                      >
                        Testar port
                      </button>

                      <button
                        type="button"
                        className="terminal-secondary-action small"
                        disabled={selectedPortBindings.length === 0 || bindingPortId === selectedPort.id}
                        onClick={() => savePortPrinters(selectedPort, [])}
                      >
                        Limpar
                      </button>
                    </div>
                  </div>

                  <div className="binding-summary">
                    {selectedPortBindings.length > 0 ? (
                      selectedPortBindings.map((binding) => (
                        <span key={binding.id}>
                          {binding.localPrinterLabel || binding.localPrinterName}
                        </span>
                      ))
                    ) : (
                      <span>Nenhuma impressora vinculada ainda</span>
                    )}
                  </div>

                  <div className="printer-search">
                    <input
                      value={printerSearch}
                      onChange={(event) => setPrinterSearch(event.target.value)}
                      placeholder="Buscar impressora local..."
                    />
                  </div>

                  <div className="printer-picker-grid">
                    {filteredPrinters.map((printer) => {
                      const selected = isPrinterSelectedForPort(selectedPort, printer)

                      return (
                        <button
                          key={printer.name}
                          type="button"
                          disabled={!registeredDevice?.id || bindingPortId === selectedPort.id}
                          className={`printer-pick-card ${selected ? 'selected' : ''}`}
                          onClick={() => togglePrinterForPort(selectedPort, printer)}
                        >
                          <span className="printer-pick-check">{selected ? '✓' : '+'}</span>
                          <span>
                            <strong>{getPrinterLabel(printer)}</strong>
                            <small>{printer.name}</small>
                            {printer.isDefault && <em>Padrão do Windows</em>}
                          </span>
                        </button>
                      )
                    })}

                    {filteredPrinters.length === 0 && (
                      <EmptyState title="Nenhuma impressora encontrada" text="Tente recarregar as impressoras locais." compact />
                    )}
                  </div>
                </>
              ) : (
                <EmptyState title="Selecione uma port" text="Escolha uma port para configurar as impressoras locais." />
              )}
            </div>
          </div>
        </section>

        <section className="terminal-panel printers-panel" id="printers">
          <div className="panel-head">
            <div>
              <p className="terminal-kicker">Hardware</p>
              <h2>Impressoras locais</h2>
              <span>Teste cada impressora diretamente antes de vincular às ports.</span>
            </div>
            <span className="panel-count">{printers.length}</span>
          </div>

          <div className="local-printer-grid">
            {printers.map((printer) => (
              <article key={printer.name} className="local-printer-card">
                <div className="printer-device-icon">▦</div>
                <div className="local-printer-main">
                  <strong>{getPrinterLabel(printer)}</strong>
                  <span>{printer.name}</span>
                  {printer.description && <small>{printer.description}</small>}
                </div>

                <div className="local-printer-actions">
                  {printer.isDefault && <span>Padrão</span>}
                  <button type="button" onClick={() => testPrintPrinter(printer)}>
                    Testar
                  </button>
                </div>
              </article>
            ))}

            {printers.length === 0 && (
              <EmptyState title="Nenhuma impressora local" text="Verifique o Windows, drivers e permissões do Terminal." />
            )}
          </div>
        </section>
      </section>
    </main>
  )
}

function ConnectionModal({
  status,
  error,
  success,
  isLoading,
  isRegistering,
  username,
  password,
  user,
  currentCompany,
  companies,
  canBeTerminal,
  onUsernameChange,
  onPasswordChange,
  onLogin,
  onRegister,
  onLogout,
  onSwitchCompany,
}: {
  status: { label: string; tone: 'success' | 'warning' | 'danger'; headline: string; text: string }
  error: string
  success: string
  isLoading: boolean
  isRegistering: boolean
  username: string
  password: string
  user: AuthUser | null
  currentCompany: AuthCompany | null
  companies: AuthCompany[]
  canBeTerminal: boolean
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onLogin: (event: FormEvent<HTMLFormElement>) => void
  onRegister: () => void
  onLogout: () => void
  onSwitchCompany: (companyId: string) => void
}) {
  return (
    <div className="terminal-modal-backdrop" role="dialog" aria-modal="true">
      <section className="terminal-connect-modal">
        <div className="modal-visual">
          <div className="modal-logo">
            <img src="./terminal-icon.svg" alt="ORDR" />
          </div>
          <StatusBeacon tone={status.tone} label={status.label} />
        </div>

        <div className="modal-copy">
          <p className="terminal-kicker">Conexão necessária</p>
          <h2>{status.headline}</h2>
          <p>{status.text}</p>
        </div>

        {error && <div className="terminal-message error">{error}</div>}
        {success && <div className="terminal-message success">{success}</div>}

        {!user ? (
          <form className="modal-form" onSubmit={onLogin}>
            <label>
              <span>API</span>
              <div className="readonly-field">{API_BASE_URL}</div>
            </label>

            <label>
              <span>Usuário</span>
              <input value={username} onChange={(event) => onUsernameChange(event.target.value)} autoComplete="username" />
            </label>

            <label>
              <span>Senha</span>
              <input
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                type="password"
                autoComplete="current-password"
              />
            </label>

            <button type="submit" disabled={isLoading}>
              {isLoading ? 'Conectando...' : 'Entrar e conectar'}
            </button>
          </form>
        ) : (
          <div className="modal-form">
            <InfoTile label="Usuário" value={user.name || user.username} />
            <InfoTile label="Empresa" value={currentCompany?.name ?? '—'} />
            <InfoTile label="Permissão" value={currentCompany?.systemRole === 'ADMIN' ? 'Admin total' : 'Custom'} />

            {companies.length > 1 && (
              <label>
                <span>Empresa</span>
                <select value={currentCompany?.id ?? ''} onChange={(event) => onSwitchCompany(event.target.value)}>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}{company.isTest ? ' · teste' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <button type="button" disabled={!canBeTerminal || isRegistering} onClick={onRegister}>
              {isRegistering ? 'Registrando...' : 'Finalizar conexão'}
            </button>

            <button type="button" className="modal-secondary" onClick={onLogout}>
              Sair da conta
            </button>
          </div>
        )}

        <p className="modal-footnote">
          O terminal só será liberado após autenticação, permissão de admin e registro deste computador.
        </p>
      </section>
    </div>
  )
}

function StatusBeacon({
  tone,
  label,
  compact = false,
}: {
  tone: 'success' | 'warning' | 'danger'
  label: string
  compact?: boolean
}) {
  return (
    <div className={`status-beacon beacon-${tone} ${compact ? 'compact' : ''}`}>
      <span />
      {label}
    </div>
  )
}

function MetricCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: number | string
  hint: string
  tone: 'blue' | 'violet' | 'orange' | 'green'
}) {
  return (
    <article className={`metric-v100 metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  )
}

function MiniInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="mini-info">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-tile">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  )
}

function EmptyState({
  title,
  text,
  compact = false,
}: {
  title: string
  text: string
  compact?: boolean
}) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      <div>∅</div>
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  )
}
