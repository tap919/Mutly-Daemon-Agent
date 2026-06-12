import { NextRequest, NextResponse } from 'next/server';
import { evaluate } from '@/engine/evaluate';
import { saveScan } from '@/lib/db/scans';
import { stripe } from '@/lib/stripe';
import type { ScanApiRequest, ScanApiResponse } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body: ScanApiRequest = await request.json();
    const { payload, paymentIntentId } = body;

    if (!payload || !payload.type || !payload.data) {
      return NextResponse.json({ error: 'Invalid request: Missing payload, type, or data' }, { status: 400 });
    }

    // Optional Stripe PaymentIntent Verification
    if (paymentIntentId) {
      try {
        const paymentIntent = await stripe.retrievePaymentIntent(paymentIntentId);
        if (paymentIntent.status !== 'succeeded') {
          return NextResponse.json(
            { error: `Payment failed: Status is ${paymentIntent.status}` },
            { status: 402 }
          );
        }
      } catch (err: any) {
        return NextResponse.json(
          { error: `Payment verification failed: ${err.message}` },
          { status: 402 }
        );
      }
    }

    // Run deterministic audit scanner
    const report = evaluate(payload);

    // Persist scan history
    await saveScan(report);

    const response: ScanApiResponse = { report };
    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'An unexpected error occurred' }, { status: 500 });
  }
}
