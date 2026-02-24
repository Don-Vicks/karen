#!/usr/bin/env node

import chalk from 'chalk'
import { Command } from 'commander'
import dotenv from 'dotenv'
import { Orchestrator } from '../agent/orchestrator'
import { ApiServer } from '../api/server'
import { AuditLogger } from '../core/audit-logger'
import { SolanaConnection } from '../core/solana/connection'
import { Guardrails } from '../core/transaction/guardrails'
import { TransactionEngine } from '../core/transaction/transaction-engine'
import { WalletManager } from '../core/wallet/wallet-manager'
import { SplTokenAdapter } from '../protocols/spl-token'
import { StakingAdapter } from '../protocols/staking'
import { TokenLauncherAdapter } from '../protocols/token-launcher'
import { WrappedSolAdapter } from '../protocols/wrapped-sol'

dotenv.config()

// ============================================
// Karen CLI
// ============================================

const LOGO = `
${chalk.cyan('╔═══════════════════════════════════════════╗')}
${chalk.cyan('║')}  ${chalk.bold.white('⚡ Karen')} ${chalk.gray('— Autonomous Wallet Infrastructure')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.gray('   for Solana AI Agents')}                    ${chalk.cyan('║')}  
${chalk.cyan('╚═══════════════════════════════════════════╝')}
`

function getServices() {
  const password = process.env.KEYSTORE_PASSWORD || 'karen-dev'
  const logger = new AuditLogger()
  const guardrails = new Guardrails(undefined, logger)
  const walletManager = new WalletManager(password)
  const transactionEngine = new TransactionEngine(
    walletManager,
    guardrails,
    logger,
  )
  const orchestrator = new Orchestrator(
    walletManager,
    transactionEngine,
    guardrails,
    logger,
  )
  return { walletManager, transactionEngine, guardrails, logger, orchestrator }
}

const program = new Command()

program
  .name('karen')
  .description('Autonomous wallet infrastructure for Solana AI agents')
  .version('0.1.0')

// ========== Wallet Commands ==========

const wallet = program.command('wallet').description('Manage wallets')

wallet
  .command('create')
  .description('Create a new wallet')
  .option('-n, --name <name>', 'Wallet name', 'my-wallet')
  .option('-m, --mnemonic <mnemonic>', 'Master mnemonic for HD derivation')
  .option('-i, --index <index>', 'Derivation index', '0')
  .action(async (opts) => {
    const { walletManager } = getServices()
    try {
      let info
      if (opts.mnemonic) {
        info = await walletManager.createDerivedWallet(
          opts.name,
          opts.mnemonic,
          Number(opts.index),
        )
        console.log(chalk.green('✅ HD-derived wallet created:'))
        console.log(chalk.gray(`   Derivation index: ${opts.index}`))
      } else {
        info = await walletManager.createWallet(opts.name)
        console.log(chalk.green('✅ Wallet created:'))
      }
      console.log(chalk.white(`   Name:    ${info.name}`))
      console.log(chalk.white(`   ID:      ${info.id}`))
      console.log(chalk.white(`   Address: ${chalk.cyan(info.publicKey)}`))
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`))
    }
  })

wallet
  .command('list')
  .description('List all wallets')
  .action(() => {
    const { walletManager } = getServices()
    const wallets = walletManager.listWallets()

    if (wallets.length === 0) {
      console.log(
        chalk.yellow(
          'No wallets found. Create one with: karen wallet create',
        ),
      )
      return
    }

    console.log(chalk.bold(`\n📜 Wallets (${wallets.length}):\n`))
    for (const w of wallets) {
      console.log(
        `  ${chalk.cyan(w.name)} ${chalk.gray(`(${w.id.slice(0, 8)}...)`)}` +
          `\n    Address: ${chalk.white(w.publicKey)}` +
          `\n    Tags: ${w.tags.join(', ') || 'none'}` +
          `\n    Created: ${w.createdAt}\n`,
      )
    }
  })

wallet
  .command('balance')
  .description('Check wallet balance')
  .requiredOption('-n, --name <name>', 'Wallet name')
  .action(async (opts) => {
    const { walletManager } = getServices()
    const wallet = walletManager.findWalletByName(opts.name)
    if (!wallet) {
      console.error(chalk.red(`❌ Wallet "${opts.name}" not found`))
      return
    }

    try {
      const balances = await walletManager.getBalances(wallet.id)
      console.log(chalk.bold(`\n💰 ${wallet.name} (${wallet.publicKey}):\n`))
      console.log(`  SOL: ${chalk.green(balances.sol.toFixed(4))}`)

      if (balances.tokens.length > 0) {
        console.log(chalk.bold('\n  Tokens:'))
        for (const t of balances.tokens) {
          console.log(
            `    ${chalk.cyan(t.mint.slice(0, 8))}...: ${chalk.green(t.uiBalance)}`,
          )
        }
      }
      console.log()
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`))
    }
  })

