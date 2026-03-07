import chalk from 'chalk'
import fs from 'fs'
import ora from 'ora'
import os from 'os'
import path from 'path'

export async function installMcp() {
  console.log(chalk.cyan('\n🔍 Scanning for MCP client configurations...'))

  const platform = os.platform()
  const homeDir = os.homedir()

  // Define known config paths
  const configPaths: { name: string; path: string }[] = []

  if (platform === 'darwin') {
    configPaths.push({
      name: 'Claude Desktop',
      path: path.join(
        homeDir,
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json',
      ),
    })
  } else if (platform === 'win32') {
    configPaths.push({
      name: 'Claude Desktop',
      path: path.join(
        homeDir,
        'AppData',
        'Roaming',
        'Claude',
        'claude_desktop_config.json',
      ),
    })
  }

  // OpenClaw
  configPaths.push({
    name: 'OpenClaw',
    path: path.join(homeDir, '.openclaw', 'openclaw.json'),
  })

  let installedCount = 0

  for (const target of configPaths) {
    const spinner = ora(`Checking ${target.name}...`).start()

    // Create directory if it doesn't exist for Claude (to be helpful)
    const dir = path.dirname(target.path)
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true })
      } catch (e) {
        spinner.fail(
          chalk.red(
            `Could not verify directory for ${target.name}: ${target.path}`,
          ),
        )
        continue
      }
    }

    let config: any = {}
    if (fs.existsSync(target.path)) {
      try {
        const fileData = fs.readFileSync(target.path, 'utf8')
        config = JSON.parse(fileData)
      } catch (e) {
        spinner.fail(
          chalk.red(`Failed to parse existing config for ${target.name}`),
        )
        continue
      }
    } else {
      // If the file doesn't exist, we'll create a basic structure
      config = { mcpServers: {} }
    }

    if (!config.mcpServers) {
      config.mcpServers = {}
    }

    // Determine the absolute path to this project's execution engine
    // Since we are running from src/cli/mcp-installer.ts or dist/cli/mcp-installer.js
    const projectRoot = path.resolve(__dirname, '..', '..')
    const executablePath = path.join(projectRoot, 'dist', 'cli', 'index.js')

    // Fallback if built files don't exist, use tsx
    let command = 'node'
    let args = [executablePath, 'mcp', 'start']

    if (!fs.existsSync(executablePath)) {
      command = 'npx'
      args = [
        'tsx',
        path.join(projectRoot, 'src', 'cli', 'index.ts'),
        'mcp',
        'start',
      ]
    }

    config.mcpServers['karen'] = {
      command,
      args,
      env: {
        // Provide path to .env file so MCP server can access Turnkey/Twilio/LLM keys
        DOTENV_CONFIG_PATH: path.join(projectRoot, '.env'),
      },
    }

    try {
      fs.writeFileSync(target.path, JSON.stringify(config, null, 2), 'utf8')
      spinner.succeed(chalk.green(`Successfully installed into ${target.name}`))
      installedCount++
    } catch (e: any) {
      spinner.fail(chalk.red(`Failed to write to ${target.name}: ${e.message}`))
    }
  }

  if (installedCount > 0) {
    console.log(
      chalk.cyan(
        `\n✨ Successfully injected Karen MCP configuration into ${installedCount} client(s)!`,
      ),
    )
    console.log(
      chalk.gray(
        `Restart your Claude Desktop or OpenClaw client to apply the changes.\n`,
      ),
    )
  } else {
    console.log(
      chalk.yellow(
        `\n⚠️ No compatible MCP clients were found or successfully configured.`,
      ),
    )
  }
}
