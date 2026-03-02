import { describe, expect, test } from "bun:test";
import type { Context } from "hono";
import { Hono } from "hono";
import z from "zod";
import type { RouterShape } from "~/contract/contract.types.js";
import { createContracts } from "~/contract/contracts.js";
import { createHonoMiddlewareHandlers, createHonoOptions, initHono } from "~/hono/hono.js";
import { createMiddlewares } from "~/middleware/middleware.js";

const shape = {
	ROUTER: {
		users: {
			ROUTER: {
				register: {
					CONTRACT: true,
				},
				$userId: {
					CONTRACT: true,
				},
			},
		},
		transforms: {
			CONTRACT: true,
		},
		health: {
			CONTRACT: true,
		},
	},
} as const satisfies RouterShape;

const zUser = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string(),
});

const contracts = createContracts(shape, {
	ROUTER: {
		users: {
			ROUTER: {
				register: {
					CONTRACT: {
						post: {
							body: {
								type: "JSON",
								schema: z.object({
									name: z.string(),
									email: z.string(),
								}),
							},
							responses: {
								201: {
									type: "JSON",
									schema: zUser,
								},
							},
						},
					},
				},
				$userId: {
					CONTRACT: {
						get: {
							pathParams: z.object({ userId: z.string() }),
							responses: {
								200: {
									type: "JSON",
									schema: zUser,
								},
							},
						},
					},
				},
			},
		},
		health: {
			CONTRACT: {
				get: {
					responses: {
						200: {
							type: "JSON",
							schema: z.object({ status: z.string() }),
						},
					},
				},
			},
		},
		transforms: {
			CONTRACT: {
				post: {
					body: {
						type: "JSON",
						schema: z
							.object({ name: z.string() })
							.transform(async (input) => ({ name: input.name.trim() }))
							.transform((input) => ({ normalized: input.name.toUpperCase() })),
					},
					responses: {
						200: {
							type: "JSON",
							schema: z
								.object({ message: z.string() })
								.transform(async (body) => ({ message: `${body.message}!` })),
						},
					},
				},
			},
		},
	},
});

const middleware = createMiddlewares(contracts, {
	MIDDLEWARE: {
		rateLimit: {
			429: {
				type: "JSON",
				schema: z.object({ retryAfter: z.number() }),
			},
		},
	},
	ROUTER: {
		users: {
			ROUTER: {
				register: {
					MIDDLEWARE: {
						antiBot: {
							403: {
								type: "JSON",
								schema: z.object({ error: z.string() }),
							},
						},
					},
				},
			},
		},
	},
});

const middlewareOptions = createHonoOptions({ errorMode: "public" });

createHonoMiddlewareHandlers(middleware, middlewareOptions, {
	MIDDLEWARE: {
		// @ts-expect-error rateLimit 429 data must match declared schema ({ retryAfter: number })
		rateLimit: async () => ({
			type: "JSON" as const,
			status: 429 as const,
			data: "wrong type",
		}),
	},
});

function createTestApp() {
	const app = new Hono();

	initHono(
		app,
		contracts,
		{
			ROUTER: {
				users: {
					ROUTER: {
						register: {
							HANDLER: {
								post: (input) => ({
									type: "JSON" as const,
									status: 201 as const,
									data: { id: "test-id", ...input.body },
								}),
							},
						},
						$userId: {
							HANDLER: {
								get: (input) => ({
									type: "JSON" as const,
									status: 200 as const,
									data: {
										id: input.pathParams.userId,
										name: "Test User",
										email: "test@example.com",
									},
								}),
							},
						},
					},
				},
				health: {
					HANDLER: {
						get: () => ({
							type: "JSON" as const,
							status: 200 as const,
							data: { status: "ok" },
						}),
					},
				},
				transforms: {
					HANDLER: {
						post: (input) => ({
							type: "JSON" as const,
							status: 200 as const,
							data: { message: input.body.normalized },
						}),
					},
				},
			},
		},
		middleware,
		{
			MIDDLEWARE: {
				rateLimit: async (_ctx, next) => {
					await next();
				},
			},
			ROUTER: {
				users: {
					ROUTER: {
						register: {
							MIDDLEWARE: {
								antiBot: async (_ctx, next) => {
									await next();
								},
							},
						},
					},
				},
			},
		},
		{
			errorMode: "public",
		},
	);

	return app;
}