wallet
  .command('airdrop')
  .description('Request devnet SOL airdrop')
  .requiredOption('-n, --name <name>', 'Wallet name')
  .option('-a, --amount <amount>', 'Amount of SOL', '1')
  .action(async (opts) => {
    const { walletManager, transactionEngine } = getServices()
    const wallet = walletManager.findWalletByName(opts.name)
    if (!wallet) {
      console.error(chalk.red(`❌ Wallet "${opts.name}" not found`))
      return
    }

    console.log(chalk.yellow(`⏳ Requesting ${opts.amount} SOL airdrop...`))
    try {
      const record = await transactionEngine.airdrop(
        wallet.id,
        Number(opts.amount),
      )
      if (record.status === 'confirmed') {
        console.log(chalk.green(`✅ Airdropped ${opts.amount} SOL`))
        console.log(chalk.gray(`   Signature: ${record.signature}`))
      } else {
        console.error(chalk.red(`❌ Airdrop failed: ${record.error}`))
      }
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`))
    }
  })

wallet
  .command('send')
  .description('Send SOL to another address')
  .requiredOption('-n, --name <name>', 'Source wallet name')
  .requiredOption('-t, --to <address>', 'Destination address')
  .requiredOption('-a, --amount <amount>', 'Amount of SOL')
  .action(async (opts) => {
    const { walletManager, transactionEngine } = getServices()
    const wallet = walletManager.findWalletByName(opts.name)
    if (!wallet) {
      console.error(chalk.red(`❌ Wallet "${opts.name}" not found`))
      return
    }

    console.log(chalk.yellow(`⏳ Sending ${opts.amount} SOL to ${opts.to}...`))
    try {
      const record = await transactionEngine.transferSol(
        wallet.id,
        opts.to,
        Number(opts.amount),
      )
      if (record.status === 'confirmed') {
        console.log(chalk.green(`✅ Sent ${opts.amount} SOL`))
        console.log(chalk.gray(`   Signature: ${record.signature}`))
      } else if (record.status === 'blocked') {
        console.error(chalk.red(`🛡️ Blocked by guardrails: ${record.error}`))
      } else {
        console.error(chalk.red(`❌ Failed: ${record.error}`))
      }
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`))
    }
  })

wallet
  .command('mnemonic')
  .description('Generate a new master mnemonic for HD wallet derivation')
  .action(() => {
    const mnemonic = WalletManager.generateMnemonic()
    console.log(chalk.bold('\n🔑 New Master Mnemonic (24 words):\n'))
    console.log(chalk.yellow(`   ${mnemonic}`))
    console.log(
      chalk.red(
        '\n   ⚠️  Store this securely! Anyone with this can derive all agent wallets.\n',
      ),
    )
  })

// ========== DeFi Wallet Commands ==========

wallet
  .command('launch-token')
  .description('Create a new SPL token')
  .requiredOption('-n, --name <name>', 'Wallet name')
  .requiredOption('--token-name <tokenName>', 'Token name')
  .requiredOption('--symbol <symbol>', 'Token symbol')
  .option('--decimals <decimals>', 'Decimal places', '9')
  .option('--supply <supply>', 'Initial supply', '1000000')
  .action(async (opts) => {
    const { walletManager } = getServices()
    const wallet = walletManager.findWalletByName(opts.name)
    if (!wallet) {
      console.error(chalk.red(`❌ Wallet "${opts.name}" not found`))
      return
    }
    console.log(chalk.yellow(`⏳ Launching token ${opts.symbol}...`))
    try {
      const launcher = new TokenLauncherAdapter()
      const result = await launcher.createToken(
        walletManager,
        wallet.id,
        opts.tokenName,
        opts.symbol,
        Number(opts.decimals),
        Number(opts.supply),
      )
      console.log(chalk.green(`✅ Token launched!`))
      console.log(chalk.white(`   Name:    ${result.name} (${result.symbol})`))
      console.log(chalk.white(`   Mint:    ${chalk.cyan(result.mint)}`))
      console.log(chalk.white(`   Supply:  ${result.supply.toLocaleString()}`))
      console.log(chalk.gray(`   Tx:      ${result.signature}`))
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`))
    }
  })

wallet
  .command('mint-supply')
  .description('Mint additional token supply')
  .requiredOption('-n, --name <name>', 'Wallet name')
  .requiredOption('--mint <mint>', 'Token mint address')
  .requiredOption('-a, --amount <amount>', 'Amount to mint')
  .option('--decimals <decimals>', 'Token decimals', '9')
  .action(async (opts) => {
    const { walletManager } = getServices()
    const wallet = walletManager.findWalletByName(opts.name)
    if (!wallet) {
      console.error(chalk.red(`❌ Wallet "${opts.name}" not found`))
      return
    }
    try {
      const launcher = new TokenLauncherAdapter()
      const result = await launcher.mintAdditionalSupply(
        walletManager,
        wallet.id,
        opts.mint,
        Number(opts.amount),
        Number(opts.decimals),
      )
      console.log(chalk.green(`✅ Minted ${opts.amount} tokens`))
      console.log(chalk.gray(`   Tx: ${result.signature}`))
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`))
    }
  })

