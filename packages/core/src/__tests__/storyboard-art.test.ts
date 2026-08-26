import { describe, expect, it } from "vitest";
import { outstandingShots } from "../pipeline/storyboard-art.js";
import type { StoryboardAssetsManifest, StoryboardImageAsset } from "../pipeline/script-storyboard-runner.js";

const shot = (shotId: string, status: StoryboardImageAsset["status"], prompt = "a lighthouse"): StoryboardImageAsset =>
  ({ shotId, prompt, sourceRefs: [], variants: [], status });

const manifest = (assets: StoryboardImageAsset[]): StoryboardAssetsManifest => ({
  version: 1,
  kind: "storyboard_assets",
  title: "Closing Time",
  projectId: "closing-time",
  baseDir: "storyboards/closing-time",
  storyboardPath: "storyboards/closing-time/storyboard.md",
  imagePromptsPath: "storyboards/closing-time/image-prompts.md",
  assetsDir: "storyboards/closing-time/assets",
  sourceDir: "storyboards/closing-time/assets/source",
  generatedDir: "storyboards/closing-time/assets/generated",
  selectedDir: "storyboards/closing-time/assets/selected",
  createdAt: "2026-08-27T00:00:00.000Z",
  assets,
});

describe("outstandingShots", () => {
  // The whole point of resuming: an interrupted run picks up at nine rather
  // than redrawing the eight images that are already on disk.
  it("skips shots that already have an image", () => {
    const m = manifest([shot("shot-001", "generated"), shot("shot-002", "prompt_ready")]);
    expect(outstandingShots(m).map((s) => s.shotId)).toEqual(["shot-002"]);
  });

  it("retries a failed shot — finishing it is what resuming is for", () => {
    const m = manifest([shot("shot-001", "failed"), shot("shot-002", "generated")]);
    expect(outstandingShots(m).map((s) => s.shotId)).toEqual(["shot-001"]);
  });

  it("redo takes everything, so alternatives can be asked for", () => {
    const m = manifest([shot("shot-001", "generated"), shot("shot-002", "selected")]);
    expect(outstandingShots(m, { redo: true })).toHaveLength(2);
  });

  it("renders only the shots named", () => {
    const m = manifest([shot("shot-001", "prompt_ready"), shot("shot-002", "prompt_ready")]);
    expect(outstandingShots(m, { only: ["shot-002"] }).map((s) => s.shotId)).toEqual(["shot-002"]);
  });

  it("leaves a shot with no prompt alone rather than rendering nothing", () => {
    const m = manifest([shot("shot-001", "prompt_ready", "   ")]);
    expect(outstandingShots(m)).toHaveLength(0);
  });

  it("a selected shot is not redrawn by default — it is the chosen take", () => {
    const m = manifest([shot("shot-001", "selected")]);
    expect(outstandingShots(m)).toHaveLength(0);
  });
});
