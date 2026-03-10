import { describe, expect, test } from "bun:test";
import z from "zod";
import type { MiddlewareHandler } from "../server/server.js";
import type { ApiShape } from "../shared/shared.js";
import type { MiddlewareTreeFor } from "./middleware.js";
import { createHonoMiddlewareHandlers } from "./middleware.js";

const shape = {
	SHAPE: {
		users: { CONTRACT: true },
	},
} as const satisfies ApiShape;

const nestedShape = {
	SHAPE: {
		api: {
			SHAPE: {
				users: {
					CONTRACT: true,
					SHAPE: {
						$userId: { CONTRACT: true },
					},
				},
			},
		},
	},
} as const satisfies ApiShape;

describe("middleware bindings", () => {
	test("returns the supplied middleware tree and handlers", () => {
		const middlewares = {
			MIDDLEWARE: {
				rateLimit: {
					429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
				},
			},
		} as const satisfies MiddlewareTreeFor<typeof shape>;

		const handlers = {
			MIDDLEWARE: {
				rateLimit: () => ({
					status: 429 as const,
					type: "JSON" as const,
					data: { retryAfter: 123 },
				}),
			},
		};

		const bound = createHonoMiddlewareHandlers<typeof middlewares, { requestId: string }>(
			middlewares,
			handlers,
		);

		expect(bound.middlewares).toBe(middlewares);
		expect(bound.handlers).toBe(handlers);
	});
});

const middlewaresType = {
	MIDDLEWARE: {
		rateLimit: {
			429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
		},
	},
} as const satisfies MiddlewareTreeFor<typeof shape>;

const typedMiddlewares = createHonoMiddlewareHandlers<
	typeof middlewaresType,
	{ requestId: string }
>(middlewaresType, {
	MIDDLEWARE: {
		rateLimit: (_ctx, _next, ourContext) => {
			const requestId: string = ourContext.requestId;
			void requestId;
			return { status: 429, type: "JSON", data: { retryAfter: 1 } };
		},
	},
});
void typedMiddlewares;

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
	} as const satisfies MiddlewareTreeFor<typeof nestedShape>;
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
	} as const satisfies MiddlewareTreeFor<typeof nestedShape>;
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
	} as const satisfies MiddlewareTreeFor<typeof nestedShape>;
	void invalidShapeMiddlewares;

	const validHandler: MiddlewareHandler<
		typeof middlewaresType.MIDDLEWARE.rateLimit,
		{ requestId: string }
	> = (_ctx, _next, ourContext) => {
		const requestId: string = ourContext.requestId;
		void requestId;
		return { status: 429, type: "JSON", data: { retryAfter: 1 } };
	};
	void validHandler;

	void createHonoMiddlewareHandlers<typeof middlewaresType, { requestId: string }>(
		middlewaresType,
		{
			MIDDLEWARE: {
				rateLimit: (_ctx, _next, ourContext) => {
					// @ts-expect-error requestId is string, not number
					const invalid: number = ourContext.requestId;
					void invalid;
					return { status: 429, type: "JSON", data: { retryAfter: 1 } };
				},
			},
		},
	);

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
});
