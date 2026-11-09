import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import { gui } from "@opencode/plugin/gui/vite"

// The build runs from the config root, so pin the project root to this plugin
// directory; otherwise `src/gui.tsx` and `dist/` resolve against the wrong cwd.
const root = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  root,
  plugins: [gui()],
})
