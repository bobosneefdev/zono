import { describe, expect, test } from "bun:test";
import type { Context } from "hono";
import { Hono } from "hono";
import superjson from "superjson";
import z from "zod";
import { createContracts } from "~/contract/contract.js";
import type { RouterShape } from "~/contract/contract.types.js";
import {
	createHonoContractHandlers,
	createHonoMiddlewareHandlers,
	createHonoOptions,
	initHono,
} from "~/hono/hono.js";
import { createMiddlewares } from "~/middleware/middleware.js";

const shape = {
	ROUTER: {
		users: {
			ROUTER: {
				register: { CONTRACT: true },
				$userId: { CONTRACT: true },
			},
		},
		health: { CONTRACT: true },
		responses: {
			ROUTER: {
				json: { CONTRACT: true },
				superjson: { CONTRACT: true },
				superjsonQuery: { CONTRACT: true },
				text: { CONTRACT: true },
				blob: { CONTRACT: true },
				arrayBuffer: { CONTRACT: true },
				formData: { CONTRACT: true },
				readableStream: { CONTRACT: true },
				voidResponse: { CONTRACT: true },
				standardHeaders: { CONTRACT: true },
				superjsonHeaders: { CONTRACT: true },
			},
		},
		bodies: {
			ROUTER: {
				json: { CONTRACT: true },
				superjson: { CONTRACT: true },
				string: { CONTRACT: true },
				urlSearchParams: { CONTRACT: true },
				formData: { CONTRACT: true },
				blob: { CONTRACT: true },
				uint8Array: { CONTRACT: true },
				standardHeaders: { CONTRACT: true },
				superjsonHeaders: { CONTRACT: true },
			},
		},
	},
} as const satisfies RouterShape;

const zUser = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string(),
});

