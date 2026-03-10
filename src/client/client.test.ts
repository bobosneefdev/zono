import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import superjson from "superjson";
import z from "zod";
import type { ContractTreeFor } from "../contract/contract.js";
import type { MiddlewareTreeFor } from "../middleware/middleware.js";
import type { ApiShape } from "../shared/shared.js";
import {
	createSerializedResponse,
	ZONO_HEADER_DATA_HEADER,
	ZONO_HEADER_DATA_TYPE_HEADER,
	ZONO_QUERY_DATA_KEY,
} from "../shared/shared.js";
import { createClient } from "./client.js";

type HasStatus<TUnion, TStatus extends number> = Extract<TUnion, { status: TStatus }> extends never
	? false
	: true;

const servers: Array<{ stop: () => void }> = [];

const startServer = (app: Hono): string => {
	const server = Bun.serve({ fetch: app.fetch, port: 0 });
	servers.push(server);
	return `http://localhost:${server.port}`;
};

afterEach(() => {
	while (servers.length > 0) {
		servers.pop()?.stop();
	}
});

const shape = {
	SHAPE: {
		users: {
			SHAPE: {
				$userId: { CONTRACT: true },
			},
		},
		standard: { CONTRACT: true },
		textUpload: { CONTRACT: true },
		blobUpload: { CONTRACT: true },
		search: { CONTRACT: true },
		upload: { CONTRACT: true },
		structured: { CONTRACT: true },
		responseHeadersStandard: { CONTRACT: true },
		responseHeadersStructured: { CONTRACT: true },
		events: { CONTRACT: true },
		downloadText: { CONTRACT: true },
		downloadBytes: { CONTRACT: true },
		downloadBlob: { CONTRACT: true },
		downloadForm: { CONTRACT: true },
		noop: { CONTRACT: true },
	},
} as const satisfies ApiShape;

