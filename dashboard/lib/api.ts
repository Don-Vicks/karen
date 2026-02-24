// ============================================
// Dashboard API Client
// ============================================
// Communicates with the Karen REST API server

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
const API_SECRET = process.env.NEXT_PUBLIC_API_SECRET || 'karen-dev-secret'

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_SECRET}`,
      ...options?.headers,
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(error.error || `API error: ${res.status}`)
  }

  return res.json()
}

// ========== Health ==========

export async function getHealth() {
  return apiFetch('/api/v1/health')
}

// ========== Wallets ==========

export async function getWallets() {
  const data = await apiFetch('/api/v1/wallets')
  return data.wallets || []
}

export async function getWalletBalance(walletId: string) {
  return apiFetch(`/api/v1/wallets/${walletId}/balance`)
}

export async function createWallet(name: string) {
  return apiFetch('/api/v1/wallets', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export async function airdropWallet(walletId: string, amount: number) {
  return apiFetch(`/api/v1/wallets/${walletId}/airdrop`, {
    method: 'POST',
    body: JSON.stringify({ amount }),
  })
}

export async function getWalletTransactions(walletId: string, limit = 20) {
  const data = await apiFetch(
    `/api/v1/wallets/${walletId}/transactions?limit=${limit}`,
  )
  return data.transactions || []
}

// ========== Agents ==========

export async function getAgents() {
  const data = await apiFetch('/api/v1/agents')
  return data.agents || []
}

export async function createAgent(options: {
  name: string
  strategy: string
  llmProvider?: string
  llmModel?: string
}) {
  return apiFetch('/api/v1/agents', {
    method: 'POST',
    body: JSON.stringify(options),
  })
}

export async function startAgent(agentId: string) {
  return apiFetch(`/api/v1/agents/${agentId}/start`, { method: 'POST' })
}

export async function stopAgent(agentId: string) {
  return apiFetch(`/api/v1/agents/${agentId}/stop`, { method: 'POST' })
}

export async function chatWithAgent(agentId: string, message: string) {
  const data = await apiFetch(`/api/v1/agents/${agentId}/chat`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
  return data.response
}

// ========== Transactions ==========

export async function getTransactions(limit = 50) {
  const data = await apiFetch(`/api/v1/transactions?limit=${limit}`)
  return data.transactions || []
}

// ========== API Keys ==========

export async function getApiKeys() {
  const data = await apiFetch('/api/v1/keys')
  return data.keys || []
}

export async function createApiKey(name: string) {
  return apiFetch('/api/v1/keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}