const contracts = createContracts(shape, {
	ROUTER: {
		users: {
			ROUTER: {
				register: {
					CONTRACT: {
						post: {
							body: {
								type: "JSON",
								schema: z.object({ name: z.string(), email: z.string().email() }),
							},
							responses: { 201: { type: "JSON", schema: zUser } },
						},
					},
				},
				$userId: {
					CONTRACT: {
						get: {
							pathParams: z.object({ userId: z.string() }),
							responses: { 200: { type: "JSON", schema: zUser } },
						},
					},
				},
			},
		},
		health: {
			CONTRACT: {
				get: {
					responses: {
						200: {
							type: "JSON",
							schema: z.object({ status: z.string() }),
						},
					},
				},
			},
		},
		responses: {
			ROUTER: {
				json: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									type: "JSON",
									schema: z.object({ kind: z.literal("json") }),
								},
							},
						},
					},
				},
				superjson: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									type: "SuperJSON",
									schema: z.object({
										kind: z.literal("superjson"),
										createdAt: z.date(),
										counters: z.map(z.string(), z.number()),
										tags: z.set(z.string()),
									}),
								},
							},
						},
					},
				},
				superjsonQuery: {
					CONTRACT: {
						get: {
							query: {
								type: "SuperJSON",
								schema: z.object({
									filters: z.array(
										z.object({
											label: z.string(),
											at: z.date(),
										}),
									),
									metadata: z.map(z.string(), z.number()),
								}),
							},
							responses: {
								200: {
									type: "JSON",
									schema: z.object({
										filterCount: z.number(),
										firstAtIso: z.string(),
										metadataTotal: z.number(),
									}),
								},
							},
						},
					},
				},
				text: {
					CONTRACT: {
						get: {
							responses: { 200: { type: "Text", schema: z.string() } },
						},
					},
				},
				blob: {
					CONTRACT: {
						get: {
							responses: { 200: { type: "Blob", schema: z.instanceof(Blob) } },
						},
					},
				},
				arrayBuffer: {
					CONTRACT: {
						get: {
							responses: {
								200: { type: "ArrayBuffer", schema: z.instanceof(ArrayBuffer) },
							},
						},
					},
				},
				formData: {
					CONTRACT: {
						get: {
							responses: {
								200: { type: "FormData", schema: z.instanceof(FormData) },
							},
						},
					},
				},
				readableStream: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									type: "ReadableStream",
									schema: z.instanceof(ReadableStream),
								},
							},
						},
					},
				},
				voidResponse: {
					CONTRACT: {
						get: {
							responses: { 204: { type: "Void" } },
						},
					},
				},
				standardHeaders: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									type: "JSON",
									schema: z.object({ ok: z.literal(true) }),
									headers: {
										type: "Standard",
										schema: z.object({ "x-from-server": z.string() }),
									},
								},
							},
						},
					},
				},
				superjsonHeaders: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									type: "JSON",
									schema: z.object({ ok: z.literal(true) }),
									headers: {
										type: "SuperJSON",
										schema: z.object({
											meta: z.object({
												source: z.string(),
												attempt: z.number(),
												generatedAt: z.date(),
											}),
											quotas: z.map(z.string(), z.number()),
											scopes: z.set(z.string()),
										}),
									},
								},
							},
						},
					},
				},
			},
		},
		bodies: {
			ROUTER: {
				json: {
					CONTRACT: {
						post: {
							body: { type: "JSON", schema: z.object({ message: z.string() }) },
							responses: {
								200: { type: "JSON", schema: z.object({ echoed: z.string() }) },
							},
						},
					},
				},
				superjson: {
					CONTRACT: {
						post: {
							body: {
								type: "SuperJSON",
								schema: z.object({
									payload: z.object({
										createdAt: z.date(),
										scores: z.map(z.string(), z.number()),
										flags: z.set(z.string()),
									}),
								}),
							},
							responses: {
								200: {
									type: "JSON",
									schema: z.object({
										isoDate: z.string(),
										scoreTotal: z.number(),
										hasPriority: z.boolean(),
									}),
								},
							},
						},
					},
				},
				string: {
					CONTRACT: {
						post: {
							body: { type: "String", schema: z.string().min(1) },
							responses: { 200: { type: "Text", schema: z.string() } },
						},
					},
				},
				urlSearchParams: {
					CONTRACT: {
						post: {
							body: {
								type: "URLSearchParams",
								schema: z.instanceof(URLSearchParams),
							},
							responses: {
								200: { type: "JSON", schema: z.object({ query: z.string() }) },
							},
						},
					},
				},
				formData: {
					CONTRACT: {
						post: {
							body: { type: "FormData", schema: z.instanceof(FormData) },
							responses: {
								200: { type: "JSON", schema: z.object({ field: z.string() }) },
							},
						},
					},
				},
				blob: {
					CONTRACT: {
						post: {
							body: { type: "Blob", schema: z.instanceof(Blob) },
							responses: {
								200: { type: "JSON", schema: z.object({ size: z.number() }) },
							},
						},
					},
				},
				uint8Array: {
					CONTRACT: {
						post: {
							body: { type: "Uint8Array", schema: z.instanceof(Uint8Array) },
							responses: {
								200: { type: "JSON", schema: z.object({ length: z.number() }) },
							},
						},
					},
				},
				standardHeaders: {
					CONTRACT: {
						post: {
							headers: {
								type: "Standard",
								schema: z.object({ "x-trace-id": z.string() }),
							},
							responses: {
								200: { type: "JSON", schema: z.object({ traceId: z.string() }) },
							},
						},
					},
				},
				superjsonHeaders: {
					CONTRACT: {
						post: {
							headers: {
								type: "SuperJSON",
								schema: z.object({
									auth: z.object({
										token: z.string(),
										issuedAt: z.date(),
										scopes: z.set(z.string()),
										quotas: z.map(z.string(), z.number()),
									}),
								}),
							},
							responses: {
								200: {
									type: "JSON",
									schema: z.object({
										token: z.string(),
										issuedAt: z.string(),
										scopeCount: z.number(),
										quotaTotal: z.number(),
									}),
								},
							},
						},
					},
				},
			},
		},
	},
});

const middleware = createMiddlewares(contracts, {
	MIDDLEWARE: {
		rateLimit: {
			429: {
				type: "JSON",
				schema: z.object({ retryAfter: z.number() }),
			},
		},
	},
	ROUTER: {
		users: {
			ROUTER: {
				register: {
					MIDDLEWARE: {
						antiBot: {
							403: {
								type: "JSON",
								schema: z.object({ error: z.string() }),
							},
						},
					},
				},
			},
		},
	},
});

