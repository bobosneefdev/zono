import { createClient } from "@bobosneefdev/zono/client";
import {
	createRouter,
	RouterShape,
	RouterShapeContractGivenPath,
} from "@bobosneefdev/zono/contract";
import { initHono } from "@bobosneefdev/zono/hono";
import { ServerHandlerGivenMethod } from "@bobosneefdev/zono/server";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import z from "zod";
import {
	createGatewayRouter,
	createGatewayRouterService,
	initHonoGateway,
} from "~/hono_gateway/index.js";

// NOT A MODULE, JUST A SANDBOX FOR TESTING/EXAMPLES THROUGHOUT DEVELOPMENT

const zId = z.uuid();

const zTimestamp = z.number().int();

const zUserBase = z.object({
	first: z.string(),
	last: z.string(),
	email: z.email(),
	age: z.number().int().min(13),
});

const zUser = zUserBase.extend({
	id: zId,
	createdAt: zTimestamp,
});

const zComment = z.object({
	id: zId,
	createdAt: zTimestamp,
	updatedAt: zTimestamp,
	authorId: zId,
	postId: zId,
	content: z.string(),
});

const zPost = z.object({
	id: zId,
	createdAt: zTimestamp,
	updatedAt: z.number().int(),
	authorId: zId,
	title: z.string(),
	description: z.string(),
});

// ./social/contract.ts
const socialShape = {
	users: {
		TYPE: "router",
		ROUTER: {
			register: {
				TYPE: "contract",
			},
			$userId: {
				TYPE: "contract",
				ROUTER: {
					posts: {
						TYPE: "contract",
						ROUTER: {
							$postId: {
								TYPE: "contract",
							},
						},
					},
					comments: {
						TYPE: "contract",
						ROUTER: {
							$commentId: {
								TYPE: "contract",
							},
						},
					},
				},
			},
		},
	},
} satisfies RouterShape;

type ExampleShape = typeof socialShape;

// ./social/users/register/contract.ts
const usersRegisterContract = {
	get: {
		query: {
			type: "json",
			schema: zUserBase,
		},
		responses: {
			201: {
				contentType: "application/json",
				schema: zUser,
			},
		},
	},
} satisfies RouterShapeContractGivenPath<ExampleShape, "users.register">;

// ./social/users/$userId/contract.ts
const usersUserIdContract = {
	get: {
		pathParams: z.object({
			userId: zId,
		}),
		responses: {
			200: {
				contentType: "application/json",
				schema: zUser,
			},
		},
	},
} satisfies RouterShapeContractGivenPath<ExampleShape, "users.$userId">;

// ./social/users/$userId/posts/contract.ts
const usersUserIdPostsContract = {
	get: {
		pathParams: z.object({
			userId: zId,
		}),
		responses: {
			200: {
				contentType: "application/json",
				schema: z.array(zPost),
			},
		},
	},
} satisfies RouterShapeContractGivenPath<ExampleShape, "users.$userId.posts">;

// ./social/users/$userId/posts/$postId/contract.ts
const usersUserIdPostsPostIdContract = {
	get: {
		pathParams: z.object({
			userId: zId,
			postId: zId,
		}),
		responses: {
			200: {
				contentType: "application/json",
				schema: zPost,
			},
		},
	},
} satisfies RouterShapeContractGivenPath<ExampleShape, "users.$userId.posts.$postId">;

// ./social/users/$userId/comments/contract.ts
const usersUserIdCommentsContract = {
	get: {
		pathParams: z.object({
			userId: zId,
		}),
		responses: {
			200: {
				contentType: "application/json",
				schema: z.array(zComment),
			},
		},
	},
} satisfies RouterShapeContractGivenPath<ExampleShape, "users.$userId.comments">;

