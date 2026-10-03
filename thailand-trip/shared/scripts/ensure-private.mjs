// Hotel names and flight numbers stay out of git (the repo is public).
// If the real file is missing, start from the example so everything still builds.
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const real = join(dir, "trip-private.json");
if (!existsSync(real)) {
  copyFileSync(join(dir, "trip-private.example.json"), real);
  console.log("shared/src/trip-private.json created from the example. Put your real hotels and flight numbers there.");
}
