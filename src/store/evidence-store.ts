"use client";

import { create } from "zustand";
import type { EvidenceDocument, OcrBlock, UploadedAsset } from "@/types/app";

type EvidenceStore = {
  uploadedAssets: UploadedAsset[];
  ocrBlocks: OcrBlock[];
  evidenceDocuments: EvidenceDocument[];
  addUploadedAssets: (assets: UploadedAsset[]) => void;
  updateAssetProgress: (id: string, progress: number) => void;
  patchUploadedAsset: (id: string, patch: Partial<UploadedAsset>) => void;
  removeUploadedAsset: (id: string) => void;
  clearUploadedAssets: () => void;
  setOcrBlocks: (blocks: OcrBlock[]) => void;
  setEvidenceDocuments: (documents: EvidenceDocument[]) => void;
  clearEvidenceWorkspace: () => void;
};

const resetEvidenceState = () => ({
  uploadedAssets: [],
  ocrBlocks: [],
  evidenceDocuments: [],
});

export const useEvidenceStore = create<EvidenceStore>()((set) => ({
  ...resetEvidenceState(),
  addUploadedAssets: (assets) =>
    set((state) => ({ uploadedAssets: [...state.uploadedAssets, ...assets] })),
  updateAssetProgress: (id, progress) =>
    set((state) => ({
      uploadedAssets: state.uploadedAssets.map((asset) =>
        asset.id === id
          ? {
              ...asset,
              progress,
              status: progress >= 100 ? "complete" : "uploading",
            }
          : asset,
      ),
    })),
  patchUploadedAsset: (id, patch) =>
    set((state) => ({
      uploadedAssets: state.uploadedAssets.map((asset) =>
        asset.id === id ? { ...asset, ...patch } : asset,
      ),
    })),
  removeUploadedAsset: (id) =>
    set((state) => ({
      uploadedAssets: state.uploadedAssets.filter((asset) => asset.id !== id),
      evidenceDocuments: state.evidenceDocuments.filter((document) => document.assetId !== id),
    })),
  clearUploadedAssets: () => set({ uploadedAssets: [] }),
  setOcrBlocks: (blocks) => set({ ocrBlocks: blocks }),
  setEvidenceDocuments: (documents) => set({ evidenceDocuments: documents }),
  clearEvidenceWorkspace: () => set(resetEvidenceState()),
}));
