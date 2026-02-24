import fs from 'fs'
import path from 'path'
import { AgentDecision, KarenEvent, TransactionRecord } from './types'

// ============================================
// Audit Logger
// ============================================
// Logs all transactions, decisions, and events to disk

const LOG_DIR = path.resolve(process.cwd(), 'data', 'logs')

export class AuditLogger {
  private logDir: string
  private listeners: ((event: KarenEvent) => void)[] = []

  constructor(logDir?: string) {
    this.logDir = logDir || LOG_DIR
    this.ensureDir()
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true })
    }
  }

  /**
   * Log a transaction
   */
  logTransaction(record: TransactionRecord): void {
    const file = path.join(this.logDir, 'transactions.jsonl')
    fs.appendFileSync(file, JSON.stringify(record) + '\n')
  }

  /**
   * Log an agent decision
   */
  logDecision(decision: AgentDecision): void {
    const file = path.join(this.logDir, `agent-${decision.agentId}.jsonl`)
    fs.appendFileSync(file, JSON.stringify(decision) + '\n')
  }

  /**
   * Log a generic event
   */
  logEvent(event: KarenEvent): void {
    const file = path.join(this.logDir, 'events.jsonl')
    const entry = { ...event, timestamp: new Date().toISOString() }
    fs.appendFileSync(file, JSON.stringify(entry) + '\n')

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Don't let listener errors crash the logger
      }
    }
  }

  /**
   * Subscribe to events
   */
  onEvent(listener: (event: KarenEvent) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  /**
   * Read transaction history
   */
  getTransactions(walletId?: string, limit: number = 50): TransactionRecord[] {
    const file = path.join(this.logDir, 'transactions.jsonl')
    if (!fs.existsSync(file)) return []

    const lines = fs
      .readFileSync(file, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
    let records: TransactionRecord[] = lines.map((l) => JSON.parse(l))

    if (walletId) {
      records = records.filter((r) => r.walletId === walletId)
    }

    return records.slice(-limit).reverse()
  }

  /**
   * Read agent decisions
   */
  getDecisions(agentId: string, limit: number = 50): AgentDecision[] {
    const file = path.join(this.logDir, `agent-${agentId}.jsonl`)
    if (!fs.existsSync(file)) return []

    const lines = fs
      .readFileSync(file, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
    const decisions: AgentDecision[] = lines.map((l) => JSON.parse(l))

    return decisions.slice(-limit).reverse()
  }
}
