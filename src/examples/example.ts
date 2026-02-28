import { type Context, Hono } from "hono";
import z from "zod";
import { createClient } from "~/client/client.js";
import { createRoutes } from "~/contract/routes.js";
import type { RouterShape } from "~/contract/shape.types.js";
import { initHono } from "~/hono/hono.js";
import {
	generateHonoGatewayRoutesAndMiddleware,
	initHonoGateway,
} from "~/hono_gateway/hono_gateway.js";
import { createMiddleware } from "~/middleware/middleware.js";

const shape = {
	ROUTER: {
		users: {
			ROUTER: {
				register: {
					CONTRACT: true,
				},
				$userId: {
					CONTRACT: true,
				},
			},
		},
		health: {
			CONTRACT: true,
		},
		transforms: {
			CONTRACT: true,
		},
	},
} as const satisfies RouterShape;

const userSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	email: z.string().email(),
});

const routes = createRoutes(shape, {
	ROUTER: {
		users: {
			ROUTER: {
				register: {
					CONTRACT: {
						post: {
							body: {
								contentType: "application/json",
								schema: z.object({
									name: z.string(),
									email: z.email(),
								}),
							},
							responses: {
								201: {
									contentType: "application/json",
									schema: userSchema,
								},
							},
						},
					},
				},
				$userId: {
					CONTRACT: {
						get: {
							pathParams: z.object({ userId: z.string().uuid() }),
							responses: {
								200: {
									contentType: "application/json",
									schema: userSchema,
								},
								404: {
									contentType: "application/json",
									schema: z.object({ message: z.string() }),
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
							schema: z.object({ status: z.literal("ok") }),
						},
					},
				},
			},
		},
		transforms: {
			CONTRACT: {
				post: {
					body: {
						contentType: "application/json",
						schema: z
							.object({ name: z.string() })
							.transform(async (input) => ({ name: input.name.trim() }))
							.transform((input) => ({ normalized: input.name.toUpperCase() })),
					},
					responses: {
						200: {
							contentType: "application/json",
							schema: z
								.object({ message: z.string() })
								.transform(async (body) => ({ message: `${body.message}!`, id: crypto.randomUUID() })),
						},
					},
				},
			},
		},
	},
});

const middleware = createMiddleware(routes, {
	MIDDLEWARE: {
		rateLimit: {
			429: {
				contentType: "application/json",
				schema: z.object({ retryAfterSeconds: z.number().int().positive() }),
			},
		},
	},
});

const app = new Hono();

initHono(
	app,
	routes,
	{
		ROUTER: {
			users: {
				ROUTER: {
					register: {
						HANDLER: {
							post: async (input, _ctx: Context, _auth: string | undefined) => {
								return {
									status: 201 as const,
									contentType: "application/json" as const,
									body: {
										id: crypto.randomUUID(),
										name: input.body.name,
										email: input.body.email,
									},
								};
							},
						},
					},
					$userId: {
						HANDLER: {
							get: async (input) => {
								if (input.pathParams.userId.endsWith("0")) {
									return {
										status: 404 as const,
										contentType: "application/json" as const,
										body: { message: "User not found" },
									};
								}

								return {
									status: 200 as const,
									contentType: "application/json" as const,
									body: {
										id: input.pathParams.userId,
										name: "Example User",
										email: "user@example.com",
									},
								};
							},
						},
					},
				},
			},
			health: {
				HANDLER: {
					get: async () => ({
						status: 200 as const,
						contentType: "application/json" as const,
						body: { status: "ok" as const },
					}),
				},
			},
			transforms: {
				HANDLER: {
					post: async (input) => ({
						status: 200 as const,
						contentType: "application/json" as const,
						body: { message: input.body.normalized },
					}),
				},
			},
		},
	},
	middleware,
	{
		MIDDLEWARE: {
			rateLimit: async (_ctx, _auth, next) => {
				await next();
			},
		},
	},
	{
		errorMode: "public",
		transformContextParams: async (params: [Context]) => {
			return [...params, params[0].req.header("Authorization") ?? "no-auth"] as const;
		},
	},
);

Bun.serve({
	fetch: app.fetch,
	port: 3000,
});

const client = createClient(routes, {
	baseUrl: "http://localhost:3000",
	middleware: [middleware],
	serverErrorMode: "public",
});

const gateway = generateHonoGatewayRoutesAndMiddleware({
	usersService: {
		routes,
		middleware,
	},
});

const gatewayMiddleware = createMiddleware(gateway.routes, {
	MIDDLEWARE: {
		// This would be if your middleware should have no responses possible
		requestLogging: {},
	},
});

const gatewayApp = new Hono();

initHonoGateway(gatewayApp, gateway.routes, {
	services: {
		usersService: "http://localhost:3000",
	},
	middleware: gatewayMiddleware,
	middlewareHandlers: {
		MIDDLEWARE: {
			requestLogging: async (_ctx, next) => {
				console.log("Request logging");
				await next();
			},
		},
	},
	errorMode: "public",
});

Bun.serve({
	fetch: gatewayApp.fetch,
	port: 4000,
});

const gatewayClient = createClient(gateway.routes, {
	baseUrl: "http://localhost:4000",
	middleware: [gateway.middleware, gatewayMiddleware],
	serverErrorMode: "public",
});

(async () => {
	const serviceRegister = await client.users.register.post({
		body: {
			name: "Ada Lovelace",
			email: "ada@example.com",
		},
	});

	if (serviceRegister.status === 201) {
		console.log("Service created user:", serviceRegister.body.id);
	}

	const gatewayHealth = await gatewayClient.usersService.health.get();
	if (gatewayHealth.status === 200) {
		console.log("Gateway health:", gatewayHealth.body.status);
	}

	const transformed = await client.transforms.post({ body: { name: "  ada  " } });
	if (transformed.status === 200) {
		console.log("Transformed response:", transformed.body.message);
	}

	const gatewayUser = await gatewayClient.usersService.users.$userId.get({
		pathParams: {
			userId: crypto.randomUUID(),
		},
	});
	if (gatewayUser.status === 200) {
		console.log("Gateway fetched user email:", gatewayUser.body.email);
	}

	if (gatewayUser.status === 404) {
		console.log(gatewayUser.body.message);
	}
})();