wallet
  .command('revoke-authority')
  .description('Permanently revoke mint or freeze authority')
  .requiredOption('-n, --name <name>', 'Wallet name')
  .requiredOption('--mint <mint>', 'Token mint address')
  .option('--type <type>', 'Authority type: mint or freeze', 'mint')
  .action(async (opts) => {
    const { walletManager } = getServices()
    const wallet = walletManager.findWalletByName(opts.name)
    if (!wallet) {
      console.error(chalk.red(`❌ Wallet "${opts.name}" not found`))
      return
    }
    console.log(
      chalk.yellow(`⚠️  Revoking ${opts.type} authority (IRREVERSIBLE)...`),
    )
    try {
      const launcher = new TokenLauncherAdapter()
      const sig =
        opts.type === 'freeze'
          ? await launcher.revokeFreezeAuthority(
              walletManager,
              wallet.id,
              opts.mint,
            )
          : await launcher.revokeMintAuthority(
              walletManager,
              wallet.id,
              opts.mint,
            )
      console.log(chalk.green(`✅ ${opts.type} authority permanently revoked`))
      console.log(chalk.gray(`   Tx: ${sig}`))
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`))
    }
  })

wallet
  .command('stake')
  .description('Stake SOL to a validator')
  .requiredOption('-n, --name <name>', 'Wallet name')
  .requiredOption('-a, --amount <amount>', 'Amount of SOL to stake')
  .option('-v, --validator <validator>', 'Validator vote account')
  .action(async (opts) => {
    const { walletManager } = getServices()
    const wallet = walletManager.findWalletByName(opts.name)
    if (!wallet) {
      console.error(chalk.red(`❌ Wallet "${opts.name}" not found`))
      return
    }
    console.log(chalk.yellow(`⏳ Staking ${opts.amount} SOL...`))
    try {
      const stakingAdapter = new StakingAdapter()
      const result = await stakingAdapter.stakeSOL(
        walletManager,
        wallet.id,
        Number(opts.amount),
        opts.validator,
      )
      console.log(chalk.green(`✅ Staked ${result.amount} SOL`))
      console.log(
        chalk.white(`   Stake Account: ${chalk.cyan(result.stakeAccount)}`),
      )
      console.log(chalk.white(`   Validator:     ${result.validator}`))
      console.log(chalk.gray(`   Tx:            ${result.signature}`))
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`))
    }
  })

wallet
  .command('unstake')
  .description('Deactivate a stake account')
  .requiredOption('-n, --name <name>', 'Wallet name')
  .requiredOption('-s, --stake-account <stakeAccount>', 'Stake account pubkey')
  .action(async (opts) => {
    const { walletManager } = getServices()
    const wallet = walletManager.findWalletByName(opts.name)
    if (!wallet) {
      console.error(chalk.red(`❌ Wallet "${opts.name}" not found`))
      return
    }
    try {
      const stakingAdapter = new StakingAdapter()
      const sig = await stakingAdapter.unstakeSOL(
        walletManager,
        wallet.id,
        opts.stakeAccount,
      )
      console.log(chalk.green(`✅ Stake deactivation initiated`))
      console.log(chalk.gray(`   Tx: ${sig}`))
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`))
    }
  })

wallet
  .command('withdraw-stake')
  .description('Withdraw SOL from a deactivated stake account')
  .requiredOption('-n, --name <name>', 'Wallet name')
  .requiredOption('-s, --stake-account <stakeAccount>', 'Stake account pubkey')
  .action(async (opts) => {
    const { walletManager } = getServices()
    const wallet = walletManager.findWalletByName(opts.name)
    if (!wallet) {
      console.error(chalk.red(`❌ Wallet "${opts.name}" not found`))
      return
    }
    try {
      const stakingAdapter = new StakingAdapter()
      const sig = await stakingAdapter.withdrawStake(
        walletManager,
        wallet.id,
        opts.stakeAccount,
      )
      console.log(chalk.green(`✅ Stake withdrawn to wallet`))
      console.log(chalk.gray(`   Tx: ${sig}`))
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`))
    }
  })

