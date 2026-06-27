// Custom lightweight Stripe API client using native fetch
// Keeps the bundle light and avoids external npm dependencies

export interface StripePaymentIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
}

export class StripeClient {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.STRIPE_SECRET_KEY || '';
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (!this.apiKey) {
      throw new Error('Stripe API Key is not configured');
    }

    const response = await fetch(`https://api.stripe.com/v1${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Stripe API Request Failed');
    }

    return response.json() as Promise<T>;
  }

  async retrievePaymentIntent(id: string): Promise<StripePaymentIntent> {
    return this.request<StripePaymentIntent>(`/payment_intents/${id}`);
  }

  // Pure cryptographic verification of Stripe webhooks without the stripe npm package
  // Uses Web Crypto API (SubtleCrypto) which is native to Node.js and Next.js Edge/Server runtimes
  async verifyWebhookSignature(
    payload: string,
    signatureHeader: string,
    secret: string
  ): Promise<boolean> {
    try {
      if (!signatureHeader || !secret) return false;

      // Header format: t=123456789,v1=sha256_hash_value
      const parts = signatureHeader.split(',');
      const timestampPart = parts.find((p) => p.startsWith('t='));
      const signaturePart = parts.find((p) => p.startsWith('v1='));

      if (!timestampPart || !signaturePart) return false;

      const timestamp = timestampPart.split('=')[1];
      const signature = signaturePart.split('=')[1];

      // Standard Stripe webhook signature check
      const signedPayload = `${timestamp}.${payload}`;
      const encoder = new TextEncoder();
      
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const signatureBytes = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(signedPayload)
      );

      // Convert signature to hex
      const calculatedHex = Array.from(new Uint8Array(signatureBytes))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      return calculatedHex === signature;
    } catch {
      return false;
    }
  }
}

export const stripe = new StripeClient();
