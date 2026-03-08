import { defineConfig } from "tsdown";

export default defineConfig({
	format: "esm",
	dts: true,
	entry: {
		client: "src/client/index.ts",
		contract: "src/contract/index.ts",
		gateway: "src/gateway/index.ts",
		middleware: "src/middleware/index.ts",
		server: "src/server/index.ts",
		shared: "src/shared/index.ts",
	},
	deps: {
		skipNodeModulesBundle: true,
	},
	shims: true,
	clean: true,
	treeshake: true,
	target: false,
});