wallet
  .command('stakes')
  .description('List all stake accounts')
  .requiredOption('-n, --name <name>', 'Wallet name')
  .action(async (opts) => {
    const { walletManager } = getServices()
    const wallet = walletManager.findWalletByName(opts.name)
    if (!wallet) {
      console.error(chalk.red(`❌ Wallet "${opts.name}" not found`))
      return
    }
    try {
      const stakingAdapter = new StakingAdapter()
      const stakes = await stakingAdapter.getStakeAccounts(wallet.publicKey)
      if (stakes.length === 0) {
        console.log(chalk.yellow('No stake accounts found.'))
        return
      }
      console.log(chalk.bold(`\n🥩 Stake Accounts (${stakes.length}):\n`))
      for (const s of stakes) {
        console.log(
          `  ${chalk.cyan(s.address.slice(0, 12))}...` +
            `\n    Balance:  ${chalk.green(s.solBalance.toFixed(4))} SOL` +
            `\n    State:    ${s.state}` +
            `\n    Validator: ${s.voter || 'N/A'}\n`,
        )
      }
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`))
    }
  })

wallet
  .command('burn')
  .description('Burn SPL tokens')
  .requiredOption('-n, --name <name>', 'Wallet name')
  .requiredOption('--mint <mint>', 'Token mint address')
  .requiredOption('-a, --amount <amount>', 'Amount to burn')
  .action(async (opts) => {
    const { walletManager } = getServices()
    const wallet = walletManager.findWalletByName(opts.name)
    if (!wallet) {
      console.error(chalk.red(`❌ Wallet "${opts.name}" not found`))
      return
    }
    try {
      const spl = new SplTokenAdapter()
      const result = await spl.burnTokens(
        walletManager,
        wallet.id,
        opts.mint,
        Number(opts.amount),
      )
      console.log(chalk.green(`✅ Burned ${opts.amount} tokens`))
      console.log(chalk.gray(`   Tx: ${result.signature}`))
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`))
    }
  })

wallet
  .command('close-account')
  .description('Close an empty token account to reclaim rent')
  .requiredOption('-n, --name <name>', 'Wallet name')
  .requiredOption('--mint <mint>', 'Token mint address')
  .action(async (opts) => {
    const { walletManager } = getServices()
    const wallet = walletManager.findWalletByName(opts.name)
    if (!wallet) {
      console.error(chalk.red(`❌ Wallet "${opts.name}" not found`))
      return
    }
    try {
      const spl = new SplTokenAdapter()
      const result = await spl.closeTokenAccount(
        walletManager,
        wallet.id,
        opts.mint,
      )
      console.log(chalk.green(`✅ Token account closed`))
      console.log(
        chalk.white(
          `   Rent reclaimed: ${result.rentReclaimed.toFixed(6)} SOL`,
        ),
      )
      console.log(chalk.gray(`   Tx: ${result.signature}`))
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`))
    }
  })

wallet
  .command('wrap-sol')
  .description('Wrap SOL to wSOL')
  .requiredOption('-n, --name <name>', 'Wallet name')
  .requiredOption('-a, --amount <amount>', 'Amount of SOL to wrap')
  .action(async (opts) => {
    const { walletManager } = getServices()
    const wallet = walletManager.findWalletByName(opts.name)
    if (!wallet) {
      console.error(chalk.red(`❌ Wallet "${opts.name}" not found`))
      return
    }
    try {
      const wsol = new WrappedSolAdapter()
      const result = await wsol.wrapSOL(
        walletManager,
        wallet.id,
        Number(opts.amount),
      )
      console.log(chalk.green(`✅ Wrapped ${result.amount} SOL → wSOL`))
      console.log(chalk.gray(`   Tx: ${result.signature}`))
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`))
    }
  })

