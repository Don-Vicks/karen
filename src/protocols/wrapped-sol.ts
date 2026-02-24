import {
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddress,
  NATIVE_MINT,
} from '@solana/spl-token'
import { LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js'
import { getConnection } from '../core/solana/connection'
import { WalletManager } from '../core/wallet/wallet-manager'

// ============================================
// Wrapped SOL (wSOL) Adapter
// ============================================
// Convert between SOL and wSOL for DeFi interactions

export class WrappedSolAdapter {
  /**
   * Wrap SOL into wSOL by creating/funding a native token account
   */
  async wrapSOL(
    walletManager: WalletManager,
    walletId: string,
    amountSol: number,
  ): Promise<{ signature: string; wsolAccount: string; amount: number }> {
    const connection = getConnection()
    const payer = await walletManager.getKeypair(walletId)
    const lamports = Math.round(amountSol * LAMPORTS_PER_SOL)

    const ata = await getAssociatedTokenAddress(NATIVE_MINT, payer.publicKey)

    const tx = new Transaction()

    // Check if the wSOL ATA already exists
    const ataInfo = await connection.getAccountInfo(ata)
    if (!ataInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          ata,
          payer.publicKey,
          NATIVE_MINT,
        ),
      )
    }

    // Transfer SOL to the wSOL account
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: ata,
        lamports,
      }),
    )

    // Sync the native account balance
    tx.add(createSyncNativeInstruction(ata))

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
      wsolAccount: ata.toBase58(),
      amount: amountSol,
    }
  }

  /**
   * Unwrap wSOL back to SOL by closing the native token account
   */
  async unwrapSOL(
    walletManager: WalletManager,
    walletId: string,
  ): Promise<{ signature: string; amount: number }> {
    const connection = getConnection()
    const payer = await walletManager.getKeypair(walletId)

    const ata = await getAssociatedTokenAddress(NATIVE_MINT, payer.publicKey)

    // Get the balance before closing
    const ataInfo = await connection.getAccountInfo(ata)
    if (!ataInfo) {
      throw new Error('No wSOL account found to unwrap')
    }
    const wsolLamports = ataInfo.lamports

    const tx = new Transaction().add(
      createCloseAccountInstruction(
        ata,
        payer.publicKey, // destination — SOL goes back here
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
      amount: wsolLamports / LAMPORTS_PER_SOL,
    }
  }
}
