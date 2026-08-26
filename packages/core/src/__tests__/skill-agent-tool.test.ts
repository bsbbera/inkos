import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSkillRegistry } from "../skills/index.js";
import { createUseSkillTool } from "../agent/skill-tool.js";

/**
 * Symlinks need elevated privileges on Windows, and these two tests are about
 * what the registry does with one, not about whether the OS will make it. A
 * skip is honest; two permanent EPERM failures just teach everyone to read a
 * red run as green.
 */
async function symlinkOrSkip(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") return false;
    throw error;
  }
}

describe("use_skill agent tool", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-use-skill-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("loads a skill body only after the agent explicitly selects it by intent", async () => {
    const baseDir = join(root, "writer-distillation");
    await mkdir(baseDir, { recursive: true });
    const registry = createSkillRegistry({
      skills: [{
        id: "writer-distillation",
        name: "Writer Distillation",
        description: "Distill a writer's transferable craft.",
        body: "Separate transferable craft from surface wording.",
        source: "external",
        baseDir,
      }],
    });
    const activated: string[] = [];
    const tool = createUseSkillTool({
      registry,
      onActivate: (activation) => activated.push(activation.skill.id),
    });

    const result = await tool.execute("skill-1", { skillId: "writer-distillation" });

    expect(result.content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("Separate transferable craft"),
      }),
    ]);
    expect(result.details).toMatchObject({
      kind: "skill_activated",
      skillId: "writer-distillation",
    });
    expect(activated).toEqual(["writer-distillation"]);
  });

  it("reads static referenced text without allowing path traversal", async () => {
    const baseDir = join(root, "writer-distillation");
    await mkdir(join(baseDir, "references"), { recursive: true });
    await writeFile(join(baseDir, "references", "rubric.md"), "# Rubric\nPrefer scene evidence.", "utf-8");
    const registry = createSkillRegistry({
      skills: [{
        id: "writer-distillation",
        name: "Writer Distillation",
        description: "Distill writer craft.",
        body: "Read references/rubric.md when evaluating samples.",
        source: "external",
        baseDir,
      }],
    });
    const activated: string[] = [];
    const tool = createUseSkillTool({
      registry,
      onActivate: (activation) => activated.push(activation.skill.id),
    });

    const result = await tool.execute("skill-resource", {
      skillId: "writer-distillation",
      resourcePath: "references/rubric.md",
    });
    expect(result.content).toEqual([
      expect.objectContaining({
        text: expect.stringMatching(/Read references\/rubric\.md[\s\S]*Prefer scene evidence/),
      }),
    ]);
    expect(activated).toEqual(["writer-distillation"]);
    await expect(tool.execute("skill-traversal", {
      skillId: "writer-distillation",
      resourcePath: "../secret.txt",
    })).rejects.toThrow(/outside|traversal|relative/i);
    await expect(tool.execute("skill-missing", {
      skillId: "writer-distillation",
      resourcePath: "references/missing.md",
    })).rejects.toThrow();
    expect(activated).toEqual(["writer-distillation"]);
  });

  it("retrieves relevant Skill references by natural-language query", async () => {
    const baseDir = join(root, "long-writing");
    await mkdir(join(baseDir, "references"), { recursive: true });
    await writeFile(
      join(baseDir, "references", "continuity.md"),
      [
        "# 伏笔连续性",
        "",
        "师债必须通过誓令碎片和导师旧信继续推进。",
        "",
        "# 节奏",
        "",
        "日常章节允许降低冲突密度。",
      ].join("\n"),
      "utf-8",
    );
    const registry = createSkillRegistry({
      skills: [{
        id: "long-writing",
        name: "Long Writing",
        description: "Long-form continuity guidance.",
        body: "Retrieve only the reference needed by the current task.",
        source: "external",
        baseDir,
      }],
    });
    const tool = createUseSkillTool({ registry });

    const result = await tool.execute("skill-search", {
      skillId: "long-writing",
      query: "导师旧信和誓令碎片的伏笔如何推进",
    });

    expect(result.content).toEqual([expect.objectContaining({
      text: expect.stringMatching(/references\/continuity\.md:[0-9]+-[0-9]+[\s\S]*师债必须通过誓令碎片/),
    })]);
    expect(result.details).toMatchObject({
      kind: "skill_activated",
      skillId: "long-writing",
      query: "导师旧信和誓令碎片的伏笔如何推进",
      retrievedResources: [expect.objectContaining({ path: "references/continuity.md" })],
    });
  });

  it("rejects resources reached through a symlinked parent directory", async () => {
    const baseDir = join(root, "writer-distillation");
    const outsideDir = join(root, "outside");
    await mkdir(baseDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "secret.md"), "outside secret", "utf-8");
    if (!await symlinkOrSkip(outsideDir, join(baseDir, "references"))) return;
    const registry = createSkillRegistry({
      skills: [{
        id: "writer-distillation",
        name: "Writer Distillation",
        description: "Distill writer craft.",
        body: "Read references only when needed.",
        source: "external",
        baseDir,
      }],
    });
    const tool = createUseSkillTool({ registry });

    await expect(tool.execute("skill-symlink", {
      skillId: "writer-distillation",
      resourcePath: "references/secret.md",
    })).rejects.toThrow(/symbolic link/i);
  });

  it("rejects a symlinked skill root before reading resources", async () => {
    const realDir = join(root, "real-skill");
    const linkedDir = join(root, "linked-skill");
    await mkdir(join(realDir, "references"), { recursive: true });
    await writeFile(join(realDir, "references", "secret.md"), "outside secret", "utf-8");
    if (!await symlinkOrSkip(realDir, linkedDir)) return;
    const registry = createSkillRegistry({
      skills: [{
        id: "linked-skill",
        name: "Linked Skill",
        description: "A linked skill root.",
        body: "Read references only when needed.",
        source: "external",
        baseDir: linkedDir,
      }],
    });
    const tool = createUseSkillTool({ registry });

    await expect(tool.execute("skill-root-symlink", {
      skillId: "linked-skill",
      resourcePath: "references/secret.md",
    })).rejects.toThrow(/symbolic link/i);
  });

  it("refuses disabled and unknown skills", async () => {
    const registry = createSkillRegistry({
      skills: [{
        id: "disabled-skill",
        name: "Disabled Skill",
        description: "A disabled test skill.",
        body: "Do not load.",
        source: "external",
      }],
    });
    const tool = createUseSkillTool({
      registry,
      disabledSkillIds: ["disabled-skill"],
    });

    await expect(tool.execute("disabled", { skillId: "disabled-skill" }))
      .rejects.toThrow(/disabled/i);
    await expect(tool.execute("missing", { skillId: "missing-skill" }))
      .rejects.toThrow(/not available/i);
  });
});
