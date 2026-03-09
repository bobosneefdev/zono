import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import z from "zod";
import type { ContractTreeFor } from "../contract/contract.js";
import type { MiddlewareTreeFor } from "../middleware/middleware.js";
import { createHonoMiddlewareHandlers } from "../middleware/middleware.js";
import type { ApiShape } from "../shared/shared.js";
import { createSerializedResponse, parseSerializedResponse } from "../shared/shared.js";
import type { GatewayServiceMask } from "./gateway.js";
import {
	createGatewayClient,
	createGatewayService,
	createGatewayServices,
	type GatewayMiddlewares,
	initGateway,
} from "./gateway.js";

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

const serviceShape = {
	SHAPE: {
		echo: { CONTRACT: true },
		plain: { CONTRACT: true },
		users: { CONTRACT: true },
	},
} as const satisfies ApiShape;

const serviceContracts = {
	SHAPE: {
		echo: {
			CONTRACT: {
				get: {
					responses: {
						200: {
							type: "JSON",
							schema: z.object({ query: z.string(), header: z.string() }),
						},
					},
				},
				post: {
					responses: {
						201: { type: "Text", schema: z.string() },
					},
				},
			},
		},
		plain: {
			CONTRACT: {
				get: {
					responses: { 200: { type: "JSON", schema: z.object({ ok: z.boolean() }) } },
				},
			},
		},
		users: {
			CONTRACT: {
				get: {
					responses: {
						200: { type: "JSON", schema: z.object({ users: z.array(z.string()) }) },
					},
				},
			},
		},
	},
} as const satisfies ContractTreeFor<typeof serviceShape>;

const serviceMiddlewares = {
	MIDDLEWARE: {},
} as const satisfies MiddlewareTreeFor<typeof serviceShape>;

const nestedUsersServiceShape = {
	SHAPE: {
		users: {
			CONTRACT: true,
			SHAPE: {
				$userId: { CONTRACT: true },
			},
		},
	},
} as const satisfies ApiShape;