// ./social/users/$userId/comments/$commentId/contract.ts
const usersUserIdCommentsCommentIdContract = {
	get: {
		pathParams: z.object({
			userId: zId,
			commentId: zId,
		}),
		responses: {
			200: {
				contentType: "application/json",
				schema: zComment,
			},
		},
	},
} satisfies RouterShapeContractGivenPath<ExampleShape, "users.$userId.comments.$commentId">;

// ./social/contract.ts
const socialRouter = createRouter(socialShape, {
	users: {
		register: {
			CONTRACT: usersRegisterContract,
		},
		$userId: {
			CONTRACT: usersUserIdContract,
			ROUTER: {
				posts: {
					CONTRACT: usersUserIdPostsContract,
					ROUTER: {
						$postId: {
							CONTRACT: usersUserIdPostsPostIdContract,
						},
					},
				},
				comments: {
					CONTRACT: usersUserIdCommentsContract,
					ROUTER: {
						$commentId: {
							CONTRACT: usersUserIdCommentsCommentIdContract,
						},
					},
				},
			},
		},
	},
});

// ./social/server.ts
type MyHonoContext = [Context];

// ./social/users/register/handler.ts
const handleGet_users_register: ServerHandlerGivenMethod<
	typeof socialRouter.users.register.CONTRACT,
	MyHonoContext,
	"get"
> = async (data, _c) => {
	return {
		status: 201,
		data: {
			...data.query,
			id: crypto.randomUUID(),
			createdAt: Date.now(),
		},
	};
};

// ./social/users/$userId/handler.ts
const handleGet_users_$userId: ServerHandlerGivenMethod<
	typeof socialRouter.users.$userId.CONTRACT,
	MyHonoContext,
	"get"
> = async (data, _c) => {
	return {
		status: 200,
		data: {
			id: data.pathParams.userId,
			first: "John",
			last: "Porkchop",
			email: "john@porkmail.com",
			age: 13,
			createdAt: Date.now(),
		},
	};
};

// ./social/users/$userId/posts/handler.ts
const handleGet_users_$userId_posts: ServerHandlerGivenMethod<
	typeof socialRouter.users.$userId.ROUTER.posts.CONTRACT,
	MyHonoContext,
	"get"
> = async (data, _c) => {
	return {
		status: 200,
		data: [
			{
				id: crypto.randomUUID(),
				createdAt: Date.now(),
				updatedAt: Date.now(),
				authorId: data.pathParams.userId,
				title: "Post Title",
				description: "Post Description",
			},
		],
	};
};

// ./social/users/$userId/posts/$postId/handler.ts
const handleGet_users_$userId_posts_$postId: ServerHandlerGivenMethod<
	typeof socialRouter.users.$userId.ROUTER.posts.ROUTER.$postId.CONTRACT,
	MyHonoContext,
	"get"
> = async (data, _c) => {
	return {
		status: 200,
		data: {
			id: data.pathParams.postId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			authorId: data.pathParams.userId,
			title: "Post Title",
			description: "Post Description",
		},
	};
};

// ./social/users/$userId/comments/handler.ts
const handleGet_users_$userId_comments: ServerHandlerGivenMethod<
	typeof socialRouter.users.$userId.ROUTER.comments.CONTRACT,
	MyHonoContext,
	"get"
> = async (data, _c) => {
	return {
		status: 200,
		data: [
			{
				id: crypto.randomUUID(),
				createdAt: Date.now(),
				updatedAt: Date.now(),
				authorId: data.pathParams.userId,
				postId: crypto.randomUUID(),
				content: "Comment Content",
			},
		],
	};
};

// ./social/users/$userId/comments/$commentId/handler.ts
const handleGet_users_$userId_comments_$commentId: ServerHandlerGivenMethod<
	typeof socialRouter.users.$userId.ROUTER.comments.ROUTER.$commentId.CONTRACT,
	MyHonoContext,
	"get"
> = async (data, _c) => {
	return {
		status: 200,
		data: {
			id: data.pathParams.commentId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			authorId: data.pathParams.userId,
			postId: crypto.randomUUID(),
			content: "Comment Content",
		},
	};
};

