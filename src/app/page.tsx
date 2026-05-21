"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { Variants } from "framer-motion";
import {
  ArrowRight,
  Brain,
  FileText,
  Gauge,
  ImageIcon,
  Layers3,
  MessageSquareText,
  ScanText,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "@/components/ui/icons";
import { AnimatedBackground } from "@/components/landing/animated-background";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const features = [
  {
    icon: ImageIcon,
    title: "自然图片理解",
    body: "商品图、场景图和截图都能进入同一套视觉问答流程。",
  },
  {
    icon: FileText,
    title: "文档与 PPT 问答",
    body: "通过 OCR、页面级证据和提示词路由补齐多页文档能力。",
  },
  {
    icon: ScanText,
    title: "OCR 证据面板",
    body: "展示识别文本、置信度与页面来源，让回答可追溯。",
  },
  {
    icon: Brain,
    title: "推理过程折叠",
    body: "保留思考链路，但默认收起，让界面更像成熟产品。",
  },
];

const capabilityTicker = [
  "Input routing",
  "OCR evidence",
  "Markdown",
  "LaTeX",
  "Code copy",
  "Session memory",
  "Token streaming",
  "Document preview",
];

const pipeline = [
  { label: "路由", text: "图片 / 截图 / 文档页面", score: 94 },
  { label: "OCR", text: "提取标题、公式、表格文本", score: 88 },
  { label: "召回", text: "候选页与证据片段", score: 91 },
  { label: "回答", text: "Markdown + 引用 + 流式输出", score: 97 },
];

const metrics = [
  { icon: Workflow, label: "3 条主路径", value: "图像 / 单页 / 多页" },
  { icon: Gauge, label: "接口形态", value: "Mock stream" },
  { icon: ShieldCheck, label: "保留契约", value: "/api/chat" },
];

const container: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] } },
};