const nestedUsersServiceContracts = {
	SHAPE: {
		users: {
			CONTRACT: {
				get: {
					responses: {
						200: { type: "JSON", schema: z.object({ users: z.array(z.string()) }) },
					},
				},
			},
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
} as const satisfies ContractTreeFor<typeof nestedUsersServiceShape>;

const nestedUsersServiceMiddlewares = {
	MIDDLEWARE: {},
} as const satisfies MiddlewareTreeFor<typeof nestedUsersServiceShape>;

describe("gateway runtime", () => {
	test("proxies GET to upstream and preserves status headers serialized body", async () => {
		const upstreamApp = new Hono();
		upstreamApp.get("/echo", (ctx) => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				headers: { "x-upstream": "1" },
				data: {
					query: ctx.req.query("q") ?? "",
					header: ctx.req.header("x-test") ?? "",
				},
			});
		});

		const upstreamUrl = startServer(upstreamApp);
		const gatewayMask = {
			SHAPE: {
				echo: { CONTRACT: true },
			},
		} as const satisfies GatewayServiceMask<typeof serviceShape>;
		const service = createGatewayService(
			gatewayMask,
			serviceContracts,
			serviceMiddlewares,
			"public",
			upstreamUrl,
		);

		const gatewayApp = new Hono();
		initGateway(gatewayApp, createGatewayServices({ service }));
		const response = await fetch(`${startServer(gatewayApp)}/echo?q=abc`, {
			headers: { "x-test": "ok" },
		});
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(200);
		expect(response.headers.get("x-upstream")).toBe("1");
		expect(parsed.source).toBe("contract");
		expect(parsed.data).toEqual({ query: "abc", header: "ok" });
	});

	test("forwards POST body", async () => {
		const upstreamApp = new Hono();
		upstreamApp.post("/echo", async (ctx) => {
			const body = await ctx.req.text();
			return createSerializedResponse({
				status: 201,
				type: "Text",
				source: "contract",
				data: `body:${body}`,
			});
		});

		const service = createGatewayService(
			{ SHAPE: { echo: { CONTRACT: true } } },
			serviceContracts,
			serviceMiddlewares,
			"public",
			startServer(upstreamApp),
		);
		const gatewayApp = new Hono();
		initGateway(gatewayApp, createGatewayServices({ service }));
		const gatewayUrl = startServer(gatewayApp);

		const post = await fetch(`${gatewayUrl}/echo`, {
			method: "POST",
			body: "hello",
			headers: { "content-type": "text/plain" },
		});
		const parsedPost = await parseSerializedResponse(post);
		expect(post.status).toBe(201);
		expect(parsedPost.type).toBe("Text");
		expect(parsedPost.data).toBe("body:hello");
	});

	test("does not register masked-out nested routes", async () => {
		let usersHitCount = 0;
		let userHitCount = 0;
		const upstreamApp = new Hono();
		upstreamApp.get("/users", () => {
			usersHitCount += 1;
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { users: ["u1"] },
			});
		});
		upstreamApp.get("/users/:userId", (ctx) => {
			userHitCount += 1;
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { id: ctx.req.param("userId") },
			});
		});

		const services = createGatewayServices({
			usersService: createGatewayService(
				{
					SHAPE: {
						users: { CONTRACT: true },
					},
				},
				nestedUsersServiceContracts,
				nestedUsersServiceMiddlewares,
				"public",
				startServer(upstreamApp),
			),
		});

		const gatewayApp = new Hono();
		initGateway(gatewayApp, services);
		const gatewayUrl = startServer(gatewayApp);

		const usersResponse = await fetch(`${gatewayUrl}/users`);
		const maskedResponse = await fetch(`${gatewayUrl}/users/user-1`);
		const parsedUsers = await parseSerializedResponse(usersResponse);

		expect(usersResponse.status).toBe(200);
		expect(parsedUsers.source).toBe("contract");
		expect(parsedUsers.data).toEqual({ users: ["u1"] });
		expect(maskedResponse.status).toBe(404);
		expect(usersHitCount).toBe(1);
		expect(userHitCount).toBe(0);
	});

	test("runs layered gateway middlewares in path order and passes gateway context", async () => {
		const upstreamApp = new Hono();
		upstreamApp.get("/users", () => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { users: ["u1"] },
			});
		});

		const services = createGatewayServices({
			usersService: createGatewayService(
				{ SHAPE: { users: { CONTRACT: true }, plain: { CONTRACT: true } } },
				serviceContracts,
				serviceMiddlewares,
				"public",
				startServer(upstreamApp),
			),
		});

		const gatewayMiddlewares = {
			MIDDLEWARE: {
				gatewayGuard: {
					418: { type: "JSON", schema: z.object({ message: z.string() }) },
				},
			},
			SHAPE: {
				usersService: {
					MIDDLEWARE: {
						serviceGuard: {
							401: { type: "JSON", schema: z.object({ message: z.string() }) },
						},
					},
					SHAPE: {
						users: {
							MIDDLEWARE: {
								auth: {
									403: {
										type: "JSON",
										schema: z.object({ message: z.string() }),
									},
								},
							},
						},
					},
				},
			},
		} as const satisfies GatewayMiddlewares<typeof services>;

		const steps: Array<string> = [];
		const boundGatewayMiddlewares = createHonoMiddlewareHandlers<
			typeof gatewayMiddlewares,
			{ requestId: string }
		>(gatewayMiddlewares, {
			MIDDLEWARE: {
				gatewayGuard: async (_ctx, next, ourContext) => {
					steps.push(`gateway:before:${ourContext.requestId}`);
					await next();
					steps.push("gateway:after");
				},
			},
			SHAPE: {
				usersService: {
					MIDDLEWARE: {
						serviceGuard: async (_ctx, next, ourContext) => {
							steps.push(`service:before:${ourContext.requestId}`);
							await next();
							steps.push("service:after");
						},
					},
					SHAPE: {
						users: {
							MIDDLEWARE: {
								auth: async (_ctx, next, ourContext) => {
									steps.push(`auth:before:${ourContext.requestId}`);
									await next();
									steps.push("auth:after");
								},
							},
						},
					},
				},
			},
		});

		const gatewayApp = new Hono();
		initGateway(gatewayApp, services, {
			middlewares: boundGatewayMiddlewares,
			createContext: () => ({ requestId: "ctx-1" }),
		});

		const response = await fetch(`${startServer(gatewayApp)}/users`);
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(200);
		expect(parsed.source).toBe("contract");
		expect(parsed.data).toEqual({ users: ["u1"] });
		expect(steps).toEqual([
			"gateway:before:ctx-1",
			"service:before:ctx-1",
			"auth:before:ctx-1",
			"auth:after",
			"service:after",
			"gateway:after",
		]);
	});

	test("gateway root middleware applies to all routes", async () => {
		let upstreamHitCount = 0;
		const upstreamApp = new Hono();
		upstreamApp.get("/users", () => {
			upstreamHitCount += 1;
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { users: ["u1"] },
			});
		});
		upstreamApp.get("/plain", () => {
			upstreamHitCount += 1;
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { ok: true },
			});
		});

		const services = createGatewayServices({
			usersService: createGatewayService(
				{ SHAPE: { users: { CONTRACT: true }, plain: { CONTRACT: true } } },
				serviceContracts,
				serviceMiddlewares,
				"public",
				startServer(upstreamApp),
			),
		});

		const gatewayMiddlewares = {
			MIDDLEWARE: {
				gatewayGuard: {
					418: { type: "JSON", schema: z.object({ message: z.string() }) },
				},
			},
		} as const satisfies GatewayMiddlewares<typeof services>;

		const seenPaths: Array<string> = [];
		const boundGatewayMiddlewares = createHonoMiddlewareHandlers<
			typeof gatewayMiddlewares,
			{ requestId: string }
		>(gatewayMiddlewares, {
			MIDDLEWARE: {
				gatewayGuard: async (ctx, next) => {
					seenPaths.push(new URL(ctx.req.url).pathname);
					await next();
				},
			},
		});

		const gatewayApp = new Hono();
		initGateway(gatewayApp, services, {
			middlewares: boundGatewayMiddlewares,
			createContext: () => ({ requestId: "ctx-2" }),
		});

		const gatewayUrl = startServer(gatewayApp);
		const usersResponse = await fetch(`${gatewayUrl}/users`);
		const plainResponse = await fetch(`${gatewayUrl}/plain`);
		const usersParsed = await parseSerializedResponse(usersResponse);
		const plainParsed = await parseSerializedResponse(plainResponse);

		expect(usersResponse.status).toBe(200);
		expect(plainResponse.status).toBe(200);
		expect(usersParsed.source).toBe("contract");
		expect(plainParsed.source).toBe("contract");
		expect(usersParsed.data).toEqual({ users: ["u1"] });
		expect(plainParsed.data).toEqual({ ok: true });
		expect(upstreamHitCount).toBe(2);
		expect(seenPaths).toEqual(["/users", "/plain"]);
	});

	test("gateway root middleware short-circuits before upstream proxy", async () => {
		let upstreamHitCount = 0;
		const upstreamApp = new Hono();
		upstreamApp.get("/users", () => {
			upstreamHitCount += 1;
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { users: ["u1"] },
			});
		});

		const services = createGatewayServices({
			usersService: createGatewayService(
				{ SHAPE: { users: { CONTRACT: true } } },
				serviceContracts,
				serviceMiddlewares,
				"public",
				startServer(upstreamApp),
			),
		});

		const gatewayMiddlewares = {
			MIDDLEWARE: {
				gatewayGuard: {
					401: { type: "JSON", schema: z.object({ message: z.string() }) },
				},
			},
			SHAPE: {
				usersService: {
					SHAPE: {
						users: {
							MIDDLEWARE: {
								auth: {
									403: {
										type: "JSON",
										schema: z.object({ message: z.string() }),
									},
								},
							},
						},
					},
				},
			},
		} as const satisfies GatewayMiddlewares<typeof services>;

		const steps: Array<string> = [];
		const boundGatewayMiddlewares = createHonoMiddlewareHandlers<
			typeof gatewayMiddlewares,
			{ requestId: string }
		>(gatewayMiddlewares, {
			MIDDLEWARE: {
				gatewayGuard: () => {
					steps.push("gateway:block");
					return {
						status: 401,
						type: "JSON",
						data: { message: "Unauthorized" },
					};
				},
			},
			SHAPE: {
				usersService: {
					SHAPE: {
						users: {
							MIDDLEWARE: {
								auth: () => {
									steps.push("auth:block");
									return {
										status: 403,
										type: "JSON",
										data: { message: "Forbidden" },
									};
								},
							},
						},
					},
				},
			},
		});

		const gatewayApp = new Hono();
		initGateway(gatewayApp, services, {
			middlewares: boundGatewayMiddlewares,
			createContext: () => ({ requestId: "ctx-3" }),
		});

		const response = await fetch(`${startServer(gatewayApp)}/users`);
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(401);
		expect(parsed.source).toBe("middleware");
		expect(parsed.data).toEqual({ message: "Unauthorized" });
		expect(upstreamHitCount).toBe(0);
		expect(steps).toEqual(["gateway:block"]);
	});

	test("deeper gateway middleware overrides root middleware with the same name", async () => {
		const upstreamApp = new Hono();
		upstreamApp.get("/users", () => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { users: ["u1"] },
			});
		});

		const services = createGatewayServices({
			usersService: createGatewayService(
				{ SHAPE: { users: { CONTRACT: true }, plain: { CONTRACT: true } } },
				serviceContracts,
				serviceMiddlewares,
				"public",
				startServer(upstreamApp),
			),
		});

		const gatewayMiddlewares = {
			MIDDLEWARE: {
				auth: {
					401: { type: "JSON", schema: z.object({ message: z.string() }) },
				},
			},
			SHAPE: {
				usersService: {
					SHAPE: {
						users: {
							MIDDLEWARE: {
								auth: {
									403: {
										type: "JSON",
										schema: z.object({ message: z.string() }),
									},
								},
							},
						},
					},
				},
			},
		} as const satisfies GatewayMiddlewares<typeof services>;

		const boundGatewayMiddlewares = createHonoMiddlewareHandlers(gatewayMiddlewares, {
			MIDDLEWARE: {
				auth: () => ({
					status: 401,
					type: "JSON",
					data: { message: "Global" },
				}),
			},
			SHAPE: {
				usersService: {
					SHAPE: {
						users: {
							MIDDLEWARE: {
								auth: () => ({
									status: 403,
									type: "JSON",
									data: { message: "Scoped" },
								}),
							},
						},
					},
				},
			},
		});

		const gatewayApp = new Hono();
		initGateway(gatewayApp, services, {
			middlewares: boundGatewayMiddlewares,
		});

		const response = await fetch(`${startServer(gatewayApp)}/users`);
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(403);
		expect(parsed.source).toBe("middleware");
		expect(parsed.data).toEqual({ message: "Scoped" });
	});

	test("createGatewayClient caches service clients", () => {
		const gatewayClient =
			createGatewayClient<
				ReturnType<
					typeof createGatewayServices<{ users: ReturnType<typeof createGatewayService> }>
				>
			>("http://localhost:9999");

		const first = gatewayClient.users;
		const second = gatewayClient.users;
		expect(first).toBe(second);
	});
});

