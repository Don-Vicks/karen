import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import prompts from 'prompts'

const LOGO = `
${chalk.cyan('╔═══════════════════════════════════════════╗')}
${chalk.cyan('║')}  ${chalk.bold.white('⚡ Karen')} ${chalk.gray('— Autonomous Wallet Infrastructure')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.gray('   for Solana AI Agents')}                    ${chalk.cyan('║')}  
${chalk.cyan('╚═══════════════════════════════════════════╝')}
`

export async function runOnboarding() {
  console.clear()
  console.log(LOGO)
  console.log(chalk.bold('Welcome to the Karen Interactive Setup Wizard! 🚀\n'))
  console.log(
    chalk.gray(
      'This wizard will help you configure your AI Provider and Turnkey Web3 Enclave.\n',
    ),
  )

  const responses = await prompts([
    {
      type: 'select',
      name: 'llmProvider',
      message: 'Choose your default AI Provider:',
      choices: [
        { title: 'OpenAI (GPT-4o)', value: 'openai' },
        { title: 'Anthropic (Claude-3.5-Sonnet)', value: 'anthropic' },
        { title: 'Google (Gemini Pro)', value: 'gemini' },
        { title: 'xAI (Grok)', value: 'grok' },
      ],
      initial: 0,
    },
    {
      type: 'password',
      name: 'llmKey',
      message: (prev) =>
        `Enter your ${prev.charAt(0).toUpperCase() + prev.slice(1)} API Key:`,
    },
    {
      type: 'text',
      name: 'turnkeyOrgId',
      message: 'Enter your Turnkey Organization ID:',
    },
    {
      type: 'password',
      name: 'turnkeyPublicKey',
      message: 'Enter your Turnkey API Public Key:',
    },
    {
      type: 'password',
      name: 'turnkeyPrivateKey',
      message: 'Enter your Turnkey API Private Key:',
    },
  ])

  if (!responses.llmKey || !responses.turnkeyOrgId) {
    console.log(chalk.red('\n❌ Setup aborted.'))
    return
  }

  // Determine env format
  let envFileContent = ''

  // Set the default model dynamically
  let defaultModel = 'gpt-4o'
  let keyName = 'OPENAI_API_KEY'

  if (responses.llmProvider === 'anthropic') {
    defaultModel = 'claude-3-5-sonnet-20241022'
    keyName = 'ANTHROPIC_API_KEY'
  } else if (responses.llmProvider === 'gemini') {
    defaultModel = 'gemini-2.0-flash-exp'
    keyName = 'GEMINI_API_KEY'
  } else if (responses.llmProvider === 'grok') {
    defaultModel = 'grok-beta'
    keyName = 'XAI_API_KEY'
  }

  envFileContent += `# AI Default Provider\n`
  envFileContent += `DEFAULT_LLM_MODEL="${defaultModel}"\n`
  envFileContent += `${keyName}="${responses.llmKey}"\n\n`

  envFileContent += `# Turnkey Enclave Authentication\n`
  envFileContent += `TURNKEY_ORGANIZATION_ID="${responses.turnkeyOrgId}"\n`
  envFileContent += `TURNKEY_API_PUBLIC_KEY="${responses.turnkeyPublicKey}"\n`
  envFileContent += `TURNKEY_API_PRIVATE_KEY="${responses.turnkeyPrivateKey}"\n\n`

  const projectRoot = path.resolve(__dirname, '..', '..')
  const envPath = path.join(projectRoot, '.env')

  try {
    // Read existing .env if it exists to preserve custom stuff like Twilio
    if (fs.existsSync(envPath)) {
      const existingEnv = fs.readFileSync(envPath, 'utf8')
      envFileContent =
        envFileContent + '\n# --- Existing Variables ---\n' + existingEnv
    }

    fs.writeFileSync(envPath, envFileContent, 'utf8')
    console.log(chalk.green('\n✅ Successfully wrote configuration to .env!'))
    console.log(
      chalk.cyan('You can now interact with your agent by running: ') +
        chalk.bold.white('karen chat'),
    )
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Failed to write .env file: ${error.message}`))
  }
}
