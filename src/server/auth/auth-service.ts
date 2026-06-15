import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function verifyUser(email: string, password: string) {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    console.log(`[AuthService] Verifying user: ${normalizedEmail}`);
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      console.log(`[AuthService] User NOT found: ${normalizedEmail}`);
      return null;
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    console.log(`[AuthService] Password valid: ${isValid}`);

    if (isValid) {
      return {
        id: user.id,
        name: user.name,
        email: user.email,
      };
    }

    return null;
  } catch (error) {
    console.error("[AuthService] Database error:", error);
    return null;
  }
}

export async function registerUser(email: string, password: string, name?: string) {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = name?.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return { error: "邮箱格式不正确" };
    }
    if (password.length < 8) {
      return { error: "密码至少需要 8 位" };
    }
    if (normalizedName && normalizedName.length > 40) {
      return { error: "昵称不能超过 40 个字符" };
    }

    console.log(`[AuthService] Registering user: ${normalizedEmail}`);
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      console.log(`[AuthService] Email already exists: ${normalizedEmail}`);
      return { error: "该邮箱已被注册" };
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash: hashedPassword,
        name: normalizedName || normalizedEmail.split("@")[0],
      },
    });

    console.log(`[AuthService] User created: ${user.id}`);
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    };
  } catch (error) {
    console.error("[AuthService] Registration error:", error);
    return { error: "注册失败，请稍后再试" };
  }
}
