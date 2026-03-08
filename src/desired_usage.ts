import { Hono } from "hono";
import z from "zod";
import { createClient } from "./client/client.js";
import { Contracts } from "./contract/contract.types.js";
import {
	createGatewayClient,
	createGatewayService,
	createGatewayServices,
	initGateway,
} from "./gateway/gateway.js";
import { GatewayServiceShape } from "./gateway/gateway.types.js";
import { Middlewares } from "./middleware/middleware.types.js";
import {
	createHonoContractHandlers,
	createHonoMiddlewareHandlers,
	initHono,
} from "./server/server.js";
import { ServerContextCreator } from "./server/server.types.js";
import { Shape } from "./shared/shared.types.js";

// DEMO SCHEMAS
const zUser = z.object({
	id: z.uuid(),
	first: z.string(),
	last: z.string(),
	email: z.email(),
	createdAt: z.date(),
});

const usersServiceShape = {
	SHAPE: {
		users: {
			CONTRACT: true,
			SHAPE: {
				$userId: { CONTRACT: true },
			},
		},
	},
} as const satisfies Shape;
type UsersServiceShape = typeof usersServiceShape;

const usersServiceContracts = {
	SHAPE: {
		users: {
			CONTRACT: {
				get: {
					responses: {
						200: {
							type: "SuperJSON",
							body: z.array(zUser),
						},
					},
				},
			},
			SHAPE: {
				$userId: {
					CONTRACT: {
						get: {
							pathParams: z.object({ userId: z.uuid() }),
							responses: {
								200: {
									type: "SuperJSON",
									body: zUser.nullable(),
								},
							},
						},
					},
				},
			},
		},
	},
} as const satisfies Contracts<UsersServiceShape>;
type UsersServiceContracts = typeof usersServiceContracts;

const usersServiceMiddlewares = {
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
} as const satisfies Middlewares<UsersServiceShape>;
type UsersServiceMiddlewares = typeof usersServiceMiddlewares;

const createUsersServiceContext = (async (_ctx) => {
	// Get session header
	// Validate JWT, parse user
	const user = {
		platformId: crypto.randomUUID(),
		username: "JohnPorkRox123",
	};
	return user;
}) satisfies ServerContextCreator;
type UsersServiceContext = Awaited<ReturnType<typeof createUsersServiceContext>>;

const usersServiceContractHandlers = createHonoContractHandlers<
	UsersServiceContracts,
	UsersServiceContext
>(usersServiceContracts, {
	SHAPE: {
		users: {
			HANDLER: {
				get: async () => ({
					status: 200,
					type: "SuperJSON",
					data: [
						{
							id: crypto.randomUUID(),
							first: "John",
							last: "Pork",
							email: "johnpork@gmail.com",
							createdAt: new Date(),
						},
					],
				}),
			},
			SHAPE: {
				$userId: {
					HANDLER: {
						get: async (data, _ctx, _ourContext) => ({
							type: "SuperJSON",
							status: 200,
							data: {
								id: data.pathParams.userId,
								createdAt: new Date(),
								email: "johnpork@gmail.com",
								first: "John",
								last: "Pork",
							},
						}),
					},
				},
			},
		},
	},
});

const usersServiceMiddlewareHandlers = createHonoMiddlewareHandlers<
	UsersServiceMiddlewares,
	UsersServiceContext
>(usersServiceMiddlewares, {
	MIDDLEWARE: {
		rateLimit: async (_ctx, next, _ourContext) => {
			const rand = Math.random();
			if (rand < 0.5) {
				return {
					type: "JSON",
					status: 429,
					data: {
						retryAfter: Date.now() + 1000,
					},
				};
			}
			await next();
		},
	},
});

const usersServiceApp = new Hono();
initHono<UsersServiceShape, UsersServiceContext>(usersServiceApp, {
	contracts: usersServiceContractHandlers,
	middlewares: usersServiceMiddlewareHandlers,
	createContext: createUsersServiceContext,
	errorMode: "public",
});
Bun.serve({ fetch: usersServiceApp.fetch, port: 3000 });

const usersServiceClient = createClient<
	UsersServiceShape,
	UsersServiceContracts,
	UsersServiceMiddlewares,
	"public"
>("http://localhost:3000");

(async () => {
	const users = await usersServiceClient.fetch("/users/$userId", "get", {
		pathParams: { userId: crypto.randomUUID() },
	});
	console.log(users);
})();

// GatewayServiceShape is pretty much like a "Pick" util for the shape of the existing service shape.
const usersGatewayServiceShape = {
	SHAPE: {
		users: {
			CONTRACT: true,
			SHAPE: {}, // empty object should be ignored obviously
		},
	},
} as const satisfies GatewayServiceShape<UsersServiceShape>;

const usersGatewayService = createGatewayService(
	usersGatewayServiceShape,
	usersServiceContracts,
	usersServiceMiddlewares,
	"public",
	"http://localhost:3000",
);

const gatewayServices = createGatewayServices({
	users: usersGatewayService,
});

const gatewayApp = new Hono();
initGateway(gatewayApp, gatewayServices);
Bun.serve({ fetch: gatewayApp.fetch, port: 3001 });

// Note that client no longer gets real run-time schemas, etc. This is to protect leakage of full API details to the client.
const gatewayClient = createGatewayClient<typeof gatewayServices>("http://localhost:3001");

(async () => {
	const users = await gatewayClient.users.fetch("/users", "get");
	console.log(users);
})();
