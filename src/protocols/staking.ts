import {
  Authorized,
  Keypair,
  LAMPORTS_PER_SOL,
  Lockup,
  PublicKey,
  StakeProgram,
  Transaction,
} from '@solana/web3.js'
import { getConnection } from '../core/solana/connection'
import { WalletManager } from '../core/wallet/wallet-manager'

// ============================================
// Native SOL Staking Adapter
// ============================================
// Delegate SOL to validators, manage stake accounts

// Well-known devnet validators for defaults
const DEFAULT_DEVNET_VALIDATOR = 'FwR3PbjS5iyqzLiLugrBqKSa5EKZ4vK9SKs7eQXtT59f'

export interface StakeResult {
  signature: string
  stakeAccount: string
  amount: number
  validator: string
}

export interface StakeAccountInfo {
  address: string
  lamports: number
  solBalance: number
  state: string // 'inactive' | 'activating' | 'active' | 'deactivating'
  voter?: string
  activationEpoch?: string
  deactivationEpoch?: string
}

export class StakingAdapter {
  /**
   * Stake SOL by creating a stake account and delegating to a validator
   */
  async stakeSOL(
    walletManager: WalletManager,
    walletId: string,
    amountSol: number,
    validatorVoteAccount?: string,
  ): Promise<StakeResult> {
    const connection = getConnection()
    const payer = await walletManager.getKeypair(walletId)
    const stakeKeypair = Keypair.generate()
    const validator = validatorVoteAccount || DEFAULT_DEVNET_VALIDATOR

    const lamports = Math.round(amountSol * LAMPORTS_PER_SOL)
    const minimumRent = await connection.getMinimumBalanceForRentExemption(
      StakeProgram.space,
    )
    const totalLamports = lamports + minimumRent

    // Create stake account
    const createStakeAccountTx = StakeProgram.createAccount({
      fromPubkey: payer.publicKey,
      stakePubkey: stakeKeypair.publicKey,
      authorized: new Authorized(payer.publicKey, payer.publicKey),
      lockup: new Lockup(0, 0, payer.publicKey),
      lamports: totalLamports,
    })

    // Delegate to validator
    const delegateTx = StakeProgram.delegate({
      stakePubkey: stakeKeypair.publicKey,
      authorizedPubkey: payer.publicKey,
      votePubkey: new PublicKey(validator),
    })

    const tx = new Transaction()
    tx.add(...createStakeAccountTx.instructions)
    tx.add(...delegateTx.instructions)

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash()
    tx.recentBlockhash = blockhash
    tx.lastValidBlockHeight = lastValidBlockHeight
    tx.feePayer = payer.publicKey

    tx.sign(payer, stakeKeypair)
    const signature = await connection.sendRawTransaction(tx.serialize())
    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    })

    return {
      signature,
      stakeAccount: stakeKeypair.publicKey.toBase58(),
      amount: amountSol,
      validator,
    }
  }

  /**
   * Deactivate (unstake) a stake account
   */
  async unstakeSOL(
    walletManager: WalletManager,
    walletId: string,
    stakeAccountPubkey: string,
  ): Promise<string> {
    const connection = getConnection()
    const payer = await walletManager.getKeypair(walletId)

    const deactivateTx = StakeProgram.deactivate({
      stakePubkey: new PublicKey(stakeAccountPubkey),
      authorizedPubkey: payer.publicKey,
    })

    const tx = new Transaction()
    tx.add(...deactivateTx.instructions)

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
   * Withdraw SOL from a deactivated stake account
   */
  async withdrawStake(
    walletManager: WalletManager,
    walletId: string,
    stakeAccountPubkey: string,
  ): Promise<string> {
    const connection = getConnection()
    const payer = await walletManager.getKeypair(walletId)
    const stakePubkey = new PublicKey(stakeAccountPubkey)

    // Get the balance of the stake account
    const stakeBalance = await connection.getBalance(stakePubkey)

    const withdrawTx = StakeProgram.withdraw({
      stakePubkey,
      authorizedPubkey: payer.publicKey,
      toPubkey: payer.publicKey,
      lamports: stakeBalance,
    })

    const tx = new Transaction()
    tx.add(...withdrawTx.instructions)

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
   * Get all stake accounts owned by the wallet
   */
  async getStakeAccounts(ownerAddress: string): Promise<StakeAccountInfo[]> {
    const connection = getConnection()
    const owner = new PublicKey(ownerAddress)

    const stakeAccounts = await connection.getParsedProgramAccounts(
      StakeProgram.programId,
      {
        filters: [
          {
            memcmp: {
              offset: 12, // Staker authority offset in stake account data
              bytes: owner.toBase58(),
            },
          },
        ],
      },
    )

    return stakeAccounts.map((account) => {
      const parsedData = (account.account.data as any)?.parsed
      const stakeInfo = parsedData?.info?.stake
      const meta = parsedData?.info?.meta

      let state = 'unknown'
      if (parsedData?.type) {
        state = parsedData.type // 'initialized', 'delegated', etc.
      }

      return {
        address: account.pubkey.toBase58(),
        lamports: account.account.lamports,
        solBalance: account.account.lamports / LAMPORTS_PER_SOL,
        state,
        voter: stakeInfo?.delegation?.voter,
        activationEpoch: stakeInfo?.delegation?.activationEpoch,
        deactivationEpoch: stakeInfo?.delegation?.deactivationEpoch,
      }
    })
  }
}
