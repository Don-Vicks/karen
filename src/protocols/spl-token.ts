import {
  createBurnInstruction,
  createCloseAccountInstruction,
  createFreezeAccountInstruction,
  createThawAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
  TokenAccountNotFoundError,
} from '@solana/spl-token'
import { PublicKey, Transaction } from '@solana/web3.js'
import { getConnection } from '../core/solana/connection'
import { TokenBalance } from '../core/types'
import { WalletManager } from '../core/wallet/wallet-manager'

// ============================================
// SPL Token Adapter
// ============================================
// Token account management, balance lookups, metadata

export class SplTokenAdapter {
  /**
   * Get all token balances for a wallet
   */
  async getTokenBalances(ownerAddress: string): Promise<TokenBalance[]> {
    const connection = getConnection()
    const owner = new PublicKey(ownerAddress)

    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      owner,
      {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      },
    )

    return tokenAccounts.value.map((ta) => {
      const info = ta.account.data.parsed.info
      return {
        mint: info.mint,
        balance: Number(info.tokenAmount.amount),
        decimals: info.tokenAmount.decimals,
        uiBalance: info.tokenAmount.uiAmount || 0,
      }
    })
  }

  /**
   * Get balance for a specific token
   */
  async getTokenBalance(
    ownerAddress: string,
    mintAddress: string,
  ): Promise<TokenBalance | null> {
    const connection = getConnection()
    const owner = new PublicKey(ownerAddress)
    const mint = new PublicKey(mintAddress)

    try {
      const ata = await getAssociatedTokenAddress(mint, owner)
      const account = await getAccount(connection, ata)
      const mintInfo = await getMint(connection, mint)

      return {
        mint: mintAddress,
        balance: Number(account.amount),
        decimals: mintInfo.decimals,
        uiBalance: Number(account.amount) / Math.pow(10, mintInfo.decimals),
      }
    } catch (error) {
      if (error instanceof TokenAccountNotFoundError) {
        return null
      }
      throw error
    }
  }

  /**
   * Get the associated token address for a wallet + mint
   */
  async getTokenAddress(
    ownerAddress: string,
    mintAddress: string,
  ): Promise<string> {
    const owner = new PublicKey(ownerAddress)
    const mint = new PublicKey(mintAddress)
    const ata = await getAssociatedTokenAddress(mint, owner)
    return ata.toBase58()
  }

  /**
   * Check if a token account exists
   */
  async tokenAccountExists(
    ownerAddress: string,
    mintAddress: string,
  ): Promise<boolean> {
    const connection = getConnection()
    const owner = new PublicKey(ownerAddress)
    const mint = new PublicKey(mintAddress)

    try {
      const ata = await getAssociatedTokenAddress(mint, owner)
      await getAccount(connection, ata)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get token mint info (supply, decimals, etc.)
   */
  async getMintInfo(mintAddress: string) {
    const connection = getConnection()
    const mint = new PublicKey(mintAddress)
    const info = await getMint(connection, mint)

    return {
      address: mintAddress,
      decimals: info.decimals,
      supply: Number(info.supply),
      isInitialized: info.isInitialized,
      freezeAuthority: info.freezeAuthority?.toBase58() || null,
      mintAuthority: info.mintAuthority?.toBase58() || null,
    }
  }

  /**
   * Burn SPL tokens from the wallet's associated token account
   */
  async burnTokens(
    walletManager: WalletManager,
    walletId: string,
    mintAddress: string,
    amount: number,
  ): Promise<{ signature: string; burned: number }> {
    const connection = getConnection()
    const payer = await walletManager.getKeypair(walletId)
    const mint = new PublicKey(mintAddress)

    const ata = await getAssociatedTokenAddress(mint, payer.publicKey)
    const mintInfo = await getMint(connection, mint)
    const rawAmount = Math.round(amount * Math.pow(10, mintInfo.decimals))

    const tx = new Transaction().add(
      createBurnInstruction(ata, mint, payer.publicKey, BigInt(rawAmount)),
    )

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash()
    tx.recentBlockhash = blockhash
    tx.lastValidBlockHeight = lastValidBlockHeight
    tx.feePayer = payer.publicKey

    tx.sign(payer)
    const signature = await connection.sendRawTransaction(tx.serialize())
    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    })

    return { signature, burned: amount }
  }

  /**
   * Close an empty token account and reclaim rent SOL
   */
  async closeTokenAccount(
    walletManager: WalletManager,
    walletId: string,
    mintAddress: string,
  ): Promise<{ signature: string; rentReclaimed: number }> {
    const connection = getConnection()
    const payer = await walletManager.getKeypair(walletId)
    const mint = new PublicKey(mintAddress)

    const ata = await getAssociatedTokenAddress(mint, payer.publicKey)

    // Check that balance is zero before closing
    const account = await getAccount(connection, ata)
    if (account.amount > BigInt(0)) {
      throw new Error(
        'Token account has non-zero balance. Burn or transfer all tokens before closing.',
      )
    }

    const ataInfo = await connection.getAccountInfo(ata)
    const rentLamports = ataInfo?.lamports || 0

    const tx = new Transaction().add(
      createCloseAccountInstruction(
        ata,
        payer.publicKey, // destination for rent
        payer.publicKey, // authority
      ),
    )

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash()
    tx.recentBlockhash = blockhash
    tx.lastValidBlockHeight = lastValidBlockHeight
    tx.feePayer = payer.publicKey

    tx.sign(payer)
    const signature = await connection.sendRawTransaction(tx.serialize())
    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    })

    return {
      signature,
      rentReclaimed: rentLamports / 1e9,
    }
  }

  /**
   * Freeze a token account (requires freeze authority on the mint)
   */
  async freezeTokenAccount(
    walletManager: WalletManager,
    walletId: string,
    targetOwner: string,
    mintAddress: string,
  ): Promise<string> {
    const connection = getConnection()
    const payer = await walletManager.getKeypair(walletId)
    const mint = new PublicKey(mintAddress)
    const owner = new PublicKey(targetOwner)

    const ata = await getAssociatedTokenAddress(mint, owner)

    const tx = new Transaction().add(
      createFreezeAccountInstruction(
        ata,
        mint,
        payer.publicKey, // freeze authority
      ),
    )

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash()
    tx.recentBlockhash = blockhash
    tx.lastValidBlockHeight = lastValidBlockHeight
    tx.feePayer = payer.publicKey

    tx.sign(payer)
    const signature = await connection.sendRawTransaction(tx.serialize())
    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    })

    return signature
  }

  /**
   * Thaw (unfreeze) a frozen token account
   */
  async thawTokenAccount(
    walletManager: WalletManager,
    walletId: string,
    targetOwner: string,
    mintAddress: string,
  ): Promise<string> {
    const connection = getConnection()
    const payer = await walletManager.getKeypair(walletId)
    const mint = new PublicKey(mintAddress)
    const owner = new PublicKey(targetOwner)

    const ata = await getAssociatedTokenAddress(mint, owner)

    const tx = new Transaction().add(
      createThawAccountInstruction(
        ata,
        mint,
        payer.publicKey, // freeze authority
      ),
    )

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash()
    tx.recentBlockhash = blockhash
    tx.lastValidBlockHeight = lastValidBlockHeight
    tx.feePayer = payer.publicKey

    tx.sign(payer)
    const signature = await connection.sendRawTransaction(tx.serialize())
    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    })

    return signature
  }
}
