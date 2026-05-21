"use client";

import { useMutation } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useRef, useState } from "react";
import { ProgressBar } from "@/components/upload/upload-progress";
import { Button } from "@/components/ui/button";
import { FileWarning, ImagePlus, Loader2, Trash2, UploadCloud } from "@/components/ui/icons";
import { uploadFiles } from "@/lib/api";
import { createId } from "@/lib/id";
import { cn } from "@/lib/utils";
import { useEvidenceStore } from "@/store/evidence-store";
import type { UploadedAsset, UploadResponse } from "@/types/app";

const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"];

export function UploadDropzone({ compact = false }: { compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");

  const assets = useEvidenceStore((state) => state.uploadedAssets);
  const addUploadedAssets = useEvidenceStore((state) => state.addUploadedAssets);
  const updateAssetProgress = useEvidenceStore((state) => state.updateAssetProgress);
  const patchUploadedAsset = useEvidenceStore((state) => state.patchUploadedAsset);
  const removeUploadedAsset = useEvidenceStore((state) => state.removeUploadedAsset);
  const setOcrBlocks = useEvidenceStore((state) => state.setOcrBlocks);
  const setEvidenceDocuments = useEvidenceStore((state) => state.setEvidenceDocuments);

  const uploadMutation = useMutation({
    mutationFn: uploadFiles,
    onSuccess: (data: UploadResponse) => {
      setOcrBlocks(data.ocrBlocks);
      setEvidenceDocuments(data.documents);

      data.files.forEach((file) => {
        updateAssetProgress(file.id, 100);
        patchUploadedAsset(file.id, {
          routing: file.routing,
          progress: 100,
          status: "complete",
        });
      });
    },
    onError: (mutationError) => {
      if (mutationError instanceof AxiosError) {
        setError(mutationError.response?.data?.error ?? "OCR 服务调用失败，请稍后重试。");
        return;
      }

      setError("OCR 服务调用失败，请稍后重试。");
    },
  });

  const startProgress = useCallback(
    (assetIds: string[]) => {
      assetIds.forEach((id, index) => {
        let progress = 12 + index * 4;
        let tick = 0;
        const increments = [18, 16, 14, 12, 20];

        const timer = window.setInterval(() => {
          progress = Math.min(100, progress + increments[tick % increments.length]);
          tick += 1;
          updateAssetProgress(id, progress);

          if (progress >= 100) {
            window.clearInterval(timer);
          }
        }, 220);
      });
    },
    [updateAssetProgress],
  );

  const handleFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (!files.length) return;

      const invalid = files.find((file) => !allowedTypes.includes(file.type));
      if (invalid) {
        setError(`暂不支持 ${invalid.name}，请上传 PDF、PNG、JPG、WEBP 或 GIF。`);
        return;
      }

      setError("");
      const nextAssets: UploadedAsset[] = files.map((file) => ({
        id: createId("asset"),
        name: file.name,
        type: file.type,
        size: file.size,
        previewUrl: URL.createObjectURL(file),
        progress: 8,
        status: "uploading",
        routing: file.type === "application/pdf" ? "ocr" : undefined,
      }));

      addUploadedAssets(nextAssets);
      startProgress(nextAssets.map((asset) => asset.id));
      uploadMutation.mutate(
        files.map((file, index) => ({
          assetId: nextAssets[index].id,
          file,
        })),
      );
    },
    [addUploadedAssets, startProgress, uploadMutation],
  );

  return (
    <div className="space-y-3">
      <motion.button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
        whileHover={{ scale: compact ? 1.01 : 1.015 }}
        className={cn(
          "group relative w-full overflow-hidden rounded-lg border border-border bg-card/80 text-left shadow-sm backdrop-blur-2xl transition duration-300",
          isDragging && "border-primary/50 bg-primary/10",
          compact ? "p-3" : "p-5",
        )}
      >
        <span className="absolute inset-0 rounded-lg bg-[linear-gradient(120deg,transparent,color-mix(in_oklab,var(--primary)_18%,transparent),transparent)] opacity-0 transition duration-500 group-hover:opacity-100" />
        <span className="relative flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-lg border border-border bg-background/70 text-primary">
            {uploadMutation.isPending ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <UploadCloud className="size-5" />
            )}
          </span>
          <span>
            <span className="block text-sm font-medium text-card-foreground">拖拽或点击上传文件</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              支持 PDF、截图、多图和文档页面图片
            </span>
          </span>
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={allowedTypes.join(",")}
          className="hidden"
          onChange={(event) => {
            if (event.target.files) {
              handleFiles(event.target.files);
              event.target.value = "";
            }
          }}
        />
      </motion.button>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <FileWarning className="size-4" />
          {error}
        </div>
      ) : null}

      <AnimatePresence initial={false}>
        {assets.length ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className={cn("grid gap-3", compact ? "grid-cols-2" : "sm:grid-cols-2")}
          >
            {assets.map((asset) => (
              <motion.div
                layout
                key={asset.id}
                className="relative overflow-hidden rounded-lg border border-border bg-background/70 p-2"
              >
                <div className="aspect-[4/3] overflow-hidden rounded-md bg-muted">
                  {asset.type === "application/pdf" ? (
                    <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border bg-card/60 px-3 text-center text-xs text-muted-foreground">
                      PDF 文档
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={asset.previewUrl} alt={asset.name} className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <ImagePlus className="size-3.5 shrink-0 text-primary" />
                  <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{asset.name}</p>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => removeUploadedAsset(asset.id)}
                    aria-label="删除文件"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
                <ProgressBar value={asset.progress} />
              </motion.div>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
