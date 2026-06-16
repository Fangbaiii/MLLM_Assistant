"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";

export function RegisterForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await axios.post("/api/auth/register", {
        email,
        password,
        name,
      });

      if (response.data.success) {
        // 注册成功后跳转到登录页
        router.push("/login?registered=true");
      }
    } catch (err: unknown) {
      const message =
        axios.isAxiosError<{ error?: string }>(err) ? err.response?.data?.error : null;
      setError(message || "注册失败，请稍后再试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md p-8 bg-white border border-gray-200 rounded-2xl shadow-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">创建账号</h1>
        <p className="mt-2 text-sm text-gray-500">加入 MLLM Assistant，开启多模态 AI 之旅</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">姓名（可选）</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
            placeholder="您的称呼"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">邮箱地址</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
            placeholder="example@mail.com"
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
            placeholder="至少 6 位字符"
            minLength={6}
          />
        </div>

        {error && (
          <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 px-4 bg-gray-900 hover:bg-black text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "注册中..." : "立即注册"}
        </button>

        <div className="text-center text-sm text-gray-500">
          已有账号？{" "}
          <Link href="/login" className="text-primary font-medium hover:underline">
            立即登录
          </Link>
        </div>
      </form>
    </div>
  );
}
