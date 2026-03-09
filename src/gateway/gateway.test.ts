import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import z from "zod";
import type { ContractTreeFor } from "../contract/contract.js";
import type { MiddlewareTreeFor } from "../middleware/middleware.js";
import { createHonoMiddlewareHandlers } from "../middleware/middleware.js";
import type { ApiShape } from "../shared/shared.js";
import { createSerializedResponse, parseSerializedResponse } from "../shared/shared.js";
import type { GatewayShape } from "./gateway.js";
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
		const gatewayShape = {
			SHAPE: {
				echo: { CONTRACT: true },
			},
		} as const satisfies GatewayShape<typeof serviceShape>;
		const service = createGatewayService(
			gatewayShape,
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
			SHAPE: {
				usersService: {
					MIDDLEWARE: {
						rootGuard: {
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
			SHAPE: {
				usersService: {
					MIDDLEWARE: {
						rootGuard: async (_ctx, next, ourContext) => {
							steps.push(`root:before:${ourContext.requestId}`);
							await next();
							steps.push("root:after");
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
			"root:before:ctx-1",
			"auth:before:ctx-1",
			"auth:after",
			"root:after",
		]);
	});

	test("gateway middleware short-circuits before upstream proxy", async () => {
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
			SHAPE: {
				usersService: {
					MIDDLEWARE: {
						rootGuard: {
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
			SHAPE: {
				usersService: {
					MIDDLEWARE: {
						rootGuard: async (_ctx, next) => {
							steps.push("root:before");
							await next();
							steps.push("root:after");
						},
					},
					SHAPE: {
						users: {
							MIDDLEWARE: {
								auth: () => {
									steps.push("auth:block");
									return {
										status: 403,
										type: "JSON",
										data: { message: "Unauthorized" },
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
			createContext: () => ({ requestId: "ctx-2" }),
		});

		const response = await fetch(`${startServer(gatewayApp)}/users`);
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(403);
		expect(parsed.source).toBe("middleware");
		expect(parsed.data).toEqual({ message: "Unauthorized" });
		expect(upstreamHitCount).toBe(0);
		expect(steps).toEqual(["root:before", "auth:block", "root:after"]);
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

const gatewayShapeTyped = {
	SHAPE: {
		echo: { CONTRACT: true },
		plain: { CONTRACT: true },
		users: { CONTRACT: true },
	},
} as const satisfies GatewayShape<typeof serviceShape>;
void gatewayShapeTyped;

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
		SHAPE: {
			usersService: {
				MIDDLEWARE: {
					auth: {
						403: { type: "JSON", schema: z.object({ message: z.string() }) },
					},
				},
				SHAPE: {
					users: {
						MIDDLEWARE: {
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
	const usersAuthData: ExtractStatus<UsersResponse, 403>["data"] = { message: "Unauthorized" };
	const usersRateLimitData: ExtractStatus<UsersResponse, 429>["data"] = { retryAfter: 1000 };
	void usersAuthData;
	void usersRateLimitData;

	const invalidUsersRateLimitData: ExtractStatus<UsersResponse, 429>["data"] = {
		// @ts-expect-error gateway middleware status 429 keeps its declared payload shape
		retryAfter: "later",
	};
	void invalidUsersRateLimitData;

	const plainResponsePromise = client.usersService.fetch("/plain", "get");
	type PlainResponse = Awaited<typeof plainResponsePromise>;
	const plainAuthData: ExtractStatus<PlainResponse, 403>["data"] = { message: "Unauthorized" };
	void plainAuthData;

	// @ts-expect-error /plain should not include /users scoped gateway middleware status 429
	const plainRateLimit: ExtractStatus<PlainResponse, 429> = {
		status: 429,
		data: { retryAfter: 1 },
		response: new Response(),
	};
	void plainRateLimit;
});
