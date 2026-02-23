import { describe, expect, it } from "bun:test";
import z from "zod";
import { createClient } from "~/client/index.js";
import type { ClientRequestForRoute, ClientRoute } from "~/client/types.js";
import { createRouter } from "~/contract/index.js";

const router = createRouter(
	{
		users: {
			type: "router",
			router: {
				$id: {
					type: "contract",
					router: {
						posts: {
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
						id: z
							.string()
							.refine(async (value) => value.length > 0, "id must be non-empty"),
					}),
					responses: {
						200: {
							body: z.object({
								id: z.string(),
								name: z.string().transform(async (value) => value.toUpperCase()),
							}),
						},
					},
				},
				router: {
					posts: {
						contract: {
							method: "post",
							pathParams: z.object({
								id: z.string(),
							}),
							body: z.object({
								title: z.string(),
							}),
							responses: {
								201: {
									body: z.object({
										ok: z.literal(true),
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

function expectType<T>(_value: T): void {}

describe("createClient", () => {
	it("provides strongly-typed route and request inference", async () => {
		const client = createClient(router, {
			baseUrl: "http://localhost:3000",
			defaultHeaders: {
				"Header-1": "value-1",
				"Header-2": () => "value-2",
				"Header-3": async () => "value-3",
			},
		});

		const fetchConfig = await client.fetchConfig("/users/$id", {
			pathParams: {
				id: "123",
			},
		});

		expectType<[string, RequestInit]>(fetchConfig);
		expectType<"/users/$id" | "/users/$id/posts">("/users/$id");

		const validRoute: ClientRoute<typeof router> = "/users/$id";
		expectType<"/users/$id" | "/users/$id/posts">(validRoute);

		// @ts-expect-error invalid route path should be rejected
		const invalidRoute: ClientRoute<typeof router> = "/users/nope";
		void invalidRoute;

		type UsersRequest = ClientRequestForRoute<typeof router, "/users/$id">;
		const usersRequestOk: UsersRequest = {
			pathParams: {
				id: "123",
			},
		};
		expectType<UsersRequest>(usersRequestOk);

		// @ts-expect-error missing required pathParams
		const usersRequestBad: UsersRequest = {};
		void usersRequestBad;

		type PostsRequest = ClientRequestForRoute<typeof router, "/users/$id/posts">;
		const postsRequestOk: PostsRequest = {
			pathParams: {
				id: "123",
			},
			body: {
				title: "Hello world",
			},
		};
		expectType<PostsRequest>(postsRequestOk);

		const postsFetchConfig = await client.fetchConfig("/users/$id/posts", {
			pathParams: {
				id: "123",
			},
			body: {
				title: "Hello world",
			},
		});

		expectType<[string, RequestInit]>(postsFetchConfig);
	});

	it("builds fetch tuple with parsed outgoing input and merged headers", async () => {
		const client = createClient(router, {
			baseUrl: "http://localhost:3000/",
			defaultHeaders: {
				"Header-1": "value-1",
				"Header-2": () => "value-2",
				"Header-3": async () => "value-3",
			},
		});

		const [url, init] = await client.fetchConfig("/users/$id", {
			pathParams: {
				id: "abc xyz",
			},
		});

		expect(url).toBe("http://localhost:3000/users/abc%20xyz");
		expect(init.method).toBe("GET");
		expect(init.headers).toBeInstanceOf(Headers);

		const headers = init.headers as Headers;
		expect(headers.get("Header-1")).toBe("value-1");
		expect(headers.get("Header-2")).toBe("value-2");
		expect(headers.get("Header-3")).toBe("value-3");
	});

	it("parses response through async schemas for declared statuses", async () => {
		const client = createClient(router, {
			baseUrl: "http://localhost:3000",
		});

		const response = new Response(JSON.stringify({ id: "123", name: "jake" }), {
			status: 200,
			headers: {
				"content-type": "application/json",
			},
		});

		const parsed = await client.parseResponse("/users/$id", response);

		expect(parsed.status).toBe(200);
		expect(parsed.body).toEqual({ id: "123", name: "JAKE" });
		expect(parsed.response).toBe(response);

		if (parsed.status === 200) {
			expectType<{ id: string; name: string }>(parsed.body);
		}
	});
});
