import { describe, expect, it } from "vitest";
import { rankMcpTools } from "../agent/mcp-tools.js";

describe("finding a connected tool", () => {
  const tools = [
    { server: "powerpoint", name: "ppt_add_slide", description: "Add a slide to the open presentation" },
    { server: "blender", name: "create_object", description: "Create a mesh object in the scene" },
    { server: "brave-search", name: "brave_web_search", description: "Search the web with Brave" },
  ];

  it("returns only the tools the request names, not the whole list", () => {
    expect(rankMcpTools(tools, "add a slide").map((t) => t.name)).toEqual(["ppt_add_slide"]);
    expect(rankMcpTools(tools, "the")).toEqual([]);
  });
});
