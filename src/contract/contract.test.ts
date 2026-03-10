import { describe, expect, test } from "bun:test";
import z from "zod";
import type { ApiShape } from "../shared/shared.js";
import type { ContractTreeFor } from "./contract.js";
import {
	compileContractRoutes,
	getContractRequestParsers,
	getContractResponseSchema,
	isContractLike,
	validateContractResponseType,
} from "./contract.js";

describe("contract route compilation", () => {
	test("compiles nested routes with dynamic segments", () => {
		const shape = {
			SHAPE: {
				users: {
					CONTRACT: true,
					SHAPE: {
						$userId: { CONTRACT: true },
					},
				},
			},
		} as const satisfies ApiShape;

		const contracts = {
			SHAPE: {
				users: {
					CONTRACT: {
						get: {
							responses: {
								200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
							},
						},
					},
					SHAPE: {
						$userId: {
							CONTRACT: {
								get: {
									pathParams: z.object({ userId: z.uuid() }),
									responses: {
										200: { type: "JSON", schema: z.object({ id: z.string() }) },
									},
								},
							},
						},
					},
				},
			},
		} as const satisfies ContractTreeFor<typeof shape>;

		const routes = compileContractRoutes(contracts).map((route) => ({
			pathTemplate: route.pathTemplate,
			honoPath: route.honoPath,
			method: route.method,
		}));

		expect(routes).toEqual([
			{ pathTemplate: "/users", honoPath: "/users", method: "get" },
			{ pathTemplate: "/users/$userId", honoPath: "/users/:userId", method: "get" },
		]);
	});
});

describe("contract helpers", () => {
	test("returns request parsers for each declared input segment", () => {
		const methodDefinition = {
			pathParams: z.object({ userId: z.string() }),
			query: { type: "JSON", schema: z.object({ active: z.boolean() }) },
			headers: { type: "Standard", schema: z.object({ "x-trace": z.string() }) },
			body: { type: "Text", schema: z.string() },
			responses: {
				200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
			},
		} as const;

		expect(getContractRequestParsers(methodDefinition)).toEqual({
			pathParams: methodDefinition.pathParams,
			query: methodDefinition.query,
			headers: methodDefinition.headers,
			body: methodDefinition.body,
		});
	});

	test("returns the response schema for a declared status", () => {
		const methodDefinition = {
			responses: {
				200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
				404: { type: "Text", schema: z.string() },
			},
		} as const;

		expect(getContractResponseSchema(methodDefinition, 200)).toBe(
			methodDefinition.responses[200],
		);
		expect(getContractResponseSchema(methodDefinition, 404)).toBe(
			methodDefinition.responses[404],
		);
		expect(getContractResponseSchema(methodDefinition, 500)).toBeUndefined();
	});

	test("compares response types against the declared schema", () => {
		const jsonSchema = { type: "JSON", schema: z.object({ ok: z.boolean() }) } as const;

		expect(validateContractResponseType(jsonSchema, "JSON")).toBe(true);
		expect(validateContractResponseType(jsonSchema, "Text")).toBe(false);
	});

	test("recognizes contract-like records", () => {
		expect(
			isContractLike({
				get: {
					responses: {
						200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
					},
				},
				post: undefined,
			}),
		).toBe(true);
		expect(isContractLike(null)).toBe(false);
		expect(isContractLike({ trace: {} })).toBe(false);
		expect(isContractLike({ get: "bad" })).toBe(false);
	});
});

const typeOnly = (_cb: () => void): void => {};

typeOnly(() => {
	const shape = {
		SHAPE: {
			users: {
				SHAPE: {
					$userId: { CONTRACT: true },
				},
			},
		},
	} as const satisfies ApiShape;

	const contracts = {
		SHAPE: {
			users: {
				SHAPE: {
					$userId: {
						CONTRACT: {
							get: {
								pathParams: z.object({ userId: z.string() }),
								responses: {
									200: { type: "JSON", schema: z.object({ id: z.string() }) },
								},
							},
						},
					},
				},
			},
		},
	} as const satisfies ContractTreeFor<typeof shape>;
	void contracts;

	const invalidContracts = {
		SHAPE: {
			users: {
				SHAPE: {
					$userId: {
						CONTRACT: {
							// @ts-expect-error dynamic segment contracts require pathParams schema
							get: {
								responses: {
									200: { type: "JSON", schema: z.object({ id: z.string() }) },
								},
							},
						},
					},
				},
			},
		},
	} as const satisfies ContractTreeFor<typeof shape>;
	void invalidContracts;

	const invalidResponseSpec = {
		SHAPE: {
			users: {
				SHAPE: {
					$userId: {
						CONTRACT: {
							get: {
								pathParams: z.object({ userId: z.string() }),
								responses: {
									// @ts-expect-error response specs must use schema, not body
									200: { type: "JSON", body: z.object({ id: z.string() }) },
								},
							},
						},
					},
				},
			},
		},
	} as const satisfies ContractTreeFor<typeof shape>;
	void invalidResponseSpec;

	const invalidQuerySpec = {
		SHAPE: {
			users: {
				SHAPE: {
					$userId: {
						CONTRACT: {
							get: {
								pathParams: z.object({ userId: z.string() }),
								// @ts-expect-error request query specs must use schema, not query
								query: { type: "JSON", query: z.object({ id: z.string() }) },
								responses: {
									200: { type: "JSON", schema: z.object({ id: z.string() }) },
								},
							},
						},
					},
				},
			},
		},
	} as const satisfies ContractTreeFor<typeof shape>;
	void invalidQuerySpec;

	const invalidHeadersSpec = {
		SHAPE: {
			users: {
				SHAPE: {
					$userId: {
						CONTRACT: {
							get: {
								pathParams: z.object({ userId: z.string() }),
								// @ts-expect-error request header specs must use schema, not headers
								headers: { type: "JSON", headers: z.object({ id: z.string() }) },
								responses: {
									200: { type: "JSON", schema: z.object({ id: z.string() }) },
								},
							},
						},
					},
				},
			},
		},
	} as const satisfies ContractTreeFor<typeof shape>;
	void invalidHeadersSpec;

	const invalidBodySpec = {
		SHAPE: {
			users: {
				SHAPE: {
					$userId: {
						CONTRACT: {
							get: {
								pathParams: z.object({ userId: z.string() }),
								// @ts-expect-error request body specs must use schema, not body
								body: { type: "JSON", body: z.object({ id: z.string() }) },
								responses: {
									200: { type: "JSON", schema: z.object({ id: z.string() }) },
								},
							},
						},
					},
				},
			},
		},
	} as const satisfies ContractTreeFor<typeof shape>;
	void invalidBodySpec;
});
