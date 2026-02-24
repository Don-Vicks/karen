import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  TokenAccountNotFoundError,
} from '@solana/spl-token'
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'
import { v4 as uuidv4 } from 'uuid'
import { AuditLogger } from '../audit-logger'
import { getConnection } from '../solana/connection'
import {
  TransactionDetails,
  TransactionRecord,
  TransactionType,
} from '../types'
import { WalletManager } from '../wallet/wallet-manager'
import { Guardrails } from './guardrails'

// ============================================
// Transaction Engine
// ============================================
// Builds, validates, signs, and sends transactions automatically

export class TransactionEngine {
  private walletManager: WalletManager
  private guardrails: Guardrails
  private logger: AuditLogger

  constructor(
    walletManager: WalletManager,
    guardrails: Guardrails,
    logger: AuditLogger,
  ) {
    this.walletManager = walletManager
    this.guardrails = guardrails
    this.logger = logger
  }

  // ========== SOL Transfers ==========

  /**
   * Send SOL from one wallet to another address
   */
  async transferSol(
    walletId: string,
    toAddress: string,
    amountSol: number,
    agentId?: string,
  ): Promise<TransactionRecord> {
    const record = this.createRecord(walletId, 'transfer', agentId, {
      to: toAddress,
      amount: amountSol,
      token: 'SOL',
    })

    try {
      // Validate with guardrails
      const validation = this.guardrails.validate(
        walletId,
        amountSol,
        [SystemProgram.programId.toBase58()],
        toAddress,
      )
      record.guardrailsApplied = validation.guardrails

      if (!validation.allowed) {
        record.status = 'blocked'
        record.error = validation.reason
        this.logger.logTransaction(record)
        this.logger.logEvent({ type: 'transaction:blocked', data: record })
        return record
      }

      // Build transaction
      const keypair = await this.walletManager.getKeypair(walletId)
      const connection = getConnection()
      const toPubkey = new PublicKey(toAddress)

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey,
          lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
        }),
      )

      // Sign and send
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [keypair],
      )

      // Record success
      record.status = 'confirmed'
      record.signature = signature
      this.guardrails.recordTransaction(walletId, amountSol)

      this.logger.logTransaction(record)
      this.logger.logEvent({ type: 'transaction:confirmed', data: record })

      return record
    } catch (error: any) {
      record.status = 'failed'
      record.error = error.message || String(error)
      this.logger.logTransaction(record)
      this.logger.logEvent({ type: 'transaction:failed', data: record })
      return record
    }
  }

  // ========== SPL Token Transfers ==========

  /**
   * Send SPL tokens from one wallet to another address
   */
  async transferToken(
    walletId: string,
    toAddress: string,
    mintAddress: string,
    amount: number,
    decimals: number,
    agentId?: string,
  ): Promise<TransactionRecord> {
    const record = this.createRecord(walletId, 'token_transfer', agentId, {
      to: toAddress,
      amount,
      token: mintAddress,
    })

    try {
      const validation = this.guardrails.validate(
        walletId,
        0, // Token transfers don't directly spend SOL (just fees)
        [
          'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
        ],
        toAddress,
      )
      record.guardrailsApplied = validation.guardrails

      if (!validation.allowed) {
        record.status = 'blocked'
        record.error = validation.reason
        this.logger.logTransaction(record)
        this.logger.logEvent({ type: 'transaction:blocked', data: record })
        return record
      }

      const keypair = await this.walletManager.getKeypair(walletId)
      const connection = getConnection()
      const mint = new PublicKey(mintAddress)
      const toPubkey = new PublicKey(toAddress)

      // Get or create associated token accounts
      const fromATA = await getAssociatedTokenAddress(mint, keypair.publicKey)
      const toATA = await getAssociatedTokenAddress(mint, toPubkey)

      const transaction = new Transaction()

      // Check if destination ATA exists, create if not
      try {
        await getAccount(connection, toATA)
      } catch (error) {
        if (error instanceof TokenAccountNotFoundError) {
          transaction.add(
            createAssociatedTokenAccountInstruction(
              keypair.publicKey,
              toATA,
              toPubkey,
              mint,
            ),
          )
        } else {
          throw error
        }
      }

      // Add transfer instruction
      const rawAmount = BigInt(Math.round(amount * Math.pow(10, decimals)))
      transaction.add(
        createTransferInstruction(fromATA, toATA, keypair.publicKey, rawAmount),
      )

      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [keypair],
      )

      record.status = 'confirmed'
      record.signature = signature
      this.guardrails.recordTransaction(walletId, 0)

      this.logger.logTransaction(record)
      this.logger.logEvent({ type: 'transaction:confirmed', data: record })
      return record
    } catch (error: any) {
      record.status = 'failed'
      record.error = error.message || String(error)
      this.logger.logTransaction(record)
      this.logger.logEvent({ type: 'transaction:failed', data: record })
      return record
    }
  }

  // ========== Arbitrary Transaction ==========

  /**
   * Sign and send a pre-built transaction (used by protocol adapters)
   */
  async signAndSend(
    walletId: string,
    transaction: Transaction,
    amountSol: number,
    type: TransactionType,
    details: TransactionDetails,
    agentId?: string,
    programIds: string[] = [],
  ): Promise<TransactionRecord> {
    const record = this.createRecord(walletId, type, agentId, details)

    try {
      const validation = this.guardrails.validate(
        walletId,
        amountSol,
        programIds,
      )
      record.guardrailsApplied = validation.guardrails

      if (!validation.allowed) {
        record.status = 'blocked'
        record.error = validation.reason
        this.logger.logTransaction(record)
        this.logger.logEvent({ type: 'transaction:blocked', data: record })
        return record
      }

      const keypair = await this.walletManager.getKeypair(walletId)
      const connection = getConnection()

      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [keypair],
      )

      record.status = 'confirmed'
      record.signature = signature
      this.guardrails.recordTransaction(walletId, amountSol)

      this.logger.logTransaction(record)
      this.logger.logEvent({ type: 'transaction:confirmed', data: record })
      return record
    } catch (error: any) {
      record.status = 'failed'
      record.error = error.message || String(error)
      this.logger.logTransaction(record)
      this.logger.logEvent({ type: 'transaction:failed', data: record })
      return record
    }
  }

  // ========== Airdrop (Devnet) ==========

  /**
   * Request a devnet airdrop
   */
  async airdrop(
    walletId: string,
    amountSol: number = 1,
    agentId?: string,
  ): Promise<TransactionRecord> {
    const record = this.createRecord(walletId, 'airdrop', agentId, {
      amount: amountSol,
    })

    try {
      const signature = await this.walletManager.requestAirdrop(
        walletId,
        amountSol,
      )

      record.status = 'confirmed'
      record.signature = signature

      this.logger.logTransaction(record)
      this.logger.logEvent({ type: 'transaction:confirmed', data: record })
      return record
    } catch (error: any) {
      record.status = 'failed'
      record.error = error.message || String(error)
      this.logger.logTransaction(record)
      this.logger.logEvent({ type: 'transaction:failed', data: record })
      return record
    }
  }

  // ========== Transaction History ==========

  getTransactionHistory(
    walletId?: string,
    limit?: number,
  ): TransactionRecord[] {
    return this.logger.getTransactions(walletId, limit)
  }

  // ========== Helpers ==========

  private createRecord(
    walletId: string,
    type: TransactionType,
    agentId?: string,
    details: TransactionDetails = {},
  ): TransactionRecord {
    return {
      id: uuidv4(),
      walletId,
      agentId,
      type,
      status: 'pending',
      details,
      guardrailsApplied: [],
      timestamp: new Date().toISOString(),
    }
  }
}
