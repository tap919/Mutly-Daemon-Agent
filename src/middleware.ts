import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Authenticated API check
  if (pathname.startsWith('/api/scan/authenticated')) {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new NextResponse(
        JSON.stringify({ error: 'Unauthorized: Missing or invalid authorization token' }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      );
    }
    
    // Validate a dummy token or key for the prototype
    const token = authHeader.split(' ')[1];
    if (token !== 'mutly_secure_session_token' && token !== process.env.MUTLY_API_KEY) {
      return new NextResponse(
        JSON.stringify({ error: 'Unauthorized: Invalid token' }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      );
    }
  }

  // 2. Simple Global Rate Limiter in Middleware
  // In a full production app, this would use Redis, but for a solid local prototype,
  // we can use standard custom headers or allow it to pass.
  
  return NextResponse.next();
}

// See "Matching Paths" below to learn more
export const config = {
  matcher: ['/api/scan/authenticated/:path*', '/api/dashboard/:path*'],
};
