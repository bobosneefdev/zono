import { describe, expect, it } from "bun:test";
import { Context, Hono } from "hono";
import z from "zod";
import { createRouter } from "~/contract/index.js";
import { initHono } from "~/hono/index.js";
import type { ServerHandlerInput, ServerHandlerOutput, ServerHandlerTree } from "~/hono/types.js";

function expectType<T>(_value: T): void {}

const router = createRouter(
	{
		users: {
			type: "router",
			router: {
				$id: {
					type: "contract",
					router: {
						$postId: {
							type: "contract",
						},
					},
				},
			},
		},
	},
	{
		users: {
			$id: {
				contract: {
					method: "get",
					pathParams: z.object({
						id: z.string(),
					}),
					headers: z.object({
						"x-input-header": z.string(),
					}),
					responses: {
						200: {
							body: z.object({
								id: z.string(),
								name: z.string().transform(async (value) => value.toUpperCase()),
							}),
							headers: z.object({
								"x-custom-header": z.string(),
							}),
						},
					},
				},
				router: {
					$postId: {
						contract: {
							method: "get",
							pathParams: z.object({
								id: z.string(),
								postId: z.string(),
							}),
							responses: {
								200: {
									body: z.object({
										id: z.string(),
										title: z.string(),
									}),
								},
							},
						},
					},
				},
			},
		},
	},
);

describe("initHono", () => {
	it("provides strongly typed handler input and output", () => {
		type UsersContract = typeof router.users.$id.contract;
		type UsersInput = ServerHandlerInput<UsersContract>;
		type UsersOutput = ServerHandlerOutput<UsersContract>;

		const input: UsersInput = {
			pathParams: {
				id: "123",
			},
			headers: {
				"x-input-header": "ok",
			},
		};

		expectType<string>(input.pathParams.id);

		const output: UsersOutput = {
			status: 200,
			data: {
				id: "123",
				name: "john",
			},
			headers: {
				"x-custom-header": "hello",
			},
		};

		expectType<200>(output.status);

		const app = new Hono();
		const handlers: ServerHandlerTree<typeof router, [Context]> = {
			users: {
				$id: {
					handler: async (data, c) => {
						expectType<Context>(c);
						return {
							status: 200,
							data: {
								id: data.pathParams.id,
								name: "john",
							},
							headers: {
								"x-custom-header": "hello",
							},
						};
					},
					router: {
						$postId: {
							handler: async (data) => {
								return {
									status: 200,
									data: {
										id: data.pathParams.postId,
										title: "post",
									},
								};
							},
						},
					},
				},
			},
		};

		initHono(app, router, handlers);

		// @ts-expect-error headers are required for this response schema
		const invalidOutput: UsersOutput = {
			status: 200,
			data: {
				id: "123",
				name: "john",
			},
		};
		void invalidOutput;
	});

	it("registers nested routes and validates incoming and outgoing payloads", async () => {
		const app = new Hono();

		initHono(app, router, {
			users: {
				$id: {
					handler: async (data) => {
						return {
							status: 200,
							data: {
								id: data.pathParams.id,
								name: "john doe",
							},
							headers: {
								"x-custom-header": "Hello, world!",
							},
						};
					},
					router: {
						$postId: {
							handler: async (data) => {
								return {
									status: 200,
									data: {
										id: data.pathParams.postId,
										title: "Post Title",
									},
								};
							},
						},
					},
				},
			},
		});

		const usersResponse = await app.request("http://localhost/users/123", {
			method: "GET",
			headers: {
				"x-input-header": "ok",
			},
		});

		expect(usersResponse.status).toBe(200);
		expect(usersResponse.headers.get("x-custom-header")).toBe("Hello, world!");
		expect(await usersResponse.json()).toEqual({
			id: "123",
			name: "JOHN DOE",
		});

		const postsResponse = await app.request("http://localhost/users/123/abc", {
			method: "GET",
		});

		expect(postsResponse.status).toBe(200);
		expect(await postsResponse.json()).toEqual({
			id: "abc",
			title: "Post Title",
		});
	});

	it("supports bypassIncomingParse option", async () => {
		const bypassRouter = createRouter(
			{
				items: {
					type: "router",
					router: {
						$id: {
							type: "contract",
						},
					},
				},
			},
			{
				items: {
					$id: {
						contract: {
							method: "get",
							pathParams: z.object({
								id: z.string().regex(/^\d+$/),
							}),
							responses: {
								200: {
									body: z.object({
										id: z.string(),
									}),
								},
							},
						},
					},
				},
			},
		);

		const app = new Hono();

		initHono(
			app,
			bypassRouter,
			{
				items: {
					$id: {
						handler: async (data) => ({
							status: 200,
							data: {
								id: data.pathParams.id,
							},
						}),
					},
				},
			},
			{
				bypassIncomingParse: true,
			},
		);

		const response = await app.request("http://localhost/items/abc", {
			method: "GET",
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id: "abc" });
	});
});
