import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import * as bip39 from 'bip39'
import { derivePath } from 'ed25519-hd-key'
import { v4 as uuidv4 } from 'uuid'
import { getConnection } from '../solana/connection'
import { TokenBalance, WalletBalance, WalletInfo } from '../types'
import { Keystore } from './keystore'

// ============================================
// Wallet Manager
// ============================================
// Handles wallet creation, HD derivation, balance checks

export class WalletManager {
  private keystore: Keystore
  private password: string
  private masterSeed?: Buffer

  constructor(password: string, keystoreDir?: string) {
    this.keystore = new Keystore(keystoreDir)
    this.password = password
  }

  // ========== Wallet Creation ==========

  /**
   * Create a new random wallet
   */
  async createWallet(name: string, tags: string[] = []): Promise<WalletInfo> {
    const keypair = Keypair.generate()
    const id = uuidv4()

    await this.keystore.encrypt(keypair, this.password, {
      id,
      name,
      tags,
    })

    return {
      id,
      name,
      publicKey: keypair.publicKey.toBase58(),
      createdAt: new Date().toISOString(),
      tags,
    }
  }

  /**
   * Create a wallet derived from master mnemonic (HD derivation)
   * Each agent gets a unique, deterministic wallet from the same seed
   */
  async createDerivedWallet(
    name: string,
    mnemonic: string,
    derivationIndex: number,
    tags: string[] = [],
  ): Promise<WalletInfo> {
    const seed = await bip39.mnemonicToSeed(mnemonic)
    const path = `m/44'/501'/${derivationIndex}'/0'`
    const derived = derivePath(path, seed.toString('hex'))
    const keypair = Keypair.fromSeed(derived.key)
    const id = uuidv4()

    await this.keystore.encrypt(keypair, this.password, {
      id,
      name,
      derivationIndex,
      tags,
    })

    return {
      id,
      name,
      publicKey: keypair.publicKey.toBase58(),
      createdAt: new Date().toISOString(),
      derivationIndex,
      tags,
    }
  }

  /**
   * Generate a new master mnemonic for HD derivation
   */
  static generateMnemonic(): string {
    return bip39.generateMnemonic(256) // 24 words
  }

  /**
   * Import a wallet from a secret key (base58 or Uint8Array)
   */
  async importWallet(
    name: string,
    secretKey: Uint8Array,
    tags: string[] = [],
  ): Promise<WalletInfo> {
    const keypair = Keypair.fromSecretKey(secretKey)
    const id = uuidv4()

    await this.keystore.encrypt(keypair, this.password, {
      id,
      name,
      tags,
    })

    return {
      id,
      name,
      publicKey: keypair.publicKey.toBase58(),
      createdAt: new Date().toISOString(),
      tags,
    }
  }

  // ========== Wallet Access ==========

  /**
   * Get the keypair for a wallet (decrypts from keystore)
   */
  async getKeypair(walletId: string): Promise<Keypair> {
    return this.keystore.decrypt(walletId, this.password)
  }

  /**
   * List all wallets (metadata only, no keys)
   */
  listWallets(): WalletInfo[] {
    return this.keystore.list().map((ks) => ({
      id: ks.id,
      name: ks.metadata.name,
      publicKey: ks.address,
      createdAt: ks.metadata.createdAt,
      derivationIndex: ks.metadata.derivationIndex,
      tags: ks.metadata.tags,
    }))
  }

  /**
   * Get a single wallet's info
   */
  getWallet(walletId: string): WalletInfo | null {
    const ks = this.keystore.get(walletId)
    if (!ks) return null
    return {
      id: ks.id,
      name: ks.metadata.name,
      publicKey: ks.address,
      createdAt: ks.metadata.createdAt,
      derivationIndex: ks.metadata.derivationIndex,
      tags: ks.metadata.tags,
    }
  }

  /**
   * Find a wallet by name
   */
  findWalletByName(name: string): WalletInfo | null {
    const wallets = this.listWallets()
    return wallets.find((w) => w.name === name) || null
  }

  /**
   * Delete a wallet
   */
  deleteWallet(walletId: string): boolean {
    return this.keystore.delete(walletId)
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
