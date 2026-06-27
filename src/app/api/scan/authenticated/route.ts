import { NextRequest, NextResponse } from 'next/server';
import { evaluate } from '@/engine/evaluate';
import { saveScan } from '@/lib/db/scans';
import type { ScanApiRequest, ScanApiResponse } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body: ScanApiRequest = await request.json();
    const { payload } = body;

    if (!payload || !payload.type || !payload.data) {
      return NextResponse.json({ error: 'Invalid request: Missing payload, type, or data' }, { status: 400 });
    }

    // Since this is authenticated/authenticated subscription endpoint, 
    // we do not require individual PaymentIntentIds here.

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
