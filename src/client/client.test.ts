import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import z from "zod";
import { createClient } from "~/client/client.js";
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
								schema: z.object({ name: z.string(), email: z.string() }),
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
});

let server: ReturnType<typeof Bun.serve>;
const PORT = 19876;

beforeAll(() => {
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
									body: { id: "new-id", ...input.body },
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
										email: "user@test.com",
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
		},
		undefined,
		undefined,
		{
			errorMode: "public",
		},
	);
	server = Bun.serve({ fetch: app.fetch, port: PORT });
});

afterAll(() => {
	server.stop();
});

describe("createClient (proxy chain)", () => {
	const client = createClient(routes, {
		baseUrl: `http://localhost:${PORT}`,
		middleware: [middleware],
		serverErrorMode: "public",
	});

	test("GET request with no params", async () => {
		const res = await client.health.get();
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ status: "ok" });
		expect(res.response).toBeInstanceOf(Response);
	});

	test("POST request with body", async () => {
		const res = await client.users.register.post({
			body: { name: "John", email: "john@example.com" },
		});
		expect(res.status).toBe(201);
		expect(res.body).toEqual({
			id: "new-id",
			name: "John",
			email: "john@example.com",
		});
	});

	test("GET request with path params", async () => {
		const res = await client.users.$userId.get({
			pathParams: { userId: "user-123" },
		});
		expect(res.status).toBe(200);
		if (res.status === 200) {
			expect(res.body.id).toBe("user-123");
		}
	});

	test("validation error returns 400 with public error mode", async () => {
		const rawClient = createClient(routes, {
			baseUrl: `http://localhost:${PORT}`,
			middleware: [middleware],
			serverErrorMode: "public",
			bypassOutgoingParse: true,
		});
		const res = await rawClient.users.register.post({
			body: { name: 123 as unknown as string, email: "bad" },
		});
		expect(res.status).toBe(400);
		expect(res.body).toBeDefined();
	});
});
