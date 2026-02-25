import { afterEach, describe, expect, it, mock } from "bun:test";
import z from "zod";
import type {
	ClientPathsAvailableGivenMethod,
	ClientRequestInputGivenMethodAndPath,
} from "~/client/client.types.js";
import { ServerHandlerOutput } from "~/lib/index.js";
import { createRouter, RouterPath } from "~/router/index.js";
import { createClient } from "./client.js";

const router = createRouter(
	{
		users: {
			TYPE: "router",
			ROUTER: {
				$id: {
					TYPE: "contract",
					ROUTER: {
						posts: {
							TYPE: "contract",
						},
					},
				},
			},
		},
	},
	{
		users: {
			$id: {
				CONTRACT: {
					get: {
						pathParams: z.object({
							id: z
								.string()
								.refine(async (value) => value.length > 0, "id must be non-empty"),
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
							},
						},
					},
					post: {
						pathParams: z.object({
							id: z.string(),
						}),
						body: z.union([
							z.object({
								name: z.string(),
							}),
							z.instanceof(FormData),
						]),
						responses: {
							201: {
								contentType: "application/json",
								body: z.object({
									ok: z.literal(true),
								}),
							},
						},
					},
				},
				ROUTER: {
					posts: {
						CONTRACT: {
							post: {
								pathParams: z.object({
									id: z.string(),
								}),
								body: z.object({
									title: z.string(),
								}),
								responses: {
									201: {
										contentType: "application/json",
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

		const anyRoute = "/users/$id" as const satisfies RouterPath<typeof router>;
		expectType<"/users/$id" | "/users/$id/posts">(anyRoute);

		const getRoute = "/users/$id" as const satisfies ClientPathsAvailableGivenMethod<
			typeof router,
			"get"
		>;
		expectType<"/users/$id">(getRoute);

		const postRoute = "/users/$id/posts" as const satisfies ClientPathsAvailableGivenMethod<
			typeof router,
			"post"
		>;
		expectType<"/users/$id" | "/users/$id/posts">(postRoute);

		// @ts-expect-error invalid route path should be rejected
		const invalidRoute: ClientRoute<typeof router> = "/users/nope";
		void invalidRoute;

		// @ts-expect-error /users/$id/posts does not support get
		const invalidGetRoute: ClientPathsAvailableGivenMethod<typeof router, "get"> =
			"/users/$id/posts";
		void invalidGetRoute;

		type UsersGetRequest = ClientRequestInputGivenMethodAndPath<
			typeof router,
			"get",
			"/users/$id"
		>;
		const usersGetRequestOk: UsersGetRequest = {
			pathParams: {
				id: "123",
			},
		};
		expectType<UsersGetRequest>(usersGetRequestOk);

		type UsersPostRequest = ClientRequestInputGivenMethodAndPath<
			typeof router,
			"post",
			"/users/$id"
		>;
		const usersPostRequestOk: UsersPostRequest = {
			pathParams: {
				id: "123",
			},
			body: {
				name: "Jake",
			},
		};
		expectType<UsersPostRequest>(usersPostRequestOk);

		expectType<(path: "/users/$id", request: UsersPostRequest) => Promise<{ status: 201 }>>(
			client.post,
		);

		// @ts-expect-error /users/$id/posts does not support get
		expectType<(path: "/users/$id/posts") => Promise<{ status: 200 }>>(client.get);
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

	it("sends FormData bodies without forcing JSON content-type", async () => {
		const fetchMock = mock(async () => {
			return new Response(JSON.stringify({ ok: true }), {
				status: 201,
				headers: {
					"content-type": "application/json",
				},
			});
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = createClient(router, {
			baseUrl: "http://localhost:3000",
			bypassOutgoingParse: true,
		});

		const formData = new FormData();
		formData.set("name", "Jake");

		const parsed = await client.post("/users/$id", {
			pathParams: {
				id: "123",
			},
			body: formData,
		});

		expect(parsed.status).toBe(201);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const firstCall = fetchMock.mock.calls[0];
		expect(firstCall).toBeDefined();
		const [, init] = firstCall as unknown as [string, RequestInit];
		expect(init.body).toBe(formData);
		expect(init.headers).toBeInstanceOf(Headers);
		const headers = init.headers as Headers;
		expect(headers.has("content-type")).toBe(false);
	});

	it("decodes json/text/bytes/null response bodies from contract contentType", async () => {
		const contentTypeRouter = createRouter(
			{
				json: { TYPE: "contract" },
				text: { TYPE: "contract" },
				bytes: { TYPE: "contract" },
				nullish: { TYPE: "contract" },
			},
			{
				json: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									contentType: "application/json",
									body: z.object({ ok: z.literal(true) }),
								},
							},
						},
					},
				},
				text: {
					CONTRACT: {
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
					CONTRACT: {
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
					CONTRACT: {
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

		const client = createClient(contentTypeRouter, {
			baseUrl: "http://localhost:3000",
		});

		const parsedJson = await client.parseResponse(
			"get",
			"/json",
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		expect(parsedJson.body).toEqual({ ok: true });

		const parsedText = await client.parseResponse(
			"get",
			"/text",
			new Response("hello", {
				status: 200,
				headers: { "content-type": "text/plain" },
			}),
		);
		expect(parsedText.body).toBe("hello");

		const bytes = Uint8Array.from([1, 2, 3]);
		const parsedBytes = await client.parseResponse(
			"get",
			"/bytes",
			new Response(bytes, {
				status: 200,
				headers: { "content-type": "application/octet-stream" },
			}),
		);
		expect(parsedBytes.body).toEqual(bytes);

		const parsedNull = await client.parseResponse(
			"get",
			"/nullish",
			new Response(null, { status: 204 }),
		);
		expect(parsedNull.body).toBeUndefined();

		type NullContract = NonNullable<typeof contentTypeRouter.nullish.CONTRACT.get>;
		type NullResponse = ServerHandlerOutput<NullContract>;
		const nullResponseOk: NullResponse = { status: 204 };
		const nullResponseWithUndefinedData: NullResponse = { status: 204, data: undefined };
		expectType<204>(nullResponseOk.status);
		expectType<204>(nullResponseWithUndefinedData.status);
	});
});
