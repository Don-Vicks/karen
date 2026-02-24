import cors from 'cors'
import express, { NextFunction, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { Orchestrator } from '../agent/orchestrator'
import { AuditLogger } from '../core/audit-logger'
import { Guardrails } from '../core/transaction/guardrails'
import { TransactionEngine } from '../core/transaction/transaction-engine'
import { ApiKeyRecord } from '../core/types'
import { WalletManager } from '../core/wallet/wallet-manager'
import { JupiterAdapter } from '../protocols/jupiter'
import { SplTokenAdapter } from '../protocols/spl-token'
import { StakingAdapter } from '../protocols/staking'
import { TokenLauncherAdapter } from '../protocols/token-launcher'
import { WrappedSolAdapter } from '../protocols/wrapped-sol'

// ============================================
// REST API Server
// ============================================
// Exposes Karen capabilities to external AI agents

export class ApiServer {
  private app: express.Application
  private walletManager: WalletManager
  private transactionEngine: TransactionEngine
  private guardrails: Guardrails
  private logger: AuditLogger
  private orchestrator: Orchestrator
  private jupiter: JupiterAdapter
  private splToken: SplTokenAdapter
  private tokenLauncher: TokenLauncherAdapter
  private staking: StakingAdapter
  private wrappedSol: WrappedSolAdapter
  private apiKeys: Map<string, ApiKeyRecord> = new Map()
  private apiSecret: string

  constructor(
    walletManager: WalletManager,
    transactionEngine: TransactionEngine,
    guardrails: Guardrails,
    logger: AuditLogger,
    orchestrator: Orchestrator,
  ) {
    this.walletManager = walletManager
    this.transactionEngine = transactionEngine
    this.guardrails = guardrails
    this.logger = logger
    this.orchestrator = orchestrator
    this.jupiter = new JupiterAdapter()
    this.splToken = new SplTokenAdapter()
    this.tokenLauncher = new TokenLauncherAdapter()
    this.staking = new StakingAdapter()
    this.wrappedSol = new WrappedSolAdapter()
    this.apiSecret = process.env.API_SECRET || 'karen-dev-secret'

    this.app = express()
    this.setupMiddleware()
    this.setupRoutes()
  }

  private setupMiddleware(): void {
    this.app.use(cors())
    this.app.use(express.json())

    // Request logging
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      console.log(`[API] ${req.method} ${req.path}`)
      next()
    })
  }

  private setupRoutes(): void {
    // ========== Health ==========
    this.app.get('/api/v1/health', async (_req, res) => {
      const { SolanaConnection } = await import('../core/solana/connection')
      const health = await SolanaConnection.getInstance().getHealth()
      const stats = this.orchestrator.getStats()
      res.json({
        status: 'ok',
        version: '0.1.0',
        solana: health,
        agents: stats,
      })
    })

    // ========== API Key Management ==========
    this.app.post('/api/v1/keys', this.adminAuth.bind(this), (req, res) => {
      const {
        name,
        permissions = ['read', 'write'],
        rateLimit = 10,
        spendingLimitSol = 5,
      } = req.body

      if (!name) {
        return res.status(400).json({ error: 'name is required' })
      }

      const apiKey: ApiKeyRecord = {
        id: uuidv4(),
        key: `sk-${uuidv4().replace(/-/g, '')}`,
        name,
        walletId: '', // Will be set when wallet is created
        permissions,
        rateLimit,
        spendingLimitSol,
        createdAt: new Date().toISOString(),
      }

      this.apiKeys.set(apiKey.key, apiKey)
      res.json({ apiKey: apiKey.key, id: apiKey.id, name: apiKey.name })
    })

    this.app.get('/api/v1/keys', this.adminAuth.bind(this), (_req, res) => {
      const keys = Array.from(this.apiKeys.values()).map((k) => ({
        id: k.id,
        name: k.name,
        walletId: k.walletId,
        permissions: k.permissions,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
      }))
      res.json({ keys })
    })

    // ========== Wallet Endpoints ==========
    this.app.post(
      '/api/v1/wallets',
      this.apiKeyAuth.bind(this),
      async (req: Request, res: Response) => {
        try {
          const { name = 'external-wallet' } = req.body
          const wallet = await this.walletManager.createWallet(name, [
            'external',
            'api',
          ])

          // Associate wallet with API key
          const apiKeyRecord = (req as any).apiKeyRecord as ApiKeyRecord
          if (apiKeyRecord) {
            apiKeyRecord.walletId = wallet.id
          }

          res.json({
            walletId: wallet.id,
            name: wallet.name,
            address: wallet.publicKey,
            createdAt: wallet.createdAt,
          })
        } catch (error: any) {
          res.status(500).json({ error: error.message })
        }
      },
    )

    this.app.get('/api/v1/wallets', this.apiKeyAuth.bind(this), (_req, res) => {
      const wallets = this.walletManager.listWallets()
      res.json({ wallets })
    })

    this.app.get(
      '/api/v1/wallets/:id/balance',
      this.apiKeyAuth.bind(this),
      async (req, res) => {
        try {
          const balances = await this.walletManager.getBalances(
            String(req.params.id),
          )
          res.json(balances)
        } catch (error: any) {
          res.status(404).json({ error: error.message })
        }
      },
    )

    // ========== Transaction Endpoints ==========
    this.app.post(
      '/api/v1/wallets/:id/transfer',
      this.apiKeyAuth.bind(this),
      async (req, res) => {
        try {
          const { to, amount } = req.body
          if (!to || !amount) {
            return res.status(400).json({ error: 'to and amount are required' })
          }

          const record = await this.transactionEngine.transferSol(
            String(req.params.id),
            to,
            Number(amount),
            'api',
          )
          res.json(record)
        } catch (error: any) {
          res.status(500).json({ error: error.message })
        }
      },
    )

    this.app.post(
      '/api/v1/wallets/:id/swap',
      this.apiKeyAuth.bind(this),
      async (req, res) => {
        try {
          const { inputToken, outputToken, amount, slippageBps = 50 } = req.body
          if (!inputToken || !outputToken || !amount) {
            return res.status(400).json({
              error: 'inputToken, outputToken, and amount are required',
            })
          }

          const result = await this.jupiter.executeSwap(
            this.walletManager,
            String(req.params.id),
            inputToken,
            outputToken,
            Number(amount),
            Number(slippageBps),
          )
          res.json(result)
        } catch (error: any) {
          res.status(500).json({ error: error.message })
        }
      },
    )

    this.app.post(
      '/api/v1/wallets/:id/airdrop',
      this.apiKeyAuth.bind(this),
      async (req, res) => {
        try {
          const { amount = 1 } = req.body
          const record = await this.transactionEngine.airdrop(
            String(req.params.id),
            Math.min(Number(amount), 2),
            'api',
          )
          res.json(record)
        } catch (error: any) {
          res.status(500).json({ error: error.message })
        }
      },
    )

    this.app.get(
      '/api/v1/wallets/:id/transactions',
      this.apiKeyAuth.bind(this),
      (req, res) => {
        const limit = Number(req.query.limit) || 50
        const transactions = this.transactionEngine.getTransactionHistory(
          String(req.params.id),
          limit,
        )
        res.json({ transactions })
      },
    )

    // ========== Agent Endpoints ==========
    this.app.get('/api/v1/agents', this.apiKeyAuth.bind(this), (_req, res) => {
      res.json({ agents: this.orchestrator.listAgents() })
    })

    this.app.post(
      '/api/v1/agents',
      this.adminAuth.bind(this),
      async (req, res) => {
        try {
          const config = await this.orchestrator.createAgent(req.body)
          res.json(config)
        } catch (error: any) {
          res.status(500).json({ error: error.message })
        }
      },
    )

    this.app.post(
      '/api/v1/agents/:id/start',
      this.adminAuth.bind(this),
      (req, res) => {
        try {
          this.orchestrator.startAgent(String(req.params.id))
          res.json({ status: 'started' })
        } catch (error: any) {
          res.status(404).json({ error: error.message })
        }
      },
    )

    this.app.post(
      '/api/v1/agents/:id/stop',
      this.adminAuth.bind(this),
      (req, res) => {
        try {
          this.orchestrator.stopAgent(String(req.params.id))
          res.json({ status: 'stopped' })
        } catch (error: any) {
          res.status(404).json({ error: error.message })
        }
      },
    )

    this.app.post(
      '/api/v1/agents/:id/chat',
      this.apiKeyAuth.bind(this),
      async (req, res) => {
        try {
          const { message } = req.body
          if (!message) {
            return res.status(400).json({ error: 'message is required' })
          }
          const response = await this.orchestrator.chatWithAgent(
            String(req.params.id),
            message,
          )
          res.json({ response })
        } catch (error: any) {
          res.status(404).json({ error: error.message })
        }
      },
    )

    // ========== Transaction Feed ==========
    this.app.get(
      '/api/v1/transactions',
      this.apiKeyAuth.bind(this),
      (req, res) => {
        const limit = Number(req.query.limit) || 50
        const transactions = this.transactionEngine.getTransactionHistory(
          undefined,
          limit,
        )
        res.json({ transactions })
      },
    )

    // ========== DeFi: Token Launch ==========
    this.app.post(
      '/api/v1/wallets/:id/launch-token',
      this.apiKeyAuth.bind(this),
      async (req, res) => {
        try {
          const {
            name,
            symbol,
            decimals = 9,
            initialSupply = 1_000_000,
          } = req.body
          if (!name || !symbol) {
            return res
              .status(400)
              .json({ error: 'name and symbol are required' })
          }
          const result = await this.tokenLauncher.createToken(
            this.walletManager,
            String(req.params.id),
            name,
            symbol,
            Number(decimals),
            Number(initialSupply),
          )
          res.json(result)
        } catch (error: any) {
          res.status(500).json({ error: error.message })
        }
      },
    )

    this.app.post(
      '/api/v1/wallets/:id/mint-supply',
      this.apiKeyAuth.bind(this),
      async (req, res) => {
        try {
          const { mint, amount, decimals = 9 } = req.body
          if (!mint || !amount) {
            return res
              .status(400)
              .json({ error: 'mint and amount are required' })
          }
          const result = await this.tokenLauncher.mintAdditionalSupply(
            this.walletManager,
            String(req.params.id),
            mint,
            Number(amount),
            Number(decimals),
          )
          res.json(result)
        } catch (error: any) {
          res.status(500).json({ error: error.message })
        }
      },
    )

    this.app.post(
      '/api/v1/wallets/:id/revoke-authority',
      this.apiKeyAuth.bind(this),
      async (req, res) => {
        try {
          const { mint, authorityType = 'mint' } = req.body
          if (!mint) {
            return res.status(400).json({ error: 'mint is required' })
          }
          let signature: string
          if (authorityType === 'freeze') {
            signature = await this.tokenLauncher.revokeFreezeAuthority(
              this.walletManager,
              String(req.params.id),
              mint,
            )
          } else {
            signature = await this.tokenLauncher.revokeMintAuthority(
              this.walletManager,
              String(req.params.id),
              mint,
            )
          }
          res.json({ signature, authorityType, revoked: true })
        } catch (error: any) {
          res.status(500).json({ error: error.message })
        }
      },
    )

    // ========== DeFi: Staking ==========
    this.app.post(
      '/api/v1/wallets/:id/stake',
      this.apiKeyAuth.bind(this),
      async (req, res) => {
        try {
          const { amount, validator } = req.body
          if (!amount) {
            return res.status(400).json({ error: 'amount is required' })
          }
          const result = await this.staking.stakeSOL(
            this.walletManager,
            String(req.params.id),
            Number(amount),
            validator,
          )
          res.json(result)
        } catch (error: any) {
          res.status(500).json({ error: error.message })
        }
      },
    )

    this.app.post(
      '/api/v1/wallets/:id/unstake',
      this.apiKeyAuth.bind(this),
      async (req, res) => {
        try {
          const { stakeAccount } = req.body
          if (!stakeAccount) {
            return res.status(400).json({ error: 'stakeAccount is required' })
          }
          const signature = await this.staking.unstakeSOL(
            this.walletManager,
            String(req.params.id),
            stakeAccount,
          )
          res.json({ signature, stakeAccount, deactivated: true })
        } catch (error: any) {
          res.status(500).json({ error: error.message })
        }
      },
    )

    this.app.post(
      '/api/v1/wallets/:id/withdraw-stake',
      this.apiKeyAuth.bind(this),
      async (req, res) => {
        try {
          const { stakeAccount } = req.body
          if (!stakeAccount) {
            return res.status(400).json({ error: 'stakeAccount is required' })
          }
          const signature = await this.staking.withdrawStake(
            this.walletManager,
            String(req.params.id),
            stakeAccount,
          )
          res.json({ signature, stakeAccount, withdrawn: true })
        } catch (error: any) {
          res.status(500).json({ error: error.message })
        }
      },
    )

    this.app.get(
      '/api/v1/wallets/:id/stakes',
      this.apiKeyAuth.bind(this),
      async (req, res) => {
        try {
          const wallet = this.walletManager.getWallet(String(req.params.id))
          if (!wallet) {
            return res.status(404).json({ error: 'Wallet not found' })
          }
          const stakes = await this.staking.getStakeAccounts(wallet.publicKey)
          res.json({ stakes })
        } catch (error: any) {
          res.status(500).json({ error: error.message })
        }
      },
    )

    // ========== DeFi: Token Account Management ==========
    this.app.post(
      '/api/v1/wallets/:id/burn',
      this.apiKeyAuth.bind(this),
      async (req, res) => {
        try {
          const { mint, amount } = req.body
          if (!mint || !amount) {
            return res
              .status(400)
              .json({ error: 'mint and amount are required' })
          }
          const result = await this.splToken.burnTokens(
            this.walletManager,
            String(req.params.id),
            mint,
            Number(amount),
          )
          res.json(result)
        } catch (error: any) {
          res.status(500).json({ error: error.message })
        }
      },
    )

    this.app.post(
      '/api/v1/wallets/:id/close-account',
      this.apiKeyAuth.bind(this),
      async (req, res) => {
        try {
          const { mint } = req.body
          if (!mint) {
            return res.status(400).json({ error: 'mint is required' })
          }
          const result = await this.splToken.closeTokenAccount(
            this.walletManager,
            String(req.params.id),
            mint,
          )
          res.json(result)
        } catch (error: any) {
          res.status(500).json({ error: error.message })
        }
      },
    )

    // ========== DeFi: Wrapped SOL ==========
    this.app.post(
      '/api/v1/wallets/:id/wrap-sol',
      this.apiKeyAuth.bind(this),
      async (req, res) => {
        try {
          const { amount } = req.body
          if (!amount) {
            return res.status(400).json({ error: 'amount is required' })
          }
          const result = await this.wrappedSol.wrapSOL(
            this.walletManager,
            String(req.params.id),
            Number(amount),
          )
          res.json(result)
        } catch (error: any) {
          res.status(500).json({ error: error.message })
        }
      },
    )

    this.app.post(
      '/api/v1/wallets/:id/unwrap-sol',
      this.apiKeyAuth.bind(this),
      async (req, res) => {
        try {
          const result = await this.wrappedSol.unwrapSOL(
            this.walletManager,
            String(req.params.id),
          )
          res.json(result)
        } catch (error: any) {
          res.status(500).json({ error: error.message })
        }
      },
    )
  }

  // ========== Auth Middleware ==========

  private adminAuth(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization
    if (!authHeader || authHeader !== `Bearer ${this.apiSecret}`) {
      res
        .status(401)
        .json({ error: 'Unauthorized — admin API secret required' })
      return
    }
    next()
  }

  private apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization
    if (!authHeader) {
      res.status(401).json({ error: 'Unauthorized — API key required' })
      return
    }

    const key = authHeader.replace('Bearer ', '')

    // Accept admin secret too
    if (key === this.apiSecret) {
      next()
      return
    }

    const apiKeyRecord = this.apiKeys.get(key)
    if (!apiKeyRecord) {
      res.status(401).json({ error: 'Invalid API key' })
      return
    }

    apiKeyRecord.lastUsedAt = new Date().toISOString()
    ;(req as any).apiKeyRecord = apiKeyRecord
    next()
  }

  // ========== Server Lifecycle ==========

  start(port?: number): void {
    const serverPort = port || Number(process.env.API_PORT) || 3001
    this.app.listen(serverPort, () => {
      console.log(
        `\n🚀 Karen API server running on http://localhost:${serverPort}`,
      )
      console.log(`   Health: http://localhost:${serverPort}/api/v1/health`)
      console.log(`   Docs:   See SKILLS.md for API reference\n`)
    })
  }

  getApp(): express.Application {
    return this.app
  }
}
