import { defineConfig } from "tsdown";

export default defineConfig({
	format: "esm",
	dts: true,
	entry: {
		contract: "src/contract/index.ts",
		middleware: "src/middleware/index.ts",
		client: "src/client/index.ts",
		hono: "src/hono/index.ts",
		"hono-gateway": "src/hono_gateway/index.ts",
	},
	deps: {
		skipNodeModulesBundle: true,
	},
	shims: true,
	clean: true,
	treeshake: true,
	target: false,
});
