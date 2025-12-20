import { defineConfig } from "tsup";

export default defineConfig({
    format: ["esm", "cjs"],
    entry: {
        "shared": "src/shared.ts",
        "client": "src/client.ts",
        "server": "src/server.ts",
    },
    keepNames: true,
    dts: true,
    shims: true,
    skipNodeModulesBundle: true,
    clean: true,
});