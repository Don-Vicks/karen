import { Keypair } from '@solana/web3.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { EncryptedKeystore } from '../types'

// ============================================
// Encrypted Keystore Manager
// ============================================
// AES-256-GCM encryption for private keys at rest
// Uses scrypt for password-based key derivation

const SCRYPT_PARAMS = {
  n: 16384, // CPU/memory cost — secure while staying within Node.js memory limits
  r: 8,
  p: 1,
  dklen: 32, // 256-bit key
  maxmem: 64 * 1024 * 1024, // 64MB — ensures scrypt doesn't hit Node.js memory cap
}

const DATA_DIR = path.resolve(process.cwd(), 'data', 'keystores')

export class Keystore {
  private dataDir: string

  constructor(dataDir?: string) {
    this.dataDir = dataDir || DATA_DIR
    this.ensureDir()
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true })
    }
  }

  /**
   * Encrypt a keypair and save to disk
   */
  async encrypt(
    keypair: Keypair,
    password: string,
    metadata: {
      id: string
      name: string
      derivationIndex?: number
      tags?: string[]
    },
  ): Promise<EncryptedKeystore> {
    const salt = crypto.randomBytes(32)
    const iv = crypto.randomBytes(16)

    // Derive encryption key from password using scrypt
    const derivedKey = await this.deriveKey(password, salt)

    // Encrypt the secret key
    const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv)
    const secretKeyBuffer = Buffer.from(keypair.secretKey)
    const encrypted = Buffer.concat([
      cipher.update(secretKeyBuffer),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()

    const keystore: EncryptedKeystore = {
      version: 1,
      id: metadata.id,
      address: keypair.publicKey.toBase58(),
      crypto: {
        cipher: 'aes-256-gcm',
        ciphertext: encrypted.toString('hex'),
        cipherparams: {
          iv: iv.toString('hex'),
          tag: authTag.toString('hex'),
        },
        kdf: 'scrypt',
        kdfparams: {
          ...SCRYPT_PARAMS,
          salt: salt.toString('hex'),
        },
      },
      metadata: {
        name: metadata.name,
        createdAt: new Date().toISOString(),
        derivationIndex: metadata.derivationIndex,
        tags: metadata.tags || [],
      },
    }

    // Save to disk
    const filepath = this.getFilepath(metadata.id)
    fs.writeFileSync(filepath, JSON.stringify(keystore, null, 2))

    return keystore
  }

  /**
   * Decrypt a keystore and return the keypair
   */
  async decrypt(id: string, password: string): Promise<Keypair> {
    const filepath = this.getFilepath(id)

    if (!fs.existsSync(filepath)) {
      throw new Error(`Keystore not found: ${id}`)
    }

    const keystore: EncryptedKeystore = JSON.parse(
      fs.readFileSync(filepath, 'utf-8'),
    )

    const salt = Buffer.from(keystore.crypto.kdfparams.salt, 'hex')
    const iv = Buffer.from(keystore.crypto.cipherparams.iv, 'hex')
    const tag = Buffer.from(keystore.crypto.cipherparams.tag, 'hex')
    const ciphertext = Buffer.from(keystore.crypto.ciphertext, 'hex')

    // Derive key from password
    const derivedKey = await this.deriveKey(password, salt)

    // Decrypt
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv)
    decipher.setAuthTag(tag)

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ])

    return Keypair.fromSecretKey(new Uint8Array(decrypted))
  }

  /**
   * List all keystores (without decrypting)
   */
  list(): EncryptedKeystore[] {
    this.ensureDir()
    const files = fs
      .readdirSync(this.dataDir)
      .filter((f) => f.endsWith('.json'))
    return files.map((f) => {
      const content = fs.readFileSync(path.join(this.dataDir, f), 'utf-8')
      return JSON.parse(content) as EncryptedKeystore
    })
  }

  /**
   * Get a specific keystore metadata (without decrypting)
   */
  get(id: string): EncryptedKeystore | null {
    const filepath = this.getFilepath(id)
    if (!fs.existsSync(filepath)) return null
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'))
  }

  /**
   * Delete a keystore
   */
  delete(id: string): boolean {
    const filepath = this.getFilepath(id)
    if (!fs.existsSync(filepath)) return false
    fs.unlinkSync(filepath)
    return true
  }

  /**
   * Check if a keystore exists
   */
  exists(id: string): boolean {
    return fs.existsSync(this.getFilepath(id))
  }

  private getFilepath(id: string): string {
    return path.join(this.dataDir, `${id}.json`)
  }

  private deriveKey(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.scrypt(
        password,
        salt,
        SCRYPT_PARAMS.dklen,
        {
          N: SCRYPT_PARAMS.n,
          r: SCRYPT_PARAMS.r,
          p: SCRYPT_PARAMS.p,
          maxmem: SCRYPT_PARAMS.maxmem,
        },
        (err, derivedKey) => {
          if (err) reject(new Error(`Invalid scrypt params: ${err.message}`))
          else resolve(derivedKey as Buffer)
        },
      )
    })
  }
}
