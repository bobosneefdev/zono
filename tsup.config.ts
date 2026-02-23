import { defineConfig } from "tsup";

export default defineConfig({
	format: ["esm", "cjs"],
	entry: {
		client: "src/client.ts",
		contract: "src/contract.ts",
		hono: "src/hono.ts",
		sveltekit: "src/sveltekit.ts",
	},
	keepNames: true,
	dts: true,
	shims: true,
	skipNodeModulesBundle: true,
	clean: true,
});
