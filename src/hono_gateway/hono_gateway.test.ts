import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono, type MiddlewareHandler } from "hono";
import z from "zod";
import { initHono } from "~/hono/index.js";
import {
	createGatewayRouter,
	createGatewayRouterService,
	initHonoGateway,
} from "~/hono_gateway/index.js";
import { createRouter } from "~/router/index.js";

const serviceRouter = createRouter(
	{
		items: {
			TYPE: "router",
			ROUTER: {
				$id: {
					TYPE: "contract",
				},
			},
		},
		health: {
			TYPE: "contract",
		},
	},
	{
		items: {
			$id: {
				CONTRACT: {
					get: {
						pathParams: z.object({ id: z.string() }),
						responses: {
							200: {
								contentType: "application/json",
								schema: z.object({ id: z.string(), name: z.string() }),
							},
						},
					},
					post: {
						pathParams: z.object({ id: z.string() }),
						payload: {
							contentType: "application/json",
							schema: z.object({ name: z.string() }),
						},
						responses: {
							201: {
								contentType: "application/json",
								schema: z.object({ id: z.string(), name: z.string() }),
							},
						},
					},
				},
			},
		},
		health: {
			CONTRACT: {
				get: {
					query: {
						type: "standard",
						schema: z.object({ verbose: z.string().optional() }),
					},
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
);

let upstreamServer: ReturnType<typeof Bun.serve>;
const upstreamPort = 19876;

beforeAll(() => {
	const upstreamApp = new Hono();
	initHono(upstreamApp, serviceRouter, {
		items: {
			$id: {
				HANDLER: {
					get: async (data) => ({
						status: 200,
						data: { id: data.pathParams.id, name: "Item" },
					}),
					post: async (data) => ({
						status: 201,
						data: { id: data.pathParams.id, name: data.payload.name },
					}),
				},
			},
		},
		health: {
			HANDLER: {
				get: async (data) => ({
					status: 200,
					data: {
						status: data.query?.verbose === "true" ? "ok-verbose" : "ok",
					},
				}),
			},
		},
	});
	upstreamServer = Bun.serve({
		fetch: upstreamApp.fetch,
		port: upstreamPort,
	});
});

afterAll(() => {
	upstreamServer.stop(true);
});

describe("createGatewayRouter", () => {
	it("returns the input unchanged", () => {
		const input = { svc: serviceRouter };
		const result = createGatewayRouter(input);
		expect(result).toBe(input);
	});
});

describe("initHonoGateway", () => {
	it("proxies GET requests to the upstream service", async () => {
		const gatewayRouter = createGatewayRouter({ svc: serviceRouter });
		const app = new Hono();
		initHonoGateway(app, gatewayRouter, {
			services: {
				svc: { baseUrl: `http://localhost:${upstreamPort}` },
			},
		});

		const response = await app.request("http://localhost/svc/items/abc", {
			method: "GET",
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id: "abc", name: "Item" });
	});

	it("proxies POST requests with body", async () => {
		const gatewayRouter = createGatewayRouter({ svc: serviceRouter });
		const app = new Hono();
		initHonoGateway(app, gatewayRouter, {
			services: {
				svc: { baseUrl: `http://localhost:${upstreamPort}` },
			},
		});

		const response = await app.request("http://localhost/svc/items/xyz", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Widget" }),
		});

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ id: "xyz", name: "Widget" });
	});

	it("preserves query strings", async () => {
		const gatewayRouter = createGatewayRouter({ svc: serviceRouter });
		const app = new Hono();
		initHonoGateway(app, gatewayRouter, {
			services: {
				svc: { baseUrl: `http://localhost:${upstreamPort}` },
			},
		});

		const response = await app.request("http://localhost/svc/health?verbose=true", {
			method: "GET",
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "ok-verbose" });
	});

	it("supports basePath option", async () => {
		const gatewayRouter = createGatewayRouter({ svc: serviceRouter });
		const app = new Hono();
		initHonoGateway(app, gatewayRouter, {
			services: {
				svc: { baseUrl: `http://localhost:${upstreamPort}` },
			},
			basePath: "/v1",
		});

		const withBasePath = await app.request("http://localhost/v1/svc/items/abc", {
			method: "GET",
		});
		expect(withBasePath.status).toBe(200);
		expect(await withBasePath.json()).toEqual({ id: "abc", name: "Item" });

		const withoutBasePath = await app.request("http://localhost/svc/items/abc", {
			method: "GET",
		});
		expect(withoutBasePath.status).toBe(404);
	});

	it("executes middleware in order: global -> service[*] -> service[path]", async () => {
		const order: Array<string> = [];
		const gatewayRouter = createGatewayRouter({ svc: serviceRouter });
		const app = new Hono();
		initHonoGateway(app, gatewayRouter, {
			services: {
				svc: {
					baseUrl: `http://localhost:${upstreamPort}`,
					middleware: {
						"*": [
							async (_c, next) => {
								order.push("service");
								await next();
							},
						],
						"/items/$id": [
							(async (_c, next) => {
								order.push("path");
								await next();
							}) satisfies MiddlewareHandler,
						],
					},
				},
			},
			globalMiddleware: [
				async (_c, next) => {
					order.push("global");
					await next();
				},
			],
		});

		await app.request("http://localhost/svc/items/abc", { method: "GET" });
		expect(order).toEqual(["global", "service", "path"]);
	});

	it("global middleware can short-circuit the request", async () => {
		const gatewayRouter = createGatewayRouter({ svc: serviceRouter });
		const app = new Hono();
		initHonoGateway(app, gatewayRouter, {
			services: {
				svc: { baseUrl: `http://localhost:${upstreamPort}` },
			},
			globalMiddleware: [
				async (c, _next) => {
					return c.json({ error: "Blocked" }, 403);
				},
			],
		});

		const response = await app.request("http://localhost/svc/items/abc", {
			method: "GET",
		});

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "Blocked" });
	});

	it("returns 502 when upstream is unreachable", async () => {
		const gatewayRouter = createGatewayRouter({ svc: serviceRouter });
		const app = new Hono();
		initHonoGateway(app, gatewayRouter, {
			services: {
				svc: { baseUrl: "http://localhost:19999" },
			},
		});

		const response = await app.request("http://localhost/svc/items/abc", {
			method: "GET",
		});

		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({ error: "Bad Gateway" });
	});

	it("works with multiple services", async () => {
		const secondRouter = createRouter(
			{ ping: { TYPE: "contract" } },
			{
				ping: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									contentType: "application/json",
									schema: z.object({ pong: z.boolean() }),
								},
							},
						},
					},
				},
			},
		);

		const secondApp = new Hono();
		initHono(secondApp, secondRouter, {
			ping: {
				HANDLER: {
					get: async () => ({ status: 200, data: { pong: true } }),
				},
			},
		});
		const secondServer = Bun.serve({
			fetch: secondApp.fetch,
			port: upstreamPort + 1,
		});

		try {
			const gatewayRouter = createGatewayRouter({
				svc: serviceRouter,
				other: secondRouter,
			});
			const app = new Hono();
			initHonoGateway(app, gatewayRouter, {
				services: {
					svc: { baseUrl: `http://localhost:${upstreamPort}` },
					other: { baseUrl: `http://localhost:${upstreamPort + 1}` },
				},
			});

			const svcResponse = await app.request("http://localhost/svc/items/abc", {
				method: "GET",
			});
			expect(svcResponse.status).toBe(200);
			expect(await svcResponse.json()).toEqual({ id: "abc", name: "Item" });

			const otherResponse = await app.request("http://localhost/other/ping", {
				method: "GET",
			});
			expect(otherResponse.status).toBe(200);
			expect(await otherResponse.json()).toEqual({ pong: true });
		} finally {
			secondServer.stop(true);
		}
	});
});

