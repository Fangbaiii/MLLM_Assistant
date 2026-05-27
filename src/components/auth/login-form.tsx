"use client";

import { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginFormInner() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const visibleSuccess = success || (searchParams.get("registered") ? "注册成功，请使用新账号登录" : "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("邮箱或密码错误");
      } else {
        router.push("/chat");
        router.refresh();
      }
    } catch (err) {
      setError("登录时发生意外错误");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md p-8 bg-white border border-gray-200 rounded-2xl shadow-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">欢迎回来</h1>
        <p className="mt-2 text-sm text-gray-500">请输入你的账号密码以访问 MLLM Assistant</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">邮箱地址</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
            placeholder="admin@example.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">密码</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg">
            {error}
          </div>
        )}

        {visibleSuccess && (
          <div className="p-3 text-sm text-green-600 bg-green-50 border border-green-100 rounded-lg">
            {visibleSuccess}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 px-4 bg-gray-900 hover:bg-black text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "登录中..." : "立即登录"}
        </button>

        <div className="text-center text-sm text-gray-500">
          还没有账号？{" "}
          <Link href="/register" className="text-primary font-medium hover:underline">
            立即注册
          </Link>
        </div>

        <div className="text-center text-xs text-gray-400">
          演示账号: admin@example.com / password123
        </div>
      </form>
    </div>
  );
}

export function LoginForm() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground text-center">加载中...</div>}>
      <LoginFormInner />
    </Suspense>
  );
}
