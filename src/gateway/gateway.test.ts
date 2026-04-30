import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import z from "zod";
import type { ContractTreeFor } from "../contract/contract.js";
import type { MiddlewareTreeFor } from "../middleware/middleware.js";
import { createHonoMiddlewareHandlers } from "../middleware/middleware.js";
import {
	createHonoContractHandlers,
	createHonoMiddlewareHandlers as createServerMiddlewareHandlers,
	initHono,
} from "../server/server.js";
import type { ApiShape } from "../shared/shared.js";
import {
	createSerializedResponse,
	parseSerializedResponse,
	ZONO_HEADER_DATA_HEADER,
	ZONO_HEADER_DATA_TYPE_HEADER,
} from "../shared/shared.js";
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

const getGatewayServiceUrl = (gatewayUrl: string, serviceName: string, path: string): string => {
	return new URL(
		path === "/" ? `/${serviceName}` : `/${serviceName}${path}`,
		gatewayUrl,
	).toString();
};

afterEach(() => {
	while (servers.length > 0) {
		servers.pop()?.stop();
	}
});

const serviceShape = {
	SHAPE: {
		echo: { CONTRACT: true },
		headered: { CONTRACT: true },
		plain: { CONTRACT: true },
		users: { CONTRACT: true },
		boom: { CONTRACT: true },
		headOnly: { CONTRACT: true },
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
		headered: {
			CONTRACT: {
				get: {
					responses: {
						200: {
							type: "JSON",
							schema: z.object({ ok: z.boolean() }),
							headers: {
								type: "Standard",
								schema: z.object({ "x-upstream": z.string() }),
							},
						},
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
		boom: {
			CONTRACT: {
				get: {
					responses: {
						200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
					},
				},
			},
		},
		headOnly: {
			CONTRACT: {
				head: {
					responses: {
						204: { type: "Contentless" },
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

const heartbeatServiceShape = {
	SHAPE: {
		heartbeat: { CONTRACT: true },
	},
} as const satisfies ApiShape;

const heartbeatServiceContracts = {
	SHAPE: {
		heartbeat: {
			CONTRACT: {
				get: {
					responses: {
						200: {
							type: "JSON",
							schema: z.object({ service: z.string() }),
						},
					},
				},
			},
		},
	},
} as const satisfies ContractTreeFor<typeof heartbeatServiceShape>;

const heartbeatServiceMiddlewares = {
	MIDDLEWARE: {},
} as const satisfies MiddlewareTreeFor<typeof heartbeatServiceShape>;

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
		const response = await fetch(
			`${getGatewayServiceUrl(startServer(gatewayApp), "service", "/echo")}?q=abc`,
			{
				headers: { "x-test": "ok" },
			},
		);
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(200);
		expect(response.headers.get("x-upstream")).toBe("1");
		expect(parsed.source).toBe("contract");
		expect(parsed.data).toEqual({ query: "abc", header: "ok" });
	});

	test("forwards POST bodies to the upstream service", async () => {
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

		const post = await fetch(getGatewayServiceUrl(gatewayUrl, "service", "/echo"), {
			method: "POST",
			body: "hello",
			headers: { "content-type": "text/plain" },
		});
		const parsedPost = await parseSerializedResponse(post);

		expect(post.status).toBe(201);
		expect(parsedPost.type).toBe("Text");
		expect(parsedPost.data).toBe("body:hello");
	});

	test("namespaces same-path routes by service key and drops legacy unprefixed routes", async () => {
		const service1App = new Hono();
		service1App.get("/heartbeat", () => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { service: "service1" },
			});
		});

		const service2App = new Hono();
		service2App.get("/heartbeat", () => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { service: "service2" },
			});
		});

		const services = createGatewayServices({
			service1: createGatewayService(
				{ SHAPE: { heartbeat: { CONTRACT: true } } },
				heartbeatServiceContracts,
				heartbeatServiceMiddlewares,
				"public",
				startServer(service1App),
			),
			service2: createGatewayService(
				{ SHAPE: { heartbeat: { CONTRACT: true } } },
				heartbeatServiceContracts,
				heartbeatServiceMiddlewares,
				"public",
				startServer(service2App),
			),
		});

		const gatewayApp = new Hono();
		initGateway(gatewayApp, services);
		const gatewayUrl = startServer(gatewayApp);

		const service1Response = await fetch(
			getGatewayServiceUrl(gatewayUrl, "service1", "/heartbeat"),
		);
		const service2Response = await fetch(
			getGatewayServiceUrl(gatewayUrl, "service2", "/heartbeat"),
		);
		const legacyResponse = await fetch(new URL("/heartbeat", gatewayUrl));

		expect((await parseSerializedResponse(service1Response)).data).toEqual({
			service: "service1",
		});
		expect((await parseSerializedResponse(service2Response)).data).toEqual({
			service: "service2",
		});
		expect(legacyResponse.status).toBe(404);
	});

	test("rejects invalid service keys used as namespaces", () => {
		expect(() =>
			createGatewayServices({
				"": createGatewayService(
					{ SHAPE: { heartbeat: { CONTRACT: true } } },
					heartbeatServiceContracts,
					heartbeatServiceMiddlewares,
					"public",
					"http://localhost",
				),
			}),
		).toThrow("cannot be empty");

		expect(() =>
			createGatewayServices({
				invalid: createGatewayService(
					{ SHAPE: { heartbeat: { CONTRACT: true } } },
					heartbeatServiceContracts,
					heartbeatServiceMiddlewares,
					"public",
					"http://localhost",
				),
				"bad/key": createGatewayService(
					{ SHAPE: { heartbeat: { CONTRACT: true } } },
					heartbeatServiceContracts,
					heartbeatServiceMiddlewares,
					"public",
					"http://localhost",
				),
			}),
		).toThrow("cannot contain '/'");

		expect(() =>
			createGatewayServices({
				$bad: createGatewayService(
					{ SHAPE: { heartbeat: { CONTRACT: true } } },
					heartbeatServiceContracts,
					heartbeatServiceMiddlewares,
					"public",
					"http://localhost",
				),
			}),
		).toThrow("cannot start with '$'");
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

		const usersResponse = await fetch(
			getGatewayServiceUrl(gatewayUrl, "usersService", "/users"),
		);
		const maskedResponse = await fetch(
			getGatewayServiceUrl(gatewayUrl, "usersService", "/users/user-1"),
		);
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

		const response = await fetch(
			getGatewayServiceUrl(startServer(gatewayApp), "usersService", "/users"),
		);
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
		const usersResponse = await fetch(
			getGatewayServiceUrl(gatewayUrl, "usersService", "/users"),
		);
		const plainResponse = await fetch(
			getGatewayServiceUrl(gatewayUrl, "usersService", "/plain"),
		);
		const usersParsed = await parseSerializedResponse(usersResponse);
		const plainParsed = await parseSerializedResponse(plainResponse);

		expect(usersResponse.status).toBe(200);
		expect(plainResponse.status).toBe(200);
		expect(usersParsed.data).toEqual({ users: ["u1"] });
		expect(plainParsed.data).toEqual({ ok: true });
		expect(upstreamHitCount).toBe(2);
		expect(seenPaths).toEqual(["/usersService/users", "/usersService/plain"]);
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

		const response = await fetch(
			getGatewayServiceUrl(startServer(gatewayApp), "usersService", "/users"),
		);
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(401);
		expect(parsed.source).toBe("middleware");
		expect(parsed.data).toEqual({ message: "Unauthorized" });
		expect(upstreamHitCount).toBe(0);
		expect(steps).toEqual(["gateway:block"]);
	});

	test("gateway middleware raw Response pass-through bypasses serialization", async () => {
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
		} as const satisfies GatewayMiddlewares<typeof services>;

		const boundGatewayMiddlewares = createHonoMiddlewareHandlers(gatewayMiddlewares, {
			MIDDLEWARE: {
				gatewayGuard: () =>
					new Response("blocked", {
						status: 401,
						headers: {
							"content-type": "text/plain",
							"x-raw": "1",
						},
					}),
			},
		});

		const gatewayApp = new Hono();
		initGateway(gatewayApp, services, {
			middlewares: boundGatewayMiddlewares,
		});

		const response = await fetch(
			getGatewayServiceUrl(startServer(gatewayApp), "usersService", "/users"),
		);

		expect(response.status).toBe(401);
		expect(response.headers.get("x-raw")).toBe("1");
		expect(await response.text()).toBe("blocked");
		expect(upstreamHitCount).toBe(0);
	});

	test("same-name gateway middleware composes in ancestor-to-descendant order", async () => {
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

		const steps: Array<string> = [];
		const boundGatewayMiddlewares = createHonoMiddlewareHandlers(gatewayMiddlewares, {
			MIDDLEWARE: {
				auth: async (_ctx, next) => {
					steps.push("global");
					await next();
				},
			},
			SHAPE: {
				usersService: {
					SHAPE: {
						users: {
							MIDDLEWARE: {
								auth: () => {
									steps.push("scoped");
									return {
										status: 403,
										type: "JSON",
										data: { message: "Scoped" },
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
		});

		const response = await fetch(
			getGatewayServiceUrl(startServer(gatewayApp), "usersService", "/users"),
		);
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(403);
		expect(parsed.source).toBe("middleware");
		expect(parsed.data).toEqual({ message: "Scoped" });
		expect(steps).toEqual(["global", "scoped"]);
	});
});

describe("gateway error handling", () => {
	test("gateway-thrown errors respect public and private service error modes", async () => {
		const upstreamApp = new Hono();
		upstreamApp.get("/users", () => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { users: ["u1"] },
			});
		});

		const createGateway = (errorMode: "public" | "private") => {
			const services = createGatewayServices({
				usersService: createGatewayService(
					{ SHAPE: { users: { CONTRACT: true } } },
					serviceContracts,
					serviceMiddlewares,
					errorMode,
					startServer(upstreamApp),
				),
			});
			const gatewayMiddlewares = {
				MIDDLEWARE: {
					gatewayGuard: {
						401: { type: "JSON", schema: z.object({ message: z.string() }) },
					},
				},
			} as const satisfies GatewayMiddlewares<typeof services>;

			const gatewayApp = new Hono();
			initGateway(gatewayApp, services, {
				middlewares: createHonoMiddlewareHandlers(gatewayMiddlewares, {
					MIDDLEWARE: {
						gatewayGuard: () => {
							throw new Error(`explode-${errorMode}`);
						},
					},
				}),
			});
			return startServer(gatewayApp);
		};

		const publicParsed = await parseSerializedResponse(
			await fetch(getGatewayServiceUrl(createGateway("public"), "usersService", "/users")),
		);
		const privateParsed = await parseSerializedResponse(
			await fetch(getGatewayServiceUrl(createGateway("private"), "usersService", "/users")),
		);

		expect(publicParsed.data).toEqual({ message: "explode-public" });
		expect(privateParsed.data).toEqual({
			message: "explode-private",
			issues: {},
			stack: expect.any(String),
		});
	});

	test("gateway client surfaces upstream middleware and public error responses", async () => {
		const upstreamShape = {
			SHAPE: {
				users: { CONTRACT: true },
				boom: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const upstreamContracts = {
			SHAPE: {
				users: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									type: "JSON",
									schema: z.object({ users: z.array(z.string()) }),
								},
							},
						},
					},
				},
				boom: {
					CONTRACT: {
						get: {
							responses: {
								200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
							},
						},
					},
				},
			},
		} as const satisfies ContractTreeFor<typeof upstreamShape>;

		const upstreamMiddlewares = {
			MIDDLEWARE: {
				rateLimit: {
					429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
				},
			},
		} as const satisfies MiddlewareTreeFor<typeof upstreamShape>;

		const upstreamApp = new Hono();
		initHono<typeof upstreamShape, unknown, typeof upstreamMiddlewares>(upstreamApp, {
			contracts: createHonoContractHandlers(upstreamContracts, {
				SHAPE: {
					users: {
						HANDLER: {
							get: () => ({ status: 200, type: "JSON", data: { users: ["u1"] } }),
						},
					},
					boom: {
						HANDLER: {
							get: () => {
								throw new Error("upstream-public");
							},
						},
					},
				},
			}),
			middlewares: createServerMiddlewareHandlers(upstreamMiddlewares, {
				MIDDLEWARE: {
					rateLimit: (ctx, next) => {
						if (new URL(ctx.req.url).pathname === "/users") {
							return { status: 429, type: "JSON", data: { retryAfter: 1 } };
						}
						return next();
					},
				},
			}),
			errorMode: "public",
			createContext: () => ({}),
		});

		const service = createGatewayService(
			{ SHAPE: { users: { CONTRACT: true }, boom: { CONTRACT: true } } },
			upstreamContracts,
			upstreamMiddlewares,
			"public",
			startServer(upstreamApp),
		);
		const services = createGatewayServices({ upstream: service });
		const gatewayApp = new Hono();
		initGateway(gatewayApp, services);
		const gatewayClient = createGatewayClient<typeof services>(startServer(gatewayApp));

		const limited = await gatewayClient.upstream.fetch("/users", "get");
		const failed = await gatewayClient.upstream.fetch("/boom", "get");

		expect(limited.status).toBe(429);
		expect(limited.data).toEqual({ retryAfter: 1 });
		expect(failed.status).toBe(500);
		expect(failed.data).toEqual({ message: "upstream-public" });
	});

	test("gateway client surfaces upstream private error responses", async () => {
		const upstreamShape = {
			SHAPE: {
				boom: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const upstreamContracts = {
			SHAPE: {
				boom: {
					CONTRACT: {
						get: {
							responses: {
								200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
							},
						},
					},
				},
			},
		} as const satisfies ContractTreeFor<typeof upstreamShape>;

		const upstreamApp = new Hono();
		initHono<typeof upstreamShape, unknown>(upstreamApp, {
			contracts: createHonoContractHandlers(upstreamContracts, {
				SHAPE: {
					boom: {
						HANDLER: {
							get: () => {
								throw new Error("upstream-private");
							},
						},
					},
				},
			}),
			errorMode: "private",
			createContext: () => ({}),
		});

		const service = createGatewayService(
			{ SHAPE: { boom: { CONTRACT: true } } },
			upstreamContracts,
			{ MIDDLEWARE: {} },
			"private",
			startServer(upstreamApp),
		);
		const services = createGatewayServices({ upstream: service });
		const gatewayApp = new Hono();
		initGateway(gatewayApp, services);
		const gatewayClient = createGatewayClient<typeof services>(startServer(gatewayApp));

		const failed = await gatewayClient.upstream.fetch("/boom", "get");

		expect(failed.status).toBe(500);
		expect(failed.data).toEqual({
			message: "upstream-private",
			issues: {},
			stack: expect.any(String),
		});
	});

	test("gateway client round-trips upstream declared response headers", async () => {
		const upstreamApp = new Hono();
		upstreamApp.get("/headered", () => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				headers: {
					"x-upstream": "1",
					[ZONO_HEADER_DATA_TYPE_HEADER]: "Standard",
					[ZONO_HEADER_DATA_HEADER]: JSON.stringify({ "x-upstream": "1" }),
				},
				data: { ok: true },
			});
		});

		const service = createGatewayService(
			{ SHAPE: { headered: { CONTRACT: true } } },
			serviceContracts,
			serviceMiddlewares,
			"public",
			startServer(upstreamApp),
		);
		const services = createGatewayServices({ upstream: service });
		const gatewayApp = new Hono();
		initGateway(gatewayApp, services);
		const gatewayClient = createGatewayClient<typeof services>(startServer(gatewayApp));

		const response = await gatewayClient.upstream.fetch("/headered", "get");

		expect(response.status).toBe(200);
		expect(response.data).toEqual({ ok: true });
		expect(response.headers).toEqual({ "x-upstream": "1" });
		expect(response.response.headers.get("x-upstream")).toBe("1");
	});

	test("gateway client fetchConfig and parseResponse compose through vanilla fetch", async () => {
		const upstreamShape = {
			SHAPE: {
				users: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const upstreamContracts = {
			SHAPE: {
				users: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									type: "JSON",
									schema: z.object({ users: z.array(z.string()) }),
								},
							},
						},
					},
				},
			},
		} as const satisfies ContractTreeFor<typeof upstreamShape>;

		const upstreamMiddlewares = {
			MIDDLEWARE: {
				rateLimit: {
					429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
				},
			},
		} as const satisfies MiddlewareTreeFor<typeof upstreamShape>;

		const upstreamApp = new Hono();
		initHono<typeof upstreamShape, unknown, typeof upstreamMiddlewares>(upstreamApp, {
			contracts: createHonoContractHandlers(upstreamContracts, {
				SHAPE: {
					users: {
						HANDLER: {
							get: () => ({ status: 200, type: "JSON", data: { users: ["u1"] } }),
						},
					},
				},
			}),
			middlewares: createServerMiddlewareHandlers(upstreamMiddlewares, {
				MIDDLEWARE: {
					rateLimit: () => ({ status: 429, type: "JSON", data: { retryAfter: 1 } }),
				},
			}),
			errorMode: "public",
			createContext: () => ({}),
		});

		const services = createGatewayServices({
			upstream: createGatewayService(
				{ SHAPE: { users: { CONTRACT: true } } },
				upstreamContracts,
				upstreamMiddlewares,
				"public",
				startServer(upstreamApp),
			),
		});
		const gatewayApp = new Hono();
		initGateway(gatewayApp, services);
		const gatewayClient = createGatewayClient<typeof services>(startServer(gatewayApp));

		const [url, init] = await gatewayClient.upstream.fetchConfig("/users", "get");
		const rawResponse = await fetch(url, init);
		const parsed = await gatewayClient.upstream.parseResponse("/users", "get", rawResponse);

		expect(url).toContain("/upstream/users");
		expect(init.method).toBe("GET");
		expect(parsed.status).toBe(429);
		expect(parsed.data).toEqual({ retryAfter: 1 });
		expect(await parsed.response.json()).toEqual({ retryAfter: 1 });
	});

	test("gateway client keeps unprefixed call paths while targeting service namespaces", async () => {
		const service1App = new Hono();
		service1App.get("/heartbeat", () => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { service: "service1" },
			});
		});

		const service2App = new Hono();
		service2App.get("/heartbeat", () => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { service: "service2" },
			});
		});

		const services = createGatewayServices({
			service1: createGatewayService(
				{ SHAPE: { heartbeat: { CONTRACT: true } } },
				heartbeatServiceContracts,
				heartbeatServiceMiddlewares,
				"public",
				startServer(service1App),
			),
			service2: createGatewayService(
				{ SHAPE: { heartbeat: { CONTRACT: true } } },
				heartbeatServiceContracts,
				heartbeatServiceMiddlewares,
				"public",
				startServer(service2App),
			),
		});

		const gatewayApp = new Hono();
		initGateway(gatewayApp, services);
		const gatewayClient = createGatewayClient<typeof services>(startServer(gatewayApp));

		const service1Response = await gatewayClient.service1.fetch("/heartbeat", "get");
		const service2Response = await gatewayClient.service2.fetch("/heartbeat", "get");
		const [service1Url, service1Init] = await gatewayClient.service1.fetchConfig(
			"/heartbeat",
			"get",
		);

		expect(service1Response.data).toEqual({ service: "service1" });
		expect(service2Response.data).toEqual({ service: "service2" });
		expect(service1Url).toContain("/service1/heartbeat");
		expect(service1Init.method).toBe("GET");
	});

	test("gateway client hooks run after service path namespacing", async () => {
		const upstreamApp = new Hono();
		upstreamApp.get("/echo", (ctx) => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: {
					query: ctx.req.query("hooked") ?? "",
					header: ctx.req.header("x-hooked") ?? "",
				},
			});
		});

		const service = createGatewayService(
			{ SHAPE: { echo: { CONTRACT: true } } },
			serviceContracts,
			serviceMiddlewares,
			"public",
			startServer(upstreamApp),
		);
		const services = createGatewayServices({ service });
		const gatewayApp = new Hono();
		initGateway(gatewayApp, services);
		const seenPaths: Array<string> = [];
		const gatewayClient = createGatewayClient<typeof services>(startServer(gatewayApp), {
			preRequest: (url, init) => {
				const nextUrl = new URL(url);
				seenPaths.push(nextUrl.pathname);
				nextUrl.searchParams.set("hooked", "1");
				const headers = new Headers(init.headers);
				headers.set("x-hooked", "1");
				return [nextUrl.toString(), { ...init, headers }];
			},
			postRequest: async (response) => {
				const parsed = (await parseSerializedResponse(response.clone())) as {
					data: { query: string; header: string };
				};
				return createSerializedResponse({
					status: 200,
					type: "JSON",
					source: "contract",
					data: { ...parsed.data, post: "1" },
				});
			},
		});

		const [url, init] = await gatewayClient.service.fetchConfig("/echo", "get");
		const response = await gatewayClient.service.fetch("/echo", "get");

		expect(seenPaths).toEqual(["/service/echo", "/service/echo"]);
		expect(url).toContain("/service/echo");
		expect(new URL(url).searchParams.get("hooked")).toBe("1");
		expect(new Request(url, init).headers.get("x-hooked")).toBe("1");
		expect(response.data as { query: string; header: string; post: string }).toEqual({
			query: "1",
			header: "1",
			post: "1",
		});
	});
});

