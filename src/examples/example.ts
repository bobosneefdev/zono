import { Hono } from "hono";
import z from "zod";
import { createClient } from "~/client/client.js";
import type { RouterShape } from "~/contract/contract.types.js";
import { createRoutes } from "~/contract/routes.js";
import {
	createHonoMiddlewareHandlers,
	createHonoOptions,
	createHonoRouteHandlers,
	initHono,
} from "~/hono/hono.js";
import {
	createGatewayOptions,
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
		imageUpload: {
			CONTRACT: true,
		},
	},
} as const satisfies RouterShape;

const userSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	email: z.email(),
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
							schema: z.object({ message: z.string() }).transform(async (body) => ({
								message: `${body.message}!`,
								id: crypto.randomUUID(),
							})),
						},
					},
				},
			},
		},
		imageUpload: {
			CONTRACT: {
				post: {
					body: {
						contentType: "application/octet-stream",
						schema: z.instanceof(Uint8Array),
					},
					responses: {
						201: {
							contentType: "application/octet-stream",
							schema: z.instanceof(Uint8Array),
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

const honoOptions = createHonoOptions({
	errorMode: "public",
	additionalHandlerParams: async (ctx) => {
		return [ctx.req.header("Authorization") ?? "no-auth"] as const;
	},
});

const honoRouteHandlers = createHonoRouteHandlers(routes, honoOptions, {
	ROUTER: {
		users: {
			ROUTER: {
				register: {
					HANDLER: {
						post: async (input, ctx, _auth) =>
							ctx.json(
								{
									id: crypto.randomUUID(),
									name: input.body.name,
									email: input.body.email,
								},
								201,
							),
					},
				},
				$userId: {
					HANDLER: {
						get: async (input, ctx) => {
							if (input.pathParams.userId.endsWith("0")) {
								return ctx.json({ message: "User not found" }, 404);
							}

							return ctx.json(
								{
									id: input.pathParams.userId,
									name: "Example User",
									email: "user@example.com",
								},
								200,
							);
						},
					},
				},
			},
		},
		health: {
			HANDLER: {
				get: async (_input, ctx) => ctx.json({ status: "ok" }, 200),
			},
		},
		transforms: {
			HANDLER: {
				post: async (input, ctx) => ctx.json({ message: input.body.normalized }, 200),
			},
		},
		imageUpload: {
			HANDLER: {
				post: async (input, ctx) => ctx.body(input.body, 201),
			},
		},
	},
});

const honoMiddlewareHandlers = createHonoMiddlewareHandlers(middleware, honoOptions, {
	MIDDLEWARE: {
		rateLimit: async (ctx, _next, _auth) => {
			return ctx.json({ retryAfterSeconds: 60 }, 429);
		},
	},
});

const app = new Hono();

initHono(app, routes, honoRouteHandlers, middleware, honoMiddlewareHandlers, honoOptions);

Bun.serve({
	fetch: app.fetch,
	port: 3000,
});

const client = createClient(routes, {
	baseUrl: "http://localhost:3000",
	middleware: [middleware],
	serverErrorMode: "public",
});

const { routes: gatewayRoutes, middleware: gatewayMiddleware } =
	generateHonoGatewayRoutesAndMiddleware({
		usersService: {
			routes,
			middleware,
		},
	});

const gatewayOptions = createGatewayOptions(gatewayRoutes, {
	services: {
		usersService: "http://localhost:3000",
	},
});

const gatewayCustomMiddleware = createMiddleware(gatewayRoutes, {
	MIDDLEWARE: {
		// Example of what it looks like if your middleware never returns a response
		requestLogging: {},
	},
});

const gatewayCustomMiddlewareHandlers = createHonoMiddlewareHandlers(
	gatewayCustomMiddleware,
	gatewayOptions,
	{
		MIDDLEWARE: {
			requestLogging: async (_ctx, next) => {
				console.log("Gateway request logging middleware");
				await next();
			},
		},
	},
);

const gatewayApp = new Hono();

initHonoGateway(
	gatewayApp,
	gatewayRoutes,
	gatewayCustomMiddleware,
	gatewayCustomMiddlewareHandlers,
	gatewayOptions,
);

Bun.serve({
	fetch: gatewayApp.fetch,
	port: 4000,
});

const gatewayClient = createClient(gatewayRoutes, {
	baseUrl: "http://localhost:4000",
	middleware: [gatewayMiddleware, gatewayCustomMiddleware],
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
