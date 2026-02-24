import { describe, expect, it } from "bun:test";
import { Context, Hono } from "hono";
import z from "zod";
import { createRouter } from "~/contract/index.js";
import { initHono } from "~/hono/index.js";
import type {
	ServerHandlerInput,
	ServerHandlerOutput,
	ServerHandlerTree,
} from "~/lib/server.types.js";

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
					get: {
						pathParams: z.object({
							id: z.string(),
						}),
						headers: z.object({
							"x-input-header": z.string(),
						}),
						responses: {
							200: {
								contentType: "application/json",
								body: z.object({
									id: z.string(),
									name: z
										.string()
										.transform(async (value) => value.toUpperCase()),
								}),
								headers: z.object({
									"x-custom-header": z.string(),
								}),
							},
						},
					},
					post: {
						pathParams: z.object({
							id: z.string(),
						}),
						body: z.object({
							name: z.string(),
						}),
						responses: {
							201: {
								contentType: "application/json",
								body: z.object({
									id: z.string(),
									name: z.string(),
								}),
							},
						},
					},
				},
				router: {
					$postId: {
						contract: {
							get: {
								pathParams: z.object({
									id: z.string(),
									postId: z.string(),
								}),
								responses: {
									200: {
										contentType: "application/json",
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
	},
);

describe("initHono", () => {
	it("provides strongly typed handler input and output", () => {
		type UsersContract = NonNullable<typeof router.users.$id.contract.get>;
		type UsersInput = ServerHandlerInput<UsersContract>;
		type UsersOutput = ServerHandlerOutput<UsersContract>;
		type CreateUserContract = NonNullable<typeof router.users.$id.contract.post>;
		type CreateUserInput = ServerHandlerInput<CreateUserContract>;

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

		// @ts-expect-error headers are required for this response schema
		const outputWithoutHeaders: UsersOutput = {
			status: 200,
			data: {
				id: "123",
				name: "john",
			},
		};
		void outputWithoutHeaders;

		const createInput: CreateUserInput = {
			pathParams: {
				id: "123",
			},
			body: {
				name: "john",
			},
		};

		expectType<string>(createInput.body.name);

		const app = new Hono();
		const handlers: ServerHandlerTree<typeof router, [Context]> = {
			users: {
				$id: {
					handler: {
						get: async (data, c) => {
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
						post: async (data) => {
							return {
								status: 201,
								data: {
									id: data.pathParams.id,
									name: data.body.name,
								},
							};
						},
					},
					router: {
						$postId: {
							handler: {
								get: async (data) => {
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
			},
		};

		initHono(app, router, handlers);
	});

	it("registers nested routes and validates incoming and outgoing payloads", async () => {
		const app = new Hono();

		initHono(app, router, {
			users: {
				$id: {
					handler: {
						get: async (data) => {
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
						post: async (data) => {
							return {
								status: 201,
								data: {
									id: data.pathParams.id,
									name: data.body.name,
								},
							};
						},
					},
					router: {
						$postId: {
							handler: {
								get: async (data) => {
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

		const createResponse = await app.request("http://localhost/users/123", {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({
				name: "Jane",
			}),
		});

		expect(createResponse.status).toBe(201);
		expect(await createResponse.json()).toEqual({
			id: "123",
			name: "Jane",
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
							get: {
								pathParams: z.object({
									id: z.string().regex(/^\d+$/),
								}),
								responses: {
									200: {
										contentType: "application/json",
										body: z.object({
											id: z.string(),
										}),
									},
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
						handler: {
							get: async (data) => ({
								status: 200,
								data: {
									id: data.pathParams.id,
								},
							}),
						},
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

	it("supports global and route-level middleware in initHono", async () => {
		const app = new Hono();

		initHono(
			app,
			router,
			{
				users: {
					$id: {
						handler: {
							get: async (data) => {
								return {
									status: 200,
									data: {
										id: data.pathParams.id,
										name: "john",
									},
									headers: {
										"x-custom-header": "ok",
									},
								};
							},
							post: async (data) => {
								return {
									status: 201,
									data: {
										id: data.pathParams.id,
										name: data.body.name,
									},
								};
							},
						},
						middleware: [
							async (context, next) => {
								context.header("x-route-middleware", "users-id");
								await next();
							},
						],
						router: {
							$postId: {
								handler: {
									get: async (data) => {
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
				},
			},
			{
				globalMiddleware: [
					async (context, next) => {
						context.header("x-global-middleware", "enabled");
						await next();
					},
				],
			},
		);

		const usersResponse = await app.request("http://localhost/users/123", {
			method: "GET",
			headers: {
				"x-input-header": "ok",
			},
		});

		expect(usersResponse.status).toBe(200);
		expect(usersResponse.headers.get("x-global-middleware")).toBe("enabled");
		expect(usersResponse.headers.get("x-route-middleware")).toBe("users-id");

		const postsResponse = await app.request("http://localhost/users/123/abc", {
			method: "GET",
		});

		expect(postsResponse.status).toBe(200);
		expect(postsResponse.headers.get("x-global-middleware")).toBe("enabled");
		expect(postsResponse.headers.get("x-route-middleware")).toBeNull();
	});

	it("throws deterministic error when method contract is missing matching handler", () => {
		const app = new Hono();
		const handlersWithMissingPostMethod = {
			users: {
				$id: {
					handler: {
						get: async (
							data: ServerHandlerInput<
								NonNullable<typeof router.users.$id.contract.get>
							>,
						) => ({
							status: 200,
							data: {
								id: data.pathParams.id,
								name: "john",
							},
							headers: {
								"x-custom-header": "ok",
							},
						}),
					},
					router: {
						$postId: {
							handler: {
								get: async (
									data: ServerHandlerInput<
										NonNullable<
											typeof router.users.$id.router.$postId.contract.get
										>
									>,
								) => ({
									status: 200,
									data: {
										id: data.pathParams.postId,
										title: "post",
									},
								}),
							},
						},
					},
				},
			},
		} as unknown as ServerHandlerTree<typeof router, [Context]>;

		expect(() => initHono(app, router, handlersWithMissingPostMethod)).toThrow(
			"Missing handler function for POST /users/:id",
		);
	});

	it("parses multipart FormData request bodies", async () => {
		const formRouter = createRouter(
			{
				uploads: {
					type: "contract",
				},
			},
			{
				uploads: {
					contract: {
						post: {
							body: z.instanceof(FormData),
							responses: {
								200: {
									contentType: "application/json",
									body: z.object({
										name: z.string(),
									}),
								},
							},
						},
					},
				},
			},
		);

		const app = new Hono();
		initHono(app, formRouter, {
			uploads: {
				handler: {
					post: async (data) => ({
						status: 200,
						data: {
							name: String(data.body.get("name") ?? ""),
						},
					}),
				},
			},
		});

		const formData = new FormData();
		formData.set("name", "Jane");

		const response = await app.request("http://localhost/uploads", {
			method: "POST",
			body: formData,
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			name: "Jane",
		});
	});

	it("encodes json/text/bytes/null responses based on response contentType", async () => {
		const contentTypeRouter = createRouter(
			{
				json: { type: "contract" },
				text: { type: "contract" },
				bytes: { type: "contract" },
				nullish: { type: "contract" },
			},
			{
				json: {
					contract: {
						get: {
							responses: {
								200: {
									contentType: "application/json",
									body: z.object({ value: z.string() }),
								},
							},
						},
					},
				},
				text: {
					contract: {
						get: {
							responses: {
								200: {
									contentType: "text/plain",
									body: z.string(),
								},
							},
						},
					},
				},
				bytes: {
					contract: {
						get: {
							responses: {
								200: {
									contentType: "application/octet-stream",
									body: z.instanceof(Uint8Array),
								},
							},
						},
					},
				},
				nullish: {
					contract: {
						get: {
							responses: {
								204: {
									contentType: null,
								},
							},
						},
					},
				},
			},
		);

		const app = new Hono();
		initHono(app, contentTypeRouter, {
			json: {
				handler: {
					get: async () => ({ status: 200, data: { value: "ok" } }),
				},
			},
			text: {
				handler: {
					get: async () => ({ status: 200, data: "hello" }),
				},
			},
			bytes: {
				handler: {
					get: async () => ({ status: 200, data: Uint8Array.from([7, 8, 9]) }),
				},
			},
			nullish: {
				handler: {
					get: async () => ({ status: 204 }),
				},
			},
		});

		const jsonResponse = await app.request("http://localhost/json", { method: "GET" });
		expect(jsonResponse.headers.get("content-type")?.includes("application/json")).toBe(true);
		expect(await jsonResponse.json()).toEqual({ value: "ok" });

		const textResponse = await app.request("http://localhost/text", { method: "GET" });
		expect(textResponse.headers.get("content-type")).toBe("text/plain");
		expect(await textResponse.text()).toBe("hello");

		const bytesResponse = await app.request("http://localhost/bytes", { method: "GET" });
		expect(bytesResponse.headers.get("content-type")).toBe("application/octet-stream");
		expect(new Uint8Array(await bytesResponse.arrayBuffer())).toEqual(
			Uint8Array.from([7, 8, 9]),
		);

		const nullResponse = await app.request("http://localhost/nullish", { method: "GET" });
		expect(nullResponse.status).toBe(204);
		expect(nullResponse.headers.get("content-type")).toBeNull();
		expect(await nullResponse.text()).toBe("");
	});
});