function CapabilityTicker() {
  const labels = [...capabilityTicker, ...capabilityTicker];

  return (
    <div className="relative mx-auto mt-10 max-w-7xl overflow-hidden border-y border-border/70 bg-background/60 py-3">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-background to-transparent" />
      <motion.div
        className="flex w-max gap-3"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 24, repeat: Infinity, ease: "linear" }}
      >
        {labels.map((label, index) => (
          <span
            key={`${label}-${index}`}
            className="rounded-full border border-border/70 bg-card px-4 py-1.5 text-xs text-muted-foreground"
          >
            {label}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

function HeroPreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="premium-panel relative overflow-hidden rounded-lg p-4"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_0%,color-mix(in_oklab,var(--primary)_22%,transparent),transparent_32rem)]" />

      <div className="relative flex flex-col overflow-hidden rounded-lg border border-border/70 bg-card/80">
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[color-mix(in_oklab,var(--primary)_90%,white)]" />
            <span className="size-2 rounded-full bg-[color-mix(in_oklab,var(--accent)_80%,white)]" />
            <span className="size-2 rounded-full bg-muted-foreground/30" />
          </div>
          <Badge variant="secondary" className="bg-secondary/60 text-secondary-foreground">
            预览窗口
          </Badge>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-[0.92fr_1.08fr]">
          <div className="rounded-lg border border-border/70 bg-background/70 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Layers3 className="size-4 text-primary" />
              证据链路
            </div>
            <div className="space-y-3">
              {pipeline.map((stage, index) => (
                <motion.div
                  key={stage.label}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 + index * 0.1 }}
                  className="rounded-lg border border-border/70 bg-card/70 p-3"
                >
                  <div className="flex items-center justify-between text-sm text-card-foreground">
                    <span>{stage.label}</span>
                    <motion.span
                      animate={{ opacity: [0.45, 1, 0.45] }}
                      transition={{ duration: 2.4, repeat: Infinity, delay: index * 0.15 }}
                    >
                      {stage.score}%
                    </motion.span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{stage.text}</p>
                  <div className="mt-3 h-1.5 rounded-full bg-muted">
                    <motion.div
                      className="h-full rounded-full bg-primary/80"
                      initial={{ width: 0 }}
                      animate={{ width: `${stage.score}%` }}
                      transition={{ duration: 1, delay: 0.45 + index * 0.1 }}
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-background/80 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <MessageSquareText className="size-4 text-primary" />
              对话输出
            </div>
            <div className="space-y-3 text-sm leading-7 text-card-foreground/85">
              <p>识别到这是文档截图，先补 OCR 证据，再给出结构化回答。</p>
              <div className="rounded-lg border border-border/70 bg-card/70 p-3">
                讲解模式会把结论、依据和推理顺序分层展示，适合做课程演示和产品说明。
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-primary">
                <span className="size-1.5 rounded-full bg-primary" />
                streaming tokens
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        {["OCR", "Evidence", "VLM", "Session"].map((label) => (
          <div
            key={label}
            className="rounded-lg border border-border/70 bg-card/80 px-3 py-2 text-xs text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden px-5 py-6 sm:px-8 lg:px-12">
      <AnimatedBackground />

      <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border border-border/70 bg-card/80 shadow-sm">
            <Sparkles className="size-4 text-primary" />
          </span>
          <span className="text-sm font-medium text-foreground">MLLM Studio</span>
        </Link>
        <div className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <span>Vision QA</span>
          <span>Document OCR</span>
          <span>Premium Chat</span>
        </div>
        <Link href="/chat" className={cn(buttonVariants({ size: "lg" }), "rounded-full")}>
          进入工作台
          <ArrowRight className="size-4" />
        </Link>
      </nav>

      <section className="relative z-10 mx-auto grid max-w-7xl gap-8 py-16 lg:grid-cols-[1fr_1.02fr] lg:items-start">
        <motion.div variants={container} initial="hidden" animate="show" className="max-w-3xl">
          <motion.div variants={item}>
            <Badge className="mb-6 border-border/70 bg-card/80 text-foreground hover:bg-card/80">
              Multimodal AI 工作台
            </Badge>
          </motion.div>
          <motion.h1
            variants={item}
            className="font-heading text-balance text-6xl font-semibold leading-[0.94] text-foreground sm:text-7xl lg:text-8xl"
          >
            MLLM Studio
            <span className="mt-4 block text-foreground/58">把多模态问答做成真正的产品。</span>
          </motion.h1>
          <motion.p variants={item} className="mt-7 max-w-2xl text-lg leading-8 text-muted-foreground">
            面向图片、文档截图和多页材料的前端演示：支持 OCR、Markdown、LaTeX、代码复制、推理折叠和证据面板。
          </motion.p>

          <motion.div variants={item} className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="/chat" className={buttonVariants({ size: "lg" })}>
              打开 AI Chat
              <ArrowRight className="size-4" />
            </Link>
            <Link href="/chat" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-full")}>
              查看文档问答 Demo
            </Link>
          </motion.div>

          <motion.div variants={item} className="mt-10 grid max-w-2xl gap-3 sm:grid-cols-3">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-lg border border-border/70 bg-card/80 p-4">
                <metric.icon className="mb-3 size-4 text-primary" />
                <p className="text-xs text-muted-foreground">{metric.label}</p>
                <p className="mt-1 text-sm text-card-foreground">{metric.value}</p>
              </div>
            ))}
          </motion.div>
        </motion.div>

        <HeroPreview />
      </section>

      <CapabilityTicker />

      <section className="relative z-10 mx-auto max-w-7xl py-20">
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-120px" }}
          className="grid gap-4 md:grid-cols-4"
        >
          {features.map((feature) => (
            <motion.div key={feature.title} variants={item}>
              <Card className="premium-panel h-full rounded-lg p-5 transition duration-300 hover:-translate-y-1 hover:border-primary/40 hover:bg-card">
                <feature.icon className="mb-6 size-5 text-primary" />
                <h3 className="text-base font-medium text-card-foreground">{feature.title}</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{feature.body}</p>
              </Card>
            </motion.div>
          ))}
        </motion.div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="premium-panel rounded-lg p-6">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm text-primary/80">能力地图</p>
                <h2 className="font-heading mt-3 text-4xl font-semibold text-card-foreground">从界面到接口都能替换</h2>
              </div>
              <Link href="/chat" className={cn(buttonVariants({ variant: "outline" }), "rounded-full")}>
                试用 mock 工作流
              </Link>
            </div>
            <Separator className="my-6 bg-border/70" />
            <div className="grid gap-3 sm:grid-cols-3">
              {capabilityTicker.slice(0, 6).map((capability) => (
                <div key={capability} className="rounded-lg border border-border/70 bg-background/70 p-4 text-sm text-card-foreground">
                  {capability}
                </div>
              ))}
            </div>
          </Card>
          <Card className="premium-panel rounded-lg p-6">
            <p className="text-sm text-muted-foreground">Model interface</p>
            <h3 className="font-heading mt-3 text-3xl font-semibold text-card-foreground">POST /api/chat</h3>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              当前前端使用本地 mock route。后续替换成真实后端时，只需要更换 API 基址，不必改动聊天界面结构。
            </p>
          </Card>
        </div>
      </section>
    </main>
  );
}