const nestedServiceRouter = createRouter(
	{
		posts: {
			TYPE: "router",
			ROUTER: {
				$postId: {
					TYPE: "contract",
					ROUTER: {
						comments: {
							TYPE: "contract",
							ROUTER: {
								$commentId: {
									TYPE: "contract",
								},
							},
						},
					},
				},
			},
		},
		health: {
			TYPE: "contract",
		},
	},
	{
		posts: {
			$postId: {
				CONTRACT: {
					get: {
						pathParams: z.object({ postId: z.string() }),
						responses: {
							200: {
								contentType: "application/json",
								schema: z.object({ postId: z.string() }),
							},
						},
					},
				},
				ROUTER: {
					comments: {
						CONTRACT: {
							get: {
								pathParams: z.object({ postId: z.string() }),
								responses: {
									200: {
										contentType: "application/json",
										schema: z.object({
											postId: z.string(),
											comments: z.array(z.string()),
										}),
									},
								},
							},
						},
						ROUTER: {
							$commentId: {
								CONTRACT: {
									get: {
										pathParams: z.object({
											postId: z.string(),
											commentId: z.string(),
										}),
										responses: {
											200: {
												contentType: "application/json",
												schema: z.object({
													postId: z.string(),
													commentId: z.string(),
												}),
											},
										},
									},
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
							schema: z.object({ ok: z.boolean() }),
						},
					},
				},
			},
		},
	},
);

let nestedUpstreamServer: ReturnType<typeof Bun.serve>;
const nestedUpstreamPort = 19878;

beforeAll(() => {
	const app = new Hono();
	initHono(app, nestedServiceRouter, {
		posts: {
			$postId: {
				HANDLER: {
					get: async (data) => ({
						status: 200,
						data: { postId: data.pathParams.postId },
					}),
				},
				ROUTER: {
					comments: {
						HANDLER: {
							get: async (data) => ({
								status: 200,
								data: { postId: data.pathParams.postId, comments: ["a", "b"] },
							}),
						},
						ROUTER: {
							$commentId: {
								HANDLER: {
									get: async (data) => ({
										status: 200,
										data: {
											postId: data.pathParams.postId,
											commentId: data.pathParams.commentId,
										},
									}),
								},
							},
						},
					},
				},
			},
		},
		health: {
			HANDLER: {
				get: async () => ({ status: 200, data: { ok: true } }),
			},
		},
	});
	nestedUpstreamServer = Bun.serve({ fetch: app.fetch, port: nestedUpstreamPort });
});

afterAll(() => {
	nestedUpstreamServer.stop(true);
});

describe("createGatewayRouterService", () => {
	it("included routes proxy correctly", async () => {
		const filtered = createGatewayRouterService(nestedServiceRouter, {
			includeOnlyShape: {
				posts: {
					$postId: {
						comments: true,
					},
				},
				health: true,
			},
		});
		const gatewayRouter = createGatewayRouter({ svc: filtered });
		const app = new Hono();
		initHonoGateway(app, gatewayRouter, {
			services: {
				svc: { baseUrl: `http://localhost:${nestedUpstreamPort}` },
			},
		});

		const postRes = await app.request("http://localhost/svc/posts/p1", { method: "GET" });
		expect(postRes.status).toBe(200);
		expect(await postRes.json()).toEqual({ postId: "p1" });

		const commentsRes = await app.request("http://localhost/svc/posts/p1/comments", {
			method: "GET",
		});
		expect(commentsRes.status).toBe(200);
		expect(await commentsRes.json()).toEqual({ postId: "p1", comments: ["a", "b"] });

		const healthRes = await app.request("http://localhost/svc/health", { method: "GET" });
		expect(healthRes.status).toBe(200);
		expect(await healthRes.json()).toEqual({ ok: true });
	});

	it("excluded routes return 404", async () => {
		const filtered = createGatewayRouterService(nestedServiceRouter, {
			includeOnlyShape: {
				posts: {
					$postId: true,
				},
			},
		});
		const gatewayRouter = createGatewayRouter({ svc: filtered });
		const app = new Hono();
		initHonoGateway(app, gatewayRouter, {
			services: {
				svc: { baseUrl: `http://localhost:${nestedUpstreamPort}` },
			},
		});

		const postRes = await app.request("http://localhost/svc/posts/p1", { method: "GET" });
		expect(postRes.status).toBe(200);

		const commentsRes = await app.request("http://localhost/svc/posts/p1/comments", {
			method: "GET",
		});
		expect(commentsRes.status).toBe(404);

		const commentRes = await app.request("http://localhost/svc/posts/p1/comments/c1", {
			method: "GET",
		});
		expect(commentRes.status).toBe(404);

		const healthRes = await app.request("http://localhost/svc/health", { method: "GET" });
		expect(healthRes.status).toBe(404);
	});

	it("true strips sub-router children but keeps the contract", async () => {
		const filtered = createGatewayRouterService(nestedServiceRouter, {
			includeOnlyShape: {
				posts: {
					$postId: {
						comments: true,
					},
				},
			},
		});
		const gatewayRouter = createGatewayRouter({ svc: filtered });
		const app = new Hono();
		initHonoGateway(app, gatewayRouter, {
			services: {
				svc: { baseUrl: `http://localhost:${nestedUpstreamPort}` },
			},
		});

		const commentsRes = await app.request("http://localhost/svc/posts/p1/comments", {
			method: "GET",
		});
		expect(commentsRes.status).toBe(200);
		expect(await commentsRes.json()).toEqual({ postId: "p1", comments: ["a", "b"] });

		const commentRes = await app.request("http://localhost/svc/posts/p1/comments/c1", {
			method: "GET",
		});
		expect(commentRes.status).toBe(404);
	});
});