createMiddlewares(contracts, {
	// @ts-expect-error invalid top-level key in middleware definition
	MISSING: {},
});

createMiddlewares(contracts, {
	ROUTER: {
		users: {
			ROUTER: {
				// @ts-expect-error invalid nested key in middleware definition
				missing: {},
			},
		},
	},
});

const middlewareOptions = createHonoOptions({ errorMode: "public" });
createHonoMiddlewareHandlers(middleware, middlewareOptions, {
	MIDDLEWARE: {
		// @ts-expect-error rateLimit 429 data must match declared schema ({ retryAfter: number })
		rateLimit: async () => ({
			type: "JSON" as const,
			status: 429 as const,
			data: "wrong type",
		}),
	},
});

createHonoMiddlewareHandlers(middleware, middlewareOptions, {
	// @ts-expect-error invalid top-level key in Hono middleware handlers
	MISSING: {},
});

const strictHandlerShape = {
	ROUTER: {
		ping: {
			CONTRACT: true,
		},
	},
} as const satisfies RouterShape;

const strictHandlerContracts = createContracts(strictHandlerShape, {
	ROUTER: {
		ping: {
			CONTRACT: {
				get: {
					responses: {
						200: {
							type: "JSON",
							schema: z.object({ ok: z.boolean() }),
						},
					},
				},
			},
		},
	},
});

createHonoContractHandlers(strictHandlerContracts, middlewareOptions, {
	ROUTER: {
		ping: {
			HANDLER: {
				get: () => ({
					type: "JSON" as const,
					status: 200 as const,
					data: { ok: true },
				}),
			},
		},
		// @ts-expect-error invalid top-level key in Hono contract handlers
		missing: {
			HANDLER: {
				get: () => ({
					type: "JSON" as const,
					status: 200 as const,
					data: { ok: true },
				}),
			},
		},
	},
});

