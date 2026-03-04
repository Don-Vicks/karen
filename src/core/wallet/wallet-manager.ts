import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { ApiKeyStamper } from '@turnkey/api-key-stamper'
import { TurnkeyClient } from '@turnkey/http'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { getConnection } from '../solana/connection'
import { TokenBalance, WalletBalance, WalletInfo } from '../types'
import { TurnkeySigner } from './turnkey-signer'

// ============================================
// Turnkey Wallet Manager
// ============================================
// Securely handles dynamic Solana wallet creation on Turnkey enclave

export interface WalletMetadata {
  id: string
  name: string
  publicKey: string
  turnkeyWalletId: string
  createdAt: string
  tags: string[]
}

export class WalletManager {
  private client: TurnkeyClient
  private organizationId: string
  private metadataPath: string
  private wallets: Map<string, WalletMetadata> = new Map()

  constructor(password: string, metadataDir?: string) {
    this.metadataPath = path.resolve(
      metadataDir || process.cwd(),
      'data',
      'turnkey-wallets.json',
    )

    // Ensure metadata directory exists
    const dir = path.dirname(this.metadataPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    this.organizationId = process.env.TURNKEY_ORGANIZATION_ID!

    // Auth stamper for Turnkey API
    const stamper = new ApiKeyStamper({
      apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
      apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
    })
    this.client = new TurnkeyClient(
      { baseUrl: 'https://api.turnkey.com' },
      stamper,
    )

    this.loadMetadata()
  }

  private loadMetadata(): void {
    if (!fs.existsSync(this.metadataPath)) return
    try {
      const data = fs.readFileSync(this.metadataPath, 'utf8')
      const parsed: WalletMetadata[] = JSON.parse(data)
      parsed.forEach((w) => this.wallets.set(w.id, w))
    } catch (err) {
      console.error('Failed to load Turnkey wallet metadata:', err)
    }
  }

  private saveMetadata(): void {
    fs.writeFileSync(
      this.metadataPath,
      JSON.stringify(Array.from(this.wallets.values()), null, 2),
    )
  }

  // ========== Wallet Creation ==========

  /**
   * Create a new secure wallet via Turnkey API
   */
  async createWallet(name: string, tags: string[] = []): Promise<WalletInfo> {
    const id = uuidv4()

    // 1. Send API request to Turnkey to provision a new Web3 Solana Wallet
    const response = await this.client.createWallet({
      type: 'ACTIVITY_TYPE_CREATE_WALLET',
      organizationId: this.organizationId,
      parameters: {
        walletName: `Karen Agent Wallet - ${name}`,
        accounts: [
          {
            curve: 'CURVE_ED25519',
            pathFormat: 'PATH_FORMAT_BIP32',
            path: "m/44'/501'/0'/0'", // Solana derivation
            addressFormat: 'ADDRESS_FORMAT_SOLANA',
          },
        ],
      },
      timestampMs: String(Date.now()),
    })

    const walletId = response.activity.result.createWalletResult?.walletId
    const address = response.activity.result.createWalletResult?.addresses?.[0]

    if (!walletId || !address) {
      throw new Error(
        `Turnkey Wallet Creation Failed: ${JSON.stringify(response.activity.status)}`,
      )
    }

    const metadata: WalletMetadata = {
      id,
      name,
      publicKey: address,
      turnkeyWalletId: walletId,
      createdAt: new Date().toISOString(),
      tags,
    }

    this.wallets.set(id, metadata)
    this.saveMetadata()

    return {
      id,
      name,
      publicKey: address,
      createdAt: metadata.createdAt,
      tags,
    }
  }

  /**
   * In Turnkey we disable HD derivation locally and treat all creations linearly via API
   */
  async createDerivedWallet(
    name: string,
    _mnemonic: string, // Unused by Turnkey
    _derivationIndex: number,
    tags: string[] = [],
  ): Promise<WalletInfo> {
    // Treat as standard secure creation within the Enclave
    return this.createWallet(name, tags)
  }

  /**
   * Unsupported locally. Requires secure enclave import.
   */
  async importWallet(): Promise<WalletInfo> {
    throw new Error(
      'Local Import is disabled when using Turnkey infrastructure. Provision new wallets instead.',
    )
  }

  // ========== Wallet Access ==========

  /**
   * Returns a custom Signer payload proxy instead of raw Keypair
   */
  async getSigner(walletId: string): Promise<TurnkeySigner> {
    const wallet = this.wallets.get(walletId)
    if (!wallet) throw new Error(`Wallet not found: ${walletId}`)

    return new TurnkeySigner(
      wallet.publicKey,
      wallet.turnkeyWalletId,
      wallet.publicKey,
    )
  }

  /**
   * List all wallets
   */
  listWallets(): WalletInfo[] {
    return Array.from(this.wallets.values()).map((w) => ({
      id: w.id,
      name: w.name,
      publicKey: w.publicKey,
      createdAt: w.createdAt,
      tags: w.tags,
    }))
  }

  /**
   * Get a single wallet's metadata
   */
  getWallet(walletId: string): WalletInfo | null {
    const w = this.wallets.get(walletId)
    if (!w) return null
    return {
      id: w.id,
      name: w.name,
      publicKey: w.publicKey,
      createdAt: w.createdAt,
      tags: w.tags,
    }
  }

  findWalletByName(name: string): WalletInfo | null {
    return this.listWallets().find((w) => w.name === name) || null
  }

  deleteWallet(walletId: string): boolean {
    const deleted = this.wallets.delete(walletId)
    if (deleted) this.saveMetadata()
    return deleted
  }

  // ========== Balance Tracking ==========

  /**
   * Get SOL balance for a wallet
   */
  async getSolBalance(walletId: string): Promise<number> {
    const wallet = this.getWallet(walletId)
    if (!wallet) throw new Error(`Wallet not found: ${walletId}`)

    const connection = getConnection()
    const pubkey = new PublicKey(wallet.publicKey)
    const lamports = await connection.getBalance(pubkey)
    return lamports / LAMPORTS_PER_SOL
  }

  /**
   * Get all balances (SOL + SPL tokens) for a wallet
   */
  async getBalances(walletId: string): Promise<WalletBalance> {
    const wallet = this.getWallet(walletId)
    if (!wallet) throw new Error(`Wallet not found: ${walletId}`)

    const connection = getConnection()
    const pubkey = new PublicKey(wallet.publicKey)

    // Get SOL balance
    const lamports = await connection.getBalance(pubkey)
    const sol = lamports / LAMPORTS_PER_SOL

    // Get SPL token accounts
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      pubkey,
      {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      },
    )

    const tokens: TokenBalance[] = tokenAccounts.value.map((ta) => {
      const info = ta.account.data.parsed.info
      return {
        mint: info.mint,
        balance: Number(info.tokenAmount.amount),
        decimals: info.tokenAmount.decimals,
        uiBalance: info.tokenAmount.uiAmount || 0,
      }
    })

    return { sol, tokens }
  }

  /**
   * Request a devnet airdrop
   */
  async requestAirdrop(
    walletId: string,
    amountSol: number = 1,
  ): Promise<string> {
    const wallet = this.getWallet(walletId)
    if (!wallet) throw new Error(`Wallet not found: ${walletId}`)

    const connection = getConnection()
    const pubkey = new PublicKey(wallet.publicKey)

    const signature = await connection.requestAirdrop(
      pubkey,
      amountSol * LAMPORTS_PER_SOL,
    )

    // Wait for confirmation
    const latestBlockhash = await connection.getLatestBlockhash()
    await connection.confirmTransaction({
      signature,
      ...latestBlockhash,
    })

    return signature
  }
}
