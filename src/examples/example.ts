import { Hono } from "hono";
import z from "zod";
import { createClient } from "~/client/client.js";
import { createRoutes } from "~/contract/routes.js";
import type { RouterShape } from "~/contract/shape.types.js";
import { createHonoMiddlewareHandlers, createHonoRouteHandlers, initHono } from "~/hono/hono.js";
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

initHono(app, routes, {
	routeHandlers: createHonoRouteHandlers(routes, {
		ROUTER: {
			users: {
				ROUTER: {
					register: {
						HANDLER: {
							post: async (input) => ({
								status: 201,
								contentType: "application/json",
								body: {
									id: crypto.randomUUID(),
									name: input.body.name,
									email: input.body.email,
								},
							}),
						},
					},
					$userId: {
						HANDLER: {
							get: async (input) => {
								if (input.pathParams.userId.endsWith("0")) {
									return {
										status: 404,
										contentType: "application/json",
										body: { message: "User not found" },
									};
								}

								return {
									status: 200,
									contentType: "application/json",
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
						status: 200,
						contentType: "application/json",
						body: { status: "ok" },
					}),
				},
			},
		},
	}),
	middleware,
	middlewareHandlers: createHonoMiddlewareHandlers(middleware, {
		MIDDLEWARE: {
			rateLimit: async (_ctx, next) => {
				await next();
			},
		},
	}),
	errorMode: "public",
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
		requestLogging: {},
	},
});

const gatewayApp = new Hono();

initHonoGateway(gatewayApp, gateway.routes, {
	services: {
		usersService: "http://localhost:3000",
	},
	middleware: gatewayMiddleware,
	middlewareHandlers: createHonoMiddlewareHandlers(gatewayMiddleware, {
		MIDDLEWARE: {
			requestLogging: async (_ctx, next) => {
				await next();
			},
		},
	}),
	errorMode: "public",
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

	const gatewayUser = await gatewayClient.usersService.users.$userId.get({
		pathParams: {
			userId: "550e8400-e29b-41d4-a716-446655440000",
		},
	});

	if (gatewayUser.status === 200) {
		console.log("Gateway fetched user email:", gatewayUser.body.email);
	}

	if (gatewayUser.status === 404) {
		console.log(gatewayUser.body.message);
	}
})();