function createTestApp(options?: {
	shortCircuitRateLimit?: boolean;
	throwOnUserGet?: boolean;
	additionalHandlerParams?: (
		ctx: Context,
	) => Promise<readonly [string | undefined]> | readonly [string | undefined];
}) {
	const app = new Hono();

	initHono(
		app,
		contracts,
		{
			ROUTER: {
				users: {
					ROUTER: {
						register: {
							HANDLER: {
								post: (input) => ({
									type: "JSON" as const,
									status: 201 as const,
									data: { id: "test-id", ...input.body },
								}),
							},
						},
						$userId: {
							HANDLER: {
								get: (input) => {
									if (
										options?.throwOnUserGet &&
										input.pathParams.userId === "explode"
									) {
										throw new Error("boom");
									}
									return {
										type: "JSON" as const,
										status: 200 as const,
										data: {
											id: input.pathParams.userId,
											name: "Test User",
											email: "test@example.com",
										},
									};
								},
							},
						},
					},
				},
				health: {
					HANDLER: {
						get: (_input, _ctx, authValue) => ({
							type: "JSON" as const,
							status: 200 as const,
							data: { status: authValue ?? "ok" },
						}),
					},
				},
				responses: {
					ROUTER: {
						json: {
							HANDLER: {
								get: () => ({
									type: "JSON" as const,
									status: 200 as const,
									data: { kind: "json" as const },
								}),
							},
						},
						superjson: {
							HANDLER: {
								get: () => ({
									type: "SuperJSON" as const,
									status: 200 as const,
									data: {
										kind: "superjson" as const,
										createdAt: new Date("2025-01-01T00:00:00.000Z"),
										counters: new Map([
											["success", 2],
											["failure", 1],
										]),
										tags: new Set(["alpha", "beta"]),
									},
								}),
							},
						},
						superjsonQuery: {
							HANDLER: {
								get: (input) => {
									const metadataTotal = [...input.query.metadata.values()].reduce(
										(total, value) => total + value,
										0,
									);

									return {
										type: "JSON" as const,
										status: 200 as const,
										data: {
											filterCount: input.query.filters.length,
											firstAtIso:
												input.query.filters[0]?.at.toISOString() ?? "",
											metadataTotal,
										},
									};
								},
							},
						},
						text: {
							HANDLER: {
								get: () => ({
									type: "Text" as const,
									status: 200 as const,
									data: "plain-text",
								}),
							},
						},
						blob: {
							HANDLER: {
								get: () => ({
									type: "Blob" as const,
									status: 200 as const,
									data: new Blob(["blob-data"], { type: "text/plain" }),
								}),
							},
						},
						arrayBuffer: {
							HANDLER: {
								get: () => ({
									type: "ArrayBuffer" as const,
									status: 200 as const,
									data: new TextEncoder().encode("array-buffer").buffer,
								}),
							},
						},
						formData: {
							HANDLER: {
								get: () => {
									const fd = new FormData();
									fd.set("field", "form-value");
									return {
										type: "FormData" as const,
										status: 200 as const,
										data: fd,
									};
								},
							},
						},
						readableStream: {
							HANDLER: {
								get: () => ({
									type: "ReadableStream" as const,
									status: 200 as const,
									data: new ReadableStream({
										start(controller) {
											controller.enqueue(
												new TextEncoder().encode("stream-body"),
											);
											controller.close();
										},
									}),
								}),
							},
						},
						voidResponse: {
							HANDLER: {
								get: () => ({
									type: "Void" as const,
									status: 204 as const,
								}),
							},
						},
						standardHeaders: {
							HANDLER: {
								get: () => ({
									type: "JSON" as const,
									status: 200 as const,
									data: { ok: true as const },
									headers: { "x-from-server": "hono" },
								}),
							},
						},
						superjsonHeaders: {
							HANDLER: {
								get: () => ({
									type: "JSON" as const,
									status: 200 as const,
									data: { ok: true as const },
									headers: {
										meta: {
											source: "hono",
											attempt: 1,
											generatedAt: new Date("2025-01-02T00:00:00.000Z"),
										},
										quotas: new Map([
											["read", 5],
											["write", 2],
										]),
										scopes: new Set(["read", "write"]),
									},
								}),
							},
						},
					},
				},
				bodies: {
					ROUTER: {
						json: {
							HANDLER: {
								post: (input) => ({
									type: "JSON" as const,
									status: 200 as const,
									data: { echoed: input.body.message },
								}),
							},
						},
						superjson: {
							HANDLER: {
								post: (input) => {
									const scoreTotal = [
										...input.body.payload.scores.values(),
									].reduce((total, score) => total + score, 0);

									return {
										type: "JSON" as const,
										status: 200 as const,
										data: {
											isoDate: input.body.payload.createdAt.toISOString(),
											scoreTotal,
											hasPriority: input.body.payload.flags.has("priority"),
										},
									};
								},
							},
						},
						string: {
							HANDLER: {
								post: (input) => ({
									type: "Text" as const,
									status: 200 as const,
									data: input.body.toUpperCase(),
								}),
							},
						},
						urlSearchParams: {
							HANDLER: {
								post: (input) => ({
									type: "JSON" as const,
									status: 200 as const,
									data: { query: input.body.get("q") ?? "" },
								}),
							},
						},
						formData: {
							HANDLER: {
								post: (input) => ({
									type: "JSON" as const,
									status: 200 as const,
									data: { field: String(input.body.get("field") ?? "") },
								}),
							},
						},
						blob: {
							HANDLER: {
								post: (input) => ({
									type: "JSON" as const,
									status: 200 as const,
									data: { size: input.body.size },
								}),
							},
						},
						uint8Array: {
							HANDLER: {
								post: (input) => ({
									type: "JSON" as const,
									status: 200 as const,
									data: { length: input.body.byteLength },
								}),
							},
						},
						standardHeaders: {
							HANDLER: {
								post: (input) => ({
									type: "JSON" as const,
									status: 200 as const,
									data: { traceId: input.headers["x-trace-id"] },
								}),
							},
						},
						superjsonHeaders: {
							HANDLER: {
								post: (input) => {
									const quotaTotal = [
										...input.headers.auth.quotas.values(),
									].reduce((total, value) => total + value, 0);

									return {
										type: "JSON" as const,
										status: 200 as const,
										data: {
											token: input.headers.auth.token,
											issuedAt: input.headers.auth.issuedAt.toISOString(),
											scopeCount: input.headers.auth.scopes.size,
											quotaTotal,
										},
									};
								},
							},
						},
					},
				},
			},
		},
		middleware,
		{
			MIDDLEWARE: {
				rateLimit: async (_ctx, next) => {
					if (options?.shortCircuitRateLimit) {
						return {
							type: "JSON" as const,
							status: 429 as const,
							data: { retryAfter: 60 },
						};
					}
					await next();
				},
			},
			ROUTER: {
				users: {
					ROUTER: {
						register: {
							MIDDLEWARE: {
								antiBot: async (_ctx, next) => {
									await next();
								},
							},
						},
					},
				},
			},
		},
		{
			additionalHandlerParams: options?.additionalHandlerParams,
			errorMode: "public",
		},
	);

	return app;
}

