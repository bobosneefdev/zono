import { describe, expect, test } from "bun:test";
import z from "zod";
import type { ContractTree } from "../contract/contract.js";
import type { MiddlewareHandler } from "../server/server.js";
import type { MiddlewareTreeForContracts } from "./middleware.js";
import { collectMiddlewareLayers } from "./middleware.js";

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
		},
	},
} as const satisfies ContractTree;

const nestedContracts = {
	SHAPE: {
		api: {
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
	},
} as const satisfies ContractTree;

describe("middleware layer collection", () => {
	test("collects middleware layers in traversal order", () => {
		const middlewareNodes = [
			{
				MIDDLEWARE: {
					audit: {
						418: { type: "JSON", schema: z.object({ traceId: z.string() }) },
					},
				},
			},
			{
				MIDDLEWARE: {
					auth: {
						401: { type: "JSON", schema: z.object({ message: z.string() }) },
					},
				},
			},
		];
		const handlerNodes = [
			{
				MIDDLEWARE: {
					audit: () => ({ status: 418, type: "JSON", data: { traceId: "trace-1" } }),
				},
			},
			{
				MIDDLEWARE: {
					auth: () => ({ status: 401, type: "JSON", data: { message: "blocked" } }),
				},
			},
		];

		const layers = collectMiddlewareLayers(middlewareNodes, handlerNodes);

		expect(layers).toHaveLength(2);
		expect(layers.map((layer) => layer.name)).toEqual(["audit", "auth"]);
		expect(Object.keys(layers[0]!.definition)).toEqual(["418"]);
		expect(Object.keys(layers[1]!.definition)).toEqual(["401"]);
	});

	test("throws when a middleware node has no handler map", () => {
		expect(() =>
			collectMiddlewareLayers(
				[
					{
						MIDDLEWARE: {
							auth: {
								401: { type: "JSON", schema: z.object({ message: z.string() }) },
							},
						},
					},
				],
				[{}],
			),
		).toThrow("Missing MIDDLEWARE handlers node for middleware layer");
	});

	test("throws when a middleware handler is missing", () => {
		expect(() =>
			collectMiddlewareLayers(
				[
					{
						MIDDLEWARE: {
							auth: {
								401: { type: "JSON", schema: z.object({ message: z.string() }) },
							},
						},
					},
				],
				[{ MIDDLEWARE: {} }],
			),
		).toThrow("Missing middleware handler 'auth'");
	});

	test("throws when a middleware definition is not a record", () => {
		expect(() =>
			collectMiddlewareLayers(
				[
					{
						MIDDLEWARE: {
							auth: 123,
						},
					},
				],
				[
					{
						MIDDLEWARE: {
							auth: () => undefined,
						},
					},
				],
			),
		).toThrow("Missing middleware definition 'auth'");
	});
});

const middlewaresType = {
	MIDDLEWARE: {
		rateLimit: {
			429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
		},
	},
} as const satisfies MiddlewareTreeForContracts<typeof contracts>;

const middlewaresWithHeadersType = {
	MIDDLEWARE: {
		auth: {
			401: {
				type: "JSON",
				schema: z.object({ message: z.string() }),
				headers: {
					type: "Standard",
					schema: z.object({ "x-auth": z.string() }),
				},
			},
		},
	},
} as const satisfies MiddlewareTreeForContracts<typeof contracts>;

const typeOnly = (_cb: () => void): void => {};

typeOnly(() => {
	const rootlessMiddlewares = {
		SHAPE: {
			api: {
				MIDDLEWARE: {
					auth: {
						401: { type: "JSON", schema: z.object({ message: z.string() }) },
					},
				},
				SHAPE: {
					users: {
						SHAPE: {
							$userId: {
								MIDDLEWARE: {
									rateLimit: {
										429: {
											type: "JSON",
											schema: z.object({ retryAfter: z.number() }),
										},
									},
								},
							},
						},
					},
				},
			},
		},
	} as const satisfies MiddlewareTreeForContracts<typeof nestedContracts>;
	void rootlessMiddlewares;

	const intermediateMiddlewares = {
		SHAPE: {
			api: {
				MIDDLEWARE: {
					audit: {
						418: { type: "JSON", schema: z.object({ traceId: z.string() }) },
					},
				},
			},
		},
	} as const satisfies MiddlewareTreeForContracts<typeof nestedContracts>;
	void intermediateMiddlewares;

	const invalidShapeMiddlewares = {
		SHAPE: {
			api: {
				SHAPE: {
					// @ts-expect-error unknown middleware shape key should fail
					admin: {
						MIDDLEWARE: {
							auth: {
								401: { type: "JSON", schema: z.object({ message: z.string() }) },
							},
						},
					},
				},
			},
		},
	} as const satisfies MiddlewareTreeForContracts<typeof nestedContracts>;
	void invalidShapeMiddlewares;

	const validHandler: MiddlewareHandler<
		typeof middlewaresType.MIDDLEWARE.rateLimit,
		{ requestId: string }
	> = (_ctx, _next, appContext) => {
		const requestId: string = appContext.requestId;
		void requestId;
		return { status: 429, type: "JSON", data: { retryAfter: 1 } };
	};
	void validHandler;

	const validHandlerWithHeaders: MiddlewareHandler<
		typeof middlewaresWithHeadersType.MIDDLEWARE.auth,
		{ requestId: string }
	> = () => {
		return {
			status: 401,
			type: "JSON",
			headers: { "x-auth": "required" },
			data: { message: "Unauthorized" },
		};
	};
	void validHandlerWithHeaders;

	const invalidContextUsage: MiddlewareHandler<
		typeof middlewaresType.MIDDLEWARE.rateLimit,
		{ requestId: string }
	> = (_ctx, _next, appContext) => {
		// @ts-expect-error requestId is string, not number
		const invalid: number = appContext.requestId;
		void invalid;
		return { status: 429, type: "JSON", data: { retryAfter: 1 } };
	};
	void invalidContextUsage;

	// @ts-expect-error 418 is not declared by the middleware spec
	const invalidStatus: MiddlewareHandler<
		typeof middlewaresType.MIDDLEWARE.rateLimit,
		{ requestId: string }
	> = () => {
		return { status: 418, type: "JSON", data: { retryAfter: 1 } };
	};
	void invalidStatus;

	// @ts-expect-error rateLimit only allows JSON responses
	const invalidType: MiddlewareHandler<
		typeof middlewaresType.MIDDLEWARE.rateLimit,
		{ requestId: string }
	> = () => {
		return { status: 429, type: "Text", data: "too many requests" };
	};
	void invalidType;

	// @ts-expect-error retryAfter must be a number
	const invalidData: MiddlewareHandler<
		typeof middlewaresType.MIDDLEWARE.rateLimit,
		{ requestId: string }
	> = () => {
		return { status: 429, type: "JSON", data: { retryAfter: "1" } };
	};
	void invalidData;

	// @ts-expect-error declared middleware response headers are required
	const missingHeaders: MiddlewareHandler<
		typeof middlewaresWithHeadersType.MIDDLEWARE.auth,
		{ requestId: string }
	> = () => {
		return { status: 401, type: "JSON", data: { message: "Unauthorized" } };
	};
	void missingHeaders;

	// @ts-expect-error middleware response headers must match the declared schema
	const invalidHeaders: MiddlewareHandler<
		typeof middlewaresWithHeadersType.MIDDLEWARE.auth,
		{ requestId: string }
	> = () => {
		return {
			status: 401,
			type: "JSON",
			headers: { "x-auth": 1 },
			data: { message: "Unauthorized" },
		};
	};
	void invalidHeaders;
});
