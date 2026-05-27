# MLLM Studio 🚀

[![Next.js](https://img.shields.io/badge/Next.js-15+-black?logo=next.js)](https://nextjs.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma)](https://www.prisma.io/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**MLLM Studio** 是一款多模态 AI 交互设计的全栈工作台。它集成了先进的文档解析、安全的用户管理体系以及高度可定制的 Prompt 引擎，旨在为用户提供从数据上传到深度推理的闭环体验。

---

## ✨ 核心特性

- 🔐 **全栈安全体系**: 集成 Auth.js (v5)，支持邮箱/密码登录与注册，具备完善的路由保护机制。
- 📦 **持久化数据存储**: 基于 Prisma + PostgreSQL，确保所有聊天记录、会话元数据实时落库。
- 🛡️ **账号级数据隔离**: 严密的租户隔离逻辑，确保用户隐私与对话记忆的绝对独立。
- 🧠 **动态 Prompt 引擎**: 数据库级 System Prompt 管理，预设“直接回答”、“详细解释”、“深度思考”三种专业模式。
- 📄 **多模态文件处理**: 支持 PDF 与多格式图片上传，内置 OCR 识别流与视觉路由分发。
- 🧪 **证据链路追踪**: 独特的“证据面板”设计，支持将模型推理依据与原始文档片段精准对齐。

---

## 🛠️ 技术架构

### 前端 (Frontend)
- **Framework**: [Next.js 15+](https://nextjs.org/) (App Router)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/)
- **State Management**: [Zustand](https://zustand-demo.pmnd.rs/)
- **Animation**: [Framer Motion](https://www.framer.com/motion/)
- **Components**: [shadcn/ui](https://ui.shadcn.com/)

### 后端 (Backend)
- **Runtime**: [Node.js](https://nodejs.org/)
- **Database**: [PostgreSQL](https://www.postgresql.org/)
- **ORM**: [Prisma 6](https://www.prisma.io/)
- **Authentication**: [Auth.js](https://authjs.dev/) (NextAuth v5 Beta)

---

## 🚀 快速开始

### 前置要求
- **Node.js**: v20.0.0 或更高版本（推荐）
- **pnpm**: v9.0.0 或更高版本（若 Corepack 异常可用 `npx -y pnpm@9.15.9`）

### 安装步骤

1. **克隆仓库**
   ```bash
   git clone https://github.com/Fangbaiii/MLLM_Assistant.git
   cd MLLM_Assistant
   ```

2. **安装依赖**
   ```bash
   npx -y pnpm@9.15.9 install
   ```

3. **环境配置**
   在项目根目录创建 `.env` 文件，并填入以下必要变量：
   ```env
   # 数据库连接
   DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB_NAME?schema=public&sslmode=require"
   # Auth.js 密钥 (可通过 npx auth secret 生成)
   AUTH_SECRET="your-32-character-secret-key"
   
   # OCR 服务（同步解析）
   PADDLEOCR_DOC_PARSING_API_URL="https://your-api-url/layout-parsing"
   PADDLEOCR_ACCESS_TOKEN="your-token"

   # 多模态模型服务（OpenAI-compatible）
   MLLM_MODEL_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
   MLLM_MODEL_NAME="qwen3-vl-plus"
   MLLM_MODEL_API_KEY="your-model-api-key"

   # 上下文窗口裁剪
   MLLM_CONTEXT_WINDOW_CHARS="18000"
   MLLM_CONTEXT_MAX_MESSAGES="16"

   # 上传文件持久化目录
   MLLM_STORAGE_DIR="/mnt/data/tianyi/MLLM_Assistant/uploads"
   ```

4. **初始化数据库**
   ```bash
   npx prisma db push
   npx prisma db seed
   ```

5. **启动开发服务器**
   ```bash
   npx -y pnpm@9.15.9 dev --hostname 127.0.0.1 --port 3000
   ```
   打开浏览器访问 [http://localhost:3000](http://localhost:3000)。

### 通过 SSH 访问（远程服务器）
本地终端先建立端口转发：
```bash
ssh -N -L 3000:127.0.0.1:3000 USER@SERVER_IP
```
然后浏览器访问：
```text
http://127.0.0.1:3000/
```

---

## 📂 目录结构

```text
├── prisma/               # 数据库 Schema 与迁移脚本
├── public/               # 静态资源文件
├── src/
│   ├── app/              # Next.js 页面与 API 路由
│   ├── components/       # UI 组件与业务组件
│   ├── hooks/            # 自定义 React Hooks
│   ├── lib/              # 通用工具类与单例 (Prisma, API Client)
│   ├── server/           # 核心业务服务逻辑 (Auth, Chat, Prompt)
│   ├── store/            # Zustand 状态库
│   └── types/            # TypeScript 类型定义
└── .env                  # 环境变量配置 (不进入 Git)
```

---

## 🤝 协作开发

本项目采用模块化设计，方便多角色协同：
- **模型接入者**: 关注 `src/app/api/chat/route.ts`，利用 `src/server/chat/prompt-service.ts` 获取预存指令。
- **UI 开发者**: 关注 `src/components/`，使用现有的 shadcn/ui 组件库进行扩展。
- **数据管理者**: 运行 `npx prisma studio` 即可可视化管理本地数据库。

---

## 🗺️ 路线图 (Roadmap)

- [x] 用户系统与 Session 持久化
- [x] 会话管理 (CRUD) 闭环
- [x] 账号数据彻底隔离
- [x] 动态 Prompt 预存系统
- [x] 接入 DeepSeek/OpenAI 真实流式输出
- [x] 接入云端 PostgreSQL 数据库
- [x] 支持多轮对话的上下文窗口自动裁剪
- [x] 接入 Qwen3-VL 云端多模态 API（OpenAI-compatible）
- [x] 接入 PaddleOCR 同步文档解析（含图片/PDF 上传链路）

---

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 协议开源。
