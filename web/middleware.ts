import { NextRequest, NextResponse } from 'next/server';

const apiUrl = process.env.API_URL || 'http://localhost:3001';
const SESSION_COOKIE_NAME = 'frigg_sid';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME);

  if (!sessionCookie) {
    if (pathname === '/login') return NextResponse.next();
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Cookie present — confirm it's still valid and check forced-password-change
  // state. The API is the source of truth; middleware never touches Postgres.
  let mustChangePassword = false;
  try {
    const res = await fetch(`${apiUrl}/api/auth/me`, {
      headers: { Cookie: req.headers.get('cookie') ?? '' },
    });
    if (!res.ok) {
      if (pathname === '/login') return NextResponse.next();
      const redirectRes = NextResponse.redirect(new URL('/login', req.url));
      redirectRes.cookies.delete(SESSION_COOKIE_NAME);
      return redirectRes;
    }
    const { user } = await res.json();
    mustChangePassword = Boolean(user?.mustChangePassword);
  } catch {
    // API unreachable — let the request through; page-level fetches will surface the error.
    return NextResponse.next();
  }

  if (mustChangePassword && pathname !== '/change-password') {
    return NextResponse.redirect(new URL('/change-password', req.url));
  }
  if (!mustChangePassword && pathname === '/change-password') {
    return NextResponse.redirect(new URL('/', req.url));
  }
  if (pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
