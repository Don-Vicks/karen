declare module '@turnkey/http' {
  export class TurnkeyClient {
    constructor(config: { baseUrl: string }, stamper: any)
    createWallet(params: any): Promise<any>
    signRawPayload(params: any): Promise<any>
  }
  export function createActivityPoller(
    params: any,
  ): (params: any) => Promise<any>
}

declare module '@turnkey/api-key-stamper' {
  export class ApiKeyStamper {
    constructor(config: { apiPublicKey: string; apiPrivateKey: string })
  }
}
