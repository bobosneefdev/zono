import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import z from "zod";
import { createClient } from "../client/client.js";
import type { GatewayServiceMask } from "../gateway/gateway.js";
import {
	createGatewayClient,
	createGatewayService,
	createGatewayServices,
	initGateway,
} from "../gateway/gateway.js";
import type { MiddlewareTreeFor } from "../middleware/middleware.js";
import {
	createHonoContractHandlers,
	createHonoMiddlewareHandlers,
	initHono,
} from "../server/server.js";
import type { ApiShape } from "../shared/shared.js";
import { parseSerializedResponse } from "../shared/shared.js";
import type { ContractTreeFor } from "./contract.js";
import { compileContractRoutes } from "./contract.js";

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
		const server = servers.pop();
		server?.stop();
	}
});

describe("contract route compilation", () => {
	test("compiles nested routes with dynamic segments", () => {
		const shape = {
			SHAPE: {
				users: {
					CONTRACT: true,
					SHAPE: {
						$userId: { CONTRACT: true },
					},
				},
			},
		} as const satisfies ApiShape;

		const contracts = {
			SHAPE: {
				users: {
					CONTRACT: {
						get: {
							responses: {
								200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
							},
						},
					},
					SHAPE: {
						$userId: {
							CONTRACT: {
								get: {
									pathParams: z.object({ userId: z.uuid() }),
									responses: {
										200: { type: "JSON", schema: z.object({ id: z.string() }) },
									},
								},
							},
						},
					},
				},
			},
		} as const satisfies ContractTreeFor<typeof shape>;

		const routes = compileContractRoutes(contracts).map((route) => ({
			pathTemplate: route.pathTemplate,
			honoPath: route.honoPath,
			method: route.method,
		}));

		expect(routes).toEqual([
			{ pathTemplate: "/users", honoPath: "/users", method: "get" },
			{ pathTemplate: "/users/$userId", honoPath: "/users/:userId", method: "get" },
		]);
	});
});

describe("server middleware + client", () => {
	test("middleware short-circuits contract handler and client parses response", async () => {
		const shape = {
			SHAPE: {
				users: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const contracts = {
			SHAPE: {
				users: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									type: "JSON",
									schema: z.array(z.object({ id: z.string() })),
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
						schema: z.object({ retryAfter: z.number().int() }),
					},
				},
			},
		} as const satisfies MiddlewareTreeFor<typeof shape>;

		let contractHandlerCalled = false;
		const app = new Hono();
		type TestContext = { session: string };
		initHono<typeof shape, TestContext>(app, {
			contracts: createHonoContractHandlers<typeof contracts, TestContext>(contracts, {
				SHAPE: {
					users: {
						HANDLER: {
							get: async () => {
								contractHandlerCalled = true;
								return {
									type: "JSON",
									status: 200,
									data: [{ id: "never" }],
								};
							},
						},
					},
				},
			}),
			middlewares: createHonoMiddlewareHandlers<typeof middlewares, TestContext>(
				middlewares,
				{
					MIDDLEWARE: {
						rateLimit: () => ({
							type: "JSON",
							status: 429,
							data: { retryAfter: Date.now() + 1000 },
						}),
					},
				},
			),
			errorMode: "public",
			createContext: () => ({ session: "x" }),
		});

		const baseUrl = startServer(app);
		const client = createClient<typeof shape, typeof contracts, typeof middlewares, "public">(
			baseUrl,
		);

		type ClientResponse = Awaited<ReturnType<typeof client.fetch<"/users", "get">>>;
		const has429Status: HasStatus<ClientResponse, 429> = true;
		const has200Status: HasStatus<ClientResponse, 200> = true;
		void has429Status;
		void has200Status;

		const result = await client.fetch("/users", "get");
		expect(result.status).toBe(429);
		expect(contractHandlerCalled).toBe(false);
	});

	test("raw fetch sees middleware serialized payload", async () => {
		const shape = {
			SHAPE: {
				users: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const contracts = {
			SHAPE: {
				users: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									type: "JSON",
									schema: z.array(z.object({ id: z.string() })),
								},
							},
						},
					},
				},
			},
		} as const satisfies ContractTreeFor<typeof shape>;

		const middlewares = {
			MIDDLEWARE: {
				lockdown: {
					429: {
						type: "JSON",
						schema: z.object({ retryAfter: z.number() }),
					},
				},
			},
		} as const satisfies MiddlewareTreeFor<typeof shape>;

		const app = new Hono();
		type TestContext = unknown;
		initHono<typeof shape, TestContext>(app, {
			contracts: createHonoContractHandlers<typeof contracts, TestContext>(contracts, {
				SHAPE: {
					users: {
						HANDLER: {
							get: async () => ({ type: "JSON", status: 200, data: [{ id: "1" }] }),
						},
					},
				},
			}),
			middlewares: createHonoMiddlewareHandlers<typeof middlewares, TestContext>(
				middlewares,
				{
					MIDDLEWARE: {
						lockdown: () => ({ type: "JSON", status: 429, data: { retryAfter: 123 } }),
					},
				},
			),
			errorMode: "public",
			createContext: () => ({}),
		});

		const baseUrl = startServer(app);
		const response = await fetch(`${baseUrl}/users`);
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(429);
		expect(parsed.type).toBe("JSON");
		expect(parsed.source).toBe("middleware");
		expect(parsed.data).toEqual({ retryAfter: 123 });
	});
});