// ./social/server.ts
const socialApp = new Hono();

initHono(
	socialApp,
	socialRouter,
	{
		users: {
			register: {
				MIDDLEWARE: [
					async (_c, next) => {
						// We could for example put a fingerprint middleware here to prevent abuse
						await next();
					},
				],
				HANDLER: {
					get: handleGet_users_register,
				},
			},
			$userId: {
				HANDLER: {
					get: handleGet_users_$userId,
				},
				ROUTER: {
					posts: {
						HANDLER: { get: handleGet_users_$userId_posts },
						ROUTER: {
							$postId: {
								HANDLER: { get: handleGet_users_$userId_posts_$postId },
							},
						},
					},
					comments: {
						HANDLER: { get: handleGet_users_$userId_comments },
						ROUTER: {
							$commentId: {
								HANDLER: { get: handleGet_users_$userId_comments_$commentId },
							},
						},
					},
				},
			},
		},
	},
	{
		globalMiddleware: [
			async (_c, next) => {
				// We could for example put a CORS middleware here to allow cross-origin requests
				// Or a rate limiting middleware to prevent abuse
				console.log("global middleware");
				await next();
			},
		],
		errorMode: "public",
	},
);

Bun.serve({
	fetch: socialApp.fetch,
	port: 3000,
});

// ./social/client.ts
const socialClient = createClient(socialRouter, {
	baseUrl: "http://localhost:3000",
	defaultHeaders: {
		"static-header": "static-value",
		"dynamic-header": () => "dynamic-value",
		"async-header": async () => "async-value",
	},
	serverErrorMode: "public",
});

(async () => {
	const response = await socialClient.get("/users/register", {
		query: {
			first: "John",
			last: "Porkchop",
			email: "john@porkmail.com",
			age: 13,
		},
	});
	if (response.status === 400) {
		console.log(JSON.stringify(response.body, null, 2));
	} else {
		console.log(`Social: ${response.status}`);
	}
})();

// HONO GATEWAY EXAMPLE

// ./gateway/index.ts

const gatewayRouter = createGatewayRouter({
	social: createGatewayRouterService(socialRouter, {
		// The only inaccessible path would be /users/$userId/comments/$commentId
		includeOnlyShape: {
			users: {
				register: true,
				$userId: {
					posts: {
						$postId: true,
					},
					comments: true,
				},
			},
		},
	}),
});

const gatewayApp = new Hono();

initHonoGateway(gatewayApp, gatewayRouter, {
	services: {
		social: {
			baseUrl: "http://localhost:3000",
			middleware: {
				"*": [
					async (_c, next) => {
						console.log("social service middleware");
						await next();
					},
				],
				"/users/register": [
					(async (_c, next) => {
						console.log("rate limit on register");
						await next();
					}) satisfies MiddlewareHandler,
				],
			},
		},
	},
	basePath: "/v1",
	globalMiddleware: [
		async (c, next) => {
			const authorization = c.req.header("Authorization");
			if (!authorization) {
				return c.json({ error: "Unauthorized" }, 401);
			}
			const token = authorization.split(" ")[1];
			if (!token) {
				return c.json({ error: "Unauthorized" }, 401);
			}
			console.log("Auth token found in request:", token);
			await next();
		},
	],
});

Bun.serve({
	fetch: gatewayApp.fetch,
	port: 3001,
});

// ./gateway/client.ts
const gatewayClient = createClient(gatewayRouter, {
	baseUrl: "http://localhost:3001/v1",
	defaultHeaders: {
		Authorization: () => `Bearer ${crypto.randomUUID()}`,
	},
	additionalResponses: {
		401: {
			contentType: "application/json",
			schema: z.object({ error: z.string() }),
		},
	},
});

(async () => {
	const response = await gatewayClient.get("/social/users/$userId/comments", {
		pathParams: {
			userId: crypto.randomUUID(),
		},
	});
	console.log(`Gateway: ${response.status}`);
})();
