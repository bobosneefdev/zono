import { describe, expect, test } from "bun:test";
import z from "zod";
import {
	compileContractRoutes,
	defineApi,
	getContractRequestParsers,
	getContractResponseSchema,
	isContractLike,
	validateContractResponseType,
} from "./contract.js";

describe("contract route compilation", () => {
	test("compiles nested routes with dynamic segments", () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					users: {
						CONTRACT: {
							get: {
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
							query: {
								body: { type: "JSON", schema: z.object({ filter: z.string() }) },
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
											200: {
												type: "JSON",
												schema: z.object({ id: z.string() }),
											},
										},
									},
								},
							},
						},
					},
				},
			},
		});

		const routes = compileContractRoutes(api.contracts).map((route) => ({
			pathTemplate: route.pathTemplate,
			honoPath: route.honoPath,
			method: route.method,
		}));

		expect(routes).toEqual([
			{ pathTemplate: "/users", honoPath: "/users", method: "get" },
			{ pathTemplate: "/users", honoPath: "/users", method: "query" },
			{ pathTemplate: "/users/$userId", honoPath: "/users/:userId", method: "get" },
		]);
	});
});

describe("defineApi", () => {
	test("defaults middlewares to an empty tree and errorMode to opaque", () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					health: {
						CONTRACT: {
							get: {
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
				},
			},
		});

		expect(api.middlewares).toEqual({});
		expect(api.errorMode).toBe("opaque");
	});

	test("preserves the provided middlewares and errorMode", () => {
		const middlewares = {
			MIDDLEWARE: {
				rateLimit: {
					429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
				},
			},
		} as const;

		const api = defineApi({
			contracts: {
				SHAPE: {
					health: {
						CONTRACT: {
							get: {
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
				},
			},
			middlewares,
			errorMode: "detailed",
		});

		expect(api.middlewares).toBe(middlewares);
		expect(api.errorMode).toBe("detailed");
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
				query: {
					responses: {
						200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
					},
				},
			}),
		).toBe(true);
		expect(isContractLike(null)).toBe(false);
		expect(isContractLike({ trace: {} })).toBe(false);
		expect(isContractLike({ get: "bad" })).toBe(false);
	});
});

const typeOnly = (_cb: () => void): void => {};

typeOnly(() => {
	// Literal contract, middleware, and error-mode types are preserved.
	const api = defineApi({
		contracts: {
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
		},
		middlewares: {
			MIDDLEWARE: {
				auth: { 401: { type: "JSON", schema: z.object({ message: z.string() }) } },
			},
		},
		errorMode: "detailed",
	});
	const errorMode: "detailed" = api.errorMode;
	void errorMode;
	const responseType: "JSON" =
		api.contracts.SHAPE.users.SHAPE.$userId.CONTRACT.get.responses[200].type;
	void responseType;
	const middlewareResponseType: "JSON" = api.middlewares.MIDDLEWARE.auth[401].type;
	void middlewareResponseType;

	// QUERY is accepted by contract compilation.
	const queryApi = defineApi({
		contracts: {
			SHAPE: {
				search: {
					CONTRACT: {
						query: {
							body: { type: "JSON", schema: z.object({ filter: z.string() }) },
							responses: {
								200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
							},
						},
					},
				},
			},
		},
	});
	void queryApi;

	// Custom body content types preserve their literal type.
	const contentTypeApi = defineApi({
		contracts: {
			SHAPE: {
				search: {
					CONTRACT: {
						query: {
							body: {
								type: "JSON",
								contentType: "application/query+json",
								schema: z.object({ filter: z.string() }),
							},
							responses: {
								200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
							},
						},
					},
				},
			},
		},
	});
	const bodyContentType: "application/query+json" =
		contentTypeApi.contracts.SHAPE.search.CONTRACT.query.body.contentType;
	void bodyContentType;

	// Dynamic segment contracts require a pathParams schema.
	defineApi({
		contracts: {
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
		},
	});

	// Unknown contract tree keys are rejected.
	defineApi({
		contracts: {
			SHAPE: {
				users: {
					// @ts-expect-error unknown contract tree keys are rejected
					CONTRACTS: {},
				},
			},
		},
	});

	// Middleware trees reject paths absent from the contracts.
	defineApi({
		contracts: {
			SHAPE: {
				users: {
					CONTRACT: {
						get: {
							responses: {
								200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
							},
						},
					},
				},
			},
		},
		middlewares: {
			SHAPE: {
				// @ts-expect-error middleware paths must exist in the contracts
				posts: {
					MIDDLEWARE: {
						auth: { 401: { type: "JSON", schema: z.object({ message: z.string() }) } },
					},
				},
			},
		},
	});

	// FormData bodies cannot declare a custom content type.
	defineApi({
		contracts: {
			SHAPE: {
				upload: {
					CONTRACT: {
						post: {
							body: {
								type: "FormData",
								// @ts-expect-error FormData bodies do not accept a custom contentType
								contentType: "multipart/form-data; boundary=x",
								schema: z.instanceof(FormData),
							},
							responses: {
								200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
							},
						},
					},
				},
			},
		},
	});
});
