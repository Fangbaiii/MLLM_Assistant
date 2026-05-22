import { NextResponse } from "next/server";
import { registerUser } from "@/server/auth/auth-service";

export async function POST(request: Request) {
  try {
    const { email, password, name } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "邮箱和密码不能为空" }, { status: 400 });
    }

    const result = await registerUser(email, password, name);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, user: result.user });
  } catch (error) {
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
