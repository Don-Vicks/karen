import { VersionedTransaction } from '@solana/web3.js'
import { getConnection } from '../core/solana/connection'
import { WalletManager } from '../core/wallet/wallet-manager'

// ============================================
// Jupiter Swap Adapter
// ============================================
// Integrates with Jupiter V6 API for token swaps on devnet

const JUPITER_API_BASE = 'https://quote-api.jup.ag/v6'

// Well-known devnet token mints
export const KNOWN_TOKENS: Record<string, { mint: string; decimals: number }> =
  {
    SOL: {
      mint: 'So11111111111111111111111111111111111111112',
      decimals: 9,
    },
    USDC: {
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      decimals: 6,
    },
    USDT: {
      mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      decimals: 6,
    },
    BONK: {
      mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      decimals: 5,
    },
  }

export interface SwapQuote {
  inputMint: string
  outputMint: string
  inAmount: string
  outAmount: string
  otherAmountThreshold: string
  priceImpactPct: string
  routePlan: any[]
}

export interface SwapResult {
  signature: string
  inputToken: string
  outputToken: string
  inputAmount: number
  expectedOutputAmount: number
}

export class JupiterAdapter {
  private apiBase: string

  constructor(apiBase?: string) {
    this.apiBase = apiBase || JUPITER_API_BASE
  }

  /**
   * Resolve a token symbol to its mint address
   */
  resolveMint(symbolOrMint: string): string {
    const upper = symbolOrMint.toUpperCase()
    if (KNOWN_TOKENS[upper]) {
      return KNOWN_TOKENS[upper].mint
    }
    // Assume it's already a mint address
    return symbolOrMint
  }

  /**
   * Get token decimals
   */
  getDecimals(symbolOrMint: string): number {
    const upper = symbolOrMint.toUpperCase()
    if (KNOWN_TOKENS[upper]) {
      return KNOWN_TOKENS[upper].decimals
    }
    return 9 // Default to 9 (SOL-like)
  }

  /**
   * Get a swap quote from Jupiter
   */
  async getQuote(
    inputToken: string,
    outputToken: string,
    amount: number,
    slippageBps: number = 50,
  ): Promise<SwapQuote> {
    const inputMint = this.resolveMint(inputToken)
    const outputMint = this.resolveMint(outputToken)
    const inputDecimals = this.getDecimals(inputToken)
    const rawAmount = Math.round(amount * Math.pow(10, inputDecimals))

    const url = new URL(`${this.apiBase}/quote`)
    url.searchParams.set('inputMint', inputMint)
    url.searchParams.set('outputMint', outputMint)
    url.searchParams.set('amount', String(rawAmount))
    url.searchParams.set('slippageBps', String(slippageBps))

    const response = await fetch(url.toString())
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Jupiter quote failed: ${error}`)
    }

    return response.json() as Promise<SwapQuote>
  }

  /**
   * Build a swap transaction from a quote
   */
  async buildSwapTransaction(
    quote: SwapQuote,
    userPublicKey: string,
  ): Promise<{ transaction: Buffer; lastValidBlockHeight: number }> {
    const response = await fetch(`${this.apiBase}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Jupiter swap transaction failed: ${error}`)
    }

    const data = (await response.json()) as {
      swapTransaction: string
      lastValidBlockHeight: number
    }
    const transactionBuf = Buffer.from(data.swapTransaction, 'base64')
    return {
      transaction: transactionBuf,
      lastValidBlockHeight: data.lastValidBlockHeight,
    }
  }

  /**
   * Execute a full swap: quote → build → sign → send
   */
  async executeSwap(
    walletManager: WalletManager,
    walletId: string,
    inputToken: string,
    outputToken: string,
    amount: number,
    slippageBps: number = 50,
  ): Promise<SwapResult> {
    // 1. Get quote
    const quote = await this.getQuote(
      inputToken,
      outputToken,
      amount,
      slippageBps,
    )

    // 2. Get wallet keypair
    const keypair = await walletManager.getKeypair(walletId)
    const publicKeyStr = keypair.publicKey.toBase58()

    // 3. Build swap transaction
    const { transaction: txBuf, lastValidBlockHeight } =
      await this.buildSwapTransaction(quote, publicKeyStr)

    // 4. Deserialize and sign
    const connection = getConnection()
    const versionedTx = VersionedTransaction.deserialize(txBuf)
    versionedTx.sign([keypair])

    // 5. Send and confirm
    const signature = await connection.sendRawTransaction(
      versionedTx.serialize(),
      {
        skipPreflight: true,
        maxRetries: 3,
      },
    )

    const latestBlockhash = await connection.getLatestBlockhash()
    await connection.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    })

    // 6. Calculate amounts for return
    const inputDecimals = this.getDecimals(inputToken)
    const outputDecimals = this.getDecimals(outputToken)

    return {
      signature,
      inputToken,
      outputToken,
      inputAmount: amount,
      expectedOutputAmount:
        Number(quote.outAmount) / Math.pow(10, outputDecimals),
    }
  }
}