const gatewayMaskTyped = {
	SHAPE: {
		echo: { CONTRACT: true },
		plain: { CONTRACT: true },
		users: { CONTRACT: true },
	},
} as const satisfies GatewayServiceMask<typeof serviceShape>;
void gatewayMaskTyped;

type ExtractStatus<T, TStatus extends number> = Extract<T, { status: TStatus }>;
const typeOnly = (_cb: () => void): void => {};

typeOnly(() => {
	const service = createGatewayService(
		{
			SHAPE: {
				echo: { CONTRACT: true },
				plain: { CONTRACT: true },
				users: { CONTRACT: true },
			},
		},
		serviceContracts,
		serviceMiddlewares,
		"public",
		"http://localhost",
	);
	const services = createGatewayServices({ usersService: service });

	const gatewayMiddlewares = {
		MIDDLEWARE: {
			auth: {
				401: { type: "JSON", schema: z.object({ scope: z.literal("global") }) },
			},
			audit: {
				418: { type: "JSON", schema: z.object({ traceId: z.string() }) },
			},
		},
		SHAPE: {
			usersService: {
				MIDDLEWARE: {
					serviceGuard: {
						430: { type: "JSON", schema: z.object({ service: z.string() }) },
					},
				},
				SHAPE: {
					users: {
						MIDDLEWARE: {
							auth: {
								403: {
									type: "JSON",
									schema: z.object({ scope: z.literal("users") }),
								},
							},
							rateLimit: {
								429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
							},
						},
					},
				},
			},
		},
	} as const satisfies GatewayMiddlewares<typeof services>;

	const client = createGatewayClient<typeof services, typeof gatewayMiddlewares>(
		"http://localhost",
	);

	void client.usersService.fetch("/echo", "get");

	// @ts-expect-error invalid path for service contracts
	void client.usersService.fetch("/missing", "get");

	// @ts-expect-error method not defined on route
	void client.usersService.fetch("/echo", "put");

	const usersResponsePromise = client.usersService.fetch("/users", "get");
	type UsersResponse = Awaited<typeof usersResponsePromise>;
	const usersAuthData: ExtractStatus<UsersResponse, 403>["data"] = { scope: "users" };
	const usersRateLimitData: ExtractStatus<UsersResponse, 429>["data"] = { retryAfter: 1000 };
	const usersServiceGuardData: ExtractStatus<UsersResponse, 430>["data"] = {
		service: "usersService",
	};
	const usersAuditData: ExtractStatus<UsersResponse, 418>["data"] = { traceId: "trace-1" };
	const usersBadRequestData: ExtractStatus<UsersResponse, 400>["data"] = {
		message: "bad",
		issues: [],
	};
	const usersNotFoundData: ExtractStatus<UsersResponse, 404>["data"] = { message: "missing" };
	const usersInternalErrorData: ExtractStatus<UsersResponse, 500>["data"] = {
		message: "boom",
	};
	void usersAuthData;
	void usersRateLimitData;
	void usersServiceGuardData;
	void usersAuditData;
	void usersBadRequestData;
	void usersNotFoundData;
	void usersInternalErrorData;

	const invalidUsersRateLimitData: ExtractStatus<UsersResponse, 429>["data"] = {
		// @ts-expect-error gateway middleware status 429 keeps its declared payload shape
		retryAfter: "later",
	};
	void invalidUsersRateLimitData;

	const plainResponsePromise = client.usersService.fetch("/plain", "get");
	type PlainResponse = Awaited<typeof plainResponsePromise>;
	const plainAuthData: ExtractStatus<PlainResponse, 401>["data"] = { scope: "global" };
	const plainServiceGuardData: ExtractStatus<PlainResponse, 430>["data"] = {
		service: "usersService",
	};
	const plainAuditData: ExtractStatus<PlainResponse, 418>["data"] = { traceId: "trace-2" };
	void plainAuthData;
	void plainServiceGuardData;
	void plainAuditData;

	// @ts-expect-error /plain should not include /users scoped gateway middleware status 429
	const plainRateLimit: ExtractStatus<PlainResponse, 429> = {
		status: 429,
		data: { retryAfter: 1 },
		response: new Response(),
	};
	void plainRateLimit;

	// @ts-expect-error /users auth overrides root auth with the same middleware name
	const usersGlobalAuth: ExtractStatus<UsersResponse, 401> = {
		status: 401,
		data: { scope: "global" },
		response: new Response(),
	};
	void usersGlobalAuth;

	// @ts-expect-error /plain should not include /users scoped auth override
	const plainUsersAuth: ExtractStatus<PlainResponse, 403> = {
		status: 403,
		data: { scope: "users" },
		response: new Response(),
	};
	void plainUsersAuth;

	const maskedNestedService = createGatewayService(
		{
			SHAPE: {
				users: { CONTRACT: true },
			},
		},
		nestedUsersServiceContracts,
		nestedUsersServiceMiddlewares,
		"public",
		"http://localhost",
	);
	const maskedNestedServices = createGatewayServices({ usersService: maskedNestedService });

	const maskedGatewayMiddlewares = {
		SHAPE: {
			usersService: {
				SHAPE: {
					users: {
						// @ts-expect-error masked-out nested route should not allow gateway middleware
						SHAPE: {
							$userId: {
								MIDDLEWARE: {
									auth: {
										403: {
											type: "JSON",
											schema: z.object({ message: z.string() }),
										},
									},
								},
							},
						},
					},
				},
			},
		},
	} as const satisfies GatewayMiddlewares<typeof maskedNestedServices>;
	void maskedGatewayMiddlewares;

	const maskedClient = createGatewayClient<typeof maskedNestedServices>("http://localhost");
	void maskedClient.usersService.fetch("/users", "get");

	// @ts-expect-error masked-out nested route should not be exposed on the gateway client
	void maskedClient.usersService.fetch("/users/$userId", "get", {
		pathParams: { userId: "user-1" },
	});
});
