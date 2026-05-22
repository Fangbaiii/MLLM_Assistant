import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function verifyUser(email: string, password: string) {
  try {
    console.log(`[AuthService] Verifying user: ${email}`);
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      console.log(`[AuthService] User NOT found: ${email}`);
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
    console.log(`[AuthService] Registering user: ${email}`);
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      console.log(`[AuthService] Email already exists: ${email}`);
      return { error: "该邮箱已被注册" };
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: hashedPassword,
        name: name || email.split("@")[0],
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
