import chalk from 'chalk'
import ora from 'ora'
import readline from 'readline'
import { getServices } from './index'

export async function runChat() {
  console.clear()
  console.log(
    chalk.cyan('╔═══════════════════════════════════════════╗\n') +
      chalk.cyan('║') +
      chalk.bold.white('  ⚡ Karen Chat — Interactive Web3 Agent  ') +
      chalk.cyan('║\n') +
      chalk.cyan('╚═══════════════════════════════════════════╝\n'),
  )

  const services = getServices()

  // Find or create a default Agent & Wallet combo for local CLI interacting
  let wallets = services.walletManager.listWallets()
  let CLIWalletId = ''

  if (wallets.length === 0) {
    console.log(
      chalk.yellow(
        '⚠️ No wallets found. Generating a secure Turnkey default wallet...',
      ),
    )
    const spinner = ora('Provisioning Agent Credentials...').start()
    try {
      const w = await services.walletManager.createWallet('CLI-Default-Wallet')
      CLIWalletId = w.id
      spinner.succeed(chalk.green(`Wallet created: ${w.publicKey}`))
    } catch (e: any) {
      spinner.fail(chalk.red(`Failed to create Turnkey wallet: ${e.message}`))
      console.log(
        chalk.gray(
          '\nRun `karen onboard` if you have not set up your API keys yet.',
        ),
      )
      return
    }
  } else {
    // Just grab the first one
    CLIWalletId = wallets[0].id
    console.log(
      chalk.gray(`Connected to Web3 Enclave: ${wallets[0].publicKey}`),
    )
  }

  // Create or load default Agent
  const defaultAgentName = 'Karen-CLI'
  let agentId = ''
  try {
    const agentsInfo = JSON.parse(
      require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', 'data', 'agents.json'),
        'utf8',
      ),
    )
    const existing = agentsInfo.find((a: any) => a.name === defaultAgentName)
    if (existing) {
      agentId = existing.id
    } else {
      const a = await services.orchestrator.createAgent({
        name: defaultAgentName,
        strategy:
          'You are a helpful Web3 Agent interacting directly with the user via Terminal. Keep answers concise.',
      })
      agentId = a.id
    }
  } catch (e) {
    const a = await services.orchestrator.createAgent({
      name: defaultAgentName,
      strategy:
        'You are a helpful Web3 Agent interacting directly with the user via Terminal. Keep answers concise.',
    })
    agentId = a.id
  }

  console.log(
    chalk.green(
      `\n✅ Connected! Agent is ready to accept commands. Type 'exit' to quit.\n`,
    ),
  )

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  // Start the REPL Loop
  const promptUser = () => {
    rl.question(chalk.bold.magenta('\nYou: '), async (input) => {
      const text = input.trim()

      if (text.toLowerCase() === 'exit' || text.toLowerCase() === 'quit') {
        console.log(chalk.gray('Goodbye!'))
        rl.close()
        return
      }

      if (text) {
        const spinner = ora({
          text: chalk.gray('Karen is thinking...'),
          spinner: 'dots',
        }).start()

        try {
          // Send request to LLM Agent Model
          const response = await services.orchestrator.chatWithAgent(
            agentId,
            text,
          )

          spinner.stop()

          console.log(chalk.bold.cyan(`\n🤖 Karen:`))
          console.log(chalk.white(`   ${response}`))
        } catch (error: any) {
          spinner.fail(chalk.red('Agent Error'))
          console.error(chalk.red(`   ${error.message}`))
        }
      }

      promptUser()
    })
  }

  promptUser()
}