describe("gateway proxy", () => {
	test("gateway client proxies to upstream service", async () => {
		const serviceShape = {
			SHAPE: {
				users: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const serviceContracts = {
			SHAPE: {
				users: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									type: "SuperJSON",
									schema: z.array(
										z.object({ id: z.string(), createdAt: z.date() }),
									),
								},
							},
						},
					},
				},
			},
		} as const satisfies ContractTreeFor<typeof serviceShape>;

		const serviceMiddlewares = {
			MIDDLEWARE: {},
		} as const satisfies MiddlewareTreeFor<typeof serviceShape>;

		const upstreamApp = new Hono();
		type TestContext = unknown;
		initHono<typeof serviceShape, TestContext>(upstreamApp, {
			contracts: createHonoContractHandlers<typeof serviceContracts, TestContext>(
				serviceContracts,
				{
					SHAPE: {
						users: {
							HANDLER: {
								get: async () => ({
									type: "SuperJSON",
									status: 200,
									data: [
										{
											id: "u1",
											createdAt: new Date("2024-01-01T00:00:00.000Z"),
										},
									],
								}),
							},
						},
					},
				},
			),
			errorMode: "public",
			createContext: () => ({}),
		});
		const upstreamUrl = startServer(upstreamApp);

		const gatewayMask = {
			SHAPE: {
				users: { CONTRACT: true },
			},
		} as const satisfies GatewayServiceMask<typeof serviceShape>;

		const usersGateway = createGatewayService(
			gatewayMask,
			serviceContracts,
			serviceMiddlewares,
			"public",
			upstreamUrl,
		);
		const services = createGatewayServices({ users: usersGateway });

		const gatewayApp = new Hono();
		initGateway(gatewayApp, services);
		const gatewayUrl = startServer(gatewayApp);

		const gatewayClient = createGatewayClient<typeof services>(gatewayUrl);
		const users = await gatewayClient.users.fetch("/users", "get");

		expect(users.status).toBe(200);
		expect(users.response.status).toBe(200);
		expect(users.data).toEqual([{ id: "u1", createdAt: new Date("2024-01-01T00:00:00.000Z") }]);
	});
});

const typeOnly = (_cb: () => void): void => {};

typeOnly(() => {
	const shape = {
		SHAPE: {
			users: {
				SHAPE: {
					$userId: { CONTRACT: true },
				},
			},
		},
	} as const satisfies ApiShape;

	const contracts = {
		SHAPE: {
			users: {
				SHAPE: {
					$userId: {
						CONTRACT: {
							get: {
								pathParams: z.object({ userId: z.string() }),
								responses: {
									200: { type: "JSON", schema: z.object({ id: z.string() }) },
								},
							},
						},
					},
				},
			},
		},
	} as const satisfies ContractTreeFor<typeof shape>;
	void contracts;

	const gatewayMask = {
		SHAPE: {
			users: {
				SHAPE: {
					$userId: { CONTRACT: true },
				},
			},
		},
	} as const satisfies GatewayServiceMask<typeof shape>;
	void gatewayMask;

	const invalidContracts = {
		SHAPE: {
			users: {
				SHAPE: {
					$userId: {
						CONTRACT: {
							// @ts-expect-error dynamic segment contracts require pathParams schema
							get: {
								responses: {
									200: { type: "JSON", schema: z.object({ id: z.string() }) },
								},
							},
						},
					},
				},
			},
		},
	} as const satisfies ContractTreeFor<typeof shape>;
	void invalidContracts;

	const invalidResponseSpec = {
		SHAPE: {
			users: {
				SHAPE: {
					$userId: {
						CONTRACT: {
							get: {
								pathParams: z.object({ userId: z.string() }),
								responses: {
									// @ts-expect-error response specs must use schema, not body
									200: { type: "JSON", body: z.object({ id: z.string() }) },
								},
							},
						},
					},
				},
			},
		},
	} as const satisfies ContractTreeFor<typeof shape>;
	void invalidResponseSpec;

	const invalidQuerySpec = {
		SHAPE: {
			users: {
				SHAPE: {
					$userId: {
						CONTRACT: {
							get: {
								pathParams: z.object({ userId: z.string() }),
								// @ts-expect-error request query specs must use schema, not query
								query: { type: "JSON", query: z.object({ id: z.string() }) },
								responses: {
									200: { type: "JSON", schema: z.object({ id: z.string() }) },
								},
							},
						},
					},
				},
			},
		},
	} as const satisfies ContractTreeFor<typeof shape>;
	void invalidQuerySpec;

	const invalidHeadersSpec = {
		SHAPE: {
			users: {
				SHAPE: {
					$userId: {
						CONTRACT: {
							get: {
								pathParams: z.object({ userId: z.string() }),
								// @ts-expect-error request header specs must use schema, not headers
								headers: { type: "JSON", headers: z.object({ id: z.string() }) },
								responses: {
									200: { type: "JSON", schema: z.object({ id: z.string() }) },
								},
							},
						},
					},
				},
			},
		},
	} as const satisfies ContractTreeFor<typeof shape>;
	void invalidHeadersSpec;

	const invalidBodySpec = {
		SHAPE: {
			users: {
				SHAPE: {
					$userId: {
						CONTRACT: {
							get: {
								pathParams: z.object({ userId: z.string() }),
								// @ts-expect-error request body specs must use schema, not body
								body: { type: "JSON", body: z.object({ id: z.string() }) },
								responses: {
									200: { type: "JSON", schema: z.object({ id: z.string() }) },
								},
							},
						},
					},
				},
			},
		},
	} as const satisfies ContractTreeFor<typeof shape>;
	void invalidBodySpec;
});
