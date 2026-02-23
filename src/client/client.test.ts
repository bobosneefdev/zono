import { afterEach, describe, expect, it, mock } from "bun:test";
import z from "zod";
import { createClient } from "~/client/index.js";
import type {
	ClientMethodRoute,
	ClientRequestForRouteMethod,
	ClientRoute,
} from "~/client/types.js";
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
					get: {
						pathParams: z.object({
							id: z
								.string()
								.refine(async (value) => value.length > 0, "id must be non-empty"),
						}),
						responses: {
							200: {
								body: z.object({
									id: z.string(),
									name: z
										.string()
										.transform(async (value) => value.toUpperCase()),
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
								body: z.object({
									ok: z.literal(true),
								}),
							},
						},
					},
				},
				router: {
					posts: {
						contract: {
							post: {
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
	},
);

function expectType<T>(_value: T): void {}

afterEach(() => {
	mock.restore();
});

describe("createClient", () => {
	it("provides strongly-typed method-aware routes and requests", async () => {
		const client = createClient(router, {
			baseUrl: "http://localhost:3000",
		});

		const anyRoute = "/users/$id" as const satisfies ClientRoute<typeof router>;
		expectType<"/users/$id" | "/users/$id/posts">(anyRoute);

		const getRoute = "/users/$id" as const satisfies ClientMethodRoute<typeof router, "get">;
		expectType<"/users/$id">(getRoute);

		const postRoute = "/users/$id/posts" as const satisfies ClientMethodRoute<
			typeof router,
			"post"
		>;
		expectType<"/users/$id" | "/users/$id/posts">(postRoute);

		// @ts-expect-error invalid route path should be rejected
		const invalidRoute: ClientRoute<typeof router> = "/users/nope";
		void invalidRoute;

		// @ts-expect-error /users/$id/posts does not support get
		const invalidGetRoute: ClientMethodRoute<typeof router, "get"> = "/users/$id/posts";
		void invalidGetRoute;

		type UsersGetRequest = ClientRequestForRouteMethod<typeof router, "get", "/users/$id">;
		const usersGetRequestOk: UsersGetRequest = {
			pathParams: {
				id: "123",
			},
		};
		expectType<UsersGetRequest>(usersGetRequestOk);

		type UsersPostRequest = ClientRequestForRouteMethod<typeof router, "post", "/users/$id">;
		const usersPostRequestOk: UsersPostRequest = {
			pathParams: {
				id: "123",
			},
			body: {
				name: "Jake",
			},
		};
		expectType<UsersPostRequest>(usersPostRequestOk);

		expectType<(route: "/users/$id", request: UsersPostRequest) => Promise<{ status: 201 }>>(
			client.post,
		);

		// @ts-expect-error /users/$id/posts does not support get
		expectType<(route: "/users/$id/posts") => unknown>(client.get);
	});

	it("builds request with parsed outgoing input and merged headers", async () => {
		const fetchMock = mock(async () => {
			return new Response(JSON.stringify({ id: "abc xyz", name: "jake" }), {
				status: 200,
				headers: {
					"content-type": "application/json",
				},
			});
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = createClient(router, {
			baseUrl: "http://localhost:3000/",
			defaultHeaders: {
				"Header-1": "value-1",
				"Header-2": () => "value-2",
				"Header-3": async () => "value-3",
			},
		});

		const parsed = await client.get("/users/$id", {
			pathParams: {
				id: "abc xyz",
			},
		});

		expect(parsed.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const firstCall = fetchMock.mock.calls[0];
		expect(firstCall).toBeDefined();
		const [url, init] = firstCall as unknown as [string, RequestInit];
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

		const parsed = await client.parseResponse("get", "/users/$id", response);

		expect(parsed.status).toBe(200);
		expect(parsed.body).toEqual({ id: "123", name: "JAKE" });
		expect(parsed.response).toBe(response);

		if (parsed.status === 200) {
			expectType<{ id: string; name: string }>(parsed.body);
		}
	});
});
