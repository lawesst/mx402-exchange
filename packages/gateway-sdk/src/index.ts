export type GatewayClientOptions = {
  baseUrl: string;
  apiKey: string;
};

export class GatewayClient {
  constructor(private readonly options: GatewayClientOptions) {}

  async callProduct(productId: string, input: unknown, idempotencyKey: string) {
    const response = await fetch(`${this.options.baseUrl}/v1/gateway/products/${productId}/call`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`,
        "idempotency-key": idempotencyKey
      },
      body: JSON.stringify(input)
    });

    return response.json();
  }
}