const contracts = {
	SHAPE: {
		users: {
			SHAPE: {
				$userId: {
					CONTRACT: {
						post: {
							pathParams: z.object({ userId: z.string() }),
							query: {
								type: "JSON",
								schema: z.object({ active: z.boolean() }),
							},
							headers: {
								type: "JSON",
								schema: z.object({ source: z.string() }),
							},
							body: {
								type: "JSON",
								schema: z.object({ name: z.string() }),
							},
							responses: {
								200: {
									type: "JSON",
									schema: z.object({
										userId: z.string(),
										queryPayload: z.string(),
										headerPayload: z.string(),
										name: z.string(),
									}),
								},
							},
						},
					},
				},
			},
		},
		standard: {
			CONTRACT: {
				get: {
					query: {
						type: "Standard",
						schema: z.object({ foo: z.string(), count: z.string() }),
					},
					headers: {
						type: "Standard",
						schema: z.object({ "x-trace": z.string(), "x-meta": z.string() }),
					},
					responses: {
						200: {
							type: "JSON",
							schema: z.object({
								foo: z.string(),
								count: z.string(),
								trace: z.string(),
								meta: z.string(),
							}),
						},
					},
				},
			},
		},
		textUpload: {
			CONTRACT: {
				post: {
					body: { type: "Text", schema: z.string() },
					responses: {
						200: {
							type: "JSON",
							schema: z.object({ body: z.string(), contentType: z.string() }),
						},
					},
				},
			},
		},
		blobUpload: {
			CONTRACT: {
				post: {
					body: { type: "Blob", schema: z.instanceof(Blob) },
					responses: {
						200: {
							type: "JSON",
							schema: z.object({ size: z.number(), type: z.string() }),
						},
					},
				},
			},
		},
		search: {
			CONTRACT: {
				post: {
					body: {
						type: "URLSearchParams",
						schema: z.instanceof(URLSearchParams),
					},
					responses: {
						200: {
							type: "JSON",
							schema: z.object({ contentType: z.string(), payload: z.string() }),
						},
					},
				},
			},
		},
		upload: {
			CONTRACT: {
				post: {
					body: {
						type: "FormData",
						schema: z.instanceof(FormData),
					},
					responses: {
						200: {
							type: "JSON",
							schema: z.object({ fileName: z.string() }),
						},
					},
				},
			},
		},
		structured: {
			CONTRACT: {
				post: {
					query: {
						type: "SuperJSON",
						schema: z.object({ createdAt: z.date() }).optional(),
					},
					headers: {
						type: "SuperJSON",
						schema: z.object({ createdAt: z.date() }).optional(),
					},
					body: {
						type: "SuperJSON",
						schema: z.object({ createdAt: z.date() }),
					},
					responses: {
						200: {
							type: "JSON",
							schema: z.object({
								queryPayload: z.string().optional(),
								headerPayload: z.string().optional(),
								bodyPayload: z.string(),
							}),
						},
					},
				},
			},
		},
		responseHeadersStandard: {
			CONTRACT: {
				get: {
					responses: {
						200: {
							type: "JSON",
							schema: z.object({ ok: z.boolean() }),
							headers: {
								type: "Standard",
								schema: z.object({ "x-trace": z.string(), "x-meta": z.string() }),
							},
						},
					},
				},
			},
		},
		responseHeadersStructured: {
			CONTRACT: {
				get: {
					responses: {
						200: {
							type: "JSON",
							schema: z.object({ ok: z.boolean() }),
							headers: {
								type: "SuperJSON",
								schema: z.object({ createdAt: z.date() }),
							},
						},
					},
				},
			},
		},
		events: {
			CONTRACT: {
				get: {
					responses: {
						200: {
							type: "SuperJSON",
							schema: z.object({ createdAt: z.date() }),
						},
						503: {
							type: "JSON",
							schema: z.object({ message: z.string() }),
						},
					},
				},
			},
		},
		downloadText: {
			CONTRACT: {
				get: {
					responses: {
						200: { type: "Text", schema: z.string() },
					},
				},
			},
		},
		downloadBytes: {
			CONTRACT: {
				get: {
					responses: {
						200: { type: "Bytes", schema: z.instanceof(Uint8Array) },
					},
				},
			},
		},
		downloadBlob: {
			CONTRACT: {
				get: {
					responses: {
						200: { type: "Blob", schema: z.instanceof(Blob) },
					},
				},
			},
		},
		downloadForm: {
			CONTRACT: {
				get: {
					responses: {
						200: { type: "FormData", schema: z.instanceof(FormData) },
					},
				},
			},
		},
		noop: {
			CONTRACT: {
				get: {
					responses: {
						204: { type: "Contentless" },
					},
				},
			},
		},
	},
} as const satisfies ContractTreeFor<typeof shape>;

const middlewares = {
	MIDDLEWARE: {
		rateLimit: {
			429: {
				type: "JSON",
				schema: z.object({ retryAfter: z.number() }),
			},
		},
	},
} as const satisfies MiddlewareTreeFor<typeof shape>;

