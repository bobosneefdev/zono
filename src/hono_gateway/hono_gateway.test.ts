import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import superjson from "superjson";
import z from "zod";
import { createClient } from "~/client/client.js";
import type { RouterShape } from "~/contract/contract.types.js";
import { createContracts } from "~/contract/contracts.js";
import { createHonoMiddlewareHandlers, initHono } from "~/hono/hono.js";
import {
	createGatewayOptions,
	generateHonoGatewayRoutesAndMiddleware,
	initHonoGateway,
} from "~/hono_gateway/hono_gateway.js";
import { createMiddlewares } from "~/middleware/middleware.js";

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
		superjsonHeaders: {
			CONTRACT: true,
		},
		text: {
			CONTRACT: true,
		},
		blob: {
			CONTRACT: true,
		},
		arrayBuffer: {
			CONTRACT: true,
		},
		voidResponse: {
			CONTRACT: true,
		},
	},
} as const satisfies RouterShape;

const zItem = z.object({ id: z.string(), name: z.string() });

const serviceContracts = createContracts(shape, {
	ROUTER: {
		items: {
			CONTRACT: {
				get: {
					responses: {
						200: { type: "JSON", schema: z.array(zItem) },
					},
				},
				post: {
					body: {
						type: "JSON",
						schema: z.object({ name: z.string() }),
					},
					responses: {
						201: { type: "JSON", schema: zItem },
					},
				},
			},
			ROUTER: {
				$itemId: {
					CONTRACT: {
						get: {
							pathParams: z.object({ itemId: z.string() }),
							responses: {
								200: { type: "JSON", schema: zItem },
							},
						},
					},
				},
			},
		},
		superjsonHeaders: {
			CONTRACT: {
				get: {
					responses: {
						200: {
							type: "JSON",
							schema: z.object({ ok: z.literal(true) }),
							headers: {
								type: "SuperJSON",
								schema: z.object({
									meta: z.object({ source: z.string(), attempt: z.number() }),
								}),
							},
						},
					},
				},
			},
		},
		text: {
			CONTRACT: {
				get: {
					responses: {
						200: { type: "Text", schema: z.string() },
					},
				},
			},
		},
		blob: {
			CONTRACT: {
				get: {
					responses: {
						200: { type: "Blob", schema: z.instanceof(Blob) },
					},
				},
			},
		},
		arrayBuffer: {
			CONTRACT: {
				get: {
					responses: {
						200: { type: "ArrayBuffer", schema: z.instanceof(ArrayBuffer) },
					},
				},
			},
		},
		voidResponse: {
			CONTRACT: {
				get: {
					responses: {
						204: { type: "Void" },
					},
				},
			},
		},
	},
});

const serviceMiddleware = createMiddlewares(serviceContracts, {
	MIDDLEWARE: {
		auth: {
			401: {
				type: "JSON",
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
		serviceContracts,
		{
			ROUTER: {
				items: {
					HANDLER: {
						get: () => ({
							type: "JSON" as const,
							status: 200 as const,
							data: [{ id: "1", name: "Item 1" }],
						}),
						post: (input) => ({
							type: "JSON" as const,
							status: 201 as const,
							data: { id: "new", name: input.body.name },
						}),
					},
					ROUTER: {
						$itemId: {
							HANDLER: {
								get: (input) => ({
									type: "JSON" as const,
									status: 200 as const,
									data: { id: input.pathParams.itemId, name: "Found" },
								}),
							},
						},
					},
				},
				superjsonHeaders: {
					HANDLER: {
						get: () => ({
							type: "JSON" as const,
							status: 200 as const,
							data: { ok: true as const },
							headers: { meta: { source: "service", attempt: 2 } },
						}),
					},
				},
				text: {
					HANDLER: {
						get: () => ({
							type: "Text" as const,
							status: 200 as const,
							data: "gateway-text",
						}),
					},
				},
				blob: {
					HANDLER: {
						get: () => ({
							type: "Blob" as const,
							status: 200 as const,
							data: new Blob(["gateway-blob"], { type: "text/plain" }),
						}),
					},
				},
				arrayBuffer: {
					HANDLER: {
						get: () => ({
							type: "ArrayBuffer" as const,
							status: 200 as const,
							data: new TextEncoder().encode("gateway-buffer").buffer,
						}),
					},
				},
				voidResponse: {
					HANDLER: {
						get: () => ({
							type: "Void" as const,
							status: 204 as const,
						}),
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
			routes: serviceContracts,
			middleware: serviceMiddleware,
		},
	});

	const gatewayMiddleware = createMiddlewares(gateway.routes, {
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
				svc: { routes: serviceContracts, middleware: serviceMiddleware },
			});
			expect(gateway.routes.ROUTER.svc).toBe(serviceContracts);
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

		test("forwards superjson response headers", async () => {
			const res = await fetch(`http://localhost:${GATEWAY_PORT}/inventory/superjsonHeaders`);
			expect(res.status).toBe(200);
			const encoded = res.headers.get("x-zono-superjson-headers");
			expect(encoded).toBeTruthy();
			if (encoded) {
				const parsedResult = z
					.object({
						meta: z.object({ source: z.string(), attempt: z.number() }),
					})
					.safeParse(superjson.parse(encoded));
				expect(parsedResult.success).toBe(true);
				if (parsedResult.success) {
					expect(parsedResult.data.meta.source).toBe("service");
					expect(parsedResult.data.meta.attempt).toBe(2);
				}
			}
		});

		test("proxies text, blob, arrayBuffer, and void responses", async () => {
			const text = await fetch(`http://localhost:${GATEWAY_PORT}/inventory/text`);
			expect(text.status).toBe(200);
			expect(await text.text()).toBe("gateway-text");

			const blob = await fetch(`http://localhost:${GATEWAY_PORT}/inventory/blob`);
			expect(blob.status).toBe(200);
			expect(await (await blob.blob()).text()).toBe("gateway-blob");

			const arrayBuffer = await fetch(
				`http://localhost:${GATEWAY_PORT}/inventory/arrayBuffer`,
			);
			expect(arrayBuffer.status).toBe(200);
			expect(new TextDecoder().decode(await arrayBuffer.arrayBuffer())).toBe(
				"gateway-buffer",
			);

			const voidResponse = await fetch(
				`http://localhost:${GATEWAY_PORT}/inventory/voidResponse`,
			);
			expect(voidResponse.status).toBe(204);
			expect(await voidResponse.text()).toBe("");
		});
	});

	describe("gateway client", () => {
		test("proxy-chain client works through gateway", async () => {
			const gateway = generateHonoGatewayRoutesAndMiddleware({
				inventory: { routes: serviceContracts, middleware: serviceMiddleware },
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
				inventory: { routes: serviceContracts, middleware: serviceMiddleware },
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

		test("proxy-chain client receives superjson headers via gateway", async () => {
			const gateway = generateHonoGatewayRoutesAndMiddleware({
				inventory: { routes: serviceContracts, middleware: serviceMiddleware },
			});
			const client = createClient(gateway.routes, {
				baseUrl: `http://localhost:${GATEWAY_PORT}`,
				middleware: [gateway.middleware],
			});

			const res = await client.inventory.superjsonHeaders.get();
			expect(res.status).toBe(200);
			if (res.status === 200) {
				expect(res.headers).toEqual({ meta: { source: "service", attempt: 2 } });
			}
		});
	});
});
