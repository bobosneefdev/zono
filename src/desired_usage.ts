import { Hono } from "hono";
import z from "zod";
import { createClient } from "./client/client.js";
import { ContractTreeFor } from "./contract/contract.js";
import {
	createGatewayClient,
	createGatewayService,
	createGatewayServices,
	GatewayMiddlewares,
	GatewayServiceMask,
	initGateway,
} from "./gateway/gateway.js";
import { MiddlewareTreeFor } from "./middleware/middleware.js";
import {
	ContextFactory,
	ContractHandler,
	createHonoContractHandlers,
	createHonoMiddlewareHandlers,
	initHono,
	MiddlewareHandler,
} from "./server/server.js";
import { ApiShape } from "./shared/shared.js";

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
} as const satisfies ApiShape;
type UsersServiceShape = typeof usersServiceShape;

const usersServiceContracts = {
	SHAPE: {
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
				$userId: {
					CONTRACT: {
						get: {
							query: {
								type: "SuperJSON",
								schema: z.object({ active: z.boolean() }),
							},
							pathParams: z.object({ userId: z.uuid() }),
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
	},
} as const satisfies ContractTreeFor<UsersServiceShape>;
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
} as const satisfies MiddlewareTreeFor<UsersServiceShape>;
type UsersServiceMiddlewares = typeof usersServiceMiddlewares;

const createUsersServiceContext = (async (_ctx) => {
	// Get session header
	// Validate JWT, parse user
	const user = {
		platformId: crypto.randomUUID(),
		username: "JohnPorkRox123",
	};
	return user;
}) satisfies ContextFactory;
type UsersServiceContext = Awaited<ReturnType<typeof createUsersServiceContext>>;

type UsersServiceUsersContract = typeof usersServiceContracts.SHAPE.users.CONTRACT;
const getUsers: ContractHandler<
	UsersServiceUsersContract["get"],
	UsersServiceContext
> = async () => ({
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
});

const usersServiceContractHandlers = createHonoContractHandlers<
	UsersServiceContracts,
	UsersServiceContext
>(usersServiceContracts, {
	SHAPE: {
		users: {
			HANDLER: {
				get: getUsers,
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
initHono<UsersServiceShape, UsersServiceContext, UsersServiceMiddlewares>(usersServiceApp, {
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
>("http://localhost:3000", {
	preRequest: (
		url: string,
		init: RequestInit,
	): [string, RequestInit] | Promise<[string, RequestInit]> => {
		// do some magic idk
		return [url, init];
	},
	postRequest: (response: Response): Response | Promise<Response> => {
		// do some magic idk
		return response;
	},
});

(async () => {
	const users = await usersServiceClient.fetch("/users/$userId", "get", {
		pathParams: { userId: crypto.randomUUID() },
		query: { type: "SuperJSON", data: { active: true } },
	});
	console.log(users.response.status, users.data);
})();

// GatewayServiceMask is pretty much like a "Pick" util for the shape of the existing service shape.
const usersGatewayServiceMask = {
	SHAPE: {
		users: {
			CONTRACT: true,
		},
	},
} as const satisfies GatewayServiceMask<UsersServiceShape>;

const usersGatewayService = createGatewayService(
	usersGatewayServiceMask,
	usersServiceContracts,
	usersServiceMiddlewares,
	"public",
	"http://localhost:3000",
);

const gatewayServices = createGatewayServices({
	users: usersGatewayService,
});
type GatewayServices = typeof gatewayServices;

const gatewayMiddlewares = {
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
			// This would represent the users service
			SHAPE: {
				users: {
					// This would represent the users endpoint on the users service
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
} as const satisfies GatewayMiddlewares<GatewayServices>;

type GatewayAuthMiddleware = typeof gatewayMiddlewares.MIDDLEWARE.gatewayAuth;
const gatewayAuthMiddlewareHandler: MiddlewareHandler<GatewayAuthMiddleware> = async (
	_ctx,
	next,
) => {
	const isAuthed = Math.random() > 0.5;
	if (!isAuthed) {
		return {
			type: "JSON",
			status: 401,
			data: { message: "Unauthorized" },
		};
	}
	await next();
};

const gatewayApp = new Hono();
initGateway(gatewayApp, gatewayServices, {
	middlewares: createHonoMiddlewareHandlers(gatewayMiddlewares, {
		MIDDLEWARE: {
			gatewayAuth: gatewayAuthMiddlewareHandler,
		},
		SHAPE: {
			users: {
				SHAPE: {
					users: {
						MIDDLEWARE: {
							auth: () => ({
								type: "JSON",
								status: 403,
								data: { message: "Unauthorized" },
							}),
						},
					},
				},
			},
		},
	}),
	// createContext should be another option here
});
Bun.serve({ fetch: gatewayApp.fetch, port: 3001 });

// Note that client no longer gets real run-time schemas, etc. This is to protect leakage of full API details to the client.
const gatewayClient = createGatewayClient<GatewayServices, typeof gatewayMiddlewares>(
	"http://localhost:3001",
);

(async () => {
	const users = await gatewayClient.users.fetch("/users", "get");
	console.log(users.response.status, users.data);
})();
