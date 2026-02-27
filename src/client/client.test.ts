import { afterEach, describe, expect, it, mock } from "bun:test";
import { JsonContentType } from "@bobosneefdev/zono/contract.js";
import z from "zod";
import type {
	ClientPathsAvailableGivenMethod,
	ClientRequestInputGivenMethodAndPath,
	ClientValidationErrorResponse,
} from "~/client/client.types.js";
import type { ContractResponses } from "~/contract/contract.types.js";
import type { ServerHandlerOutput } from "~/internal/handler.types.js";
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
								schema: z.object({
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
						payload: {
							contentType: "application/json",
							schema: z.object({
								name: z.string(),
							}),
						},
						responses: {
							201: {
								contentType: "application/json",
								schema: z.object({
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
								payload: {
									contentType: "application/json",
									schema: z.object({
										title: z.string(),
									}),
								},
								responses: {
									201: {
										contentType: "application/json",
										schema: z.object({
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

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
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
			payload: {
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

	it("supports additionalResponses typing and parses additional runtime statuses", async () => {
		const additionalRouter = createRouter(
			{
				status: { TYPE: "contract" },
			},
			{
				status: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									contentType: "application/json",
									schema: z.object({ ok: z.literal(true) }),
								},
							},
						},
					},
				},
			},
		);

		const additionalResponses = {
			200: {
				contentType: "application/json",
				schema: z.number(),
			},
			418: {
				contentType: "application/json",
				schema: z.object({ reason: z.string() }),
			},
		} satisfies ContractResponses;

		const client = createClient(additionalRouter, {
			baseUrl: "http://localhost:3000",
			additionalResponses,
		});

		const parsed200 = await client.parseResponse(
			"get",
			"/status",
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		if (parsed200.status === 200) {
			expectType<{ ok: true } | number>(parsed200.body);
			expect(parsed200.body).toEqual({ ok: true });
		}

		const parsed418 = await client.parseResponse(
			"get",
			"/status",
			new Response(JSON.stringify({ reason: "teapot" }), {
				status: 418,
				headers: { "content-type": "application/json" },
			}),
		);

		expect(parsed418.status).toBe(418);
		if (parsed418.status === 418) {
			expectType<{ reason: string }>(parsed418.body);
			expect(parsed418.body).toEqual({ reason: "teapot" });
		}
	});

	it("sends FormData bodies without forcing JSON content-type", async () => {
		const formRouter = createRouter(
			{
				uploads: {
					TYPE: "contract",
				},
			},
			{
				uploads: {
					CONTRACT: {
						post: {
							payload: {
								contentType: "multipart/form-data",
								schema: z.instanceof(FormData),
							},
							responses: {
								201: {
									contentType: "application/json",
									schema: z.object({
										ok: z.literal(true),
									}),
								},
							},
						},
					},
				},
			},
		);

		const fetchMock = mock(async () => {
			return new Response(JSON.stringify({ ok: true }), {
				status: 201,
				headers: {
					"content-type": "application/json",
				},
			});
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = createClient(formRouter, {
			baseUrl: "http://localhost:3000",
			bypassOutgoingParse: true,
		});

		const formData = new FormData();
		formData.set("name", "Jake");

		const parsed = await client.post("/uploads", {
			payload: formData,
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
									schema: z.object({ ok: z.literal(true) }),
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
									schema: z.string(),
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
									schema: z.instanceof(Uint8Array),
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

	it("parses 400 validation errors with serverErrorMode 'public'", async () => {
		const issuesPayload = [
			{ code: "invalid_type", expected: "string", path: ["id"], message: "Expected string" },
		];
		const client = createClient(router, {
			baseUrl: "http://localhost:3000",
			serverErrorMode: "public",
		});

		const response = new Response(JSON.stringify({ issues: issuesPayload }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});

		const parsed = await client.parseResponse("get", "/users/$id", response);

		expect(parsed.status).toBe(400);
		if (parsed.status === 400) {
			expectType<ClientValidationErrorResponse<"public">>(parsed);
			expect(Array.isArray(parsed.body.issues)).toBe(true);
			expect(parsed.body.issues.length).toBe(1);
			expect(parsed.body.issues[0].code).toBe("invalid_type");
		}
	});

	it("parses 400 validation errors with serverErrorMode 'hidden'", async () => {
		const client = createClient(router, {
			baseUrl: "http://localhost:3000",
			serverErrorMode: "hidden",
		});

		const response = new Response(JSON.stringify({ issues: 3 }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});

		const parsed = await client.parseResponse("get", "/users/$id", response);

		expect(parsed.status).toBe(400);
		if (parsed.status === 400) {
			expectType<ClientValidationErrorResponse<"hidden">>(parsed);
			expect(parsed.body.issues).toBe(3);
		}
	});

	it("throws on unexpected 400 when serverErrorMode is not set", async () => {
		const client = createClient(router, {
			baseUrl: "http://localhost:3000",
		});

		const response = new Response(JSON.stringify({ issues: [] }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});

		await expect(client.parseResponse("get", "/users/$id", response)).rejects.toThrow(
			"Unexpected response status: 400",
		);
	});

	it("throws when required path param is missing", async () => {
		const client = createClient(router, {
			baseUrl: "http://localhost:3000",
			bypassOutgoingParse: true,
		});

		await expect(client.get("/users/$id", { pathParams: {} } as never)).rejects.toThrow(
			"Missing required path param: id",
		);
	});

	it("builds query string with array values for standard query", async () => {
		const queryRouter = createRouter(
			{
				search: { TYPE: "contract" },
			},
			{
				search: {
					CONTRACT: {
						get: {
							query: {
								type: "standard",
								schema: z.object({
									tags: z.array(z.string()),
								}),
							},
							responses: {
								200: {
									contentType: "application/json",
									schema: z.object({ results: z.array(z.any()) }),
								},
							},
						},
					},
				},
			},
		);

		const fetchMock = mock(async (url: string) => {
			expect(url).toContain("tags=a");
			expect(url).toContain("tags=b");
			return new Response(JSON.stringify({ results: [] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = createClient(queryRouter, { baseUrl: "http://localhost:3000" });
		await client.get("/search", { query: { tags: ["a", "b"] } });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("builds query string with json type", async () => {
		const jsonQueryRouter = createRouter(
			{
				query: { TYPE: "contract" },
			},
			{
				query: {
					CONTRACT: {
						get: {
							query: {
								type: "json",
								schema: z.object({ filter: z.string() }),
							},
							responses: {
								200: {
									contentType: "application/json",
									schema: z.object({ ok: z.boolean() }),
								},
							},
						},
					},
				},
			},
		);

		const fetchMock = mock(async (url: string) => {
			expect(url).toContain("json=");
			expect(url).toContain(encodeURIComponent(JSON.stringify({ filter: "active" })));
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = createClient(jsonQueryRouter, { baseUrl: "http://localhost:3000" });
		await client.get("/query", { query: { filter: "active" } });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("parses response with headers schema", async () => {
		const headersRouter = createRouter(
			{
				item: { TYPE: "contract" },
			},
			{
				item: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									contentType: "application/json",
									schema: z.object({ value: z.string() }),
									headers: z.object({ "x-custom": z.string() }),
								},
							},
						},
					},
				},
			},
		);

		const client = createClient(headersRouter, { baseUrl: "http://localhost:3000" });
		const parsed = await client.parseResponse(
			"get",
			"/item",
			new Response(JSON.stringify({ value: "ok" }), {
				status: 200,
				headers: { "content-type": "application/json", "x-custom": "custom-value" },
			}),
		);
		expect(parsed.status).toBe(200);
		if (parsed.status === 200) {
			expect(parsed.body).toEqual({ value: "ok" });
			expect(parsed.headers).toEqual({ "x-custom": "custom-value" });
		}
	});

	it("merges request headers into outgoing request", async () => {
		let capturedInit: RequestInit | undefined;
		const fetchMock = mock(async (_url: string, init?: RequestInit) => {
			capturedInit = init;
			return new Response(JSON.stringify({ pong: "ok" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const headerOnlyRouter = createRouter(
			{
				ping: { TYPE: "contract" },
			},
			{
				ping: {
					CONTRACT: {
						get: {
							headers: z.object({ "x-ping-header": z.string() }),
							responses: {
								200: {
									contentType: "application/json",
									schema: z.object({ pong: z.string() }),
								},
							},
						},
					},
				},
			},
		);

		const client = createClient(headerOnlyRouter, { baseUrl: "http://localhost:3000" });
		await client.get("/ping", { headers: { "x-ping-header": "request-value" } });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(capturedInit?.headers).toBeInstanceOf(Headers);
		expect((capturedInit?.headers as Headers).get("x-ping-header")).toBe("request-value");
	});

	it("sets content-type application/json when sending JSON payload without explicit header", async () => {
		const fetchMock = mock(async (_url: string, init?: RequestInit) => {
			const headers = init?.headers as Headers;
			expect(headers?.get("content-type")).toBe("application/json");
			return new Response(JSON.stringify({ ok: true }), {
				status: 201,
				headers: { "content-type": "application/json" },
			});
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = createClient(router, { baseUrl: "http://localhost:3000" });
		await client.post("/users/$id", {
			pathParams: { id: "1" },
			payload: { name: "Jake" },
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("calls real public HTTP API (chuck norris API)", async () => {
		const jsonPlaceholderRouter = createRouter(
			{
				random: {
					TYPE: "contract",
				},
				categories: {
					TYPE: "contract",
				},
			},
			{
				random: {
					CONTRACT: {
						get: {
							query: {
								type: "standard",
								schema: z.object({
									category: z.string().optional(),
								}),
							},
							responses: {
								200: {
									contentType: JsonContentType.JSON,
									schema: z.object({
										categories: z.array(z.string()),
										created_at: z
											.string()
											.regex(
												/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/,
												"Invalid timestamp format",
											),
									}),
								},
							},
						},
					},
				},
				categories: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									contentType: "application/json",
									schema: z.any(),
								},
							},
						},
					},
				},
			},
		);

		const client = createClient(jsonPlaceholderRouter, {
			baseUrl: "https://api.chucknorris.io/jokes",
		});

		const categories = await client.get("/categories");
		console.log(JSON.stringify(categories.body, null, 2), categories.response);
		const randomCategory = categories.body[Math.floor(Math.random() * categories.body.length)];

		// expect random category

		const resp = await client.get("/random", {
			query: { category: randomCategory },
		});
		console.log(JSON.stringify(resp, null, 2));

		// expect 200 resp
	});
});
