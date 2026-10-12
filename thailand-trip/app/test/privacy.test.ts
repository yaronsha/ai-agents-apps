// The repository and the app bundle are public, so hotel names and flight numbers must reach the
// app only through GET /api/trip-private. This fails the build if anything the app bundles imports
// the private data, directly or through a shared module.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../..");

/** Module specifiers that resolve to the private data: the package export, private.ts or the JSON. */
const PRIVATE = /(^|\/)(private|trip-private(\.json)?)$|^@trip\/shared\/private$/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(ts|tsx|js|mjs)$/.test(e.name) ? [path] : [];
  });
}

/** Every `import ... from "x"`, `export ... from "x"`, `import "x"` and `import("x")` specifier. */
function specifiers(code: string): string[] {
  const found: string[] = [];
  for (const m of code.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) found.push(m[1]);
  return found;
}

function offenders(files: string[]) {
  return files.flatMap((f) =>
    specifiers(readFileSync(f, "utf8"))
      .filter((s) => PRIVATE.test(s))
      .map((s) => `${relative(root, f)} imports ${s}`),
  );
}

describe("privacy guard", () => {
  it("recognises every way of naming the private data", () => {
    const code = `import { trip } from "@trip/shared/private";
      export * from "../../shared/src/private";
      import data from "./trip-private.json";
      const lazy = import('@trip/shared/private');
      import { publicTrip } from "@trip/shared";
      fetch("/api/trip-private");`;
    expect(specifiers(code).filter((s) => PRIVATE.test(s))).toEqual([
      "@trip/shared/private",
      "../../shared/src/private",
      "./trip-private.json",
      "@trip/shared/private",
    ]);
  });

  it("the app (pages, service worker and Pages Functions) never imports the private data", () => {
    expect(offenders([...sources(join(root, "app/src")), ...sources(join(root, "app/functions"))])).toEqual([]);
  });

  it("only shared/src/private.ts reads the private file, so importing @trip/shared stays safe", () => {
    const shared = sources(join(root, "shared/src")).filter((f) => !f.endsWith("private.ts"));
    expect(offenders(shared)).toEqual([]);
  });
});
