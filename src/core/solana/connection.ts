import { clusterApiUrl, Connection } from '@solana/web3.js'
import dotenv from 'dotenv'

dotenv.config()

// ============================================
// Solana Connection Manager
// ============================================

export class SolanaConnection {
  private static instance: SolanaConnection
  private connection: Connection
  private network: string

  private constructor() {
    this.network = process.env.SOLANA_NETWORK || 'devnet'
    const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet')
    this.connection = new Connection(rpcUrl, 'confirmed')
  }

  static getInstance(): SolanaConnection {
    if (!SolanaConnection.instance) {
      SolanaConnection.instance = new SolanaConnection()
    }
    return SolanaConnection.instance
  }

  getConnection(): Connection {
    return this.connection
  }

  getNetwork(): string {
    return this.network
  }

  isDevnet(): boolean {
    return this.network === 'devnet'
  }

  async getSlot(): Promise<number> {
    return this.connection.getSlot()
  }

  async getHealth(): Promise<{
    healthy: boolean
    slot: number
    network: string
  }> {
    try {
      const slot = await this.connection.getSlot()
      return { healthy: true, slot, network: this.network }
    } catch {
      return { healthy: false, slot: 0, network: this.network }
    }
  }
}

export function getConnection(): Connection {
  return SolanaConnection.getInstance().getConnection()
}

export function getNetwork(): string {
  return SolanaConnection.getInstance().getNetwork()
}
