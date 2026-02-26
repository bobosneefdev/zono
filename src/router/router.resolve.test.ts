import { describe, expect, it } from "bun:test";
import z from "zod";
import { createRouter } from "~/router/index.js";
import {
	resolveRouteContract,
	resolveRouteContractMap,
	resolveRouteMethodContract,
	routerDotPathToParamPath,
} from "~/router/router.resolve.js";

const router = createRouter(
	{
		users: {
			TYPE: "router",
			ROUTER: {
				$id: {
					TYPE: "contract",
					ROUTER: {
						$postId: {
							TYPE: "contract",
						},
					},
				},
			},
		},
	},
	{
		users: {
			$id: {
				CONTRACT: {
					get: {
						pathParams: z.object({ id: z.string() }),
						responses: {
							200: {
								contentType: "application/json",
								schema: z.object({ id: z.string() }),
							},
						},
					},
				},
				ROUTER: {
					$postId: {
						CONTRACT: {
							get: {
								pathParams: z.object({ id: z.string(), postId: z.string() }),
								responses: {
									200: {
										contentType: "application/json",
										schema: z.object({ title: z.string() }),
									},
								},
							},
						},
					},
				},
			},
		},
	},
);

const emptyContractRouter = createRouter(
	{
		empty: { TYPE: "contract" },
	},
	{
		empty: {
			CONTRACT: {},
		},
	},
);

describe("routerDotPathToParamPath", () => {
	it("returns / for empty string", () => {
		expect(routerDotPathToParamPath("")).toBe("/");
	});

	it("converts dot path to param path", () => {
		expect(routerDotPathToParamPath("users.$id")).toBe("/users/:id");
		expect(routerDotPathToParamPath("users.$id.$postId")).toBe("/users/:id/:postId");
	});
});

describe("resolveRouteContractMap", () => {
	it("resolves known path to contract map", () => {
		const map = resolveRouteContractMap(router, "/users/$id");
		expect(map.get).toBeDefined();
		expect(map.post).toBeUndefined();
	});

	it("navigates via ROUTER for nested contract nodes", () => {
		const map = resolveRouteContractMap(router, "/users/$id/$postId");
		expect(map.get).toBeDefined();
	});

	it("throws for unknown path", () => {
		expect(() =>
			resolveRouteContractMap(router, "/nonexistent" as "/users/$id" | "/users/$id/$postId"),
		).toThrow("Unknown path /nonexistent");
	});

	it("throws when path resolves to non-contract node", () => {
		expect(() =>
			resolveRouteContractMap(router, "/users" as "/users/$id" | "/users/$id/$postId"),
		).toThrow("Route does not resolve to a contract: /users");
	});
});

describe("resolveRouteContract", () => {
	it("returns first available contract by method order", () => {
		const contract = resolveRouteContract(router, "/users/$id");
		expect(contract).toBeDefined();
		expect(contract.responses[200]).toBeDefined();
	});

	it("throws when route has no contract methods", () => {
		expect(() => resolveRouteContract(emptyContractRouter, "/empty")).toThrow(
			"Route does not contain any contracts: /empty",
		);
	});
});

describe("resolveRouteMethodContract", () => {
	it("returns contract for defined method", () => {
		const contract = resolveRouteMethodContract(router, "/users/$id", "get");
		expect(contract).toBeDefined();
	});

	it("throws when method is not defined for route", () => {
		expect(() => resolveRouteMethodContract(router, "/users/$id", "patch")).toThrow(
			"Route does not contain contract for method patch: /users/$id",
		);
	});
});
