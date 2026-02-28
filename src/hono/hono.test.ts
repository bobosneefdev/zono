import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import z from "zod";
import { createRoutes } from "~/contract/routes.js";
import type { RouterShape } from "~/contract/shape.types.js";
import { createHonoMiddlewareHandlers, createHonoRouteHandlers, initHono } from "~/hono/hono.js";
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

	initHono(app, routes, {
		routeHandlers: createHonoRouteHandlers(routes, {
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
			},
		}),
		middleware,
		middlewareHandlers: createHonoMiddlewareHandlers(middleware, {
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
		}),
		errorMode: "public",
	});

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
		initHono(app, routes, {
			routeHandlers: createHonoRouteHandlers(routes, {
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
				},
			}),
			middleware,
			middlewareHandlers: createHonoMiddlewareHandlers(middleware, {
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
			}),
			errorMode: "public",
		});

		const res = await app.request("/health");
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body).toEqual({ retryAfter: 60 });
	});
});
