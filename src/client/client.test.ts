import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import z from "zod";
import { createClient } from "~/client/client.js";
import { createContracts } from "~/contract/contract.js";
import type { RouterShape } from "~/contract/contract.types.js";
import { initHono } from "~/hono/hono.js";
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
		verbs: {
			ROUTER: {
				get: { CONTRACT: true },
				post: { CONTRACT: true },
			},
		},
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
							responses: {
								201: { type: "JSON", schema: zUser },
							},
						},
					},
				},
				$userId: {
					CONTRACT: {
						get: {
							pathParams: z.object({ userId: z.string() }),
							responses: {
								200: { type: "JSON", schema: zUser },
							},
						},
					},
				},
			},
		},
		health: {
			CONTRACT: {
				get: {
					responses: {
						200: { type: "JSON", schema: z.object({ status: z.string() }) },
					},
				},
			},
		},
		verbs: {
			ROUTER: {
				get: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									type: "JSON",
									schema: z.object({ route: z.literal("get") }),
								},
							},
						},
					},
				},
				post: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									type: "JSON",
									schema: z.object({ route: z.literal("post") }),
								},
							},
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
							responses: {
								200: { type: "Text", schema: z.string() },
							},
						},
					},
				},
				blob: {
					CONTRACT: {
						get: {
							responses: {
								200: { type: "Blob", schema: z.instanceof(Blob) },
							},
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
							responses: {
								204: { type: "Void" },
							},
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
							responses: {
								200: { type: "Text", schema: z.string() },
							},
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
							body: {
								type: "JSON",
								schema: z.object({ ok: z.boolean().optional() }),
							},
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
							body: {
								type: "JSON",
								schema: z.object({ ok: z.boolean().optional() }),
							},
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
});

const typeClient = createClient(contracts, {
	baseUrl: "http://localhost:0",
	middleware: [middleware],
});
const assertType = <T>(_value: T) => undefined;
assertType<Parameters<typeof typeClient.health>[0]>("get");
assertType<Parameters<typeof typeClient.bodies.string>[0]>("post");
assertType<Parameters<typeof typeClient.bodies.string>[1]>({ body: "ok" });
assertType<Parameters<typeof typeClient.bodies.standardHeaders>[1]>({
	body: {},
	headers: { "x-trace-id": "trace-123" },
});
assertType<Parameters<typeof typeClient.bodies.superjsonHeaders>[1]>({
	body: {},
	headers: {
		auth: {
			token: "token-abc",
			issuedAt: new Date("2025-03-01T00:00:00.000Z"),
			scopes: new Set(["read", "write"]),
			quotas: new Map([
				["read", 5],
				["write", 2],
			]),
		},
	},
});
// @ts-expect-error string body route does not accept numbers
assertType<Parameters<typeof typeClient.bodies.string>[1]>({ body: 123 });
// @ts-expect-error routes without input fields do not expose a second parameter type
type _HealthSecondParameter = Parameters<typeof typeClient.health>[1];

let server: ReturnType<typeof Bun.serve>;
const PORT = 19876;

beforeAll(() => {
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
									data: { id: "new-id", ...input.body },
								}),
							},
						},
						$userId: {
							HANDLER: {
								get: (input) => {
									if (input.pathParams.userId === "explode") {
										throw new Error("forced failure");
									}
									return {
										type: "JSON" as const,
										status: 200 as const,
										data: {
											id: input.pathParams.userId,
											name: "User",
											email: "user@test.com",
										},
									};
								},
							},
						},
					},
				},
				health: {
					HANDLER: {
						get: () => ({
							type: "JSON" as const,
							status: 200 as const,
							data: { status: "ok" },
						}),
					},
				},
				verbs: {
					ROUTER: {
						get: {
							HANDLER: {
								get: () => ({
									type: "JSON" as const,
									status: 200 as const,
									data: { route: "get" as const },
								}),
							},
						},
						post: {
							HANDLER: {
								get: () => ({
									type: "JSON" as const,
									status: 200 as const,
									data: { route: "post" as const },
								}),
							},
						},
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
		undefined,
		undefined,
		{ errorMode: "public" },
	);
	server = Bun.serve({ fetch: app.fetch, port: PORT });
});

afterAll(() => {
	server.stop();
});

