import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import dotenv from 'dotenv'
import { AuditLogger } from '../core/audit-logger'
import { Guardrails } from '../core/transaction/guardrails'
import { TransactionEngine } from '../core/transaction/transaction-engine'
import { WalletManager } from '../core/wallet/wallet-manager'
import { JupiterAdapter } from '../protocols/jupiter'
import { SplTokenAdapter } from '../protocols/spl-token'
import { StakingAdapter } from '../protocols/staking'
import { TokenLauncherAdapter } from '../protocols/token-launcher'
import { WrappedSolAdapter } from '../protocols/wrapped-sol'

dotenv.config()

// ============================================
// MCP Server
// ============================================
// Exposes Karen as tools for any MCP-compatible agent
// (Claude Desktop, OpenClaw, LangChain, etc.)

export async function startMCPServer() {
  const password = process.env.KEYSTORE_PASSWORD || 'karen-dev'
  const walletManager = new WalletManager(password)
  const logger = new AuditLogger()
  const guardrails = new Guardrails(undefined, logger)
  const transactionEngine = new TransactionEngine(
    walletManager,
    guardrails,
    logger,
  )
  const jupiter = new JupiterAdapter()
  const tokenLauncher = new TokenLauncherAdapter()
  const staking = new StakingAdapter()
  const wrappedSol = new WrappedSolAdapter()
  const splToken = new SplTokenAdapter()

  const server = new Server(
    {
      name: 'karen',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  // ========== List Tools ==========
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'karen_create_wallet',
          description:
            'Create a new managed Solana wallet. Returns wallet ID and public address.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Human-readable name for the wallet',
              },
            },
            required: ['name'],
          },
        },
        {
          name: 'karen_balance',
          description: 'Check SOL and SPL token balances for a wallet.',
          inputSchema: {
            type: 'object',
            properties: {
              walletId: {
                type: 'string',
                description: 'Wallet ID (returned from karen_create_wallet)',
              },
            },
            required: ['walletId'],
          },
        },
        {
          name: 'karen_list_wallets',
          description:
            'List all managed wallets with their addresses and names.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'karen_airdrop',
          description:
            'Request SOL from the devnet faucet (max 2 SOL per request). Devnet only.',
          inputSchema: {
            type: 'object',
            properties: {
              walletId: {
                type: 'string',
                description: 'Wallet ID to fund',
              },
              amount: {
                type: 'number',
                description: 'Amount of SOL to request (max 2)',
              },
            },
            required: ['walletId', 'amount'],
          },
        },
        {
          name: 'karen_transfer',
          description: 'Send SOL from a managed wallet to any Solana address.',
          inputSchema: {
            type: 'object',
            properties: {
              walletId: {
                type: 'string',
                description: 'Source wallet ID',
              },
              to: {
                type: 'string',
                description: 'Recipient Solana address (base58)',
              },
              amount: {
                type: 'number',
                description: 'Amount of SOL to send',
              },
            },
            required: ['walletId', 'to', 'amount'],
          },
        },
        {
          name: 'karen_swap',
          description:
            'Swap tokens using Jupiter DEX. Supports SOL, USDC, USDT, BONK, or mint addresses.',
          inputSchema: {
            type: 'object',
            properties: {
              walletId: {
                type: 'string',
                description: 'Wallet ID to swap from',
              },
              inputToken: {
                type: 'string',
                description: 'Token to sell (e.g., "SOL", "USDC")',
              },
              outputToken: {
                type: 'string',
                description: 'Token to buy (e.g., "USDC", "SOL")',
              },
              amount: {
                type: 'number',
                description: 'Amount of input token to swap',
              },
              slippageBps: {
                type: 'number',
                description:
                  'Max slippage in basis points (default: 50 = 0.5%)',
              },
            },
            required: ['walletId', 'inputToken', 'outputToken', 'amount'],
          },
        },
        {
          name: 'karen_tx_history',
          description: 'Get transaction history for a wallet.',
          inputSchema: {
            type: 'object',
            properties: {
              walletId: {
                type: 'string',
                description: 'Wallet ID (optional — omit for all wallets)',
              },
              limit: {
                type: 'number',
                description: 'Number of transactions to return (default: 20)',
              },
            },
          },
        },
        // ========== DeFi: Token Launch ==========
        {
          name: 'karen_launch_token',
          description:
            'Create a new SPL token with initial supply. You become the mint and freeze authority.',
          inputSchema: {
            type: 'object',
            properties: {
              walletId: { type: 'string', description: 'Wallet ID' },
              name: { type: 'string', description: 'Token name' },
              symbol: { type: 'string', description: 'Token ticker symbol' },
              decimals: {
                type: 'number',
                description: 'Decimal places (default: 9)',
              },
              initialSupply: {
                type: 'number',
                description: 'Initial supply in whole units (default: 1000000)',
              },
            },
            required: ['walletId', 'name', 'symbol'],
          },
        },
        {
          name: 'karen_mint_supply',
          description:
            'Mint additional tokens for a token you created (must be mint authority).',
          inputSchema: {
            type: 'object',
            properties: {
              walletId: { type: 'string', description: 'Wallet ID' },
              mint: { type: 'string', description: 'Token mint address' },
              amount: { type: 'number', description: 'Amount to mint' },
              decimals: {
                type: 'number',
                description: 'Token decimals (default: 9)',
              },
            },
            required: ['walletId', 'mint', 'amount'],
          },
        },
        {
          name: 'karen_revoke_authority',
          description:
            'Permanently revoke mint or freeze authority on a token. IRREVERSIBLE.',
          inputSchema: {
            type: 'object',
            properties: {
              walletId: { type: 'string', description: 'Wallet ID' },
              mint: { type: 'string', description: 'Token mint address' },
              authorityType: {
                type: 'string',
                description: '"mint" or "freeze" (default: "mint")',
              },
            },
            required: ['walletId', 'mint'],
          },
        },
        // ========== DeFi: Staking ==========
        {
          name: 'karen_stake',
          description: 'Stake SOL by delegating to a Solana validator.',
          inputSchema: {
            type: 'object',
            properties: {
              walletId: { type: 'string', description: 'Wallet ID' },
              amount: { type: 'number', description: 'SOL to stake' },
              validator: {
                type: 'string',
                description: 'Validator vote account (optional)',
              },
            },
            required: ['walletId', 'amount'],
          },
        },
        {
          name: 'karen_unstake',
          description:
            'Deactivate a stake account. After 1 epoch, you can withdraw.',
          inputSchema: {
            type: 'object',
            properties: {
              walletId: { type: 'string', description: 'Wallet ID' },
              stakeAccount: {
                type: 'string',
                description: 'Stake account public key',
              },
            },
            required: ['walletId', 'stakeAccount'],
          },
        },
        {
          name: 'karen_withdraw_stake',
          description: 'Withdraw SOL from a fully deactivated stake account.',
          inputSchema: {
            type: 'object',
            properties: {
              walletId: { type: 'string', description: 'Wallet ID' },
              stakeAccount: {
                type: 'string',
                description: 'Stake account public key',
              },
            },
            required: ['walletId', 'stakeAccount'],
          },
        },
        {
          name: 'karen_list_stakes',
          description: 'List all stake accounts for a wallet.',
          inputSchema: {
            type: 'object',
            properties: {
              walletId: { type: 'string', description: 'Wallet ID' },
            },
            required: ['walletId'],
          },
        },
        // ========== DeFi: Token Account Ops ==========
        {
          name: 'karen_burn',
          description: 'Burn (destroy) SPL tokens from your wallet.',
          inputSchema: {
            type: 'object',
            properties: {
              walletId: { type: 'string', description: 'Wallet ID' },
              mint: { type: 'string', description: 'Token mint address' },
              amount: { type: 'number', description: 'Amount to burn' },
            },
            required: ['walletId', 'mint', 'amount'],
          },
        },
        {
          name: 'karen_close_account',
          description: 'Close an empty token account to reclaim rent SOL.',
          inputSchema: {
            type: 'object',
            properties: {
              walletId: { type: 'string', description: 'Wallet ID' },
              mint: { type: 'string', description: 'Token mint address' },
            },
            required: ['walletId', 'mint'],
          },
        },
        // ========== DeFi: Wrapped SOL ==========
        {
          name: 'karen_wrap_sol',
          description:
            'Convert SOL to Wrapped SOL (wSOL) for DeFi interactions.',
          inputSchema: {
            type: 'object',
            properties: {
              walletId: { type: 'string', description: 'Wallet ID' },
              amount: { type: 'number', description: 'SOL to wrap' },
            },
            required: ['walletId', 'amount'],
          },
        },
        {
          name: 'karen_unwrap_sol',
          description: 'Convert all wSOL back to native SOL.',
          inputSchema: {
            type: 'object',
            properties: {
              walletId: { type: 'string', description: 'Wallet ID' },
            },
            required: ['walletId'],
          },
        },
      ],
    }
  })

  // ========== Call Tools ==========
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    try {
      switch (name) {
        case 'karen_create_wallet': {
          const wallet = await walletManager.createWallet(
            String(args?.name || 'mcp-wallet'),
            ['mcp', 'external'],
          )
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    walletId: wallet.id,
                    name: wallet.name,
                    address: wallet.publicKey,
                    message:
                      'Wallet created. Use karen_airdrop to fund it with devnet SOL.',
                  },
                  null,
                  2,
                ),
              },
            ],
          }
        }

        case 'karen_balance': {
          const balances = await walletManager.getBalances(
            String(args?.walletId),
          )
          const wallet = walletManager.getWallet(String(args?.walletId))
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    wallet: wallet?.name,
                    address: wallet?.publicKey,
                    sol: balances.sol,
                    tokens: balances.tokens,
                  },
                  null,
                  2,
                ),
              },
            ],
          }
        }

        case 'karen_list_wallets': {
          const wallets = walletManager.listWallets()
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ wallets }, null, 2),
              },
            ],
          }
        }

        case 'karen_airdrop': {
          const amount = Math.min(Number(args?.amount || 1), 2)
          const record = await transactionEngine.airdrop(
            String(args?.walletId),
            amount,
            'mcp',
          )
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: record.status,
                    amount,
                    signature: record.signature,
                    error: record.error,
                  },
                  null,
                  2,
                ),
              },
            ],
          }
        }

        case 'karen_transfer': {
          const record = await transactionEngine.transferSol(
            String(args?.walletId),
            String(args?.to),
            Number(args?.amount),
            'mcp',
          )
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: record.status,
                    signature: record.signature,
                    error: record.error,
                    guardrails: record.guardrailsApplied,
                  },
                  null,
                  2,
                ),
              },
            ],
          }
        }

        case 'karen_swap': {
          const result = await jupiter.executeSwap(
            walletManager,
            String(args?.walletId),
            String(args?.inputToken),
            String(args?.outputToken),
            Number(args?.amount),
            Number(args?.slippageBps || 50),
          )
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          }
        }

        case 'karen_tx_history': {
          const walletId = args?.walletId ? String(args.walletId) : undefined
          const limit = Number(args?.limit || 20)
          const transactions = transactionEngine.getTransactionHistory(
            walletId,
            limit,
          )
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ transactions }, null, 2),
              },
            ],
          }
        }

        // ========== DeFi Tool Handlers ==========
        case 'karen_launch_token': {
          const result = await tokenLauncher.createToken(
            walletManager,
            String(args?.walletId),
            String(args?.name),
            String(args?.symbol),
            Number(args?.decimals || 9),
            Number(args?.initialSupply || 1_000_000),
          )
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          }
        }

        case 'karen_mint_supply': {
          const result = await tokenLauncher.mintAdditionalSupply(
            walletManager,
            String(args?.walletId),
            String(args?.mint),
            Number(args?.amount),
            Number(args?.decimals || 9),
          )
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          }
        }

        case 'karen_revoke_authority': {
          const authorityType = String(args?.authorityType || 'mint')
          let signature: string
          if (authorityType === 'freeze') {
            signature = await tokenLauncher.revokeFreezeAuthority(
              walletManager,
              String(args?.walletId),
              String(args?.mint),
            )
          } else {
            signature = await tokenLauncher.revokeMintAuthority(
              walletManager,
              String(args?.walletId),
              String(args?.mint),
            )
          }
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  { signature, authorityType, revoked: true },
                  null,
                  2,
                ),
              },
            ],
          }
        }

        case 'karen_stake': {
          const result = await staking.stakeSOL(
            walletManager,
            String(args?.walletId),
            Number(args?.amount),
            args?.validator ? String(args.validator) : undefined,
          )
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          }
        }

        case 'karen_unstake': {
          const signature = await staking.unstakeSOL(
            walletManager,
            String(args?.walletId),
            String(args?.stakeAccount),
          )
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ signature, deactivated: true }, null, 2),
              },
            ],
          }
        }

        case 'karen_withdraw_stake': {
          const signature = await staking.withdrawStake(
            walletManager,
            String(args?.walletId),
            String(args?.stakeAccount),
          )
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ signature, withdrawn: true }, null, 2),
              },
            ],
          }
        }

        case 'karen_list_stakes': {
          const wallet = walletManager.getWallet(String(args?.walletId))
          if (!wallet) throw new Error('Wallet not found')
          const stakes = await staking.getStakeAccounts(wallet.publicKey)
          return {
            content: [
              { type: 'text', text: JSON.stringify({ stakes }, null, 2) },
            ],
          }
        }

        case 'karen_burn': {
          const result = await splToken.burnTokens(
            walletManager,
            String(args?.walletId),
            String(args?.mint),
            Number(args?.amount),
          )
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          }
        }

        case 'karen_close_account': {
          const result = await splToken.closeTokenAccount(
            walletManager,
            String(args?.walletId),
            String(args?.mint),
          )
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          }
        }

        case 'karen_wrap_sol': {
          const result = await wrappedSol.wrapSOL(
            walletManager,
            String(args?.walletId),
            Number(args?.amount),
          )
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          }
        }

        case 'karen_unwrap_sol': {
          const result = await wrappedSol.unwrapSOL(
            walletManager,
            String(args?.walletId),
          )
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          }
        }

        default:
          return {
            content: [
              {
                type: 'text',
                text: `Unknown tool: ${name}`,
              },
            ],
            isError: true,
          }
      }
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      }
    }
  })

  // ========== Start Server ==========
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Karen MCP server running on stdio')
}

// Allow running directly
if (require.main === module) {
  startMCPServer().catch(console.error)
}
