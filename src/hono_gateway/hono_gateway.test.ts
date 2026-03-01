import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import z from "zod";
import { createClient } from "~/client/client.js";
import type { RouterShape } from "~/contract/contract.types.js";
import { createRoutes } from "~/contract/routes.js";
import { createHonoMiddlewareHandlers, initHono } from "~/hono/hono.js";
import {
	createGatewayOptions,
	generateHonoGatewayRoutesAndMiddleware,
	initHonoGateway,
} from "~/hono_gateway/hono_gateway.js";
import { createMiddleware } from "~/middleware/middleware.js";

const shape = {
	ROUTER: {
		items: {
			CONTRACT: true,
			ROUTER: {
				$itemId: {
					CONTRACT: true,
				},
			},
		},
	},
} as const satisfies RouterShape;

const zItem = z.object({ id: z.string(), name: z.string() });

const serviceRoutes = createRoutes(shape, {
	ROUTER: {
		items: {
			CONTRACT: {
				get: {
					responses: {
						200: { contentType: "application/json", schema: z.array(zItem) },
					},
				},
				post: {
					body: {
						contentType: "application/json",
						schema: z.object({ name: z.string() }),
					},
					responses: {
						201: { contentType: "application/json", schema: zItem },
					},
				},
			},
			ROUTER: {
				$itemId: {
					CONTRACT: {
						get: {
							pathParams: z.object({ itemId: z.string() }),
							responses: {
								200: { contentType: "application/json", schema: zItem },
							},
						},
					},
				},
			},
		},
	},
});

const serviceMiddleware = createMiddleware(serviceRoutes, {
	MIDDLEWARE: {
		auth: {
			401: {
				contentType: "application/json",
				schema: z.object({ error: z.string() }),
			},
		},
	},
});

const SERVICE_PORT = 19877;
const GATEWAY_PORT = 19878;
let serviceServer: ReturnType<typeof Bun.serve>;
let gatewayServer: ReturnType<typeof Bun.serve>;

beforeAll(() => {
	const serviceApp = new Hono();
	initHono(
		serviceApp,
		serviceRoutes,
		{
			ROUTER: {
				items: {
					HANDLER: {
						get: (_input, ctx) => ctx.json([{ id: "1", name: "Item 1" }], 200),
						post: (input, ctx) => ctx.json({ id: "new", name: input.body.name }, 201),
					},
					ROUTER: {
						$itemId: {
							HANDLER: {
								get: (input, ctx) =>
									ctx.json({ id: input.pathParams.itemId, name: "Found" }, 200),
							},
						},
					},
				},
			},
		},
		serviceMiddleware,
		{
			MIDDLEWARE: {
				auth: async (_ctx, next) => {
					await next();
				},
			},
		},
		{
			errorMode: "public",
		},
	);
	serviceServer = Bun.serve({ fetch: serviceApp.fetch, port: SERVICE_PORT });

	const gateway = generateHonoGatewayRoutesAndMiddleware({
		inventory: {
			routes: serviceRoutes,
			middleware: serviceMiddleware,
		},
	});

	const gatewayMiddleware = createMiddleware(gateway.routes, {
		MIDDLEWARE: {
			logging: {},
		},
	});

	const gatewayOptions = createGatewayOptions(gateway.routes, {
		services: {
			inventory: `http://localhost:${SERVICE_PORT}`,
		},
		errorMode: "public",
	});

	const gatewayMiddlewareHandlers = createHonoMiddlewareHandlers(
		gatewayMiddleware,
		gatewayOptions,
		{
			MIDDLEWARE: {
				logging: async (_ctx, next) => {
					await next();
				},
			},
		},
	);

	const gatewayApp = new Hono();

	initHonoGateway(
		gatewayApp,
		gateway.routes,
		gatewayMiddleware,
		gatewayMiddlewareHandlers,
		gatewayOptions,
	);

	gatewayServer = Bun.serve({ fetch: gatewayApp.fetch, port: GATEWAY_PORT });
});

afterAll(() => {
	serviceServer.stop();
	gatewayServer.stop();
});

describe("Gateway", () => {
	describe("generateHonoGatewayRoutesAndMiddleware", () => {
		test("generates routes with service name prefix", () => {
			const gateway = generateHonoGatewayRoutesAndMiddleware({
				svc: { routes: serviceRoutes, middleware: serviceMiddleware },
			});
			expect(gateway.routes.ROUTER.svc).toBe(serviceRoutes);
			expect(gateway.middleware.ROUTER.svc).toBe(serviceMiddleware);
		});
	});

	describe("createHonoGateway proxying", () => {
		test("proxies GET request to service", async () => {
			const res = await fetch(`http://localhost:${GATEWAY_PORT}/inventory/items`);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual([{ id: "1", name: "Item 1" }]);
		});

		test("proxies POST request to service", async () => {
			const res = await fetch(`http://localhost:${GATEWAY_PORT}/inventory/items`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "New Item" }),
			});
			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body).toEqual({ id: "new", name: "New Item" });
		});

		test("proxies path params to service", async () => {
			const res = await fetch(`http://localhost:${GATEWAY_PORT}/inventory/items/item-42`);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.id).toBe("item-42");
		});
	});

	describe("gateway client", () => {
		test("proxy-chain client works through gateway", async () => {
			const gateway = generateHonoGatewayRoutesAndMiddleware({
				inventory: { routes: serviceRoutes, middleware: serviceMiddleware },
			});
			const client = createClient(gateway.routes, {
				baseUrl: `http://localhost:${GATEWAY_PORT}`,
				middleware: [gateway.middleware],
			});

			const res = await client.inventory.items.get();
			expect(res.status).toBe(200);
			expect(res.body).toEqual([{ id: "1", name: "Item 1" }]);
		});

		test("proxy-chain client with path params through gateway", async () => {
			const gateway = generateHonoGatewayRoutesAndMiddleware({
				inventory: { routes: serviceRoutes, middleware: serviceMiddleware },
			});
			const client = createClient(gateway.routes, {
				baseUrl: `http://localhost:${GATEWAY_PORT}`,
				middleware: [gateway.middleware],
			});

			const res = await client.inventory.items.$itemId.get({
				pathParams: { itemId: "item-99" },
			});
			expect(res.status).toBe(200);
			if (res.status === 200) {
				expect(res.body.id).toBe("item-99");
			}
		});
	});
});
