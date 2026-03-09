import { PublicKey, Signer } from '@solana/web3.js'
import { ApiKeyStamper } from '@turnkey/api-key-stamper'
import { TurnkeyClient, createActivityPoller } from '@turnkey/http'

export class TurnkeySigner implements Signer {
  public publicKey: PublicKey
  public secretKey: Uint8Array = new Uint8Array() // Never exposed

  // Custom proxy method for asynchronous Turnkey enclave signing
  public async signTransaction(transaction: any): Promise<any> {
    if (transaction.version !== undefined) {
      // VersionedTransaction
      const message = transaction.message.serialize()
      const signature = await this.signMessage(message)
      transaction.addSignature(this.publicKey, signature)
      return transaction
    } else {
      // Legacy Transaction
      const message = transaction.serializeMessage()
      const signature = await this.signMessage(message)
      transaction.addSignature(this.publicKey, Buffer.from(signature))
      return transaction
    }
  }

  private client: TurnkeyClient
  private organizationId: string
  private turnkeyWalletId: string
  private walletAccountAddress: string

  constructor(
    publicKey: string,
    turnkeyWalletId: string,
    walletAccountAddress: string,
  ) {
    this.publicKey = new PublicKey(publicKey)
    this.turnkeyWalletId = turnkeyWalletId
    this.walletAccountAddress = walletAccountAddress
    this.organizationId = process.env.TURNKEY_ORGANIZATION_ID!

    const stamper = new ApiKeyStamper({
      apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
      apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
    })

    this.client = new TurnkeyClient(
      { baseUrl: 'https://api.turnkey.com' },
      stamper,
    )
  }

  /**
   * Request Turnkey to sign a raw Solana message
   */
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const payload = Buffer.from(message).toString('hex')

    // We create a Turnkey Activity to sign the raw payload matching this wallet's account
    const activityPoller = createActivityPoller({
      client: this.client,
      requestFn: this.client.signRawPayload,
    })

    const activity = await activityPoller({
      type: 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2',
      organizationId: this.organizationId,
      parameters: {
        signWith: this.walletAccountAddress,
        payload,
        encoding: 'PAYLOAD_ENCODING_HEXADECIMAL',
        hashFunction: 'HASH_FUNCTION_NOT_APPLICABLE', // Solana signs the raw message directly
      },
      timestampMs: String(Date.now()),
    })

    const signatureHex =
      activity.result.signRawPayloadResult?.r +
      activity.result.signRawPayloadResult?.s
    if (!signatureHex) {
      throw new Error(
        `Turnkey signing failed: ${JSON.stringify(activity.status)}`,
      )
    }

    return Uint8Array.from(Buffer.from(signatureHex, 'hex'))
  }
}
