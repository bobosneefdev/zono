import { Hono } from "hono";
import z from "zod";
import { createClient } from "~/client/client.js";
import { createContracts } from "~/contract/contract.js";
import type { RouterShape } from "~/contract/contract.types.js";
import {
	createHonoContractHandlers,
	createHonoMiddlewareHandlers,
	createHonoOptions,
	initHono,
} from "~/hono/hono.js";
import {
	createGatewayOptions,
	createHonoGatewayService,
	generateHonoGateway,
	initHonoGateway,
} from "~/hono_gateway/hono_gateway.js";
import { createMiddlewares } from "~/middleware/middleware.js";

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
	id: z.uuid(),
	name: z.string(),
	email: z.email(),
});

const honoOptions = createHonoOptions({
	errorMode: "public",
	additionalHandlerParams: async (ctx) => {
		return [ctx.req.header("Authorization") ?? "no-auth"] as const;
	},
});

const contracts = createContracts(shape, {
	ROUTER: {
		users: {
			ROUTER: {
				register: {
					CONTRACT: {
						post: {
							body: {
								type: "JSON",
								schema: z.object({
									name: z.string(),
									email: z.email(),
								}),
							},
							responses: {
								201: {
									type: "JSON",
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
									type: "JSON",
									schema: userSchema,
								},
								404: {
									type: "JSON",
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
							type: "JSON",
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
						type: "JSON",
						schema: z
							.object({ name: z.string() })
							.transform(async (input) => ({ name: input.name.trim() }))
							.transform((input) => ({ normalized: input.name.toUpperCase() })),
					},
					responses: {
						200: {
							type: "JSON",
							schema: z.object({ message: z.string() }).transform(async (body) => ({
								message: `${body.message}!`,
								id: crypto.randomUUID(),
							})),
						},
					},
				},
			},
		},
	},
});

const honoContractHandlers = createHonoContractHandlers(contracts, honoOptions, {
	ROUTER: {
		users: {
			ROUTER: {
				register: {
					HANDLER: {
						post: async (input, _ctx, _auth) => ({
							type: "JSON" as const,
							status: 201 as const,
							data: {
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
									type: "JSON" as const,
									status: 404 as const,
									data: { message: "User not found" },
								};
							}
							return {
								type: "JSON" as const,
								status: 200 as const,
								data: {
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
					type: "JSON" as const,
					status: 200 as const,
					data: { status: "ok" as const },
				}),
			},
		},
		transforms: {
			HANDLER: {
				post: async (input) => ({
					type: "JSON" as const,
					status: 200 as const,
					data: { message: input.body.normalized },
				}),
			},
		},
	},
});

const middlewares = createMiddlewares(contracts, {
	MIDDLEWARE: {
		rateLimit: {
			429: {
				type: "JSON",
				schema: z.object({ retryAfterSeconds: z.number().int().positive() }),
			},
		},
	},
});

const honoMiddlewareHandlers = createHonoMiddlewareHandlers(middlewares, honoOptions, {
	MIDDLEWARE: {
		rateLimit: async () => ({
			type: "JSON" as const,
			status: 429 as const,
			data: { retryAfterSeconds: 60 },
		}),
	},
});

const app = new Hono();

initHono(app, contracts, honoContractHandlers, middlewares, honoMiddlewareHandlers, honoOptions);

Bun.serve({ fetch: app.fetch, port: 3000 });

const gateway = generateHonoGateway({
	usersService: createHonoGatewayService(contracts, middlewares, {
		users: true,
		health: true,
		transforms: true,
	}),
});

const gatewayRoutes = gateway.contracts;

const gatewayMiddlewares = gateway.middlewares;

const gatewayOptions = createGatewayOptions(gatewayRoutes, {
	services: {
		usersService: "http://localhost:3000",
	},
});

const customGatewayMiddlewares = createMiddlewares(gatewayRoutes, {
	MIDDLEWARE: {
		requestLogging: {},
	},
});

const customGatewayMiddlewareHandlers = createHonoMiddlewareHandlers(
	customGatewayMiddlewares,
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
	customGatewayMiddlewares,
	customGatewayMiddlewareHandlers,
	gatewayOptions,
);

Bun.serve({
	fetch: gatewayApp.fetch,
	port: 4000,
});

const client = createClient(gatewayRoutes, {
	baseUrl: "http://localhost:4000",
	middleware: [customGatewayMiddlewares, gatewayMiddlewares],
	serverErrorMode: "public",
});

(async () => {
	const serviceRegister = await client.usersService.users.register("post", {
		body: {
			name: "Ada Lovelace",
			email: "ada@example.com",
		},
	});

	if (serviceRegister.status === 201) {
		console.log("Service created user:", serviceRegister.body.id);
	}

	const gatewayHealth = await client.usersService.health("get");
	if (gatewayHealth.status === 200) {
		console.log("Gateway health:", gatewayHealth.body.status);
	}

	const transformed = await client.usersService.transforms("post", { body: { name: "  ada  " } });
	if (transformed.status === 200) {
		console.log("Transformed response:", transformed.body.message);
	}

	const gatewayUser = await client.usersService.users.$userId("get", {
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

	process.exit(0);
})();
