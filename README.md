# MLLM Studio

一个前端 AI SaaS Demo，面向多模态大模型课程展示。

## 功能

- `/`：dashboard 风格首页
- `/chat`：ChatGPT 风格工作台
- 左侧会话管理：新建、搜索、重命名、置顶、复制、清空、删除
- 图片上传：拖拽、点击、多图、预览、删除、进度、类型校验
- 模型回答：Markdown、LaTeX、代码高亮、代码复制、推理折叠
- 证据面板：OCR、截图预览、VLM 证据 badge
- mock 接口：`POST /api/chat`、`POST /api/upload`、`GET /api/history`

## 技术栈

- Next.js 16
- React 19
- TypeScript
- TailwindCSS v4
- shadcn/ui
- Framer Motion
- Lucide React
- Zustand
- React Query
- Axios
- react-markdown / remark-gfm / rehype-highlight / rehype-katex / katex

## 本地运行

### 1. 安装依赖

在项目目录执行：

```bash
pnpm install
```

如果你的系统没有全局 `pnpm`，可以先安装 pnpm，或直接使用本机可用的 `pnpm.CMD`。

### 2. 启动开发服务

```bash
pnpm dev
```

默认打开：

- [http://127.0.0.1:3000](http://127.0.0.1:3000)

### 3. 生产构建

```bash
pnpm build
pnpm start
```

### 4. 代码检查

```bash
pnpm lint
```

## 页面怎么用

### 首页 `/`

- 顶部是产品导航和进入工作台按钮
- 中间 Hero 是更像真实 AI 产品的首屏
- 下方展示 capability cards、API 预留和能力跑马灯

### 聊天页 `/chat`

- 左侧是会话栏
- 中间是聊天区
- 右侧是证据面板
- 底部输入框支持回车发送，Shift+Enter 换行

### 上传

- 点击左下或输入区的上传按钮
- 支持 PNG / JPG / WEBP / GIF
- 上传后会在聊天区和证据面板显示预览

### 模式

- `默认`：轻量回答
- `/explain`：更结构化
- `/think`：更长的推理与更慢的流式节奏

### 会话管理

每个会话支持：

- 重命名
- 置顶 / 取消置顶
- 复制
- 清空消息
- 删除

会话和偏好会保存在浏览器 `localStorage` 里。

## Mock API 说明

### `POST /api/chat`

请求体示例：

```ts
{
  sessionId: string;
  message: string;
  mode: "default" | "explain" | "think";
  model: string;
  attachmentIds: string[];
}
```

返回：

- `message`
- `ocrBlocks`

### `POST /api/upload`

- 接收 `FormData`
- 字段名：`files`
- 返回 mock 文件列表和 OCR 片段

### `GET /api/history`

- 返回初始会话列表

## 调试指南

### 1. 页面空白或样式异常

- 先跑 `pnpm build`
- 再确认 `src/app/layout.tsx` 里的字体和全局样式是否正常加载
- 若浏览器已有旧缓存，清掉 localStorage 再刷新

清缓存方式：

```js
localStorage.removeItem("mllm-studio-chat");
location.reload();
```

也可以在侧边栏 `设置` 里执行清缓存。

### 2. 上传不生效

检查：

- 文件类型是否是 PNG / JPG / WEBP / GIF
- 是否真的点到了上传按钮
- 浏览器控制台是否有 `File type` 或 `FormData` 报错

### 3. 会话状态怪怪的

原因通常是浏览器里存了旧的会话快照。

处理：

- 侧边栏 `设置` -> `清空本地缓存`
- 或执行 `localStorage.removeItem("mllm-studio-chat")`

### 4. 发送后没有流式效果

确认：

- `POST /api/chat` 是否正常返回
- `src/lib/mock-chat.ts` 是否还在生成流式帧
- 右侧证据面板是否被遮挡

### 5. 代码块 / LaTeX 渲染异常

检查这几个依赖是否都在：

- `react-markdown`
- `remark-gfm`
- `rehype-highlight`
- `rehype-katex`
- `katex`

同时确认 `src/app/layout.tsx` 已经引入 `katex/dist/katex.min.css`。

### 6. 端口被占用

换端口启动：

```bash
pnpm dev -- --port 3001
```

## 关键文件

- `src/app/page.tsx`：首页
- `src/app/chat/page.tsx`：聊天页入口
- `src/components/chat/chat-workspace.tsx`：主工作台布局
- `src/components/chat/chat-sidebar.tsx`：会话管理
- `src/components/chat/chat-composer.tsx`：输入与发送
- `src/components/chat/chat-message.tsx`：消息气泡与 markdown
- `src/lib/mock-chat.ts`：mock 回答和流式帧
- `src/store/chat-store.ts`：会话状态
- `src/app/api/chat/route.ts`：mock chat 接口

## 后续接真实后端

后面把 mock 接口换成真实模型服务时，优先改这两个地方：

1. `src/lib/api.ts`
2. `src/app/api/chat/route.ts`

如果你要接 FastAPI / vLLM，只需要保持接口签名不变，前端大部分代码不用动。