describe("createHono", () => {
	test("registers GET routes", async () => {
		const app = createTestApp();
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok" });
	});

	test("routes without query or headers contracts ignore extra request query and headers", async () => {
		const app = createTestApp();
		const res = await app.request("/health?unused=yes", {
			headers: {
				auth: "not-superjson",
				"x-extra": "value",
			},
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok" });
	});

	test("registers POST routes with body parsing", async () => {
		const app = createTestApp();
		const res = await app.request("/users/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "John", email: "john@example.com" }),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body).toEqual({ id: "test-id", name: "John", email: "john@example.com" });
	});

	test("handles path parameters", async () => {
		const app = createTestApp();
		const res = await app.request("/users/abc-123");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.id).toBe("abc-123");
	});

	test("returns 400 for invalid body", async () => {
		const app = createTestApp();
		const res = await app.request("/users/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: 123 }),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.type).toBe("invalidInput");
		expect(Array.isArray(body.issues)).toBe(true);
	});

	test("returns hard-coded 404 body for unknown route", async () => {
		const app = createTestApp();
		const res = await app.request("/does-not-exist");
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ type: "notFound" });
	});

	test("returns hard-coded 500 body when handler throws", async () => {
		const app = createTestApp({ throwOnUserGet: true });
		const res = await app.request("/users/explode");
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ type: "internalError" });
	});

	test("middleware passes through when not short-circuiting", async () => {
		const app = createTestApp();
		const res = await app.request("/users/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "John", email: "john@test.com" }),
		});
		expect(res.status).toBe(201);
	});

	test("middleware can short-circuit with typed response", async () => {
		const app = createTestApp({ shortCircuitRateLimit: true });
		const res = await app.request("/health");
		expect(res.status).toBe(429);
		expect(await res.json()).toEqual({ retryAfter: 60 });
	});

	test("parses JSON, SuperJSON, String, URLSearchParams, FormData, Blob, and Uint8Array bodies", async () => {
		const app = createTestApp();

		const json = await app.request("/bodies/json", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ message: "hello" }),
		});
		expect(json.status).toBe(200);
		expect(await json.json()).toEqual({ echoed: "hello" });

		const superjsonBody = await app.request("/bodies/superjson", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(
				superjson.serialize({
					payload: {
						createdAt: new Date("2025-03-01T00:00:00.000Z"),
						scores: new Map([
							["math", 4],
							["science", 8],
						]),
						flags: new Set(["priority", "gift"]),
					},
				}),
			),
		});
		expect(superjsonBody.status).toBe(200);
		expect(await superjsonBody.json()).toEqual({
			isoDate: "2025-03-01T00:00:00.000Z",
			scoreTotal: 12,
			hasPriority: true,
		});

		const stringBody = await app.request("/bodies/string", {
			method: "POST",
			headers: { "content-type": "text/plain" },
			body: "hello",
		});
		expect(stringBody.status).toBe(200);
		expect(await stringBody.text()).toBe("HELLO");

		const params = new URLSearchParams();
		params.set("q", "zono");
		const urlSearchParams = await app.request("/bodies/urlSearchParams", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: params.toString(),
		});
		expect(urlSearchParams.status).toBe(200);
		expect(await urlSearchParams.json()).toEqual({ query: "zono" });

		const formData = new FormData();
		formData.set("field", "field-value");
		const formDataBody = await app.request("/bodies/formData", {
			method: "POST",
			body: formData,
		});
		expect(formDataBody.status).toBe(200);
		expect(await formDataBody.json()).toEqual({ field: "field-value" });

		const blobBody = await app.request("/bodies/blob", {
			method: "POST",
			body: new Blob(["blob-body"], { type: "text/plain" }),
		});
		expect(blobBody.status).toBe(200);
		expect(await blobBody.json()).toEqual({ size: 9 });

		const uint8ArrayBody = await app.request("/bodies/uint8Array", {
			method: "POST",
			body: new Uint8Array([1, 2, 3, 4]),
		});
		expect(uint8ArrayBody.status).toBe(200);
		expect(await uint8ArrayBody.json()).toEqual({ length: 4 });
	});

	test("parses standard and superjson request headers", async () => {
		const app = createTestApp();

		const standard = await app.request("/bodies/standardHeaders", {
			method: "POST",
			headers: { "x-trace-id": "trace-123" },
		});
		expect(standard.status).toBe(200);
		expect(await standard.json()).toEqual({ traceId: "trace-123" });

		const superjsonHeaders = await app.request("/bodies/superjsonHeaders", {
			method: "POST",
			headers: {
				auth: superjson.stringify({
					token: "token-abc",
					issuedAt: new Date("2025-03-02T00:00:00.000Z"),
					scopes: new Set(["read", "write"]),
					quotas: new Map([
						["read", 5],
						["write", 2],
					]),
				}),
			},
		});
		expect(superjsonHeaders.status).toBe(200);
		expect(await superjsonHeaders.json()).toEqual({
			token: "token-abc",
			issuedAt: "2025-03-02T00:00:00.000Z",
			scopeCount: 2,
			quotaTotal: 7,
		});
	});

	test("still validates query and headers when contracts declare them", async () => {
		const app = createTestApp();

		const missingQuery = await app.request("/responses/superjsonQuery");
		expect(missingQuery.status).toBe(400);
		expect((await missingQuery.json()).type).toBe("invalidInput");

		const missingHeader = await app.request("/bodies/standardHeaders", {
			method: "POST",
		});
		expect(missingHeader.status).toBe(400);
		expect((await missingHeader.json()).type).toBe("invalidInput");
	});

	test("emits JSON, SuperJSON, Text, Blob, ArrayBuffer, FormData, ReadableStream, and Void responses", async () => {
		const app = createTestApp();

		const json = await app.request("/responses/json");
		expect(json.status).toBe(200);
		expect(await json.json()).toEqual({ kind: "json" });

		const superjsonResponse = await app.request("/responses/superjson");
		expect(superjsonResponse.status).toBe(200);
		const superjsonWire = await superjsonResponse.json();
		const superjsonDecoded = superjson.deserialize<unknown>(
			superjsonWire as Parameters<typeof superjson.deserialize>[0],
		);
		const parsedSuperjson = z
			.object({
				kind: z.literal("superjson"),
				createdAt: z.date(),
				counters: z.map(z.string(), z.number()),
				tags: z.set(z.string()),
			})
			.safeParse(superjsonDecoded);
		expect(parsedSuperjson.success).toBe(true);
		if (parsedSuperjson.success) {
			expect(parsedSuperjson.data.kind).toBe("superjson");
			expect(parsedSuperjson.data.createdAt.toISOString()).toBe("2025-01-01T00:00:00.000Z");
			expect(parsedSuperjson.data.counters).toEqual(
				new Map([
					["success", 2],
					["failure", 1],
				]),
			);
			expect(parsedSuperjson.data.tags).toEqual(new Set(["alpha", "beta"]));
		}

		const superjsonQuery = await app.request(
			`/responses/superjsonQuery?${new URLSearchParams({
				filters: superjson.stringify([
					{ label: "one", at: new Date("2025-05-01T00:00:00.000Z") },
				]),
				metadata: superjson.stringify(
					new Map([
						["a", 1],
						["b", 2],
					]),
				),
			})}`,
		);
		expect(superjsonQuery.status).toBe(200);
		expect(await superjsonQuery.json()).toEqual({
			filterCount: 1,
			firstAtIso: "2025-05-01T00:00:00.000Z",
			metadataTotal: 3,
		});

		const text = await app.request("/responses/text");
		expect(text.status).toBe(200);
		expect(await text.text()).toBe("plain-text");

		const blob = await app.request("/responses/blob");
		expect(blob.status).toBe(200);
		expect(await (await blob.blob()).text()).toBe("blob-data");

		const arrayBuffer = await app.request("/responses/arrayBuffer");
		expect(arrayBuffer.status).toBe(200);
		expect(new TextDecoder().decode(await arrayBuffer.arrayBuffer())).toBe("array-buffer");

		const formData = await app.request("/responses/formData");
		expect(formData.status).toBe(200);
		expect((await formData.formData()).get("field")).toBe("form-value");

		const readableStream = await app.request("/responses/readableStream");
		expect(readableStream.status).toBe(200);
		expect(await readableStream.text()).toBe("stream-body");

		const voidResponse = await app.request("/responses/voidResponse");
		expect(voidResponse.status).toBe(204);
		expect(await voidResponse.text()).toBe("");
	});

	test("emits standard and superjson response headers", async () => {
		const app = createTestApp();

		const standard = await app.request("/responses/standardHeaders");
		expect(standard.status).toBe(200);
		expect(standard.headers.get("x-from-server")).toBe("hono");

		const superjsonHeaders = await app.request("/responses/superjsonHeaders");
		expect(superjsonHeaders.status).toBe(200);
		expect(superjsonHeaders.headers.get("x-zono-superjson-headers")).toBeNull();

		const encodedMeta = superjsonHeaders.headers.get("meta");
		const encodedQuotas = superjsonHeaders.headers.get("quotas");
		const encodedScopes = superjsonHeaders.headers.get("scopes");
		expect(encodedMeta).toBeTruthy();
		expect(encodedQuotas).toBeTruthy();
		expect(encodedScopes).toBeTruthy();

		if (encodedMeta && encodedQuotas && encodedScopes) {
			const parsedHeaders = z
				.object({
					meta: z.object({
						source: z.string(),
						attempt: z.number(),
						generatedAt: z.date(),
					}),
					quotas: z.map(z.string(), z.number()),
					scopes: z.set(z.string()),
				})
				.safeParse({
					meta: superjson.parse<unknown>(encodedMeta),
					quotas: superjson.parse<unknown>(encodedQuotas),
					scopes: superjson.parse<unknown>(encodedScopes),
				});
			expect(parsedHeaders.success).toBe(true);
			if (parsedHeaders.success) {
				expect(parsedHeaders.data).toEqual({
					meta: {
						source: "hono",
						attempt: 1,
						generatedAt: new Date("2025-01-02T00:00:00.000Z"),
					},
					quotas: new Map([
						["read", 5],
						["write", 2],
					]),
					scopes: new Set(["read", "write"]),
				});
			}
		}
	});

	test("additionalHandlerParams passes additional params to handlers", async () => {
		const app = createTestApp({
			additionalHandlerParams: (ctx: Context) => [ctx.req.header("Authorization")],
		});

		const withAuth = await app.request("/health", {
			headers: { Authorization: "Bearer secret-token" },
		});
		expect(withAuth.status).toBe(200);
		expect(await withAuth.json()).toEqual({ status: "Bearer secret-token" });

		const withoutAuth = await app.request("/health");
		expect(withoutAuth.status).toBe(200);
		expect(await withoutAuth.json()).toEqual({ status: "ok" });
	});

	test("additionalHandlerParams supports async resolution", async () => {
		const app = createTestApp({
			additionalHandlerParams: async (ctx: Context) => {
				await new Promise((resolve) => setTimeout(resolve, 0));
				return [ctx.req.header("Authorization") ?? "async-no-auth"] as const;
			},
		});

		const res = await app.request("/health");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "async-no-auth" });
	});
});
