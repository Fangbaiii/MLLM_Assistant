import { auth } from "@/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  const isLoggedIn = !!req.auth
  const isOnChat = req.nextUrl.pathname.startsWith("/chat")
  const isApiRoute = req.nextUrl.pathname.startsWith("/api")

  // 如果是访问聊天页面但没登录，跳登录页
  if (isOnChat && !isLoggedIn) {
    return NextResponse.redirect(new URL("/login", req.nextUrl))
  }

  // 如果已经登录且在访问登录页，跳聊天页
  if (req.nextUrl.pathname === "/login" && isLoggedIn) {
    return NextResponse.redirect(new URL("/chat", req.nextUrl))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