wallet
  .command('unwrap-sol')
  .description('Unwrap all wSOL back to native SOL')
  .requiredOption('-n, --name <name>', 'Wallet name')
  .action(async (opts) => {
    const { walletManager } = getServices()
    const wallet = walletManager.findWalletByName(opts.name)
    if (!wallet) {
      console.error(chalk.red(`❌ Wallet "${opts.name}" not found`))
      return
    }
    try {
      const wsol = new WrappedSolAdapter()
      const result = await wsol.unwrapSOL(walletManager, wallet.id)
      console.log(
        chalk.green(`✅ Unwrapped ${result.amount.toFixed(4)} wSOL → SOL`),
      )
      console.log(chalk.gray(`   Tx: ${result.signature}`))
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`))
    }
  })

// ========== Agent Commands ==========

const agent = program.command('agent').description('Manage AI agents')

agent
  .command('create')
  .description('Create a new autonomous agent')
  .requiredOption('-n, --name <name>', 'Agent name')
  .requiredOption('-s, --strategy <strategy>', 'Agent trading strategy')
  .option(
    '-l, --llm <provider>',
    'LLM provider (openai or anthropic)',
    'openai',
  )
  .option('-m, --model <model>', 'LLM model', 'gpt-4o')
  .option('--interval <ms>', 'Loop interval in milliseconds', '30000')
  .option('--max-per-tx <sol>', 'Max SOL per transaction', '2')
  .option('--daily-limit <sol>', 'Daily spending limit in SOL', '10')
  .action(async (opts) => {
    const { orchestrator } = getServices()
    try {
      const config = await orchestrator.createAgent({
        name: opts.name,
        strategy: opts.strategy,
        llmProvider: opts.llm,
        llmModel: opts.model,
        loopIntervalMs: Number(opts.interval),
        maxSolPerTransaction: Number(opts.maxPerTx),
        dailySpendingLimitSol: Number(opts.dailyLimit),
      })
      console.log(chalk.green('✅ Agent created:'))
      console.log(chalk.white(`   Name:     ${config.name}`))
      console.log(chalk.white(`   ID:       ${config.id}`))
      console.log(chalk.white(`   Wallet:   ${config.walletId}`))
      console.log(
        chalk.white(`   LLM:      ${config.llmProvider} (${config.llmModel})`),
      )
      console.log(chalk.white(`   Strategy: ${config.strategy}`))
      console.log(
        chalk.gray(
          `\n   Start with: karen agent start --name ${config.name}`,
        ),
      )
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`))
    }
  })

agent
  .command('list')
  .description('List all agents')
  .action(() => {
    const { orchestrator } = getServices()
    const agents = orchestrator.listAgents()

    if (agents.length === 0) {
      console.log(
        chalk.yellow('No agents found. Create one with: karen agent create'),
      )
      return
    }

    console.log(chalk.bold(`\n🤖 Agents (${agents.length}):\n`))
    for (const a of agents) {
      const statusColor =
        a.status === 'running'
          ? chalk.green
          : a.status === 'error'
            ? chalk.red
            : chalk.yellow
      console.log(
        `  ${chalk.cyan(a.name)} ${chalk.gray(`(${a.id.slice(0, 8)}...)`)}` +
          `\n    Status:   ${statusColor(a.status)}` +
          `\n    Wallet:   ${a.walletId.slice(0, 8)}...` +
          `\n    LLM:      ${a.llmProvider} (${a.llmModel})` +
          `\n    Strategy: ${a.strategy.slice(0, 60)}...` +
          `\n    Created:  ${a.createdAt}\n`,
      )
    }
  })

agent
  .command('start')
  .description('Start an agent')
  .requiredOption('-n, --name <name>', 'Agent name')
  .action((opts) => {
    const { orchestrator } = getServices()
    const agent = orchestrator.findAgentByName(opts.name)
    if (!agent) {
      console.error(chalk.red(`❌ Agent "${opts.name}" not found`))
      return
    }
    orchestrator.startAgent(agent.id)
    console.log(
      chalk.green(
        `✅ Agent "${opts.name}" started. It is now running autonomously.`,
      ),
    )
    console.log(chalk.gray(`   Loop interval: ${agent.loopIntervalMs}ms`))
    console.log(chalk.yellow(`   Press Ctrl+C to stop.`))
    // Keep process alive
    process.on('SIGINT', () => {
      orchestrator.stopAll()
      console.log(chalk.yellow('\n🛑 All agents stopped.'))
      process.exit(0)
    })
  })

