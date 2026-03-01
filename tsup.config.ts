import { defineConfig } from "tsup";

export default defineConfig({
	format: ["esm", "cjs"],
	entry: {
		contract: "src/contract/index.ts",
		middleware: "src/middleware/index.ts",
		client: "src/client/index.ts",
		hono: "src/hono/index.ts",
		"hono-gateway": "src/hono_gateway/index.ts",
	},
	keepNames: true,
	dts: true,
	shims: true,
	skipNodeModulesBundle: true,
	clean: true,
	splitting: true,
	treeshake: "recommended",
});
