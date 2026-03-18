import { describe, expect, it } from "bun:test"
import pkg from "../package.json" with { type: "json" }

describe("package", () => {
  it("publishes a package-root entry suitable for opencode.json plugins", () => {
    expect(pkg.type).toBe("module")
    expect(pkg.main).toBe("./dist/index.js")
    expect(pkg.exports).toEqual({
      ".": {
        import: "./dist/index.js",
        types: "./dist/index.d.ts",
      },
    })
    expect(pkg.files).toContain("dist")
    expect(pkg.scripts.build).toBeString()
    expect(pkg.scripts.prepack).toBeString()
    expect(pkg.devDependencies["@opencode-ai/plugin"]).toBeString()
  })
})
