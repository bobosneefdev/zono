import { Hono } from "hono";
import z from "zod";
import { createClient } from "./client/client.js";
import { defineApi } from "./contract/contract.js";
import {
	createGatewayClient,
	createGatewayHandlers,
	createGatewayService,
	createGatewayServices,
	GatewayMiddlewares,
	initGateway,
} from "./gateway/gateway.js";
import { createApiHandlers, initHono } from "./server/server.js";

// DEMO SCHEMAS
const zUser = z.object({
	id: z.uuid(),
	first: z.string(),
	last: z.string(),
	email: z.email(),
	createdAt: z.date(),
});

// One unified API definition: contracts are the route source of truth,
// middleware paths are constrained by the contracts, and errors default
// to the safe "opaque" mode.
const usersApi = defineApi({
	contracts: {
		SHAPE: {
			health: {
				CONTRACT: {
					// GET route without any request data.
					get: {
						responses: {
							200: {
								type: "JSON",
								schema: z.object({ ok: z.boolean() }),
							},
						},
					},
				},
			},
			users: {
				CONTRACT: {
					get: {
						responses: {
							200: {
								type: "SuperJSON",
								schema: z.array(zUser),
							},
						},
					},
				},
				SHAPE: {
					// Dynamic segments require a matching pathParams schema.
					$userId: {
						CONTRACT: {
							get: {
								pathParams: z.object({ userId: z.uuid() }),
								query: {
									type: "SuperJSON",
									schema: z.object({ active: z.boolean() }),
								},
								responses: {
									200: {
										type: "SuperJSON",
										schema: zUser.nullable(),
									},
								},
							},
						},
					},
				},
			},
			search: {
				CONTRACT: {
					// HTTP QUERY: a safe method with a request body.
					query: {
						body: {
							type: "JSON",
							// Deterministic media types with optional overrides.
							contentType: "application/query+json",
							schema: z.object({ filter: z.string() }),
						},
						responses: {
							200: {
								type: "JSON",
								schema: z.object({ results: z.array(z.string()) }),
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
				429: {
					type: "JSON",
					schema: z.object({
						/** unixMs timestamp when you should retry */
						retryAfter: z.number().int().min(0),
					}),
				},
			},
		},
	},
	// errorMode defaults to "opaque"; opt into "detailed" for development.
});

// One inferred server binding: context, contract handlers, and middleware
// handlers all derive from the API definition and createContext.
const usersBinding = createApiHandlers(usersApi)({
	createContext: async (ctx) => {
		return {
			userId: ctx.req.header("x-user-id"),
		};
	},
	contracts: {
		SHAPE: {
			health: {
				HANDLER: {
					get: () => ({
						status: 200,
						type: "JSON",
						data: { ok: true },
					}),
				},
			},
			users: {
				HANDLER: {
					get: async (_data, _ctx, appContext) => ({
						status: 200,
						type: "SuperJSON",
						data: [
							{
								id: crypto.randomUUID(),
								first: "John",
								last: "Pork",
								email: `${appContext.userId ?? "johnpork"}@gmail.com`,
								createdAt: new Date(),
							},
						],
					}),
				},
				SHAPE: {
					$userId: {
						HANDLER: {
							get: async (data) => ({
								status: 200,
								type: "SuperJSON",
								data: {
									id: data.pathParams.userId,
									first: "John",
									last: "Pork",
									email: "johnpork@gmail.com",
									createdAt: new Date(),
								},
							}),
						},
					},
				},
			},
			search: {
				HANDLER: {
					query: async (data) => ({
						status: 200,
						type: "JSON",
						data: { results: [data.body.filter] },
					}),
				},
			},
		},
	},
	middlewares: {
		MIDDLEWARE: {
			rateLimit: async (_ctx, next, _appContext) => {
				const rand = Math.random();
				if (rand < 0.5) {
					return {
						status: 429,
						type: "JSON",
						data: { retryAfter: Date.now() + 1000 },
					};
				}
				await next();
			},
		},
	},
});

const usersServiceApp = new Hono();
initHono(usersServiceApp, usersBinding, {
	// onError is observational only; it can never replace the typed response.
	onError(error, ctx) {
		console.error("users service error", { error, path: ctx.req.path });
	},
});
Bun.serve({ fetch: usersServiceApp.fetch, port: 3000 });

// Clients consume the API definition through a type-only import; no runtime
// schemas ship to client bundles.
const usersServiceClient = createClient<typeof usersApi>("http://localhost:3000", {
	preRequest: (url, init) => [url, init],
	postRequest: (response) => response,
});

(async () => {
	// No request components: data may be omitted.
	const health = await usersServiceClient.fetch("/health", "get");
	console.log(health.status, health.data);

	// Required path params and query: data is required.
	const user = await usersServiceClient.fetch("/users/$userId", "get", {
		pathParams: { userId: crypto.randomUUID() },
		query: { type: "SuperJSON", data: { active: true } },
	});
	console.log(user.response.status, user.data);

	// QUERY with a required body and custom contract media type.
	const results = await usersServiceClient.fetch("/search", "query", {
		body: {
			type: "JSON",
			contentType: "application/query+json",
			data: { filter: "active" },
		},
	});
	console.log(results.status, results.data);
})();

// The gateway masks which routes a service exposes; the mask is constrained
// directly by the API's contracts.
const usersGatewayService = createGatewayService({
	api: usersApi,
	mask: {
		SHAPE: {
			users: {
				CONTRACT: true,
			},
		},
	},
	baseUrl: "http://localhost:3000",
});

const gatewayServices = createGatewayServices({
	users: usersGatewayService,
});
type DemoGatewayServices = typeof gatewayServices;

const gatewayApi = {
	MIDDLEWARE: {
		gatewayAuth: {
			401: {
				type: "JSON",
				schema: z.object({ message: z.string() }),
			},
		},
	},
	SHAPE: {
		users: {
			// This represents the users service.
			SHAPE: {
				users: {
					// This represents the users endpoint on the users service.
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
} as const satisfies GatewayMiddlewares<DemoGatewayServices>;

const gatewayHandlers = createGatewayHandlers(gatewayApi)({
	createContext: async (ctx) => ({
		requestId: ctx.req.header("x-request-id") ?? crypto.randomUUID(),
	}),
	middlewares: {
		MIDDLEWARE: {
			gatewayAuth: async (_ctx, next) => {
				const isAuthed = Math.random() > 0.5;
				if (!isAuthed) {
					return {
						status: 401,
						type: "JSON",
						data: { message: "Unauthorized" },
					};
				}
				await next();
			},
		},
		SHAPE: {
			users: {
				SHAPE: {
					users: {
						MIDDLEWARE: {
							auth: () => ({
								status: 403,
								type: "JSON",
								data: { message: "Forbidden" },
							}),
						},
					},
				},
			},
		},
	},
});

const gatewayApp = new Hono();
initGateway(gatewayApp, gatewayServices, {
	handlers: gatewayHandlers,
	onError(error) {
		console.error("gateway error", { error });
	},
});
Bun.serve({ fetch: gatewayApp.fetch, port: 3001 });

// The gateway client is also type-only.
const gatewayClient = createGatewayClient<DemoGatewayServices, typeof gatewayApi>(
	"http://localhost:3001",
);

(async () => {
	const users = await gatewayClient.users.fetch("/users", "get");
	console.log(users.response.status, users.data);
})();
