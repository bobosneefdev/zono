import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import z from "zod";
import type { ContractTreeFor } from "../contract/contract.js";
import type { MiddlewareTreeFor } from "../middleware/middleware.js";
import type { ApiShape } from "../shared/shared.js";
import { createSerializedResponse } from "../shared/shared.js";
import { createClient } from "./client.js";

type HasStatus<TUnion, TStatus extends number> = Extract<TUnion, { status: TStatus }> extends never
	? false
	: true;

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
		users: {
			SHAPE: {
				$userId: { CONTRACT: true },
			},
		},
		search: { CONTRACT: true },
		upload: { CONTRACT: true },
		events: { CONTRACT: true },
	},
} as const satisfies ApiShape;

const contracts = {
	SHAPE: {
		users: {
			SHAPE: {
				$userId: {
					CONTRACT: {
						post: {
							pathParams: z.object({ userId: z.string() }),
							query: {
								type: "JSON",
								query: z.object({ active: z.boolean() }),
							},
							headers: {
								type: "JSON",
								headers: z.object({ "x-custom": z.object({ source: z.string() }) }),
							},
							body: {
								type: "JSON",
								body: z.object({ name: z.string() }),
							},
							responses: {
								200: {
									type: "JSON",
									body: z.object({
										userId: z.string(),
										active: z.string(),
										header: z.string(),
										name: z.string(),
									}),
								},
							},
						},
					},
				},
			},
		},
		search: {
			CONTRACT: {
				post: {
					body: {
						type: "URLSearchParams",
						body: z.instanceof(URLSearchParams),
					},
					responses: {
						200: {
							type: "JSON",
							body: z.object({ contentType: z.string(), payload: z.string() }),
						},
					},
				},
			},
		},
		upload: {
			CONTRACT: {
				post: {
					body: {
						type: "FormData",
						body: z.instanceof(FormData),
					},
					responses: {
						200: {
							type: "JSON",
							body: z.object({ fileName: z.string() }),
						},
					},
				},
			},
		},
		events: {
			CONTRACT: {
				get: {
					responses: {
						200: {
							type: "SuperJSON",
							body: z.object({ createdAt: z.date() }),
						},
						503: {
							type: "JSON",
							body: z.object({ message: z.string() }),
						},
					},
				},
			},
		},
	},
} as const satisfies ContractTreeFor<typeof shape>;

const middlewares = {
	MIDDLEWARE: {
		rateLimit: {
			429: {
				type: "JSON",
				schema: z.object({ retryAfter: z.number() }),
			},
		},
	},
} as const satisfies MiddlewareTreeFor<typeof shape>;

describe("createClient runtime", () => {
	test("encodes path/query/headers/body from request envelope", async () => {
		const app = new Hono();
		app.post("/users/:userId", async (ctx) => {
			const payload = await ctx.req.json();
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: {
					userId: ctx.req.param("userId"),
					active: ctx.req.query("active") ?? "",
					header: ctx.req.header("x-custom") ?? "",
					name: payload.name,
				},
			});
		});

		const client = createClient<typeof shape, typeof contracts, typeof middlewares, "public">(
			startServer(app),
		);

		const response = await client.fetch("/users/$userId", "post", {
			pathParams: { userId: "a/b" },
			query: { active: true },
			headers: { "x-custom": { source: "test" } },
			body: { name: "alice" },
		});

		expect(response.status).toBe(200);
		expect(response.response).toBeInstanceOf(Response);
		expect(response.response.status).toBe(200);
		expect(response.data).toEqual({
			userId: "a/b",
			active: "true",
			header: '{"source":"test"}',
			name: "alice",
		});
	});

	test("supports URLSearchParams and FormData body modes", async () => {
		const app = new Hono();
		app.post("/search", async (ctx) => {
			const contentType = ctx.req.header("content-type") ?? "";
			const payload = await ctx.req.text();
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { contentType, payload },
			});
		});
		app.post("/upload", async (ctx) => {
			const formData = await ctx.req.formData();
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { fileName: String(formData.get("fileName")) },
			});
		});

		const client = createClient<typeof shape, typeof contracts, typeof middlewares, "public">(
			startServer(app),
		);

		const urlEncoded = await client.fetch("/search", "post", {
			body: new URLSearchParams({ q: "zono docs" }),
		});
		expect(urlEncoded.status).toBe(200);
		expect(urlEncoded.response.status).toBe(200);
		expect((urlEncoded.data as { contentType: string }).contentType).toContain(
			"application/x-www-form-urlencoded",
		);
		expect((urlEncoded.data as { payload: string }).payload).toContain("q=zono+docs");

		const formData = new FormData();
		formData.set("fileName", "avatar.png");
		const uploaded = await client.fetch("/upload", "post", { body: formData });
		expect(uploaded.status).toBe(200);
		expect(uploaded.response.status).toBe(200);
		expect(uploaded.data).toEqual({ fileName: "avatar.png" });
	});

	test("parses serialized responses including SuperJSON", async () => {
		const failingApp = new Hono();
		failingApp.get("/events", () => {
			return createSerializedResponse({
				status: 503,
				type: "JSON",
				source: "error",
				data: { message: "down" },
			});
		});

		const failingClient = createClient<
			typeof shape,
			typeof contracts,
			typeof middlewares,
			"public"
		>(startServer(failingApp));
		const failed = await failingClient.fetch("/events", "get");
		expect(failed.status).toBe(503);
		expect(failed.response.status).toBe(503);
		expect((await failed.response.json()) as { message: string }).toEqual({ message: "down" });

		const healthyApp = new Hono();
		healthyApp.get("/events", () => {
			return createSerializedResponse({
				status: 200,
				type: "SuperJSON",
				source: "contract",
				data: { createdAt: new Date("2024-02-02T00:00:00.000Z") },
			});
		});

		const healthyClient = createClient<
			typeof shape,
			typeof contracts,
			typeof middlewares,
			"public"
		>(startServer(healthyApp));
		const healthy = await healthyClient.fetch("/events", "get");
		expect(healthy.status).toBe(200);
		expect(healthy.response.status).toBe(200);
		expect((healthy.data as { createdAt: Date }).createdAt instanceof Date).toBe(true);
	});
});

type TypedClient = ReturnType<
	typeof createClient<typeof shape, typeof contracts, typeof middlewares, "public">
>;
type ClientResponse = Awaited<ReturnType<TypedClient["fetch"]>>;
const has200: HasStatus<ClientResponse, 200> = true;
const has429: HasStatus<ClientResponse, 429> = true;
const has400: HasStatus<ClientResponse, 400> = true;
const has404: HasStatus<ClientResponse, 404> = true;
const has500: HasStatus<ClientResponse, 500> = true;
void has200;
void has429;
void has400;
void has404;
void has500;

const typedClient = createClient<typeof shape, typeof contracts, typeof middlewares, "public">(
	"http://localhost",
);

const runTypeOnly = (_cb: () => void): void => {};

runTypeOnly(() => {
	void typedClient.fetch("/users/$userId", "post", {
		pathParams: { userId: "u1" },
		query: { active: true },
		headers: { "x-custom": { source: "dev" } },
		body: { name: "alice" },
	});

	// @ts-expect-error unknown path should fail
	void typedClient.fetch("/unknown", "get");

	// @ts-expect-error method not declared on /events should fail
	void typedClient.fetch("/events", "post");

	// @ts-expect-error pathParams required for dynamic route
	void typedClient.fetch("/users/$userId", "post", {
		query: { active: true },
		headers: { "x-custom": { source: "dev" } },
		body: { name: "alice" },
	});
});
