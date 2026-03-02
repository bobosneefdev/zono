import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import z from "zod";
import { createClient } from "~/client/client.js";
import type { RouterShape } from "~/contract/contract.types.js";
import { createContracts } from "~/contract/contracts.js";
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
		responses: {
			ROUTER: {
				json: { CONTRACT: true },
				superjson: { CONTRACT: true },
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
										count: z.number(),
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
											}),
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
								schema: z.object({ payload: z.object({ value: z.number() }) }),
							},
							responses: {
								200: { type: "JSON", schema: z.object({ doubled: z.number() }) },
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
										scopes: z.array(z.string()),
									}),
								}),
							},
							responses: {
								200: { type: "JSON", schema: z.object({ token: z.string() }) },
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
assertType<Parameters<typeof typeClient.bodies.string.post>[0]>({ body: "ok" });
assertType<Parameters<typeof typeClient.bodies.standardHeaders.post>[0]>({
	body: {},
	headers: { "x-trace-id": "trace-123" },
});
assertType<Parameters<typeof typeClient.bodies.superjsonHeaders.post>[0]>({
	body: {},
	headers: { auth: { token: "token-abc", scopes: ["read", "write"] } },
});
// @ts-expect-error string body route does not accept numbers
assertType<Parameters<typeof typeClient.bodies.string.post>[0]>({ body: 123 });

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
									data: { kind: "superjson" as const, count: 2 },
								}),
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
									headers: { meta: { source: "hono", attempt: 1 } },
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
								post: (input) => ({
									type: "JSON" as const,
									status: 200 as const,
									data: { doubled: input.body.payload.value * 2 },
								}),
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
								post: (input) => ({
									type: "JSON" as const,
									status: 200 as const,
									data: { token: input.headers.auth.token },
								}),
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
		const health = await client.health.get();
		expect(health.status).toBe(200);
		expect(health.body).toEqual({ status: "ok" });

		const createUser = await client.users.register.post({
			body: { name: "John", email: "john@example.com" },
		});
		expect(createUser.status).toBe(201);

		const user = await client.users.$userId.get({
			pathParams: { userId: "user-123" },
		});
		expect(user.status).toBe(200);

		const missingBaseClient = createClient(contracts, {
			baseUrl: `http://localhost:${PORT}/missing-base`,
			middleware: [middleware],
			serverErrorMode: "public",
		});
		const notFound = await missingBaseClient.health.get();
		expect(notFound.status).toBe(404);
		if (notFound.status === 404) {
			expect(notFound.body).toEqual({ type: "notFound" });
		}

		const internal = await client.users.$userId.get({
			pathParams: { userId: "explode" },
		});
		expect(internal.status).toBe(500);
		if (internal.status === 500) {
			expect(internal.body).toEqual({ type: "internalError" });
		}
	});

	test("fails fast on invalid client body input", async () => {
		await expect(
			client.users.register.post({
				body: { name: "John", email: "not-an-email" },
			}),
		).rejects.toThrow("Contract validation failed");
	});

	test("parses all response body types", async () => {
		const json = await client.responses.json.get();
		expect(json.status).toBe(200);
		if (json.status === 200) {
			expect(json.body).toEqual({ kind: "json" });
		}

		const superjson = await client.responses.superjson.get();
		expect(superjson.status).toBe(200);
		if (superjson.status === 200) {
			expect(superjson.body).toEqual({ kind: "superjson", count: 2 });
		}

		const text = await client.responses.text.get();
		expect(text.status).toBe(200);
		if (text.status === 200) {
			expect(text.body).toBe("plain-text");
		}

		const blob = await client.responses.blob.get();
		expect(blob.status).toBe(200);
		if (blob.status === 200) {
			expect(blob.body).toBeInstanceOf(Blob);
			expect(await blob.body.text()).toBe("blob-data");
		}

		const arrayBuffer = await client.responses.arrayBuffer.get();
		expect(arrayBuffer.status).toBe(200);
		if (arrayBuffer.status === 200) {
			expect(arrayBuffer.body).toBeInstanceOf(ArrayBuffer);
			expect(new TextDecoder().decode(arrayBuffer.body)).toBe("array-buffer");
		}

		const formData = await client.responses.formData.get();
		expect(formData.status).toBe(200);
		if (formData.status === 200) {
			expect(formData.body).toBeInstanceOf(FormData);
			expect(formData.body.get("field")).toBe("form-value");
		}

		const readableStream = await client.responses.readableStream.get();
		expect(readableStream.status).toBe(200);
		if (readableStream.status === 200) {
			expect(readableStream.body).toBeInstanceOf(ReadableStream);
			expect(await new Response(readableStream.body).text()).toBe("stream-body");
		}

		const voidResponse = await client.responses.voidResponse.get();
		expect(voidResponse.status).toBe(204);
		if (voidResponse.status === 204) {
			expect(voidResponse.body).toBeUndefined();
		}
	});

	test("parses standard and superjson response headers", async () => {
		const standard = await client.responses.standardHeaders.get();
		expect(standard.status).toBe(200);
		if (standard.status === 200) {
			expect(standard.headers).toEqual({ "x-from-server": "hono" });
		}

		const superjson = await client.responses.superjsonHeaders.get();
		expect(superjson.status).toBe(200);
		if (superjson.status === 200) {
			expect(superjson.headers).toEqual({
				meta: { source: "hono", attempt: 1 },
			});
		}
	});

	test("encodes and parses all request body types", async () => {
		const json = await client.bodies.json.post({ body: { message: "hello" } });
		expect(json.status).toBe(200);
		if (json.status === 200) {
			expect(json.body.echoed).toBe("hello");
		}

		const superjson = await client.bodies.superjson.post({
			body: { payload: { value: 7 } },
		});
		expect(superjson.status).toBe(200);
		if (superjson.status === 200) {
			expect(superjson.body.doubled).toBe(14);
		}

		const text = await client.bodies.string.post({ body: "hello" });
		expect(text.status).toBe(200);
		if (text.status === 200) {
			expect(text.body).toBe("HELLO");
		}

		const params = new URLSearchParams();
		params.set("q", "zono");
		const urlSearchParams = await client.bodies.urlSearchParams.post({ body: params });
		expect(urlSearchParams.status).toBe(200);
		if (urlSearchParams.status === 200) {
			expect(urlSearchParams.body.query).toBe("zono");
		}

		const formData = new FormData();
		formData.set("field", "field-value");
		const formDataRes = await client.bodies.formData.post({ body: formData });
		expect(formDataRes.status).toBe(200);
		if (formDataRes.status === 200) {
			expect(formDataRes.body.field).toBe("field-value");
		}

		const blobRes = await client.bodies.blob.post({
			body: new Blob(["blob-body"], { type: "text/plain" }),
		});
		expect(blobRes.status).toBe(200);
		if (blobRes.status === 200) {
			expect(blobRes.body.size).toBe(9);
		}

		const uint8ArrayRes = await client.bodies.uint8Array.post({
			body: new Uint8Array([1, 2, 3, 4]),
		});
		expect(uint8ArrayRes.status).toBe(200);
		if (uint8ArrayRes.status === 200) {
			expect(uint8ArrayRes.body.length).toBe(4);
		}
	});

	test("encodes standard and superjson request headers", async () => {
		const standard = await client.bodies.standardHeaders.post({
			body: {},
			headers: { "x-trace-id": "trace-123" },
		});
		expect(standard.status).toBe(200);
		if (standard.status === 200) {
			expect(standard.body.traceId).toBe("trace-123");
		}

		const superjson = await client.bodies.superjsonHeaders.post({
			body: {},
			headers: {
				auth: { token: "token-abc", scopes: ["read", "write"] },
			},
		});
		expect(superjson.status).toBe(200);
		if (superjson.status === 200) {
			expect(superjson.body.token).toBe("token-abc");
		}
	});
});
