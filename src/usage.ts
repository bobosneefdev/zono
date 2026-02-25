// NOT A MODULE, JUST A SANDBOX FOR TESTING AS I DEVELOP

import { Context, Hono } from "hono";
import z from "zod";
import { createClient } from "./client/index.js";
import { initHono } from "./hono/index.js";
import { ServerHandlerGivenMethod } from "./lib/server.types.js";
import { createRouter } from "./router/index.js";

// CONTRACT/SCHEMA
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

const router = createRouter(
	{
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
	},
	{
		users: {
			register: {
				CONTRACT: {
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
				},
			},
			$userId: {
				CONTRACT: {
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
				},
				ROUTER: {
					posts: {
						CONTRACT: {
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
						},
						ROUTER: {
							$postId: {
								CONTRACT: {
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
								},
							},
						},
					},
					comments: {
						CONTRACT: {
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
						},
						ROUTER: {
							$commentId: {
								CONTRACT: {
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
								},
							},
						},
					},
				},
			},
		},
	},
);

// SERVER
type MyHonoContext = [Context];

const handleGet_users_register: ServerHandlerGivenMethod<
	typeof router.users.register.CONTRACT,
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

const handleGet_users_$userId: ServerHandlerGivenMethod<
	typeof router.users.$userId.CONTRACT,
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

const handleGet_users_$userId_posts: ServerHandlerGivenMethod<
	typeof router.users.$userId.ROUTER.posts.CONTRACT,
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

const handleGet_users_$userId_posts_$postId: ServerHandlerGivenMethod<
	typeof router.users.$userId.ROUTER.posts.ROUTER.$postId.CONTRACT,
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

const handleGet_users_$userId_comments: ServerHandlerGivenMethod<
	typeof router.users.$userId.ROUTER.comments.CONTRACT,
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

const handleGet_users_$userId_comments_$commentId: ServerHandlerGivenMethod<
	typeof router.users.$userId.ROUTER.comments.ROUTER.$commentId.CONTRACT,
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

const app = new Hono();

initHono(
	app,
	router,
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
	},
);

Bun.serve({
	fetch: app.fetch,
	port: 3000,
});

// CLIENT
const client = createClient(router, {
	baseUrl: "http://localhost:3000",
	defaultHeaders: {
		"static-header": "static-value",
		"dynamic-header": () => "dynamic-value",
		"async-header": async () => "async-value",
	},
});

(async () => {
	const response = await client.get("/users/register", {
		query: {
			first: "John",
			last: "Porkchop",
			email: "john@porkmail.com",
			age: 13,
		},
	});
	console.log(response);
})();
