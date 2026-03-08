import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import z from "zod";
import { createSerializedResponse, parseSerializedResponse } from "../shared/shared.js";
import type { Shape } from "../shared/shared.types.js";
import { createHonoMiddlewareHandlers, runMiddlewareHandlers } from "./middleware.js";
import type { Middlewares } from "./middleware.types.js";

const servers: Array<{ stop: () => void }> = [];

const startServer = (app: Hono): string => {
	const server = Bun.serve({ fetch: app.fetch, port: 0 });
	servers.push(server);
	return `http://localhost:${server.port}`;
};

afterEach(() => {
	while (servers.length > 0) {
		servers.pop()?.stop();
	}
});

const shape = {
	SHAPE: {
		users: { CONTRACT: true },
	},
} as const satisfies Shape;

describe("middleware runtime", () => {
	test("middleware short-circuits and emits serialized middleware source", async () => {
		const middlewares = {
			MIDDLEWARE: {
				rateLimit: {
					429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
				},
			},
		} as const satisfies Middlewares<typeof shape>;

		const bound = createHonoMiddlewareHandlers<typeof shape, { requestId: string }>(
			middlewares,
			{
				MIDDLEWARE: {
					rateLimit: () => ({
						status: 429,
						type: "JSON",
						data: { retryAfter: 123 },
					}),
				},
			},
		);

		const app = new Hono();
		app.get("/users", async (ctx) => {
			return runMiddlewareHandlers(ctx, { requestId: "r1" }, bound, async () =>
				createSerializedResponse({
					status: 200,
					type: "JSON",
					source: "contract",
					data: { ok: true },
				}),
			);
		});

		const response = await fetch(`${startServer(app)}/users`);
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(429);
		expect(parsed.source).toBe("middleware");
		expect(parsed.data).toEqual({ retryAfter: 123 });
	});

	test("middleware chain executes in order and continues when handlers call next", async () => {
		const middlewares = {
			MIDDLEWARE: {
				first: {
					429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
				},
				second: {
					429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
				},
			},
		} as const satisfies Middlewares<typeof shape>;

		const steps: Array<string> = [];
		const bound = createHonoMiddlewareHandlers<typeof shape, { requestId: string }>(
			middlewares,
			{
				MIDDLEWARE: {
					first: async (_ctx, next) => {
						steps.push("first:before");
						await next();
						steps.push("first:after");
					},
					second: async (_ctx, next) => {
						steps.push("second:before");
						await next();
						steps.push("second:after");
					},
				},
			},
		);

		const app = new Hono();
		app.get("/users", async (ctx) => {
			return runMiddlewareHandlers(ctx, { requestId: "r2" }, bound, async () => {
				steps.push("terminal");
				return createSerializedResponse({
					status: 200,
					type: "JSON",
					source: "contract",
					data: { ok: true },
				});
			});
		});

		const response = await fetch(`${startServer(app)}/users`);
		const parsed = await parseSerializedResponse(response);
		expect(response.status).toBe(200);
		expect(parsed.source).toBe("contract");
		expect(steps).toEqual([
			"first:before",
			"second:before",
			"terminal",
			"second:after",
			"first:after",
		]);
	});

	test("middleware validation failures surface as errors", async () => {
		const middlewares = {
			MIDDLEWARE: {
				guard: {
					429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
				},
			},
		} as const satisfies Middlewares<typeof shape>;

		const app = new Hono();

		const undeclaredStatus = createHonoMiddlewareHandlers<typeof shape, unknown>(middlewares, {
			MIDDLEWARE: {
				guard: () => ({ status: 418, type: "JSON", data: { retryAfter: 1 } }),
			},
		});
		app.get("/status", async (ctx) => {
			try {
				return await runMiddlewareHandlers(
					ctx,
					{},
					undeclaredStatus,
					async () => new Response("ok"),
				);
			} catch (error) {
				return new Response((error as Error).message, { status: 500 });
			}
		});

		const mismatchedType = createHonoMiddlewareHandlers<typeof shape, unknown>(middlewares, {
			MIDDLEWARE: {
				guard: () => ({ status: 429, type: "Text", data: "nope" }),
			},
		});
		app.get("/type", async (ctx) => {
			try {
				return await runMiddlewareHandlers(
					ctx,
					{},
					mismatchedType,
					async () => new Response("ok"),
				);
			} catch (error) {
				return new Response((error as Error).message, { status: 500 });
			}
		});

		const invalidData = createHonoMiddlewareHandlers<typeof shape, unknown>(middlewares, {
			MIDDLEWARE: {
				guard: () => ({ status: 429, type: "JSON", data: { retryAfter: "bad" } }),
			},
		});
		app.get("/data", async (ctx) => {
			try {
				return await runMiddlewareHandlers(
					ctx,
					{},
					invalidData,
					async () => new Response("ok"),
				);
			} catch (error) {
				return new Response((error as Error).message, { status: 500 });
			}
		});

		const base = startServer(app);
		const statusResponse = await fetch(`${base}/status`);
		expect(statusResponse.status).toBe(500);
		expect(await statusResponse.text()).toContain("undeclared status");

		const typeResponse = await fetch(`${base}/type`);
		expect(typeResponse.status).toBe(500);
		expect(await typeResponse.text()).toContain("mismatched response type");

		const dataResponse = await fetch(`${base}/data`);
		expect(dataResponse.status).toBe(500);
		expect(await dataResponse.text()).toContain("validation failed");
	});
});

const middlewaresType = {
	MIDDLEWARE: {
		rateLimit: {
			429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
		},
	},
} as const satisfies Middlewares<typeof shape>;

const typedMiddlewares = createHonoMiddlewareHandlers<typeof shape, { requestId: string }>(
	middlewaresType,
	{
		MIDDLEWARE: {
			rateLimit: (_ctx, _next, ourContext) => {
				const requestId: string = ourContext.requestId;
				void requestId;
				return { status: 429, type: "JSON", data: { retryAfter: 1 } };
			},
		},
	},
);
void typedMiddlewares;

const typeOnly = (_cb: () => void): void => {};

typeOnly(() => {
	void createHonoMiddlewareHandlers<typeof shape, { requestId: string }>(middlewaresType, {
		MIDDLEWARE: {
			rateLimit: (_ctx, _next, ourContext) => {
				// @ts-expect-error requestId is string, not number
				const invalid: number = ourContext.requestId;
				void invalid;
				return { status: 429, type: "JSON", data: { retryAfter: 1 } };
			},
		},
	});
});
