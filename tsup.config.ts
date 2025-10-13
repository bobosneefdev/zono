import { defineConfig } from "tsup";

export default defineConfig({
    format: ["esm", "cjs"],
    entry: {
        "index": "src/index.ts",
        "shared": "src/shared.ts",
        "client": "src/client.ts",
        "server": "src/server.ts",
    },
    dts: true,
    shims: true,
    skipNodeModulesBundle: true,
    clean: true,
});