import { describe, expect, test } from "bun:test";
import type { Context } from "hono";
import { Hono } from "hono";
import z from "zod";
import { createRoutes } from "~/contract/routes.js";
import type { RouterShape } from "~/contract/shape.types.js";
import { initHono } from "~/hono/hono.js";
import { createMiddleware } from "~/middleware/middleware.js";

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

const routes = createRoutes(shape, {
	ROUTER: {
		users: {
			ROUTER: {
				register: {
					CONTRACT: {
						post: {
							body: {
								contentType: "application/json",
								schema: z.object({
									name: z.string(),
									email: z.string(),
								}),
							},
							responses: {
								201: {
									contentType: "application/json",
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
									contentType: "application/json",
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
							contentType: "application/json",
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
						contentType: "application/json",
						schema: z
							.object({ name: z.string() })
							.transform(async (input) => ({ name: input.name.trim() }))
							.transform((input) => ({ normalized: input.name.toUpperCase() })),
					},
					responses: {
						200: {
							contentType: "application/json",
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

const middleware = createMiddleware(routes, {
	MIDDLEWARE: {
		rateLimit: {
			429: {
				contentType: "application/json",
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
								contentType: "application/json",
								schema: z.object({ error: z.string() }),
							},
						},
					},
				},
			},
		},
	},
});

function createTestApp() {
	const app = new Hono();

	initHono(
		app,
		routes,
		{
			ROUTER: {
				users: {
					ROUTER: {
						register: {
							HANDLER: {
								post: (input) => ({
									status: 201 as const,
									contentType: "application/json" as const,
									body: {
										id: "test-id",
										...input.body,
									},
								}),
							},
						},
						$userId: {
							HANDLER: {
								get: (input) => ({
									status: 200 as const,
									contentType: "application/json" as const,
									body: {
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
							status: 200 as const,
							contentType: "application/json" as const,
							body: { status: "ok" },
						}),
					},
				},
				transforms: {
					HANDLER: {
						post: (input) => ({
							status: 200 as const,
							contentType: "application/json" as const,
							body: { message: input.body.normalized },
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

describe("initHono", () => {
	test("registers GET routes", async () => {
		const app = createTestApp();
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ status: "ok" });
	});

	test("applies transformed handler input while keeping server response validation HTTP-safe", async () => {
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
		expect(body.issues).toBeDefined();
		expect(Array.isArray(body.issues)).toBe(true);
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
			routes,
			{
				ROUTER: {
					users: {
						ROUTER: {
							register: {
								HANDLER: {
									post: (input) => ({
										status: 201 as const,
										contentType: "application/json" as const,
										body: { id: "x", ...input.body },
									}),
								},
							},
							$userId: {
								HANDLER: {
									get: (input) => ({
										status: 200 as const,
										contentType: "application/json" as const,
										body: {
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
								status: 200 as const,
								contentType: "application/json" as const,
								body: { status: "ok" },
							}),
						},
					},
					transforms: {
						HANDLER: {
							post: () => ({
								status: 200 as const,
								contentType: "application/json" as const,
								body: { message: "x" },
							}),
						},
					},
				},
			},
			middleware,
			{
				MIDDLEWARE: {
					rateLimit: async () => {
						return {
							status: 429 as const,
							contentType: "application/json" as const,
							body: { retryAfter: 60 },
						};
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

		const res = await app.request("/health");
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body).toEqual({ retryAfter: 60 });
	});

	test("transformContextParams passes transformed params to handlers", async () => {
		const app = new Hono();
		initHono(
			app,
			routes,
			{
				ROUTER: {
					users: {
						ROUTER: {
							register: {
								HANDLER: {
									post: () => ({
										status: 201 as const,
										contentType: "application/json" as const,
										body: { id: "x", name: "n", email: "e@e.com" },
									}),
								},
							},
							$userId: {
								HANDLER: {
									get: () => ({
										status: 200 as const,
										contentType: "application/json" as const,
										body: { id: "x", name: "n", email: "e@e.com" },
									}),
								},
							},
						},
					},
					health: {
						HANDLER: {
							get: (_input, _ctx: Context, authValue) => ({
								status: 200 as const,
								contentType: "application/json" as const,
								body: { status: authValue ?? "no-auth" },
							}),
						},
					},
					transforms: {
						HANDLER: {
							post: () => ({
								status: 200 as const,
								contentType: "application/json" as const,
								body: { message: "x" },
							}),
						},
					},
				},
			},
			undefined,
			undefined,
			{
				transformContextParams: ([ctx]: [Context]) =>
					[ctx, ctx.req.header("Authorization")] as const,
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

	test("transformContextParams supports async transform", async () => {
		const app = new Hono();
		initHono(
			app,
			routes,
			{
				ROUTER: {
					users: {
						ROUTER: {
							register: {
								HANDLER: {
									post: () => ({
										status: 201 as const,
										contentType: "application/json" as const,
										body: { id: "x", name: "n", email: "e@e.com" },
									}),
								},
							},
							$userId: {
								HANDLER: {
									get: () => ({
										status: 200 as const,
										contentType: "application/json" as const,
										body: { id: "x", name: "n", email: "e@e.com" },
									}),
								},
							},
						},
					},
					health: {
						HANDLER: {
							get: (_input, _ctx: Context, resolved) => ({
								status: 200 as const,
								contentType: "application/json" as const,
								body: { status: resolved },
							}),
						},
					},
					transforms: {
						HANDLER: {
							post: () => ({
								status: 200 as const,
								contentType: "application/json" as const,
								body: { message: "x" },
							}),
						},
					},
				},
			},
			undefined,
			undefined,
			{
				transformContextParams: async ([ctx]: [Context]) => {
					const auth = ctx.req.header("Authorization");
					await new Promise((r) => setTimeout(r, 0));
					return [ctx, auth ?? "async-no-auth"] as const;
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