describe("gateway proxy edge cases", () => {
	test("proxies HEAD routes", async () => {
		const upstreamApp = new Hono();
		upstreamApp.use("/headOnly", async (ctx, next) => {
			if (ctx.req.method !== "HEAD") {
				await next();
				return;
			}
			ctx.header("x-head", "1");
			return new Response(null, { status: 204, headers: ctx.res.headers });
		});

		const services = createGatewayServices({
			headService: createGatewayService(
				{ SHAPE: { headOnly: { CONTRACT: true } } },
				serviceContracts,
				serviceMiddlewares,
				"public",
				startServer(upstreamApp),
			),
		});

		const gatewayApp = new Hono();
		initGateway(gatewayApp, services);
		const response = await fetch(
			getGatewayServiceUrl(startServer(gatewayApp), "headService", "/headOnly"),
			{
				method: "HEAD",
			},
		);

		expect(response.status).toBe(204);
		expect(response.headers.get("x-head")).toBe("1");
		expect(await response.text()).toBe("");
	});
});

const gatewayMaskTyped = {
	SHAPE: {
		echo: { CONTRACT: true },
		headered: { CONTRACT: true },
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
				headered: { CONTRACT: true },
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
	void client.usersService.fetch("/headered", "get");
	void client.usersService.fetchConfig("/echo", "get");

	const parsedUsersResponsePromise = client.usersService.parseResponse(
		"/users",
		"get",
		new Response(),
	);
	type ParsedUsersResponse = Awaited<typeof parsedUsersResponsePromise>;
	const parsedUsersRateLimitData: ExtractStatus<ParsedUsersResponse, 429>["data"] = {
		retryAfter: 1000,
	};
	void parsedUsersRateLimitData;

	// @ts-expect-error invalid path for service contracts
	void client.usersService.fetch("/missing", "get");

	// @ts-expect-error invalid path for service contracts
	void client.usersService.fetchConfig("/missing", "get");

	// @ts-expect-error method not defined on route
	void client.usersService.fetch("/echo", "put");

	// @ts-expect-error method not defined on route
	void client.usersService.fetchConfig("/echo", "put");

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

	const usersGlobalAuth: ExtractStatus<UsersResponse, 401> = {
		status: 401,
		data: { scope: "global" },
		response: new Response(),
	};
	void usersGlobalAuth;

	const headeredResponsePromise = client.usersService.fetch("/headered", "get");
	type HeaderedResponse = Awaited<typeof headeredResponsePromise>;
	const headeredHeaders: ExtractStatus<HeaderedResponse, 200>["headers"] = {
		"x-upstream": "1",
	};
	void headeredHeaders;

	// @ts-expect-error declared gateway client response headers are required
	const missingHeaderedHeaders: ExtractStatus<HeaderedResponse, 200> = {
		status: 200,
		data: { ok: true },
		response: new Response(),
	};
	void missingHeaderedHeaders;

	const invalidHeaderedHeaders: ExtractStatus<HeaderedResponse, 200>["headers"] = {
		// @ts-expect-error gateway client response headers must match the declared schema
		"x-upstream": 1,
	};
	void invalidHeaderedHeaders;

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
	void maskedClient.usersService.fetchConfig("/users", "get");

	// @ts-expect-error masked-out nested route should not be exposed on the gateway client
	void maskedClient.usersService.fetch("/users/$userId", "get", {
		pathParams: { userId: "user-1" },
	});

	// @ts-expect-error masked-out nested route should not be exposed on the gateway client
	void maskedClient.usersService.fetchConfig("/users/$userId", "get", {
		pathParams: { userId: "user-1" },
	});
});
