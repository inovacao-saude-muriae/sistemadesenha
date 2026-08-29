import { NextResponse } from "next/server";

// Rotas completamente públicas — sem sessão
const PUBLIC = ["/login"];

// Rotas que exigem sessão
const PROTECTED = ["/home", "/admin", "/monitor"];

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Ignora estáticos e APIs
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Raiz → /login
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Rotas públicas passam livres
  if (PUBLIC.some((r) => pathname === r || pathname.startsWith(r + "/"))) {
    return NextResponse.next();
  }

  // Rotas protegidas → verifica cookie de sessão
  // A sessão fica no localStorage (client-only), então no middleware
  // verificamos um cookie que o client seta ao fazer login
  if (PROTECTED.some((r) => pathname === r || pathname.startsWith(r + "/"))) {
    const session = request.cookies.get("session");
    if (!session?.value) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.next();
  }

  // Qualquer outra rota → /login
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
