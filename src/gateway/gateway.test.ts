import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import z from "zod";
import { defineApi } from "../contract/contract.js";
import { createApiHandlers, initHono } from "../server/server.js";
import {
	createSerializedResponse,
	parseSerializedResponse,
	ZONO_HEADER_DATA_HEADER,
	ZONO_HEADER_DATA_TYPE_HEADER,
} from "../shared/shared.js";
import type { GatewayServiceMask } from "./gateway.js";
import {
	createGatewayClient,
	createGatewayHandlers,
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

const serviceApi = defineApi({
	contracts: {
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
					query: {
						body: { type: "JSON", schema: z.object({ filter: z.string() }) },
						responses: {
							200: { type: "Text", schema: z.string() },
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
						responses: {
							200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
						},
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
	},
});

const nestedUsersServiceApi = defineApi({
	contracts: {
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
	},
});

const heartbeatServiceApi = defineApi({
	contracts: {
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
	},
});

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
		} as const satisfies GatewayServiceMask<typeof serviceApi.contracts>;
		const service = createGatewayService({
			api: serviceApi,
			mask: gatewayMask,
			baseUrl: upstreamUrl,
		});

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

	test("forwards POST bodies and content types to the upstream service", async () => {
		const upstreamApp = new Hono();
		upstreamApp.post("/echo", async (ctx) => {
			const body = await ctx.req.text();
			return createSerializedResponse({
				status: 201,
				type: "Text",
				source: "contract",
				data: `body:${body}:${ctx.req.header("content-type")}`,
			});
		});

		const service = createGatewayService({
			api: serviceApi,
			mask: { SHAPE: { echo: { CONTRACT: true } } },
			baseUrl: startServer(upstreamApp),
		});
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
		expect(parsedPost.data).toBe("body:hello:text/plain");
	});

	test("forwards QUERY bodies through the typed gateway client", async () => {
		const upstreamApp = new Hono();
		upstreamApp.on("QUERY", "/echo", async (ctx) => {
			const body = (await ctx.req.json()) as { filter: string };
			return createSerializedResponse({
				status: 200,
				type: "Text",
				source: "contract",
				data: `${ctx.req.method}:${ctx.req.header("content-type")}:${body.filter}`,
			});
		});
		const service = createGatewayService({
			api: serviceApi,
			mask: { SHAPE: { echo: { CONTRACT: true } } },
			baseUrl: startServer(upstreamApp),
		});
		const gatewayApp = new Hono();
		const services = createGatewayServices({ service });
		initGateway(gatewayApp, services);
		const client = createGatewayClient<typeof services>(startServer(gatewayApp));

		const [url, init] = await client.service.fetchConfig("/echo", "query", {
			body: { type: "JSON", data: { filter: "active" } },
		});
		const response = await client.service.fetch("/echo", "query", {
			body: { type: "JSON", data: { filter: "active" } },
		});

		expect(init.method).toBe("QUERY");
		expect(new Request(url, init).headers.get("content-type")).toBe("application/json");
		expect(response.data).toBe("QUERY:application/json:active");
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
			service1: createGatewayService({
				api: heartbeatServiceApi,
				mask: { SHAPE: { heartbeat: { CONTRACT: true } } },
				baseUrl: startServer(service1App),
			}),
			service2: createGatewayService({
				api: heartbeatServiceApi,
				mask: { SHAPE: { heartbeat: { CONTRACT: true } } },
				baseUrl: startServer(service2App),
			}),
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
		const makeService = () =>
			createGatewayService({
				api: heartbeatServiceApi,
				mask: { SHAPE: { heartbeat: { CONTRACT: true } } },
				baseUrl: "http://localhost",
			});

		expect(() =>
			createGatewayServices({
				"": makeService(),
			}),
		).toThrow("cannot be empty");

		expect(() =>
			createGatewayServices({
				invalid: makeService(),
				"bad/key": makeService(),
			}),
		).toThrow("cannot contain '/'");

		expect(() =>
			createGatewayServices({
				$bad: makeService(),
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
			usersService: createGatewayService({
				api: nestedUsersServiceApi,
				mask: {
					SHAPE: {
						users: { CONTRACT: true },
					},
				},
				baseUrl: startServer(upstreamApp),
			}),
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

	test("registers all nested routes when SHAPE is true", async () => {
		const upstreamApp = new Hono();
		upstreamApp.get("/users/:userId", (ctx) => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { id: ctx.req.param("userId") },
			});
		});

		const services = createGatewayServices({
			usersService: createGatewayService({
				api: nestedUsersServiceApi,
				mask: { SHAPE: { users: { SHAPE: true } } },
				baseUrl: startServer(upstreamApp),
			}),
		});
		const gatewayApp = new Hono();
		initGateway(gatewayApp, services);
		const response = await fetch(
			getGatewayServiceUrl(startServer(gatewayApp), "usersService", "/users/user-1"),
		);

		expect(response.status).toBe(200);
		expect((await parseSerializedResponse(response)).data).toEqual({ id: "user-1" });
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
			usersService: createGatewayService({
				api: serviceApi,
				mask: { SHAPE: { users: { CONTRACT: true }, plain: { CONTRACT: true } } },
				baseUrl: startServer(upstreamApp),
			}),
		});

		const gatewayApi = {
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
		const gatewayHandlers = createGatewayHandlers(gatewayApi)({
			createContext: () => ({ requestId: "ctx-1" }),
			middlewares: {
				MIDDLEWARE: {
					gatewayGuard: async (_ctx, next, appContext) => {
						steps.push(`gateway:before:${appContext.requestId}`);
						await next();
						steps.push("gateway:after");
					},
				},
				SHAPE: {
					usersService: {
						MIDDLEWARE: {
							serviceGuard: async (_ctx, next, appContext) => {
								steps.push(`service:before:${appContext.requestId}`);
								await next();
								steps.push("service:after");
							},
						},
						SHAPE: {
							users: {
								MIDDLEWARE: {
									auth: async (_ctx, next, appContext) => {
										steps.push(`auth:before:${appContext.requestId}`);
										await next();
										steps.push("auth:after");
									},
								},
							},
						},
					},
				},
			},
		});

		const gatewayApp = new Hono();
		initGateway(gatewayApp, services, {
			handlers: gatewayHandlers,
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
			usersService: createGatewayService({
				api: serviceApi,
				mask: { SHAPE: { users: { CONTRACT: true }, plain: { CONTRACT: true } } },
				baseUrl: startServer(upstreamApp),
			}),
		});

		const gatewayApi = {
			MIDDLEWARE: {
				gatewayGuard: {
					418: { type: "JSON", schema: z.object({ message: z.string() }) },
				},
			},
		} as const satisfies GatewayMiddlewares<typeof services>;

		const seenPaths: Array<string> = [];
		const gatewayHandlers = createGatewayHandlers(gatewayApi)({
			createContext: () => ({ requestId: "ctx-2" }),
			middlewares: {
				MIDDLEWARE: {
					gatewayGuard: async (ctx, next) => {
						seenPaths.push(new URL(ctx.req.url).pathname);
						await next();
					},
				},
			},
		});

		const gatewayApp = new Hono();
		initGateway(gatewayApp, services, {
			handlers: gatewayHandlers,
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
			usersService: createGatewayService({
				api: serviceApi,
				mask: { SHAPE: { users: { CONTRACT: true } } },
				baseUrl: startServer(upstreamApp),
			}),
		});

		const gatewayApi = {
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
		const gatewayHandlers = createGatewayHandlers(gatewayApi)({
			createContext: () => ({ requestId: "ctx-3" }),
			middlewares: {
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
			},
		});

		const gatewayApp = new Hono();
		initGateway(gatewayApp, services, {
			handlers: gatewayHandlers,
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
			usersService: createGatewayService({
				api: serviceApi,
				mask: { SHAPE: { users: { CONTRACT: true } } },
				baseUrl: startServer(upstreamApp),
			}),
		});

		const gatewayApi = {
			MIDDLEWARE: {
				gatewayGuard: {
					401: { type: "JSON", schema: z.object({ message: z.string() }) },
				},
			},
		} as const satisfies GatewayMiddlewares<typeof services>;

		const gatewayHandlers = createGatewayHandlers(gatewayApi)({
			middlewares: {
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
			},
		});

		const gatewayApp = new Hono();
		initGateway(gatewayApp, services, {
			handlers: gatewayHandlers,
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
			usersService: createGatewayService({
				api: serviceApi,
				mask: { SHAPE: { users: { CONTRACT: true }, plain: { CONTRACT: true } } },
				baseUrl: startServer(upstreamApp),
			}),
		});

		const gatewayApi = {
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
		const gatewayHandlers = createGatewayHandlers(gatewayApi)({
			middlewares: {
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
			},
		});

		const gatewayApp = new Hono();
		initGateway(gatewayApp, services, {
			handlers: gatewayHandlers,
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
	test("gateway-thrown errors respect opaque and detailed service error modes", async () => {
		const upstreamApp = new Hono();
		upstreamApp.get("/users", () => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { users: ["u1"] },
			});
		});
		const upstreamUrl = startServer(upstreamApp);

		const createGateway = (errorMode: "opaque" | "detailed") => {
			const api = defineApi({
				contracts: serviceApi.contracts,
				errorMode,
			});
			const services = createGatewayServices({
				usersService: createGatewayService({
					api,
					mask: { SHAPE: { users: { CONTRACT: true } } },
					baseUrl: upstreamUrl,
				}),
			});
			const gatewayApi = {
				MIDDLEWARE: {
					gatewayGuard: {
						401: { type: "JSON", schema: z.object({ message: z.string() }) },
					},
				},
			} as const satisfies GatewayMiddlewares<typeof services>;

			const gatewayApp = new Hono();
			initGateway(gatewayApp, services, {
				handlers: createGatewayHandlers(gatewayApi)({
					middlewares: {
						MIDDLEWARE: {
							gatewayGuard: () => {
								throw new Error(`explode-${errorMode}`);
							},
						},
					},
				}),
			});
			return startServer(gatewayApp);
		};

		const opaqueParsed = await parseSerializedResponse(
			await fetch(getGatewayServiceUrl(createGateway("opaque"), "usersService", "/users")),
		);
		const detailedParsed = await parseSerializedResponse(
			await fetch(getGatewayServiceUrl(createGateway("detailed"), "usersService", "/users")),
		);

		expect(opaqueParsed.data).toEqual({ message: "Internal server error" });
		expect(detailedParsed.data).toEqual({
			message: "explode-detailed",
			stack: expect.any(String),
		});
	});

	test("gateway onError observes failures without replacing the typed response", async () => {
		const services = createGatewayServices({
			usersService: createGatewayService({
				api: serviceApi,
				mask: { SHAPE: { users: { CONTRACT: true } } },
				baseUrl: "http://localhost",
			}),
		});
		const gatewayApi = {
			MIDDLEWARE: {
				gatewayGuard: {
					401: { type: "JSON", schema: z.object({ message: z.string() }) },
				},
			},
		} as const satisfies GatewayMiddlewares<typeof services>;

		const observed: Array<string> = [];
		const gatewayApp = new Hono();
		initGateway(gatewayApp, services, {
			handlers: createGatewayHandlers(gatewayApi)({
				middlewares: {
					MIDDLEWARE: {
						gatewayGuard: () => {
							throw new Error("gateway exploded");
						},
					},
				},
			}),
			onError: async (error) => {
				await new Promise((resolve) => setTimeout(resolve, 5));
				observed.push(error instanceof Error ? error.message : String(error));
				throw new Error("observer failed");
			},
		});

		const response = await fetch(
			getGatewayServiceUrl(startServer(gatewayApp), "usersService", "/users"),
		);

		expect(response.status).toBe(500);
		expect((await parseSerializedResponse(response)).data).toEqual({
			message: "Internal server error",
		});
		expect(observed).toEqual(["gateway exploded"]);
	});

	test("gateway client surfaces upstream middleware and opaque error responses", async () => {
		const upstreamApi = defineApi({
			contracts: {
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
			},
			middlewares: {
				MIDDLEWARE: {
					rateLimit: {
						429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
					},
				},
			},
		});

		const upstreamApp = new Hono();
		initHono(
			upstreamApp,
			createApiHandlers(upstreamApi)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						users: {
							HANDLER: {
								get: () => ({
									status: 200,
									type: "JSON",
									data: { users: ["u1"] },
								}),
							},
						},
						boom: {
							HANDLER: {
								get: () => {
									throw new Error("upstream-opaque");
								},
							},
						},
					},
				},
				middlewares: {
					MIDDLEWARE: {
						rateLimit: (ctx, next) => {
							if (new URL(ctx.req.url).pathname === "/users") {
								return { status: 429, type: "JSON", data: { retryAfter: 1 } };
							}
							return next();
						},
					},
				},
			}),
		);

		const service = createGatewayService({
			api: upstreamApi,
			mask: { SHAPE: { users: { CONTRACT: true }, boom: { CONTRACT: true } } },
			baseUrl: startServer(upstreamApp),
		});
		const services = createGatewayServices({ upstream: service });
		const gatewayApp = new Hono();
		initGateway(gatewayApp, services);
		const gatewayClient = createGatewayClient<typeof services>(startServer(gatewayApp));

		const limited = await gatewayClient.upstream.fetch("/users", "get");
		const failed = await gatewayClient.upstream.fetch("/boom", "get");

		expect(limited.status).toBe(429);
		expect(limited.data).toEqual({ retryAfter: 1 });
		expect(failed.status).toBe(500);
		// Opaque upstream errors never leak thrown messages through the gateway.
		expect(failed.data).toEqual({ message: "Internal server error" });
	});

	test("gateway client surfaces upstream detailed error responses", async () => {
		const upstreamApi = defineApi({
			contracts: {
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
			},
			errorMode: "detailed",
		});

		const upstreamApp = new Hono();
		initHono(
			upstreamApp,
			createApiHandlers(upstreamApi)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						boom: {
							HANDLER: {
								get: () => {
									throw new Error("upstream-detailed");
								},
							},
						},
					},
				},
			}),
		);

		const service = createGatewayService({
			api: upstreamApi,
			mask: { SHAPE: { boom: { CONTRACT: true } } },
			baseUrl: startServer(upstreamApp),
		});
		const services = createGatewayServices({ upstream: service });
		const gatewayApp = new Hono();
		initGateway(gatewayApp, services);
		const gatewayClient = createGatewayClient<typeof services>(startServer(gatewayApp));

		const failed = await gatewayClient.upstream.fetch("/boom", "get");

		expect(failed.status).toBe(500);
		expect(failed.data).toEqual({
			message: "upstream-detailed",
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

		const service = createGatewayService({
			api: serviceApi,
			mask: { SHAPE: { headered: { CONTRACT: true } } },
			baseUrl: startServer(upstreamApp),
		});
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
		const upstreamApi = defineApi({
			contracts: {
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
			},
			middlewares: {
				MIDDLEWARE: {
					rateLimit: {
						429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
					},
				},
			},
		});

		const upstreamApp = new Hono();
		initHono(
			upstreamApp,
			createApiHandlers(upstreamApi)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						users: {
							HANDLER: {
								get: () => ({
									status: 200,
									type: "JSON",
									data: { users: ["u1"] },
								}),
							},
						},
					},
				},
				middlewares: {
					MIDDLEWARE: {
						rateLimit: () => ({ status: 429, type: "JSON", data: { retryAfter: 1 } }),
					},
				},
			}),
		);

		const services = createGatewayServices({
			upstream: createGatewayService({
				api: upstreamApi,
				mask: { SHAPE: { users: { CONTRACT: true } } },
				baseUrl: startServer(upstreamApp),
			}),
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
			service1: createGatewayService({
				api: heartbeatServiceApi,
				mask: { SHAPE: { heartbeat: { CONTRACT: true } } },
				baseUrl: startServer(service1App),
			}),
			service2: createGatewayService({
				api: heartbeatServiceApi,
				mask: { SHAPE: { heartbeat: { CONTRACT: true } } },
				baseUrl: startServer(service2App),
			}),
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

		const service = createGatewayService({
			api: serviceApi,
			mask: { SHAPE: { echo: { CONTRACT: true } } },
			baseUrl: startServer(upstreamApp),
		});
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
			headService: createGatewayService({
				api: serviceApi,
				mask: { SHAPE: { headOnly: { CONTRACT: true } } },
				baseUrl: startServer(upstreamApp),
			}),
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
} as const satisfies GatewayServiceMask<typeof serviceApi.contracts>;
void gatewayMaskTyped;

type ExtractStatus<T, TStatus extends number> = Extract<T, { status: TStatus }>;
const typeOnly = (_cb: () => void): void => {};

typeOnly(() => {
	// Gateway masks reject nonexistent contract paths.
	const invalidMask = {
		SHAPE: {
			// @ts-expect-error unknown contract path is rejected by the mask
			missing: { CONTRACT: true },
		},
	} as const satisfies GatewayServiceMask<typeof serviceApi.contracts>;
	void invalidMask;

	const service = createGatewayService({
		api: serviceApi,
		mask: {
			SHAPE: {
				echo: { CONTRACT: true },
				headered: { CONTRACT: true },
				plain: { CONTRACT: true },
				users: { CONTRACT: true },
			},
		},
		baseUrl: "http://localhost",
	});
	const services = createGatewayServices({ usersService: service });

	const gatewayApi = {
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

	const client = createGatewayClient<typeof services, typeof gatewayApi>("http://localhost");

	void client.usersService.fetch("/echo", "get");
	void client.usersService.fetch("/headered", "get");
	void client.usersService.fetchConfig("/echo", "get");

	// Required request components make the gateway client argument required.
	// @ts-expect-error the QUERY body is required
	void client.usersService.fetch("/echo", "query");
	// @ts-expect-error the QUERY body is required
	void client.usersService.fetchConfig("/echo", "query");
	void client.usersService.fetch("/echo", "query", {
		body: { type: "JSON", data: { filter: "active" } },
	});

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
	// The service retains its API's (opaque) error mode in the client union.
	const usersBadRequestData: ExtractStatus<UsersResponse, 400>["data"] = {
		message: "Invalid request",
	};
	const usersNotFoundData: ExtractStatus<UsersResponse, 404>["data"] = {
		message: "Not Found",
	};
	const usersUnsupportedMediaTypeData: ExtractStatus<UsersResponse, 415>["data"] = {
		message: "Unsupported media type",
	};
	const usersInternalErrorData: ExtractStatus<UsersResponse, 500>["data"] = {
		message: "Internal server error",
	};
	void usersAuthData;
	void usersRateLimitData;
	void usersServiceGuardData;
	void usersAuditData;
	void usersBadRequestData;
	void usersNotFoundData;
	void usersUnsupportedMediaTypeData;
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

	const detailedServiceApi = defineApi({
		contracts: {
			SHAPE: {
				users: {
					CONTRACT: {
						get: {
							responses: {
								200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
							},
						},
					},
				},
			},
		},
		errorMode: "detailed",
	});
	const detailedServices = createGatewayServices({
		detailed: createGatewayService({
			api: detailedServiceApi,
			mask: { SHAPE: { users: { CONTRACT: true } } },
			baseUrl: "http://localhost",
		}),
	});
	const detailedClient = createGatewayClient<typeof detailedServices>("http://localhost");
	const detailedResponsePromise = detailedClient.detailed.fetch("/users", "get");
	type DetailedResponse = Awaited<typeof detailedResponsePromise>;
	// Detailed error modes surface diagnostic fields in the client union.
	const detailedInternalErrorData: ExtractStatus<DetailedResponse, 500>["data"] = {
		message: "anything",
		stack: "trace",
	};
	void detailedInternalErrorData;

	const maskedNestedService = createGatewayService({
		api: nestedUsersServiceApi,
		mask: {
			SHAPE: {
				users: { CONTRACT: true },
			},
		},
		baseUrl: "http://localhost",
	});
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

	const recursiveService = createGatewayService({
		api: nestedUsersServiceApi,
		mask: { SHAPE: { users: { SHAPE: true } } },
		baseUrl: "http://localhost",
	});
	const recursiveServices = createGatewayServices({ usersService: recursiveService });
	const recursiveClient = createGatewayClient<typeof recursiveServices>("http://localhost");
	void recursiveClient.usersService.fetch("/users/$userId", "get", {
		pathParams: { userId: "user-1" },
	});

	// @ts-expect-error masked-out nested route should not be exposed on the gateway client
	void maskedClient.usersService.fetch("/users/$userId", "get", {
		pathParams: { userId: "user-1" },
	});

	// @ts-expect-error masked-out nested route should not be exposed on the gateway client
	void maskedClient.usersService.fetchConfig("/users/$userId", "get", {
		pathParams: { userId: "user-1" },
	});
});