agent
  .command('stop')
  .description('Stop an agent')
  .requiredOption('-n, --name <name>', 'Agent name')
  .action((opts) => {
    const { orchestrator } = getServices()
    const agent = orchestrator.findAgentByName(opts.name)
    if (!agent) {
      console.error(chalk.red(`❌ Agent "${opts.name}" not found`))
      return
    }
    orchestrator.stopAgent(agent.id)
    console.log(chalk.green(`✅ Agent "${opts.name}" stopped.`))
  })

agent
  .command('chat')
  .description('Chat with an agent')
  .requiredOption('-n, --name <name>', 'Agent name')
  .requiredOption('-m, --message <message>', 'Message to send')
  .action(async (opts) => {
    const { orchestrator } = getServices()
    const agent = orchestrator.findAgentByName(opts.name)
    if (!agent) {
      console.error(chalk.red(`❌ Agent "${opts.name}" not found`))
      return
    }
    console.log(chalk.yellow(`⏳ Talking to ${opts.name}...`))
    try {
      const response = await orchestrator.chatWithAgent(agent.id, opts.message)
      console.log(chalk.bold(`\n🤖 ${opts.name}:`))
      console.log(chalk.white(`   ${response}\n`))
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`))
    }
  })

// ========== Server Commands ==========

const server = program.command('server').description('Start the Karen server')

server
  .command('start')
  .description('Start the REST API server')
  .option('-p, --port <port>', 'Port number', '3001')
  .action((opts) => {
    console.log(LOGO)
    const services = getServices()
    const apiServer = new ApiServer(
      services.walletManager,
      services.transactionEngine,
      services.guardrails,
      services.logger,
      services.orchestrator,
    )
    apiServer.start(Number(opts.port))

    process.on('SIGINT', () => {
      services.orchestrator.stopAll()
      console.log(chalk.yellow('\n🛑 Server stopped.'))
      process.exit(0)
    })
  })

server
  .command('mcp')
  .description('Start the MCP server (for external AI agents)')
  .action(async () => {
    const { startMCPServer } = await import('../mcp/server')
    await startMCPServer()
  })

// ========== Transaction Commands ==========

const tx = program.command('tx').description('View transaction history')

tx.command('list')
  .description('List recent transactions')
  .option('-w, --wallet <name>', 'Filter by wallet name')
  .option('-l, --limit <n>', 'Number of transactions', '20')
  .action((opts) => {
    const { walletManager, logger } = getServices()
    let walletId: string | undefined

    if (opts.wallet) {
      const wallet = walletManager.findWalletByName(opts.wallet)
      if (!wallet) {
        console.error(chalk.red(`❌ Wallet "${opts.wallet}" not found`))
        return
      }
      walletId = wallet.id
    }

    const txs = logger.getTransactions(walletId, Number(opts.limit))

    if (txs.length === 0) {
      console.log(chalk.yellow('No transactions found.'))
      return
    }

    console.log(chalk.bold(`\n📋 Transactions (${txs.length}):\n`))
    for (const t of txs) {
      const statusIcon =
        t.status === 'confirmed' ? '✅' : t.status === 'blocked' ? '🛡️' : '❌'
      console.log(
        `  ${statusIcon} ${chalk.cyan(t.type)} ${chalk.gray(`(${t.id.slice(0, 8)}...)`)}` +
          `\n     Wallet: ${t.walletId.slice(0, 8)}...` +
          (t.signature
            ? `\n     Tx: ${chalk.gray(t.signature.slice(0, 20))}...`
            : '') +
          (t.error ? `\n     Error: ${chalk.red(t.error)}` : '') +
          `\n     Time: ${t.timestamp}\n`,
      )
    }
  })

// ========== Info Command ==========

program
  .command('info')
  .description('Show Karen system info')
  .action(async () => {
    console.log(LOGO)
    const health = await SolanaConnection.getInstance().getHealth()
    const { walletManager, orchestrator } = getServices()
    const wallets = walletManager.listWallets()
    const agents = orchestrator.listAgents()

    console.log(chalk.bold('  System Info:\n'))
    console.log(
      `    Solana:    ${health.healthy ? chalk.green('Connected') : chalk.red('Disconnected')} (${health.network})`,
    )
    console.log(`    Slot:      ${health.slot}`)
    console.log(`    Wallets:   ${wallets.length}`)
    console.log(`    Agents:    ${agents.length}`)
    console.log()
  })

// Parse and run
program.parse()
