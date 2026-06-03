import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    base: "/terminal-v5/",
    plugins: [react()],
    build: {
        outDir: "dist",
        emptyOutDir: true,
    },
});