describe("createHono", () => {
	test("registers GET routes", async () => {
		const app = createTestApp();
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ status: "ok" });
	});

	test("applies server-side transforms to handler input, sends untransformed response", async () => {
		const app = createTestApp();
		const res = await app.request("/transforms", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "  john  " }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ message: "JOHN" });
	});

	test("registers POST routes with body parsing", async () => {
		const app = createTestApp();
		const res = await app.request("/users/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "John", email: "john@example.com" }),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body).toEqual({
			id: "test-id",
			name: "John",
			email: "john@example.com",
		});
	});

	test("handles path parameters", async () => {
		const app = createTestApp();
		const res = await app.request("/users/abc-123");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.id).toBe("abc-123");
	});

	test("returns 400 for invalid body (public error mode)", async () => {
		const app = createTestApp();
		const res = await app.request("/users/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: 123 }),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.type).toBe("invalidInput");
		expect(body.issues).toBeDefined();
		expect(Array.isArray(body.issues)).toBe(true);
	});

	test("returns hard-coded 404 body for unknown route", async () => {
		const app = createTestApp();
		const res = await app.request("/does-not-exist");
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body).toEqual({ type: "notFound" });
	});

	test("returns hard-coded 500 body when handler throws", async () => {
		const app = new Hono();
		initHono(
			app,
			contracts,
			{
				ROUTER: {
					users: {
						ROUTER: {
							register: {
								HANDLER: {
									post: () => ({
										type: "JSON" as const,
										status: 201 as const,
										data: { id: "x", name: "n", email: "e@e.com" },
									}),
								},
							},
							$userId: {
								HANDLER: {
									get: () => {
										throw new Error("boom");
									},
								},
							},
						},
					},
					health: {
						HANDLER: {
							get: () => ({
								type: "JSON" as const,
								status: 200 as const,
								data: { status: "ok" },
							}),
						},
					},
					transforms: {
						HANDLER: {
							post: () => ({
								type: "JSON" as const,
								status: 200 as const,
								data: { message: "x" },
							}),
						},
					},
				},
			},
			middleware,
			{
				MIDDLEWARE: {
					rateLimit: async (_ctx, next) => {
						await next();
					},
				},
				ROUTER: {
					users: {
						ROUTER: {
							register: {
								MIDDLEWARE: {
									antiBot: async (_ctx, next) => {
										await next();
									},
								},
							},
						},
					},
				},
			},
			{
				errorMode: "public",
			},
		);

		const res = await app.request("/users/123");
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body).toEqual({ type: "internalError" });
	});

	test("middleware passes through when not short-circuiting", async () => {
		const app = createTestApp();
		const res = await app.request("/users/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "John", email: "john@test.com" }),
		});
		expect(res.status).toBe(201);
	});

	test("middleware can short-circuit with typed response", async () => {
		const app = new Hono();
		initHono(
			app,
			contracts,
			{
				ROUTER: {
					users: {
						ROUTER: {
							register: {
								HANDLER: {
									post: (input) => ({
										type: "JSON" as const,
										status: 201 as const,
										data: { id: "x", ...input.body },
									}),
								},
							},
							$userId: {
								HANDLER: {
									get: (input) => ({
										type: "JSON" as const,
										status: 200 as const,
										data: {
											id: input.pathParams.userId,
											name: "User",
											email: "u@e.com",
										},
									}),
								},
							},
						},
					},
					health: {
						HANDLER: {
							get: () => ({
								type: "JSON" as const,
								status: 200 as const,
								data: { status: "ok" },
							}),
						},
					},
					transforms: {
						HANDLER: {
							post: () => ({
								type: "JSON" as const,
								status: 200 as const,
								data: { message: "x" },
							}),
						},
					},
				},
			},
			middleware,
			{
				MIDDLEWARE: {
					rateLimit: async () => ({
						type: "JSON" as const,
						status: 429 as const,
						data: { retryAfter: 60 },
					}),
				},
				ROUTER: {
					users: {
						ROUTER: {
							register: {
								MIDDLEWARE: {
									antiBot: async (_ctx, next) => {
										await next();
									},
								},
							},
						},
					},
				},
			},
			{
				errorMode: "public",
			},
		);

		const res = await app.request("/health");
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body).toEqual({ retryAfter: 60 });
	});

	test("additionalHandlerParams passes additional params to handlers", async () => {
		const app = new Hono();
		initHono(
			app,
			contracts,
			{
				ROUTER: {
					users: {
						ROUTER: {
							register: {
								HANDLER: {
									post: () => ({
										type: "JSON" as const,
										status: 201 as const,
										data: { id: "x", name: "n", email: "e@e.com" },
									}),
								},
							},
							$userId: {
								HANDLER: {
									get: () => ({
										type: "JSON" as const,
										status: 200 as const,
										data: { id: "x", name: "n", email: "e@e.com" },
									}),
								},
							},
						},
					},
					health: {
						HANDLER: {
							get: (_input, _ctx: Context, authValue) => ({
								type: "JSON" as const,
								status: 200 as const,
								data: { status: authValue ?? "no-auth" },
							}),
						},
					},
					transforms: {
						HANDLER: {
							post: () => ({
								type: "JSON" as const,
								status: 200 as const,
								data: { message: "x" },
							}),
						},
					},
				},
			},
			undefined,
			undefined,
			{
				additionalHandlerParams: (ctx: Context) =>
					[ctx.req.header("Authorization")] as const,
				errorMode: "public",
			},
		);

		const resWithAuth = await app.request("/health", {
			headers: { Authorization: "Bearer secret-token" },
		});
		expect(resWithAuth.status).toBe(200);
		const bodyWithAuth = await resWithAuth.json();
		expect(bodyWithAuth).toEqual({ status: "Bearer secret-token" });

		const resWithoutAuth = await app.request("/health");
		expect(resWithoutAuth.status).toBe(200);
		const bodyWithoutAuth = await resWithoutAuth.json();
		expect(bodyWithoutAuth).toEqual({ status: "no-auth" });
	});

	test("additionalHandlerParams supports async resolution", async () => {
		const app = new Hono();
		initHono(
			app,
			contracts,
			{
				ROUTER: {
					users: {
						ROUTER: {
							register: {
								HANDLER: {
									post: () => ({
										type: "JSON" as const,
										status: 201 as const,
										data: { id: "x", name: "n", email: "e@e.com" },
									}),
								},
							},
							$userId: {
								HANDLER: {
									get: () => ({
										type: "JSON" as const,
										status: 200 as const,
										data: { id: "x", name: "n", email: "e@e.com" },
									}),
								},
							},
						},
					},
					health: {
						HANDLER: {
							get: (_input, _ctx: Context, resolved) => ({
								type: "JSON" as const,
								status: 200 as const,
								data: { status: resolved },
							}),
						},
					},
					transforms: {
						HANDLER: {
							post: () => ({
								type: "JSON" as const,
								status: 200 as const,
								data: { message: "x" },
							}),
						},
					},
				},
			},
			undefined,
			undefined,
			{
				additionalHandlerParams: async (ctx: Context) => {
					const auth = ctx.req.header("Authorization");
					await new Promise((r) => setTimeout(r, 0));
					return [auth ?? "async-no-auth"] as const;
				},
				errorMode: "public",
			},
		);

		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ status: "async-no-auth" });
	});
});
