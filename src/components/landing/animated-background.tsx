"use client";

import { motion } from "framer-motion";

const beams = [
  { className: "left-[8%] top-[14%] h-48 w-px", delay: 0 },
  { className: "left-[28%] top-[10%] h-64 w-px", delay: 0.8 },
  { className: "left-[56%] top-[18%] h-56 w-px", delay: 1.2 },
  { className: "left-[78%] top-[8%] h-72 w-px", delay: 1.6 },
];

export function AnimatedBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="fine-grid absolute inset-0 opacity-70" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(255,255,255,0.08),transparent_24rem)]" />
      {beams.map((beam) => (
        <motion.div
          key={beam.className}
          className={`absolute ${beam.className} bg-gradient-to-b from-transparent via-[color-mix(in_oklab,var(--primary)_26%,transparent)] to-transparent`}
          animate={{ y: [-30, 180, -30], opacity: [0.08, 0.6, 0.08] }}
          transition={{ duration: 11, repeat: Infinity, ease: "easeInOut", delay: beam.delay }}
        />
      ))}
      <motion.div
        className="absolute left-1/2 top-[18%] h-72 w-72 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.12),transparent_65%)] blur-3xl"
        animate={{ scale: [1, 1.08, 1], opacity: [0.22, 0.38, 0.22] }}
        transition={{ duration: 8.5, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[color-mix(in_oklab,var(--foreground)_28%,transparent)] to-transparent"
        animate={{ opacity: [0.12, 0.5, 0.12], y: [0, 220, 0] }}
        transition={{ duration: 9.5, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
