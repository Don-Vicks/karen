import { ApiKeyStamper } from '@turnkey/api-key-stamper'
import { TurnkeyClient, createActivityPoller } from '@turnkey/http'
import chalk from 'chalk'
import { Command } from 'commander'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { v4 as uuidv4 } from 'uuid'
import { Keystore } from '../core/wallet/keystore'
import { WalletMetadata } from '../core/wallet/wallet-manager'

dotenv.config()

const program = new Command()

async function promptPassword(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(chalk.yellow('Enter your KEYSTORE_PASSWORD: '), (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

async function migrate() {
  console.log(chalk.bold.blue('\n🚀 Starting Turnkey Migration\n'))

  const password = process.env.KEYSTORE_PASSWORD || (await promptPassword())

  const keystoreDir = path.resolve(process.cwd(), 'data', 'keystores')
  if (!fs.existsSync(keystoreDir)) {
    console.log(chalk.red('❌ No legacy keystores found at data/keystores/'))
    return
  }

  const keystoreClient = new Keystore(keystoreDir)
  const files = fs.readdirSync(keystoreDir).filter((f) => f.endsWith('.json'))

  if (files.length === 0) {
    console.log(
      chalk.yellow('⚠️  Keystore directory is empty. Nothing to migrate.'),
    )
    return
  }

  console.log(chalk.cyan(`Found ${files.length} legacy wallets.`))

  // Initialize Turnkey
  if (
    !process.env.TURNKEY_API_PUBLIC_KEY ||
    !process.env.TURNKEY_API_PRIVATE_KEY ||
    !process.env.TURNKEY_ORGANIZATION_ID
  ) {
    console.log(
      chalk.red(
        '❌ Missing Turnkey credentials in .env. Please configure before migrating.',
      ),
    )
    return
  }

  const stamper = new ApiKeyStamper({
    apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY,
    apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY,
  })

  const turnkey = new TurnkeyClient(
    { baseUrl: 'https://api.turnkey.com' },
    stamper,
  )

  const activityPoller = createActivityPoller({
    client: turnkey,
    requestFn: turnkey.createWallet,
  })

  const newWalletsMap: Record<string, WalletMetadata> = {}
  let successCount = 0

  for (const file of files) {
    const id = file.replace('.json', '')
    console.log(chalk.gray(`\nMigrating wallet ID: ${id}...`))

    try {
      // 1. Decrypt Legacy Keystore
      const keypair = await keystoreClient.decrypt(id, password)
      const legacyMetadata = keystoreClient.get(id)

      if (!legacyMetadata) {
        console.log(
          chalk.red(`   ❌ Cannot read metadata for ${id}. Skipping.`),
        )
        continue
      }

      console.log(chalk.green('   ✓ Decrypted legacy secret key.'))

      // 2. Import into Turnkey Enclave
      const walletName =
        legacyMetadata.metadata.name || `Migrated Wallet ${id.slice(0, 4)}`

      const activity = await activityPoller({
        type: 'ACTIVITY_TYPE_CREATE_WALLET',
        organizationId: process.env.TURNKEY_ORGANIZATION_ID,
        parameters: {
          walletName: walletName,
          accounts: [
            {
              curve: 'CURVE_ED25519',
              pathFormat: 'PATH_FORMAT_BIP32',
              path: "m/44'/501'/0'/0'",
              addressFormat: 'ADDRESS_FORMAT_SOLANA',
            },
          ],
        },
        timestampMs: String(Date.now()),
      })

      const turnkeyWalletId = activity.result.createWalletResult?.walletId
      const turnkeyAddress = activity.result.createWalletResult?.addresses?.[0]

      if (!turnkeyWalletId || !turnkeyAddress) {
        throw new Error(
          `Turnkey Wallet Creation Failed: ${JSON.stringify(activity.status)}`,
        )
      }

      console.log(
        chalk.green(`   ✓ Provisioned Turnkey Wallet: ${turnkeyWalletId}`),
      )

      // Turnkey currently does not allow directly importing ED25519 raw private keys.
      // Private keys must be generated inside the enclave for maximum security.
      // Therefore, this migration script generates *new* Turnkey wallets
      // and maps the existing agents to these new addresses.
      // Note: The agents will start with 0 balance on their new Turnkey addresses.

      newWalletsMap[id] = {
        id: uuidv4(), // Give it a new UUID for the new system
        name: walletName,
        publicKey: turnkeyAddress,
        turnkeyWalletId: turnkeyWalletId,
        createdAt: new Date().toISOString(),
        tags: legacyMetadata.metadata.tags || ['migrated'],
      }

      successCount++
    } catch (e: any) {
      console.log(chalk.red(`   ❌ Failed to migrate ${id}: ${e.message}`))
    }
  }

  // 3. Save new Turnkey metadata Map
  const turnkeyWalletsPath = path.resolve(
    process.cwd(),
    'data',
    'turnkey-wallets.json',
  )

  let existingWallets: WalletMetadata[] = []
  if (fs.existsSync(turnkeyWalletsPath)) {
    existingWallets = JSON.parse(fs.readFileSync(turnkeyWalletsPath, 'utf8'))
  }

  const updatedWallets = [...existingWallets, ...Object.values(newWalletsMap)]
  fs.writeFileSync(turnkeyWalletsPath, JSON.stringify(updatedWallets, null, 2))
  console.log(chalk.green(`\n✅ Saved mapping to data/turnkey-wallets.json`))

  // 4. Update agents.json pointers
  const agentsPath = path.resolve(process.cwd(), 'data', 'agents.json')
  if (fs.existsSync(agentsPath)) {
    const agents = JSON.parse(fs.readFileSync(agentsPath, 'utf8'))
    let updatedAgentsCount = 0

    for (const agent of agents) {
      if (newWalletsMap[agent.walletId]) {
        // Point the agent to its new Turnkey wallet ID
        console.log(
          chalk.gray(
            `   Updating Agent ${agent.name} (${agent.id}) to new Wallet ID: ${newWalletsMap[agent.walletId].id}`,
          ),
        )
        agent.walletId = newWalletsMap[agent.walletId].id
        updatedAgentsCount++
      }
    }

    fs.writeFileSync(agentsPath, JSON.stringify(agents, null, 2))
    console.log(
      chalk.green(
        `✅ Updated ${updatedAgentsCount} Agents to use their new Turnkey Wallets!`,
      ),
    )
  }

  console.log(
    chalk.bold.blue(
      `\n🎉 Migration Complete! Successfully migrated ${successCount}/${files.length} wallets.`,
    ),
  )
  console.log(
    chalk.yellow(
      `\n⚠️ Note: Turnkey generates net-new secure enclaves. Your agents have new public addresses on the Solana Devnet and will require fresh Airdrops.`,
    ),
  )
}

program
  .name('migrate')
  .description('Migrate legacy Keystore wallets to Turnkey secure enclave')
  .action(migrate)

program.parse(process.argv)