describe("createClient runtime", () => {
	test("encodes structured path/query/headers/body from the request envelope", async () => {
		const app = new Hono();
		app.post("/users/:userId", async (ctx) => {
			const payload = await ctx.req.json();
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: {
					userId: ctx.req.param("userId"),
					queryPayload: ctx.req.query(ZONO_QUERY_DATA_KEY) ?? "",
					headerPayload: ctx.req.header(ZONO_HEADER_DATA_HEADER) ?? "",
					name: payload.name,
				},
			});
		});

		const client = createClient<typeof shape, typeof contracts, typeof middlewares, "public">(
			startServer(app),
		);

		const response = await client.fetch("/users/$userId", "post", {
			pathParams: { userId: "a/b" },
			query: { type: "JSON", data: { active: true } },
			headers: { type: "JSON", data: { source: "test" } },
			body: { type: "JSON", data: { name: "alice" } },
		});

		expect(response.status).toBe(200);
		expect(response.response).toBeInstanceOf(Response);
		expect(response.response.status).toBe(200);
		expect(response.data).toEqual({
			userId: "a/b",
			queryPayload: '{"active":true}',
			headerPayload: '{"source":"test"}',
			name: "alice",
		});
	});

	test("encodes standard query params and headers without reserved transport slots", async () => {
		const app = new Hono();
		app.get("/standard", (ctx) => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: {
					foo: ctx.req.query("foo") ?? "",
					count: ctx.req.query("count") ?? "",
					trace: ctx.req.header("x-trace") ?? "",
					meta: ctx.req.header("x-meta") ?? "",
				},
			});
		});

		const client = createClient<typeof shape, typeof contracts, typeof middlewares, "public">(
			startServer(app),
		);

		const response = await client.fetch("/standard", "get", {
			query: { type: "Standard", data: { foo: "bar", count: "2" } },
			headers: { type: "Standard", data: { "x-trace": "trace-1", "x-meta": '{"ok":true}' } },
		});

		expect(response.data).toEqual({
			foo: "bar",
			count: "2",
			trace: "trace-1",
			meta: '{"ok":true}',
		});
	});

	test("supports Text, Blob, URLSearchParams, and FormData request bodies", async () => {
		const app = new Hono();
		app.post("/textUpload", async (ctx) => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: {
					body: await ctx.req.text(),
					contentType: ctx.req.header("content-type") ?? "",
				},
			});
		});
		app.post("/blobUpload", async (ctx) => {
			const blob = await ctx.req.blob();
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { size: blob.size, type: blob.type },
			});
		});
		app.post("/search", async (ctx) => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: {
					contentType: ctx.req.header("content-type") ?? "",
					payload: await ctx.req.text(),
				},
			});
		});
		app.post("/upload", async (ctx) => {
			const formData = await ctx.req.formData();
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: { fileName: String(formData.get("fileName")) },
			});
		});

		const client = createClient<typeof shape, typeof contracts, typeof middlewares, "public">(
			startServer(app),
		);

		const textResponse = await client.fetch("/textUpload", "post", {
			body: { type: "Text", data: "hello" },
		});
		expect(textResponse.data).toEqual({
			body: "hello",
			contentType: "",
		});

		const blobResponse = await client.fetch("/blobUpload", "post", {
			body: { type: "Blob", data: new Blob(["blob-value"], { type: "text/plain" }) },
		});
		expect(blobResponse.data).toEqual({
			size: 10,
			type: expect.stringContaining("text/plain"),
		});

		const urlEncoded = await client.fetch("/search", "post", {
			body: { type: "URLSearchParams", data: new URLSearchParams({ q: "zono docs" }) },
		});
		expect((urlEncoded.data as { contentType: string }).contentType).toContain(
			"application/x-www-form-urlencoded",
		);
		expect((urlEncoded.data as { payload: string }).payload).toContain("q=zono+docs");

		const formData = new FormData();
		formData.set("fileName", "avatar.png");
		const uploaded = await client.fetch("/upload", "post", {
			body: { type: "FormData", data: formData },
		});
		expect(uploaded.data).toEqual({ fileName: "avatar.png" });
	});

	test("serializes SuperJSON body, query, and headers through reserved transport slots", async () => {
		const app = new Hono();
		app.post("/structured", async (ctx) => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: {
					queryPayload: ctx.req.query(ZONO_QUERY_DATA_KEY) ?? undefined,
					headerPayload: ctx.req.header(ZONO_HEADER_DATA_HEADER) ?? undefined,
					bodyPayload: await ctx.req.text(),
				},
			});
		});

		const client = createClient<typeof shape, typeof contracts, typeof middlewares, "public">(
			startServer(app),
		);
		const createdAt = new Date("2024-02-02T00:00:00.000Z");

		const response = await client.fetch("/structured", "post", {
			query: { type: "SuperJSON", data: { createdAt } },
			headers: { type: "SuperJSON", data: { createdAt } },
			body: { type: "SuperJSON", data: { createdAt } },
		});

		expect(
			superjson.parse((response.data as { queryPayload: string }).queryPayload) as {
				createdAt: Date;
			},
		).toEqual({ createdAt });
		expect(
			superjson.parse((response.data as { headerPayload: string }).headerPayload) as {
				createdAt: Date;
			},
		).toEqual({ createdAt });
		expect(
			superjson.parse((response.data as { bodyPayload: string }).bodyPayload) as {
				createdAt: Date;
			},
		).toEqual({ createdAt });
	});

	test("omits reserved query and header slots when structured data is undefined", async () => {
		const app = new Hono();
		app.post("/structured", async (ctx) => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				data: {
					queryPayload: ctx.req.query(ZONO_QUERY_DATA_KEY) ?? undefined,
					headerPayload: ctx.req.header(ZONO_HEADER_DATA_HEADER) ?? undefined,
					bodyPayload: await ctx.req.text(),
				},
			});
		});

		const client = createClient<typeof shape, typeof contracts, typeof middlewares, "public">(
			startServer(app),
		);

		const response = await client.fetch("/structured", "post", {
			body: { type: "SuperJSON", data: { createdAt: new Date("2024-02-02T00:00:00.000Z") } },
		});

		expect((response.data as { queryPayload?: string }).queryPayload).toBeUndefined();
		expect((response.data as { headerPayload?: string }).headerPayload).toBeUndefined();
	});

	test("parses Text, Bytes, Blob, FormData, Contentless, and SuperJSON responses", async () => {
		const app = new Hono();
		app.get("/events", () => {
			return createSerializedResponse({
				status: 200,
				type: "SuperJSON",
				source: "contract",
				data: { createdAt: new Date("2024-02-02T00:00:00.000Z") },
			});
		});
		app.get("/downloadText", () => {
			return createSerializedResponse({
				status: 200,
				type: "Text",
				source: "contract",
				data: "hello text",
			});
		});
		app.get("/downloadBytes", () => {
			return createSerializedResponse({
				status: 200,
				type: "Bytes",
				source: "contract",
				data: new Uint8Array([1, 2, 3]),
			});
		});
		app.get("/downloadBlob", () => {
			return createSerializedResponse({
				status: 200,
				type: "Blob",
				source: "contract",
				data: new Blob(["blob response"], { type: "text/plain" }),
			});
		});
		app.get("/downloadForm", () => {
			const formData = new FormData();
			formData.set("fileName", "avatar.png");
			return createSerializedResponse({
				status: 200,
				type: "FormData",
				source: "contract",
				data: formData,
			});
		});
		app.get("/noop", () => {
			return createSerializedResponse({
				status: 204,
				type: "Contentless",
				source: "contract",
				data: undefined,
			});
		});

		const client = createClient<typeof shape, typeof contracts, typeof middlewares, "public">(
			startServer(app),
		);

		const event = await client.fetch("/events", "get");
		expect((event.data as { createdAt: Date }).createdAt).toEqual(
			new Date("2024-02-02T00:00:00.000Z"),
		);

		const text = await client.fetch("/downloadText", "get");
		expect(text.data).toBe("hello text");

		const bytes = await client.fetch("/downloadBytes", "get");
		expect(Array.from(bytes.data as Uint8Array)).toEqual([1, 2, 3]);

		const blob = await client.fetch("/downloadBlob", "get");
		expect(await (blob.data as Blob).text()).toBe("blob response");

		const form = await client.fetch("/downloadForm", "get");
		expect((form.data as FormData).get("fileName")).toBe("avatar.png");

		const noop = await client.fetch("/noop", "get");
		expect(noop.status).toBe(204);
		expect(noop.data).toBeUndefined();
		expect(noop.headers).toBeUndefined();
	});

	test("parses declared response headers and preserves raw response headers", async () => {
		const app = new Hono();
		app.get("/responseHeadersStandard", () => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				headers: {
					"x-trace": "trace-1",
					"x-meta": "meta-1",
					[ZONO_HEADER_DATA_TYPE_HEADER]: "Standard",
					[ZONO_HEADER_DATA_HEADER]: JSON.stringify({
						"x-trace": "trace-1",
						"x-meta": "meta-1",
					}),
				},
				data: { ok: true },
			});
		});
		app.get("/responseHeadersStructured", () => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				headers: {
					[ZONO_HEADER_DATA_TYPE_HEADER]: "SuperJSON",
					[ZONO_HEADER_DATA_HEADER]: superjson.stringify({
						createdAt: new Date("2024-02-02T00:00:00.000Z"),
					}),
				},
				data: { ok: true },
			});
		});

		const client = createClient<typeof shape, typeof contracts, typeof middlewares, "public">(
			startServer(app),
		);

		const standard = await client.fetch("/responseHeadersStandard", "get");
		expect(standard.headers).toEqual({ "x-trace": "trace-1", "x-meta": "meta-1" });
		expect(standard.response.headers.get("x-trace")).toBe("trace-1");
		expect(standard.response.headers.get("x-meta")).toBe("meta-1");

		const structured = await client.fetch("/responseHeadersStructured", "get");
		expect(structured.headers).toEqual({
			createdAt: new Date("2024-02-02T00:00:00.000Z"),
		});
		expect(structured.response.headers.get("x-trace")).toBeNull();
	});

	test("parses serialized error responses", async () => {
		const app = new Hono();
		app.get("/events", () => {
			return createSerializedResponse({
				status: 503,
				type: "JSON",
				source: "error",
				data: { message: "down" },
			});
		});

		const client = createClient<typeof shape, typeof contracts, typeof middlewares, "public">(
			startServer(app),
		);
		const failed = await client.fetch("/events", "get");

		expect(failed.status).toBe(503);
		expect((await failed.response.json()) as { message: string }).toEqual({ message: "down" });
	});

	test("rejects invalid runtime path params before the request is sent", async () => {
		const app = new Hono();
		const baseUrl = startServer(app);
		const client = createClient<typeof shape, typeof contracts, typeof middlewares, "public">(
			baseUrl,
		) as unknown as {
			fetch: (path: string, method: string, data?: unknown) => Promise<unknown>;
		};

		await expect(
			client.fetch("/users/$userId", "post", {
				pathParams: { userId: 123 },
				query: { type: "JSON", data: { active: true } },
				headers: { type: "JSON", data: { source: "test" } },
				body: { type: "JSON", data: { name: "alice" } },
			}),
		).rejects.toThrow("Path param 'userId' must be a string");
	});
});

