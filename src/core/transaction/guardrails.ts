import { AuditLogger } from '../audit-logger'
import { DEFAULT_GUARDRAIL_CONFIG, GuardrailConfig } from '../types'

// ============================================
// Transaction Guardrails
// ============================================
// Security layer: spending limits, rate limiting, program allowlists

interface TransactionWindow {
  timestamps: number[]
  dailySpend: number
  lastDayReset: number
}

export class Guardrails {
  private config: GuardrailConfig
  private windows: Map<string, TransactionWindow> = new Map()
  private logger: AuditLogger

  constructor(config?: Partial<GuardrailConfig>, logger?: AuditLogger) {
    this.config = { ...DEFAULT_GUARDRAIL_CONFIG, ...config }
    this.logger = logger || new AuditLogger()
  }

  /**
   * Validate a transaction against all guardrails.
   * Returns { allowed: true } or { allowed: false, reason: string }
   */
  validate(
    walletId: string,
    amountSol: number,
    programIds: string[] = [],
    destinationAddress?: string,
  ): { allowed: boolean; reason?: string; guardrails: string[] } {
    const applied: string[] = []

    // 1. Spending limit per transaction
    applied.push('max_per_tx')
    if (amountSol > this.config.maxSolPerTransaction) {
      return {
        allowed: false,
        reason: `Amount ${amountSol} SOL exceeds per-transaction limit of ${this.config.maxSolPerTransaction} SOL`,
        guardrails: applied,
      }
    }

    // 2. Rate limiting
    applied.push('rate_limit')
    const window = this.getWindow(walletId)
    const now = Date.now()
    const recentTxCount = window.timestamps.filter(
      (t) => now - t < 60_000,
    ).length

    if (recentTxCount >= this.config.maxTransactionsPerMinute) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${recentTxCount}/${this.config.maxTransactionsPerMinute} transactions per minute`,
        guardrails: applied,
      }
    }

    // 3. Daily spending limit
    applied.push('daily_limit')
    this.resetDailyIfNeeded(window)
    if (window.dailySpend + amountSol > this.config.dailySpendingLimitSol) {
      return {
        allowed: false,
        reason: `Daily spending limit exceeded: ${window.dailySpend.toFixed(4)} + ${amountSol} > ${this.config.dailySpendingLimitSol} SOL`,
        guardrails: applied,
      }
    }

    // 4. Program allowlist
    if (this.config.allowedPrograms.length > 0 && programIds.length > 0) {
      applied.push('program_allowlist')
      const disallowed = programIds.filter(
        (p) => !this.config.allowedPrograms.includes(p),
      )
      if (disallowed.length > 0) {
        return {
          allowed: false,
          reason: `Programs not in allowlist: ${disallowed.join(', ')}`,
          guardrails: applied,
        }
      }
    }

    // 5. Blocked addresses
    if (
      destinationAddress &&
      this.config.blockedAddresses.includes(destinationAddress)
    ) {
      applied.push('blocked_address')
      return {
        allowed: false,
        reason: `Destination address is blocked: ${destinationAddress}`,
        guardrails: applied,
      }
    }

    return { allowed: true, guardrails: applied }
  }

  /**
   * Record that a transaction was sent (for rate limiting and daily totals)
   */
  recordTransaction(walletId: string, amountSol: number): void {
    const window = this.getWindow(walletId)
    window.timestamps.push(Date.now())
    window.dailySpend += amountSol

    // Trim old timestamps (keep last 5 minutes)
    const cutoff = Date.now() - 300_000
    window.timestamps = window.timestamps.filter((t) => t > cutoff)
  }

  /**
   * Get current guardrail config
   */
  getConfig(): GuardrailConfig {
    return { ...this.config }
  }

  /**
   * Update guardrail config
   */
  updateConfig(updates: Partial<GuardrailConfig>): void {
    this.config = { ...this.config, ...updates }
  }

  /**
   * Get spending info for a wallet
   */
  getSpendingInfo(walletId: string): {
    recentTxCount: number
    dailySpend: number
    dailyRemaining: number
    perTxLimit: number
  } {
    const window = this.getWindow(walletId)
    this.resetDailyIfNeeded(window)
    const now = Date.now()
    const recentTxCount = window.timestamps.filter(
      (t) => now - t < 60_000,
    ).length

    return {
      recentTxCount,
      dailySpend: window.dailySpend,
      dailyRemaining: Math.max(
        0,
        this.config.dailySpendingLimitSol - window.dailySpend,
      ),
      perTxLimit: this.config.maxSolPerTransaction,
    }
  }

  private getWindow(walletId: string): TransactionWindow {
    if (!this.windows.has(walletId)) {
      this.windows.set(walletId, {
        timestamps: [],
        dailySpend: 0,
        lastDayReset: Date.now(),
      })
    }
    return this.windows.get(walletId)!
  }

  private resetDailyIfNeeded(window: TransactionWindow): void {
    const now = Date.now()
    const dayMs = 86_400_000
    if (now - window.lastDayReset > dayMs) {
      window.dailySpend = 0
      window.lastDayReset = now
    }
  }
}
