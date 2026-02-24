import {
  AuthorityType,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddress,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { getConnection } from '../core/solana/connection'
import { WalletManager } from '../core/wallet/wallet-manager'

// ============================================
// Token Launcher Adapter
// ============================================
// Create SPL tokens, mint supply, manage authorities

export interface TokenLaunchResult {
  mint: string
  signature: string
  ata: string
  supply: number
  decimals: number
  name: string
  symbol: string
}

export interface MintResult {
  signature: string
  mint: string
  amount: number
}

export class TokenLauncherAdapter {
  /**
   * Create a new SPL token with initial supply
   */
  async createToken(
    walletManager: WalletManager,
    walletId: string,
    name: string,
    symbol: string,
    decimals: number = 9,
    initialSupply: number = 1_000_000,
  ): Promise<TokenLaunchResult> {
    const connection = getConnection()
    const payer = await walletManager.getKeypair(walletId)
    const mintKeypair = Keypair.generate()

    // Calculate rent exemption for mint account
    const lamports = await getMinimumBalanceForRentExemptMint(connection)

    // Build transaction: create mint account + initialize mint + create ATA + mint initial supply
    const tx = new Transaction()

    // 1. Create account for the mint
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
    )

    // 2. Initialize the mint with payer as mint + freeze authority
    tx.add(
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        decimals,
        payer.publicKey, // mint authority
        payer.publicKey, // freeze authority
      ),
    )

    // 3. Create associated token account for the payer
    const ata = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      payer.publicKey,
    )
    tx.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey, // payer
        ata,
        payer.publicKey, // owner
        mintKeypair.publicKey, // mint
      ),
    )

    // 4. Mint initial supply to the payer's ATA
    const rawAmount = Math.round(initialSupply * Math.pow(10, decimals))
    tx.add(
      createMintToInstruction(
        mintKeypair.publicKey, // mint
        ata, // destination
        payer.publicKey, // authority
        BigInt(rawAmount),
      ),
    )

    // Sign and send
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash()
    tx.recentBlockhash = blockhash
    tx.lastValidBlockHeight = lastValidBlockHeight
    tx.feePayer = payer.publicKey

    tx.sign(payer, mintKeypair)
    const signature = await connection.sendRawTransaction(tx.serialize())
    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    })

    return {
      mint: mintKeypair.publicKey.toBase58(),
      signature,
      ata: ata.toBase58(),
      supply: initialSupply,
      decimals,
      name,
      symbol,
    }
  }

  /**
   * Mint additional supply of an existing token (must be mint authority)
   */
  async mintAdditionalSupply(
    walletManager: WalletManager,
    walletId: string,
    mintAddress: string,
    amount: number,
    decimals: number = 9,
  ): Promise<MintResult> {
    const connection = getConnection()
    const payer = await walletManager.getKeypair(walletId)
    const mint = new PublicKey(mintAddress)

    // Get or create the ATA for the payer
    const ata = await getAssociatedTokenAddress(mint, payer.publicKey)

    const tx = new Transaction()

    // Check if ATA exists, if not create it
    const ataInfo = await connection.getAccountInfo(ata)
    if (!ataInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          ata,
          payer.publicKey,
          mint,
        ),
      )
    }

    const rawAmount = Math.round(amount * Math.pow(10, decimals))
    tx.add(
      createMintToInstruction(
        mint,
        ata,
        payer.publicKey, // mint authority
        BigInt(rawAmount),
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

    return { signature, mint: mintAddress, amount }
  }

  /**
   * Revoke mint authority permanently (irreversible — no more tokens can be minted)
   */
  async revokeMintAuthority(
    walletManager: WalletManager,
    walletId: string,
    mintAddress: string,
  ): Promise<string> {
    const connection = getConnection()
    const payer = await walletManager.getKeypair(walletId)
    const mint = new PublicKey(mintAddress)

    const tx = new Transaction().add(
      createSetAuthorityInstruction(
        mint,
        payer.publicKey, // current authority
        AuthorityType.MintTokens,
        null, // revoke by setting to null
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
   * Revoke freeze authority (irreversible — no accounts can be frozen)
   */
  async revokeFreezeAuthority(
    walletManager: WalletManager,
    walletId: string,
    mintAddress: string,
  ): Promise<string> {
    const connection = getConnection()
    const payer = await walletManager.getKeypair(walletId)
    const mint = new PublicKey(mintAddress)

    const tx = new Transaction().add(
      createSetAuthorityInstruction(
        mint,
        payer.publicKey,
        AuthorityType.FreezeAccount,
        null,
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