type TypedClient = ReturnType<
	typeof createClient<typeof shape, typeof contracts, typeof middlewares, "public">
>;
type ClientResponse = Awaited<ReturnType<TypedClient["fetch"]>>;
type ClientRateLimitData = Extract<ClientResponse, { status: 429 }>["data"];
type ClientBadRequestData = Extract<ClientResponse, { status: 400 }>["data"];
type ClientNotFoundData = Extract<ClientResponse, { status: 404 }>["data"];
type ClientInternalErrorData = Extract<ClientResponse, { status: 500 }>["data"];
const has200: HasStatus<ClientResponse, 200> = true;
const has204: HasStatus<ClientResponse, 204> = true;
const has429: HasStatus<ClientResponse, 429> = true;
const has400: HasStatus<ClientResponse, 400> = true;
const has404: HasStatus<ClientResponse, 404> = true;
const has500: HasStatus<ClientResponse, 500> = true;
const validRateLimitData: ClientRateLimitData = { retryAfter: 1 };
const validBadRequestData: ClientBadRequestData = { message: "bad", issues: [] };
const validNotFoundData: ClientNotFoundData = { message: "missing" };
const validInternalErrorData: ClientInternalErrorData = { message: "boom" };
void has200;
void has204;
void has429;
void has400;
void has404;
void has500;
void validRateLimitData;
void validBadRequestData;
void validNotFoundData;
void validInternalErrorData;