describe("createClient", () => {
	const client = createClient(contracts, {
		baseUrl: `http://localhost:${PORT}`,
		middleware: [middleware],
		serverErrorMode: "public",
	});

	test("keeps existing JSON route behavior and error branches", async () => {
		const health = await client.health("get");
		expect(health.status).toBe(200);
		expect(health.body).toEqual({ status: "ok" });

		const createUser = await client.users.register("post", {
			body: { name: "John", email: "john@example.com" },
		});
		expect(createUser.status).toBe(201);

		const user = await client.users.$userId("get", {
			pathParams: { userId: "user-123" },
		});
		expect(user.status).toBe(200);

		const missingBaseClient = createClient(contracts, {
			baseUrl: `http://localhost:${PORT}/missing-base`,
			middleware: [middleware],
			serverErrorMode: "public",
		});
		const notFound = await missingBaseClient.health("get");
		expect(notFound.status).toBe(404);
		if (notFound.status === 404) {
			expect(notFound.body).toEqual({ type: "notFound" });
		}

		const internal = await client.users.$userId("get", {
			pathParams: { userId: "explode" },
		});
		expect(internal.status).toBe(500);
		if (internal.status === 500) {
			expect(internal.body).toEqual({ type: "internalError" });
		}
	});

	test("supports path segments that match HTTP verb names", async () => {
		const getSegment = await client.verbs.get("get");
		expect(getSegment.status).toBe(200);
		if (getSegment.status === 200) {
			expect(getSegment.body.route).toBe("get");
		}

		const postSegment = await client.verbs.post("get");
		expect(postSegment.status).toBe(200);
		if (postSegment.status === 200) {
			expect(postSegment.body.route).toBe("post");
		}
	});

	test("fails fast on invalid client body input", async () => {
		await expect(
			client.users.register("post", {
				body: { name: "John", email: "not-an-email" },
			}),
		).rejects.toThrow("Contract validation failed");
	});

	test("parses all response body types", async () => {
		const json = await client.responses.json("get");
		expect(json.status).toBe(200);
		if (json.status === 200) {
			expect(json.body).toEqual({ kind: "json" });
		}

		const superjson = await client.responses.superjson("get");
		expect(superjson.status).toBe(200);
		if (superjson.status === 200) {
			expect(superjson.body.kind).toBe("superjson");
			expect(superjson.body.createdAt).toBeInstanceOf(Date);
			expect(superjson.body.createdAt.toISOString()).toBe("2025-01-01T00:00:00.000Z");
			expect(superjson.body.counters).toEqual(
				new Map([
					["success", 2],
					["failure", 1],
				]),
			);
			expect(superjson.body.tags).toEqual(new Set(["alpha", "beta"]));
		}

		const superjsonQuery = await client.responses.superjsonQuery("get", {
			query: {
				filters: [
					{
						label: "one",
						at: new Date("2025-05-01T00:00:00.000Z"),
					},
				],
				metadata: new Map([
					["a", 1],
					["b", 2],
				]),
			},
		});
		expect(superjsonQuery.status).toBe(200);
		if (superjsonQuery.status === 200) {
			expect(superjsonQuery.body).toEqual({
				filterCount: 1,
				firstAtIso: "2025-05-01T00:00:00.000Z",
				metadataTotal: 3,
			});
		}

		const text = await client.responses.text("get");
		expect(text.status).toBe(200);
		if (text.status === 200) {
			expect(text.body).toBe("plain-text");
		}

		const blob = await client.responses.blob("get");
		expect(blob.status).toBe(200);
		if (blob.status === 200) {
			expect(blob.body).toBeInstanceOf(Blob);
			expect(await blob.body.text()).toBe("blob-data");
		}

		const arrayBuffer = await client.responses.arrayBuffer("get");
		expect(arrayBuffer.status).toBe(200);
		if (arrayBuffer.status === 200) {
			expect(arrayBuffer.body).toBeInstanceOf(ArrayBuffer);
			expect(new TextDecoder().decode(arrayBuffer.body)).toBe("array-buffer");
		}

		const formData = await client.responses.formData("get");
		expect(formData.status).toBe(200);
		if (formData.status === 200) {
			expect(formData.body).toBeInstanceOf(FormData);
			expect(formData.body.get("field")).toBe("form-value");
		}

		const readableStream = await client.responses.readableStream("get");
		expect(readableStream.status).toBe(200);
		if (readableStream.status === 200) {
			expect(readableStream.body).toBeInstanceOf(ReadableStream);
			expect(await new Response(readableStream.body).text()).toBe("stream-body");
		}

		const voidResponse = await client.responses.voidResponse("get");
		expect(voidResponse.status).toBe(204);
		if (voidResponse.status === 204) {
			expect(voidResponse.body).toBeUndefined();
		}
	});

	test("parses standard and superjson response headers", async () => {
		const standard = await client.responses.standardHeaders("get");
		expect(standard.status).toBe(200);
		if (standard.status === 200) {
			expect(standard.headers).toEqual({ "x-from-server": "hono" });
		}

		const superjson = await client.responses.superjsonHeaders("get");
		expect(superjson.status).toBe(200);
		if (superjson.status === 200) {
			expect(superjson.headers).toEqual({
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
	});

	test("encodes and parses all request body types", async () => {
		const json = await client.bodies.json("post", { body: { message: "hello" } });
		expect(json.status).toBe(200);
		if (json.status === 200) {
			expect(json.body.echoed).toBe("hello");
		}

		const superjson = await client.bodies.superjson("post", {
			body: {
				payload: {
					createdAt: new Date("2025-03-01T00:00:00.000Z"),
					scores: new Map([
						["math", 4],
						["science", 8],
					]),
					flags: new Set(["priority", "gift"]),
				},
			},
		});
		expect(superjson.status).toBe(200);
		if (superjson.status === 200) {
			expect(superjson.body).toEqual({
				isoDate: "2025-03-01T00:00:00.000Z",
				scoreTotal: 12,
				hasPriority: true,
			});
		}

		const text = await client.bodies.string("post", { body: "hello" });
		expect(text.status).toBe(200);
		if (text.status === 200) {
			expect(text.body).toBe("HELLO");
		}

		const params = new URLSearchParams();
		params.set("q", "zono");
		const urlSearchParams = await client.bodies.urlSearchParams("post", { body: params });
		expect(urlSearchParams.status).toBe(200);
		if (urlSearchParams.status === 200) {
			expect(urlSearchParams.body.query).toBe("zono");
		}

		const formData = new FormData();
		formData.set("field", "field-value");
		const formDataRes = await client.bodies.formData("post", { body: formData });
		expect(formDataRes.status).toBe(200);
		if (formDataRes.status === 200) {
			expect(formDataRes.body.field).toBe("field-value");
		}

		const blobRes = await client.bodies.blob("post", {
			body: new Blob(["blob-body"], { type: "text/plain" }),
		});
		expect(blobRes.status).toBe(200);
		if (blobRes.status === 200) {
			expect(blobRes.body.size).toBe(9);
		}

		const uint8ArrayRes = await client.bodies.uint8Array("post", {
			body: new Uint8Array([1, 2, 3, 4]),
		});
		expect(uint8ArrayRes.status).toBe(200);
		if (uint8ArrayRes.status === 200) {
			expect(uint8ArrayRes.body.length).toBe(4);
		}
	});

	test("encodes standard and superjson request headers", async () => {
		const standard = await client.bodies.standardHeaders("post", {
			body: {},
			headers: { "x-trace-id": "trace-123" },
		});
		expect(standard.status).toBe(200);
		if (standard.status === 200) {
			expect(standard.body.traceId).toBe("trace-123");
		}

		const superjson = await client.bodies.superjsonHeaders("post", {
			body: {},
			headers: {
				auth: {
					token: "token-abc",
					issuedAt: new Date("2025-03-02T00:00:00.000Z"),
					scopes: new Set(["read", "write"]),
					quotas: new Map([
						["read", 5],
						["write", 2],
					]),
				},
			},
		});
		expect(superjson.status).toBe(200);
		if (superjson.status === 200) {
			expect(superjson.body).toEqual({
				token: "token-abc",
				issuedAt: "2025-03-02T00:00:00.000Z",
				scopeCount: 2,
				quotaTotal: 7,
			});
		}

		expect(superjson.response.headers.get("x-zono-superjson-headers")).toBeNull();
	});

	test("keeps behavior stable across repeated and mixed route calls", async () => {
		const firstHealth = await client.health("get");
		expect(firstHealth.status).toBe(200);
		if (firstHealth.status === 200) {
			expect(firstHealth.body).toEqual({ status: "ok" });
		}

		const user = await client.users.$userId("get", {
			pathParams: { userId: "cache-check" },
		});
		expect(user.status).toBe(200);
		if (user.status === 200) {
			expect(user.body.id).toBe("cache-check");
		}

		const secondHealth = await client.health("get");
		expect(secondHealth.status).toBe(200);
		if (secondHealth.status === 200) {
			expect(secondHealth.body).toEqual({ status: "ok" });
		}
	});

	test("keeps validation errors stable across repeated calls", async () => {
		await expect(
			client.users.register("post", {
				body: { name: "John", email: "not-an-email" },
			}),
		).rejects.toThrow("Contract validation failed");

		await expect(
			client.users.register("post", {
				body: { name: "Jane", email: "not-an-email" },
			}),
		).rejects.toThrow("Contract validation failed");
	});
});
