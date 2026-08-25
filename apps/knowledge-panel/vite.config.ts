import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";
export default defineConfig({root:fileURLToPath(new URL(".",import.meta.url)),plugins:[viteSingleFile()],build:{outDir:"dist",emptyOutDir:true},server:{port:5173,proxy:{"/api":"http://127.0.0.1:3210"}}});
