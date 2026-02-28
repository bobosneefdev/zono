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
								get: (input) => {
									if (input.pathParams.userId === "explode") {
										throw new Error("forced failure");
									}

									return {
										status: 200 as const,
										contentType: "application/json" as const,
										body: {
											id: input.pathParams.userId,
											name: "User",
											email: "user@test.com",
										},
									};
								},
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

	test("returns hard-coded 404 body when route is not found", async () => {
		const missingClient = createClient(routes, {
			baseUrl: `http://localhost:${PORT}/missing-base`,
			middleware: [middleware],
			serverErrorMode: "public",
		});

		const res = await missingClient.health.get();
		expect(res.status).toBe(404);
		if (res.status === 404) {
			expect(res.body).toEqual({ type: "notFound" });
		}
	});

	test("returns hard-coded 500 body when handler throws", async () => {
		const res = await client.users.$userId.get({
			pathParams: { userId: "explode" },
		});
		expect(res.status).toBe(500);
		if (res.status === 500) {
			expect(res.body).toEqual({ type: "internalError" });
		}
	});

	test("invalid client input fails fast before request", async () => {
		const rawClient = createClient(routes, {
			baseUrl: `http://localhost:${PORT}`,
			middleware: [middleware],
			serverErrorMode: "public",
		});

		await expect(
			rawClient.users.register.post({
				body: { name: 123 as unknown as string, email: "bad" },
			}),
		).rejects.toThrow("Contract validation failed");
	});

	test("applies directional transform behavior with async support", async () => {
		const res = await client.transforms.post({
			body: { name: "  john  " },
		});
		expect(res.status).toBe(200);
		if (res.status === 200) {
			expect(res.body.message).toBe("JOHN!");
		}
	});
});
