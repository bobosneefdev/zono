import { defineConfig } from "tsup";

export default defineConfig({
	format: ["esm", "cjs"],
	entry: {
		client: "src/client/index.ts",
		contract: "src/contract/index.ts",
		hono: "src/hono/index.ts",
		lib: "src/lib/index.ts",
		sveltekit: "src/sveltekit/index.ts",
	},
	keepNames: true,
	dts: true,
	shims: true,
	skipNodeModulesBundle: true,
	clean: true,
	splitting: true,
	treeshake: "recommended",
});