type NaTypedClient = ReturnType<
	typeof createClient<typeof shape, typeof contracts, typeof middlewares, "N/A">
>;
type NaClientResponse = Awaited<ReturnType<NaTypedClient["fetch"]>>;
type NaClientRateLimitData = Extract<NaClientResponse, { status: 429 }>["data"];
const naHas200: HasStatus<NaClientResponse, 200> = true;
const naHas204: HasStatus<NaClientResponse, 204> = true;
const naHas429: HasStatus<NaClientResponse, 429> = true;
const naHas400: HasStatus<NaClientResponse, 400> = false;
const naHas404: HasStatus<NaClientResponse, 404> = false;
const naHas500: HasStatus<NaClientResponse, 500> = false;
const naValidRateLimitData: NaClientRateLimitData = { retryAfter: 1 };
void naHas200;
void naHas204;
void naHas429;
void naHas400;
void naHas404;
void naHas500;
void naValidRateLimitData;

const typedClient = createClient<typeof shape, typeof contracts, typeof middlewares, "public">(
	"http://localhost",
);
const naTypedClient = createClient<typeof shape, typeof contracts, typeof middlewares, "N/A">(
	"http://localhost",
);

const runTypeOnly = (_cb: () => void): void => {};

runTypeOnly(() => {
	void typedClient.fetch("/users/$userId", "post", {
		pathParams: { userId: "u1" },
		query: { type: "JSON", data: { active: true } },
		headers: { type: "JSON", data: { source: "dev" } },
		body: { type: "JSON", data: { name: "alice" } },
	});

	// @ts-expect-error unknown path should fail
	void typedClient.fetch("/unknown", "get");

	// @ts-expect-error method not declared on /events should fail
	void typedClient.fetch("/events", "post");

	// @ts-expect-error pathParams required for dynamic route
	void typedClient.fetch("/users/$userId", "post", {
		query: { type: "JSON", data: { active: true } },
		headers: { type: "JSON", data: { source: "dev" } },
		body: { type: "JSON", data: { name: "alice" } },
	});

	void typedClient.fetch("/structured", "post", {
		query: { type: "SuperJSON", data: { createdAt: new Date() } },
		headers: { type: "SuperJSON", data: { createdAt: new Date() } },
		body: { type: "SuperJSON", data: { createdAt: new Date() } },
	});

	void typedClient.fetch("/structured", "post", {
		body: { type: "SuperJSON", data: { createdAt: new Date() } },
	});

	void typedClient.fetch("/standard", "get", {
		query: { type: "Standard", data: { foo: "bar", count: "1" } },
		headers: { type: "Standard", data: { "x-trace": "trace", "x-meta": "meta" } },
	});

	void typedClient.fetch("/users/$userId", "post", {
		pathParams: { userId: "u1" },
		// @ts-expect-error query now requires a transport wrapper
		query: { active: true },
		headers: { type: "JSON", data: { source: "dev" } },
		body: { type: "JSON", data: { name: "alice" } },
	});

	// @ts-expect-error middleware status 429 must keep its declared payload shape
	const invalidRateLimitData: ClientRateLimitData = { retryAfter: "soon" };
	void invalidRateLimitData;

	const scopedShape = {
		SHAPE: {
			users: {
				CONTRACT: true,
				SHAPE: {
					$userId: { CONTRACT: true },
				},
			},
			events: { CONTRACT: true },
		},
	} as const satisfies ApiShape;

	const scopedContracts = {
		SHAPE: {
			users: {
				CONTRACT: {
					get: {
						responses: {
							200: { type: "JSON", schema: z.object({ users: z.array(z.string()) }) },
						},
					},
				},
				SHAPE: {
					$userId: {
						CONTRACT: {
							get: {
								pathParams: z.object({ userId: z.string() }),
								responses: {
									200: { type: "JSON", schema: z.object({ id: z.string() }) },
								},
							},
						},
					},
				},
			},
			events: {
				CONTRACT: {
					get: {
						responses: {
							200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
						},
					},
				},
			},
		},
	} as const satisfies ContractTreeFor<typeof scopedShape>;

	const scopedMiddlewares = {
		MIDDLEWARE: {
			auth: {
				401: { type: "JSON", schema: z.object({ scope: z.literal("root") }) },
			},
			audit: {
				418: { type: "JSON", schema: z.object({ traceId: z.string() }) },
			},
		},
		SHAPE: {
			users: {
				MIDDLEWARE: {
					auth: {
						403: { type: "JSON", schema: z.object({ scope: z.literal("users") }) },
					},
				},
				SHAPE: {
					$userId: {
						MIDDLEWARE: {
							rateLimit: {
								429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
							},
						},
					},
				},
			},
		},
	} as const satisfies MiddlewareTreeFor<typeof scopedShape>;

	const scopedClient = createClient<
		typeof scopedShape,
		typeof scopedContracts,
		typeof scopedMiddlewares,
		"public"
	>("http://localhost");

	const userResponsePromise = scopedClient.fetch("/users/$userId", "get", {
		pathParams: { userId: "u1" },
	});
	type UserResponse = Awaited<typeof userResponsePromise>;
	const userScopedAuth: Extract<UserResponse, { status: 403 }>["data"] = { scope: "users" };
	const userRateLimit: Extract<UserResponse, { status: 429 }>["data"] = { retryAfter: 1 };
	const userAudit: Extract<UserResponse, { status: 418 }>["data"] = { traceId: "trace-1" };
	void userScopedAuth;
	void userRateLimit;
	void userAudit;

	const userRootAuth: Extract<UserResponse, { status: 401 }> = {
		status: 401,
		data: { scope: "root" },
		response: new Response(),
	};
	void userRootAuth;

	const eventsResponsePromise = scopedClient.fetch("/events", "get");
	type EventsResponse = Awaited<typeof eventsResponsePromise>;
	const eventsRootAuth: Extract<EventsResponse, { status: 401 }>["data"] = { scope: "root" };
	const eventsAudit: Extract<EventsResponse, { status: 418 }>["data"] = { traceId: "trace-2" };
	void eventsRootAuth;
	void eventsAudit;

	// @ts-expect-error unrelated route should not include /users scoped auth
	const eventsScopedAuth: Extract<EventsResponse, { status: 403 }> = {
		status: 403,
		data: { scope: "users" },
		response: new Response(),
	};
	void eventsScopedAuth;

	// @ts-expect-error unrelated route should not include /users/$userId rate limit
	const eventsRateLimit: Extract<EventsResponse, { status: 429 }> = {
		status: 429,
		data: { retryAfter: 1 },
		response: new Response(),
	};
	void eventsRateLimit;

	const standardHeadersResponsePromise = typedClient.fetch("/responseHeadersStandard", "get");
	type StandardHeadersResponse = Awaited<typeof standardHeadersResponsePromise>;
	const standardHeaders: Extract<StandardHeadersResponse, { status: 200 }>["headers"] = {
		"x-trace": "trace-1",
		"x-meta": "meta-1",
	};
	void standardHeaders;

	const structuredHeadersResponsePromise = typedClient.fetch("/responseHeadersStructured", "get");
	type StructuredHeadersResponse = Awaited<typeof structuredHeadersResponsePromise>;
	const structuredHeaders: Extract<StructuredHeadersResponse, { status: 200 }>["headers"] = {
		createdAt: new Date(),
	};
	void structuredHeaders;

	const eventResponsePromise = typedClient.fetch("/events", "get");
	type EventResponse = Awaited<typeof eventResponsePromise>;
	const eventHeaders: Extract<EventResponse, { status: 200 }>["headers"] = undefined;
	void eventHeaders;

	const naEventResponsePromise = naTypedClient.fetch("/events", "get");
	type NaEventResponse = Awaited<typeof naEventResponsePromise>;
	const naEventServiceUnavailableData: Extract<NaEventResponse, { status: 503 }>["data"] = {
		message: "down",
	};
	void naEventServiceUnavailableData;

	// @ts-expect-error "N/A" client omits inferred built-in error statuses
	const naBadRequestData: Extract<NaClientResponse, { status: 400 }>["data"] = {
		message: "bad",
		issues: [],
	};
	void naBadRequestData;

	// @ts-expect-error "N/A" client omits inferred built-in error statuses
	const naNotFoundData: Extract<NaClientResponse, { status: 404 }>["data"] = {
		message: "missing",
	};
	void naNotFoundData;

	// @ts-expect-error "N/A" client omits inferred built-in error statuses
	const naInternalErrorData: Extract<NaClientResponse, { status: 500 }>["data"] = {
		message: "boom",
	};
	void naInternalErrorData;

	// @ts-expect-error response headers are required when declared
	const missingStandardHeaders: Extract<StandardHeadersResponse, { status: 200 }> = {
		status: 200,
		data: { ok: true },
		response: new Response(),
	};
	void missingStandardHeaders;

	const invalidStructuredHeaders: Extract<StructuredHeadersResponse, { status: 200 }>["headers"] =
		{
			// @ts-expect-error response headers must match the declared schema
			createdAt: "2024-02-02T00:00:00.000Z",
		};
	void invalidStructuredHeaders;
});
