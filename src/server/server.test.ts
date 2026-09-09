import { afterEach, describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { Hono } from "hono";
import superjson from "superjson";
import z from "zod";
import { createClient } from "../client/client.js";
import type { ApiDefinition } from "../contract/contract.js";
import { defineApi } from "../contract/contract.js";
import type { EmptyObject, ErrorMode } from "../shared/shared.js";
import {
	parseSerializedResponse,
	ZONO_HEADER_DATA_HEADER,
	ZONO_QUERY_DATA_KEY,
} from "../shared/shared.js";
import type { ApiBinding, HonoOptions } from "./server.js";
import { createApiHandlers, initHono } from "./server.js";

const servers: Array<{ stop: () => void }> = [];

const startServer = (app: Hono): string => {
	const server = Bun.serve({ fetch: app.fetch, port: 0 });
	servers.push(server);
	return `http://localhost:${server.port}`;
};

const serve = <TApi extends Parameters<typeof initHono>[1]["api"], TContext>(
	binding: ApiBinding<TApi, TContext>,
	options?: HonoOptions,
): string => {
	const app = new Hono();
	initHono(app, binding, options);
	return startServer(app);
};

afterEach(() => {
	while (servers.length > 0) {
		servers.pop()?.stop();
	}
});

describe("server runtime", () => {
	test("registers QUERY handlers and parses request bodies", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					search: {
						CONTRACT: {
							query: {
								body: { type: "JSON", schema: z.object({ filter: z.string() }) },
								responses: {
									200: {
										type: "JSON",
										schema: z.object({
											method: z.string(),
											filter: z.string(),
										}),
									},
								},
							},
						},
					},
				},
			},
		});
		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						search: {
							HANDLER: {
								query: (data, ctx) => ({
									status: 200,
									type: "JSON",
									data: { method: ctx.req.method, filter: data.body.filter },
								}),
							},
						},
					},
				},
			}),
		);

		const response = await fetch(`${base}/search`, {
			method: "QUERY",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ filter: "active" }),
		});

		expect(response.status).toBe(200);
		expect((await parseSerializedResponse(response)).data).toEqual({
			method: "QUERY",
			filter: "active",
		});
	});

	test("parses path params, standard query, and standard headers into handler data", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					users: {
						SHAPE: {
							$userId: {
								CONTRACT: {
									get: {
										pathParams: z.object({ userId: z.string() }),
										query: {
											type: "Standard",
											schema: z.object({
												foo: z.string(),
												count: z.string(),
											}),
										},
										headers: {
											type: "Standard",
											schema: z.object({ "x-trace": z.string() }),
										},
										responses: {
											200: {
												type: "JSON",
												schema: z.object({
													userId: z.string(),
													foo: z.string(),
													count: z.string(),
													trace: z.string(),
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
		});

		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						users: {
							SHAPE: {
								$userId: {
									HANDLER: {
										get: (data) => ({
											status: 200,
											type: "JSON",
											data: {
												userId: data.pathParams.userId,
												foo: data.query.foo,
												count: data.query.count,
												trace: data.headers["x-trace"],
											},
										}),
									},
								},
							},
						},
					},
				},
			}),
		);

		const response = await fetch(`${base}/users/u1?foo=bar&count=2`, {
			headers: { "x-trace": "trace-1" },
		});
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(200);
		expect(parsed.data).toEqual({
			userId: "u1",
			foo: "bar",
			count: "2",
			trace: "trace-1",
		});
	});

	test("parses SuperJSON query and headers from reserved transport slots", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					querySuper: {
						CONTRACT: {
							get: {
								query: {
									type: "SuperJSON",
									schema: z.object({ createdAt: z.date() }),
								},
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
					headersSuper: {
						CONTRACT: {
							get: {
								headers: {
									type: "SuperJSON",
									schema: z.object({ createdAt: z.date() }),
								},
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
				},
			},
		});

		let queryValue: { createdAt: Date } | undefined;
		let headerValue: { createdAt: Date } | undefined;

		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						querySuper: {
							HANDLER: {
								get: (data) => {
									queryValue = data.query;
									return { status: 200, type: "JSON", data: { ok: true } };
								},
							},
						},
						headersSuper: {
							HANDLER: {
								get: (data) => {
									headerValue = data.headers;
									return { status: 200, type: "JSON", data: { ok: true } };
								},
							},
						},
					},
				},
			}),
		);

		const queryCreatedAt = new Date("2024-02-02T00:00:00.000Z");
		const headerCreatedAt = new Date("2024-03-03T00:00:00.000Z");

		const queryResponse = await fetch(
			`${base}/querySuper?${ZONO_QUERY_DATA_KEY}=${encodeURIComponent(superjson.stringify({ createdAt: queryCreatedAt }))}`,
		);
		const headerResponse = await fetch(`${base}/headersSuper`, {
			headers: {
				[ZONO_HEADER_DATA_HEADER]: superjson.stringify({ createdAt: headerCreatedAt }),
			},
		});

		expect(queryResponse.status).toBe(200);
		expect(headerResponse.status).toBe(200);
		expect(queryValue).toEqual({ createdAt: queryCreatedAt });
		expect(headerValue).toEqual({ createdAt: headerCreatedAt });
	});

	test("optional structured query and headers resolve to undefined when transport slots are absent", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					queryOptional: {
						CONTRACT: {
							get: {
								query: {
									type: "JSON",
									schema: z.object({ count: z.number() }).optional(),
								},
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
					headersOptional: {
						CONTRACT: {
							get: {
								headers: {
									type: "JSON",
									schema: z.object({ trace: z.string() }).optional(),
								},
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
				},
			},
		});

		let optionalQueryValue: { count: number } | undefined;
		let optionalHeaderValue: { trace: string } | undefined;

		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						queryOptional: {
							HANDLER: {
								get: (data) => {
									optionalQueryValue = data.query;
									return { status: 200, type: "JSON", data: { ok: true } };
								},
							},
						},
						headersOptional: {
							HANDLER: {
								get: (data) => {
									optionalHeaderValue = data.headers;
									return { status: 200, type: "JSON", data: { ok: true } };
								},
							},
						},
					},
				},
			}),
		);

		const queryResponse = await fetch(`${base}/queryOptional`);
		const headerResponse = await fetch(`${base}/headersOptional`);

		expect(queryResponse.status).toBe(200);
		expect(headerResponse.status).toBe(200);
		expect(optionalQueryValue).toBeUndefined();
		expect(optionalHeaderValue).toBeUndefined();
	});

	test("opaque mode is the default and returns stable 400 payloads without issues", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					query: {
						CONTRACT: {
							get: {
								query: {
									type: "JSON",
									schema: z.object({
										count: z.number().refine(async (count) => count > 0),
									}),
								},
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
					headers: {
						CONTRACT: {
							get: {
								headers: {
									type: "JSON",
									schema: z.object({ trace: z.string() }),
								},
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
				},
			},
		});
		expect(api.errorMode).toBe("opaque");

		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						query: {
							HANDLER: {
								get: () => ({ status: 200, type: "JSON", data: { ok: true } }),
							},
						},
						headers: {
							HANDLER: {
								get: () => ({ status: 200, type: "JSON", data: { ok: true } }),
							},
						},
					},
				},
			}),
		);

		const badQuery = await fetch(`${base}/query?${ZONO_QUERY_DATA_KEY}=oops`);
		expect(badQuery.status).toBe(400);
		const badQueryParsed = await parseSerializedResponse(badQuery);
		expect(badQueryParsed.source).toBe("error");
		expect(badQueryParsed.data).toEqual({ message: "Invalid request" });

		const badHeaders = await fetch(`${base}/headers`, { headers: {} });
		expect(badHeaders.status).toBe(400);
		expect((await parseSerializedResponse(badHeaders)).data).toEqual({
			message: "Invalid request",
		});
	});

	test("detailed mode exposes validation messages and issues", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					users: {
						SHAPE: {
							$userId: {
								CONTRACT: {
									get: {
										pathParams: z.object({ userId: z.uuid() }),
										responses: {
											200: {
												type: "JSON",
												schema: z.object({ id: z.string() }),
											},
										},
									},
								},
							},
						},
					},
				},
			},
			errorMode: "detailed",
		});

		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						users: {
							SHAPE: {
								$userId: {
									HANDLER: {
										get: (data) => ({
											status: 200,
											type: "JSON",
											data: { id: data.pathParams.userId },
										}),
									},
								},
							},
						},
					},
				},
			}),
		);

		const response = await fetch(`${base}/users/not-a-uuid`);
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(400);
		expect(parsed.data).toMatchObject({
			message: "Path params validation failed",
			issues: expect.any(Array),
		});
	});

	test("returns opaque 400 when bodies cannot be parsed or fail schema validation", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					jsonBody: {
						CONTRACT: {
							post: {
								body: { type: "JSON", schema: z.object({ name: z.string() }) },
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
					superBody: {
						CONTRACT: {
							post: {
								body: {
									type: "SuperJSON",
									schema: z.object({ createdAt: z.date() }),
								},
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
				},
			},
		});

		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						jsonBody: {
							HANDLER: {
								post: () => ({ status: 200, type: "JSON", data: { ok: true } }),
							},
						},
						superBody: {
							HANDLER: {
								post: () => ({ status: 200, type: "JSON", data: { ok: true } }),
							},
						},
					},
				},
			}),
		);

		const badJson = await fetch(`${base}/jsonBody`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{",
		});
		const badSuper = await fetch(`${base}/superBody`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "not valid",
		});
		const badSchema = await fetch(`${base}/jsonBody`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: 123 }),
		});

		expect(badJson.status).toBe(400);
		expect((await parseSerializedResponse(badJson)).data).toEqual({
			message: "Invalid request",
		});
		expect(badSuper.status).toBe(400);
		expect((await parseSerializedResponse(badSuper)).data).toEqual({
			message: "Invalid request",
		});
		expect(badSchema.status).toBe(400);
		expect((await parseSerializedResponse(badSchema)).data).toEqual({
			message: "Invalid request",
		});
	});

	test("enforces explicitly declared request media types with typed 415 errors", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					search: {
						CONTRACT: {
							query: {
								body: {
									type: "JSON",
									contentType: "application/query+json",
									schema: z.object({ filter: z.string() }),
								},
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
					relaxed: {
						CONTRACT: {
							post: {
								body: { type: "JSON", schema: z.object({ name: z.string() }) },
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
				},
			},
		});

		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						search: {
							HANDLER: {
								query: () => ({ status: 200, type: "JSON", data: { ok: true } }),
							},
						},
						relaxed: {
							HANDLER: {
								post: () => ({ status: 200, type: "JSON", data: { ok: true } }),
							},
						},
					},
				},
			}),
		);

		const matching = await fetch(`${base}/search`, {
			method: "QUERY",
			headers: { "content-type": "Application/Query+JSON; charset=utf-8" },
			body: JSON.stringify({ filter: "a" }),
		});
		expect(matching.status).toBe(200);

		const mismatched = await fetch(`${base}/search`, {
			method: "QUERY",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ filter: "a" }),
		});
		expect(mismatched.status).toBe(415);
		expect((await parseSerializedResponse(mismatched)).data).toEqual({
			message: "Unsupported media type",
		});

		// Contracts relying on defaults remain permissive for third-party callers.
		const relaxed = await fetch(`${base}/relaxed`, {
			method: "POST",
			headers: { "content-type": "text/nonsense" },
			body: JSON.stringify({ name: "zono" }),
		});
		expect(relaxed.status).toBe(200);
	});

	test("requires an incoming content-type header when the contract declares one", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					strictText: {
						CONTRACT: {
							post: {
								body: {
									type: "Text",
									contentType: "text/plain; charset=utf-8",
									schema: z.string(),
								},
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
				},
			},
		});

		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						strictText: {
							HANDLER: {
								post: () => ({ status: 200, type: "JSON", data: { ok: true } }),
							},
						},
					},
				},
			}),
		);

		// Declared charset must be matched by the incoming parameter value.
		const wrongCharset = await fetch(`${base}/strictText`, {
			method: "POST",
			headers: { "content-type": "text/plain; charset=ascii" },
			body: "hello",
		});
		expect(wrongCharset.status).toBe(415);

		const matching = await fetch(`${base}/strictText`, {
			method: "POST",
			headers: { "content-type": "text/plain;charset=UTF-8" },
			body: "hello",
		});
		expect(matching.status).toBe(200);
	});

	test("applies custom response media types and rejects incompatible declarations", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					problem: {
						CONTRACT: {
							get: {
								responses: {
									200: {
										type: "JSON",
										contentType: "application/problem+json",
										schema: z.object({ ok: z.boolean() }),
									},
								},
							},
						},
					},
				},
			},
		});

		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						problem: {
							HANDLER: {
								get: () => ({ status: 200, type: "JSON", data: { ok: true } }),
							},
						},
					},
				},
			}),
		);

		const response = await fetch(`${base}/problem`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/problem+json");
		expect((await parseSerializedResponse(response)).data).toEqual({ ok: true });

		// An incompatible declared response media type is a response-contract failure.
		const badApi = defineApi({
			contracts: {
				SHAPE: {
					bad: {
						CONTRACT: {
							get: {
								responses: {
									200: {
										type: "JSON",
										contentType: "text/plain",
										schema: z.object({ ok: z.boolean() }),
									},
								},
							},
						},
					},
				},
			},
		});
		const badBase = serve(
			createApiHandlers(badApi)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						bad: {
							HANDLER: {
								get: () => ({ status: 200, type: "JSON", data: { ok: true } }),
							},
						},
					},
				},
			}),
		);
		const badResponse = await fetch(`${badBase}/bad`);
		expect(badResponse.status).toBe(500);
		expect((await parseSerializedResponse(badResponse)).data).toEqual({
			message: "Internal server error",
		});
	});

	test("preserves standard and structured headers on serialized contract responses", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					json: {
						CONTRACT: {
							get: {
								responses: {
									200: {
										type: "JSON",
										schema: z.object({ ok: z.boolean() }),
										headers: {
											type: "Standard",
											schema: z.object({ "x-handler": z.string() }),
										},
									},
								},
							},
						},
					},
					superHeaders: {
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
				},
			},
		});

		const createdAt = new Date("2024-02-02T00:00:00.000Z");
		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						json: {
							HANDLER: {
								get: () => ({
									status: 200,
									type: "JSON",
									headers: { "x-handler": "1" },
									data: { ok: true },
								}),
							},
						},
						superHeaders: {
							HANDLER: {
								get: () => ({
									status: 200,
									type: "JSON",
									headers: { createdAt },
									data: { ok: true },
								}),
							},
						},
					},
				},
			}),
		);

		const response = await fetch(`${base}/json`);
		const parsed = await parseSerializedResponse(response);
		expect(response.status).toBe(200);
		expect(response.headers.get("x-handler")).toBe("1");
		expect(parsed.data).toEqual({ ok: true });
		expect(parsed.headers).toEqual({ "x-handler": "1" });

		const structuredResponse = await fetch(`${base}/superHeaders`);
		const structuredParsed = await parseSerializedResponse(structuredResponse);
		expect(structuredResponse.status).toBe(200);
		expect(structuredParsed.data).toEqual({ ok: true });
		expect(structuredParsed.headers).toEqual({ createdAt });
	});

	test("opaque 500s hide response-contract violations while detailed mode explains them", async () => {
		const contracts = {
			SHAPE: {
				invalidStatus: {
					CONTRACT: {
						get: {
							responses: {
								200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
							},
						},
					},
				},
				invalidType: {
					CONTRACT: {
						get: {
							responses: {
								200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
							},
						},
					},
				},
				invalidData: {
					CONTRACT: {
						get: {
							responses: {
								200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
							},
						},
					},
				},
				invalidHeaders: {
					CONTRACT: {
						get: {
							responses: {
								200: {
									type: "JSON",
									schema: z.object({ ok: z.boolean() }),
									headers: {
										type: "Standard",
										schema: z.object({ "x-handler": z.string() }),
									},
								},
							},
						},
					},
				},
			},
		} as const;

		const makeHandlers = () =>
			({
				SHAPE: {
					invalidStatus: {
						HANDLER: {
							get: () => ({ status: 201, type: "JSON", data: { ok: true } }),
						},
					},
					invalidType: {
						HANDLER: { get: () => ({ status: 200, type: "Text", data: "nope" }) },
					},
					invalidData: {
						HANDLER: {
							get: () => ({ status: 200, type: "JSON", data: { ok: "nope" } }),
						},
					},
					invalidHeaders: {
						HANDLER: {
							get: () => ({
								status: 200,
								type: "JSON",
								headers: { "x-handler": 1 },
								data: { ok: true },
							}),
						},
					},
				},
			}) as never;

		const opaqueApi = defineApi({ contracts });
		const opaqueBase = serve(
			createApiHandlers(opaqueApi)({
				createContext: () => ({}),
				contracts: makeHandlers(),
			}),
		);
		for (const path of ["invalidStatus", "invalidType", "invalidData", "invalidHeaders"]) {
			const parsed = await parseSerializedResponse(await fetch(`${opaqueBase}/${path}`));
			expect(parsed.data).toEqual({ message: "Internal server error" });
		}

		const detailedApi = defineApi({ contracts, errorMode: "detailed" });
		const detailedBase = serve(
			createApiHandlers(detailedApi)({
				createContext: () => ({}),
				contracts: makeHandlers(),
			}),
		);
		const invalidStatus = await parseSerializedResponse(
			await fetch(`${detailedBase}/invalidStatus`),
		);
		const invalidType = await parseSerializedResponse(
			await fetch(`${detailedBase}/invalidType`),
		);
		const invalidData = await parseSerializedResponse(
			await fetch(`${detailedBase}/invalidData`),
		);
		const invalidHeaders = await parseSerializedResponse(
			await fetch(`${detailedBase}/invalidHeaders`),
		);

		expect(invalidStatus.data).toMatchObject({
			message: "Handler returned undeclared status: 201",
		});
		expect(invalidType.data).toMatchObject({
			message: "Handler returned mismatched response type. Expected JSON, received Text",
		});
		expect(invalidData.data).toMatchObject({
			message: "Handler response data validation failed",
		});
		expect(invalidHeaders.data).toMatchObject({
			message: "Handler response headers validation failed",
		});
	});

	test("opaque 500 never exposes thrown messages or stacks while detailed does", async () => {
		const contracts = {
			SHAPE: {
				boom: {
					CONTRACT: {
						get: {
							responses: {
								200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
							},
						},
					},
				},
			},
		} as const;

		const makeBinding = (api: ApiDefinition<typeof contracts, EmptyObject, ErrorMode>) =>
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						boom: {
							HANDLER: {
								get: () => {
									throw new Error("secret boom");
								},
							},
						},
					},
				},
			});

		const opaqueBase = serve(makeBinding(defineApi({ contracts })));
		const opaqueBoom = await fetch(`${opaqueBase}/boom`);
		expect(opaqueBoom.status).toBe(500);
		expect((await parseSerializedResponse(opaqueBoom)).data).toEqual({
			message: "Internal server error",
		});

		const detailedBase = serve(makeBinding(defineApi({ contracts, errorMode: "detailed" })));
		const detailedBoom = await fetch(`${detailedBase}/boom`);
		const detailedParsed = await parseSerializedResponse(detailedBoom);
		expect(detailedBoom.status).toBe(500);
		expect((detailedParsed.data as { message: string }).message).toBe("secret boom");
		expect(detailedParsed.data).toHaveProperty("stack");
	});

	test("returns JSON 404 for unmatched routes", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					json: {
						CONTRACT: {
							get: {
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
				},
			},
		});

		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						json: {
							HANDLER: {
								get: () => ({ status: 200, type: "JSON", data: { ok: true } }),
							},
						},
					},
				},
			}),
		);

		const notFound = await fetch(`${base}/not-a-route`);
		const parsed = await parseSerializedResponse(notFound);

		expect(notFound.status).toBe(404);
		expect(parsed.source).toBe("error");
		expect(parsed.data).toEqual({ message: "Not Found" });
	});

	test("invokes onError with original failures, awaits it, and survives its own throws", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					boom: {
						CONTRACT: {
							get: {
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
					invalid: {
						CONTRACT: {
							get: {
								query: { type: "JSON", schema: z.object({ count: z.number() }) },
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
				},
			},
		});

		const observed: Array<{ message: string; path: string }> = [];
		let awaited = false;
		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						boom: {
							HANDLER: {
								get: () => {
									throw new Error("handler exploded");
								},
							},
						},
						invalid: {
							HANDLER: {
								get: () => ({ status: 200, type: "JSON", data: { ok: true } }),
							},
						},
					},
				},
			}),
			{
				onError: async (error, ctx) => {
					await new Promise((resolve) => setTimeout(resolve, 5));
					awaited = true;
					observed.push({
						message: error instanceof Error ? error.message : String(error),
						path: ctx.req.path,
					});
					throw new Error("observer failed");
				},
			},
		);

		const boom = await fetch(`${base}/boom`);
		expect(boom.status).toBe(500);
		// A throwing onError never replaces the original serialized error.
		expect((await parseSerializedResponse(boom)).data).toEqual({
			message: "Internal server error",
		});
		expect(awaited).toBe(true);
		expect(observed).toEqual([{ message: "handler exploded", path: "/boom" }]);

		const invalid = await fetch(`${base}/invalid?${ZONO_QUERY_DATA_KEY}=oops`);
		expect(invalid.status).toBe(400);
		expect(observed).toHaveLength(2);
		expect(observed[1]).toEqual({ message: "Query validation failed", path: "/invalid" });
	});

	test("middleware raw Response pass-through bypasses serialization", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					middleware: {
						CONTRACT: {
							get: {
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
				},
			},
			middlewares: {
				MIDDLEWARE: {
					gate: {
						401: { type: "JSON", schema: z.object({ message: z.string() }) },
					},
				},
			},
		});

		let handlerCalled = false;
		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						middleware: {
							HANDLER: {
								get: () => {
									handlerCalled = true;
									return { status: 200, type: "JSON", data: { ok: true } };
								},
							},
						},
					},
				},
				middlewares: {
					MIDDLEWARE: {
						gate: () =>
							new Response("blocked", {
								status: 401,
								headers: {
									"content-type": "text/plain",
									"x-raw": "1",
								},
							}),
					},
				},
			}),
		);

		const response = await fetch(`${base}/middleware`);

		expect(response.status).toBe(401);
		expect(response.headers.get("x-raw")).toBe("1");
		expect(await response.text()).toBe("blocked");
		expect(handlerCalled).toBe(false);
	});

	test("middleware short-circuits with typed serialized responses", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					middleware: {
						CONTRACT: {
							get: {
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
				},
			},
			middlewares: {
				MIDDLEWARE: {
					gate: {
						429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
					},
				},
			},
		});

		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						middleware: {
							HANDLER: {
								get: () => ({ status: 200, type: "JSON", data: { ok: true } }),
							},
						},
					},
				},
				middlewares: {
					MIDDLEWARE: {
						gate: (ctx, next) => {
							if (new URL(ctx.req.url).searchParams.get("deny") === "1") {
								return { status: 429, type: "JSON", data: { retryAfter: 5 } };
							}
							return next();
						},
					},
				},
			}),
		);

		const denied = await fetch(`${base}/middleware?deny=1`);
		expect(denied.status).toBe(429);
		expect((await parseSerializedResponse(denied)).source).toBe("middleware");

		const allowed = await fetch(`${base}/middleware`);
		expect(allowed.status).toBe(200);
	});

	test("serializes middleware response headers and rejects invalid middleware headers", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					middleware: {
						CONTRACT: {
							get: {
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
					invalid: {
						CONTRACT: {
							get: {
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
				},
			},
			middlewares: {
				SHAPE: {
					middleware: {
						MIDDLEWARE: {
							gate: {
								429: {
									type: "JSON",
									schema: z.object({ retryAfter: z.number() }),
									headers: {
										type: "Standard",
										schema: z.object({ "x-retry-after": z.string() }),
									},
								},
							},
						},
					},
					invalid: {
						MIDDLEWARE: {
							gate: {
								429: {
									type: "JSON",
									schema: z.object({ retryAfter: z.number() }),
									headers: {
										type: "Standard",
										schema: z.object({ "x-retry-after": z.string() }),
									},
								},
							},
						},
					},
				},
			},
		});

		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						middleware: {
							HANDLER: {
								get: () => ({ status: 200, type: "JSON", data: { ok: true } }),
							},
						},
						invalid: {
							HANDLER: {
								get: () => ({ status: 200, type: "JSON", data: { ok: true } }),
							},
						},
					},
				},
				middlewares: {
					SHAPE: {
						middleware: {
							MIDDLEWARE: {
								gate: () => ({
									status: 429,
									type: "JSON",
									headers: { "x-retry-after": "5" },
									data: { retryAfter: 5 },
								}),
							},
						},
						invalid: {
							MIDDLEWARE: {
								gate: () =>
									({
										status: 429,
										type: "JSON",
										headers: { "x-retry-after": 5 },
										data: { retryAfter: 5 },
									}) as unknown as {
										status: 429;
										type: "JSON";
										headers: { "x-retry-after": string };
										data: { retryAfter: number };
									},
							},
						},
					},
				},
			}),
		);

		const denied = await fetch(`${base}/middleware`);
		const invalid = await fetch(`${base}/invalid`);
		const deniedParsed = await parseSerializedResponse(denied);
		const invalidParsed = await parseSerializedResponse(invalid);

		expect(denied.status).toBe(429);
		expect(denied.headers.get("x-retry-after")).toBe("5");
		expect(deniedParsed.headers).toEqual({ "x-retry-after": "5" });
		expect(deniedParsed.data).toEqual({ retryAfter: 5 });

		expect(invalid.status).toBe(500);
		expect(invalidParsed.data).toEqual({ message: "Internal server error" });
	});
});

describe("server scoped middleware runtime", () => {
	test("runs root-to-leaf middleware only on matching routes and threads context", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					users: {
						CONTRACT: {
							get: {
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
						SHAPE: {
							$userId: {
								CONTRACT: {
									get: {
										pathParams: z.object({ userId: z.string() }),
										responses: {
											200: {
												type: "JSON",
												schema: z.object({ id: z.string() }),
											},
										},
									},
								},
							},
						},
					},
					plain: {
						CONTRACT: {
							get: {
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
				},
			},
			middlewares: {
				MIDDLEWARE: {
					audit: {
						418: { type: "JSON", schema: z.object({ traceId: z.string() }) },
					},
				},
				SHAPE: {
					users: {
						MIDDLEWARE: {
							auth: {
								403: { type: "JSON", schema: z.object({ message: z.string() }) },
							},
						},
						SHAPE: {
							$userId: {
								MIDDLEWARE: {
									rateLimit: {
										429: {
											type: "JSON",
											schema: z.object({ retryAfter: z.number() }),
										},
									},
								},
							},
						},
					},
				},
			},
		});

		const steps: Array<string> = [];
		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({ requestId: "ctx-1" }),
				contracts: {
					SHAPE: {
						users: {
							HANDLER: {
								get: (_data, _ctx, appContext) => {
									steps.push(`handler:users:${appContext.requestId}`);
									return { status: 200, type: "JSON", data: { ok: true } };
								},
							},
							SHAPE: {
								$userId: {
									HANDLER: {
										get: (data, _ctx, appContext) => {
											steps.push(`handler:user:${appContext.requestId}`);
											return {
												status: 200,
												type: "JSON",
												data: { id: data.pathParams.userId },
											};
										},
									},
								},
							},
						},
						plain: {
							HANDLER: {
								get: (_data, _ctx, appContext) => {
									steps.push(`handler:plain:${appContext.requestId}`);
									return { status: 200, type: "JSON", data: { ok: true } };
								},
							},
						},
					},
				},
				middlewares: {
					MIDDLEWARE: {
						audit: async (_ctx, next, appContext) => {
							steps.push(`audit:before:${appContext.requestId}`);
							await next();
							steps.push("audit:after");
						},
					},
					SHAPE: {
						users: {
							MIDDLEWARE: {
								auth: async (_ctx, next, appContext) => {
									steps.push(`auth:before:${appContext.requestId}`);
									await next();
									steps.push("auth:after");
								},
							},
							SHAPE: {
								$userId: {
									MIDDLEWARE: {
										rateLimit: async (_ctx, next, appContext) => {
											steps.push(`rate:before:${appContext.requestId}`);
											await next();
											steps.push("rate:after");
										},
									},
								},
							},
						},
					},
				},
			}),
		);

		steps.length = 0;
		const usersResponse = await fetch(`${base}/users`);
		expect(usersResponse.status).toBe(200);
		expect(steps).toEqual([
			"audit:before:ctx-1",
			"auth:before:ctx-1",
			"handler:users:ctx-1",
			"auth:after",
			"audit:after",
		]);

		steps.length = 0;
		const userResponse = await fetch(`${base}/users/u1`);
		expect(userResponse.status).toBe(200);
		expect(steps).toEqual([
			"audit:before:ctx-1",
			"auth:before:ctx-1",
			"rate:before:ctx-1",
			"handler:user:ctx-1",
			"rate:after",
			"auth:after",
			"audit:after",
		]);

		steps.length = 0;
		const plainResponse = await fetch(`${base}/plain`);
		expect(plainResponse.status).toBe(200);
		expect(steps).toEqual(["audit:before:ctx-1", "handler:plain:ctx-1", "audit:after"]);
	});

	test("same-name middleware composes in ancestor-to-descendant order", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					users: {
						CONTRACT: {
							get: {
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
					},
				},
			},
			middlewares: {
				MIDDLEWARE: {
					auth: {
						401: { type: "JSON", schema: z.object({ message: z.string() }) },
					},
				},
				SHAPE: {
					users: {
						MIDDLEWARE: {
							auth: {
								403: { type: "JSON", schema: z.object({ message: z.string() }) },
							},
						},
					},
				},
			},
		});

		const steps: Array<string> = [];
		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					SHAPE: {
						users: {
							HANDLER: {
								get: () => {
									steps.push("handler");
									return { status: 200, type: "JSON", data: { ok: true } };
								},
							},
						},
					},
				},
				middlewares: {
					MIDDLEWARE: {
						auth: async (_ctx, next) => {
							steps.push("root");
							await next();
						},
					},
					SHAPE: {
						users: {
							MIDDLEWARE: {
								auth: () => {
									steps.push("scoped");
									return {
										status: 403,
										type: "JSON",
										data: { message: "scoped" },
									};
								},
							},
						},
					},
				},
			}),
		);

		const response = await fetch(`${base}/users`);
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(403);
		expect(parsed.source).toBe("middleware");
		expect(parsed.data).toEqual({ message: "scoped" });
		expect(steps).toEqual(["root", "scoped"]);
	});

	test("nested short-circuit stops deeper middleware and handler execution", async () => {
		const api = defineApi({
			contracts: {
				SHAPE: {
					users: {
						CONTRACT: {
							get: {
								responses: {
									200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
								},
							},
						},
						SHAPE: {
							$userId: {
								CONTRACT: {
									get: {
										pathParams: z.object({ userId: z.string() }),
										responses: {
											200: {
												type: "JSON",
												schema: z.object({ id: z.string() }),
											},
										},
									},
								},
							},
						},
					},
				},
			},
			middlewares: {
				MIDDLEWARE: {
					audit: {
						418: { type: "JSON", schema: z.object({ traceId: z.string() }) },
					},
				},
				SHAPE: {
					users: {
						MIDDLEWARE: {
							auth: {
								403: { type: "JSON", schema: z.object({ message: z.string() }) },
							},
						},
						SHAPE: {
							$userId: {
								MIDDLEWARE: {
									rateLimit: {
										429: {
											type: "JSON",
											schema: z.object({ retryAfter: z.number() }),
										},
									},
								},
							},
						},
					},
				},
			},
		});

		const steps: Array<string> = [];
		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({ requestId: "ctx-2" }),
				contracts: {
					SHAPE: {
						users: {
							HANDLER: {
								get: () => {
									steps.push("handler:users");
									return { status: 200, type: "JSON", data: { ok: true } };
								},
							},
							SHAPE: {
								$userId: {
									HANDLER: {
										get: () => {
											steps.push("handler:user");
											return {
												status: 200,
												type: "JSON",
												data: { id: "u1" },
											};
										},
									},
								},
							},
						},
					},
				},
				middlewares: {
					MIDDLEWARE: {
						audit: async (_ctx, next, appContext) => {
							steps.push(`audit:${appContext.requestId}`);
							await next();
						},
					},
					SHAPE: {
						users: {
							MIDDLEWARE: {
								auth: (_ctx, _next, appContext) => {
									steps.push(`auth:block:${appContext.requestId}`);
									return {
										status: 403,
										type: "JSON",
										data: { message: "blocked" },
									};
								},
							},
							SHAPE: {
								$userId: {
									MIDDLEWARE: {
										rateLimit: () => {
											steps.push("rate:block");
											return {
												status: 429,
												type: "JSON",
												data: { retryAfter: 1 },
											};
										},
									},
								},
							},
						},
					},
				},
			}),
		);

		const response = await fetch(`${base}/users/u1`);
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(403);
		expect(parsed.source).toBe("middleware");
		expect(parsed.data).toEqual({ message: "blocked" });
		expect(steps).toEqual(["audit:ctx-2", "auth:block:ctx-2"]);
	});
});

const typedApi = defineApi({
	contracts: {
		SHAPE: {
			json: {
				CONTRACT: {
					post: {
						body: { type: "JSON", schema: z.object({ name: z.string() }) },
						responses: {
							200: {
								type: "JSON",
								schema: z.object({ ok: z.boolean() }),
								headers: {
									type: "Standard",
									schema: z.object({ "x-request-id": z.string() }),
								},
							},
						},
					},
				},
			},
		},
	},
	middlewares: {
		MIDDLEWARE: {
			audit: {
				418: { type: "JSON", schema: z.object({ traceId: z.string() }) },
			},
		},
	},
});

const typeOnly = (_cb: () => void): void => {};

typeOnly(() => {
	// Context is inferred from createContext and threads through handlers.
	void createApiHandlers(typedApi)({
		createContext: async () => ({ requestId: "r-1" }),
		contracts: {
			SHAPE: {
				json: {
					HANDLER: {
						post: (data, _ctx, appContext) => {
							const name: string = data.body.name;
							void name;
							const id: string = appContext.requestId;
							void id;
							return {
								status: 200,
								type: "JSON",
								headers: { "x-request-id": appContext.requestId },
								data: { ok: true },
							};
						},
					},
				},
			},
		},
		middlewares: {
			MIDDLEWARE: {
				audit: (_ctx, _next, appContext) => {
					const id: string = appContext.requestId;
					void id;
					return { status: 418, type: "JSON", data: { traceId: id } };
				},
			},
		},
	});

	void createApiHandlers(typedApi)({
		createContext: () => ({ requestId: "r-1" }),
		contracts: {
			SHAPE: {
				json: {
					HANDLER: {
						post: (_data, _ctx, appContext) => {
							// @ts-expect-error requestId is string
							const bad: number = appContext.requestId;
							void bad;
							return {
								status: 200,
								type: "JSON",
								headers: { "x-request-id": appContext.requestId },
								data: { ok: true },
							};
						},
					},
				},
			},
		},
		middlewares: {
			MIDDLEWARE: {
				audit: (_ctx, next) => next(),
			},
		},
	});

	void createApiHandlers(typedApi)({
		createContext: () => ({}),
		contracts: {
			SHAPE: {
				json: {
					HANDLER: {
						// @ts-expect-error declared response headers are required
						post: () => ({ status: 200, type: "JSON", data: { ok: true } }),
					},
				},
			},
		},
		middlewares: {
			MIDDLEWARE: {
				audit: (_ctx, next) => next(),
			},
		},
	});

	void createApiHandlers(typedApi)({
		createContext: () => ({}),
		contracts: {
			SHAPE: {
				json: {
					HANDLER: {
						post: () => ({
							status: 200,
							type: "JSON",
							// @ts-expect-error declared response headers must match the schema
							headers: { "x-request-id": 1 },
							data: { ok: true },
						}),
					},
				},
			},
		},
		middlewares: {
			MIDDLEWARE: {
				audit: (_ctx, next) => next(),
			},
		},
	});

	// Missing method handlers fail compilation.
	void createApiHandlers(typedApi)({
		createContext: () => ({}),
		contracts: {
			SHAPE: {
				json: {
					// @ts-expect-error the post handler is required
					HANDLER: {},
				},
			},
		},
		middlewares: {
			MIDDLEWARE: {
				audit: (_ctx, next) => next(),
			},
		},
	});

	// Extra handler paths fail compilation.
	void createApiHandlers(typedApi)({
		createContext: () => ({}),
		contracts: {
			SHAPE: {
				json: {
					HANDLER: {
						post: () => ({
							status: 200,
							type: "JSON",
							headers: { "x-request-id": "1" },
							data: { ok: true },
						}),
					},
				},
				// @ts-expect-error unknown handler paths are rejected
				extra: {
					HANDLER: {},
				},
			},
		},
		middlewares: {
			MIDDLEWARE: {
				audit: (_ctx, next) => next(),
			},
		},
	});

	// Declared middleware handlers are required.
	void createApiHandlers(typedApi)({
		createContext: () => ({}),
		contracts: {
			SHAPE: {
				json: {
					HANDLER: {
						post: () => ({
							status: 200,
							type: "JSON",
							headers: { "x-request-id": "1" },
							data: { ok: true },
						}),
					},
				},
			},
		},
		middlewares: {
			// @ts-expect-error the audit middleware handler is required
			MIDDLEWARE: {},
		},
	});

	// Unknown middleware names are rejected.
	void createApiHandlers(typedApi)({
		createContext: () => ({}),
		contracts: {
			SHAPE: {
				json: {
					HANDLER: {
						post: () => ({
							status: 200,
							type: "JSON",
							headers: { "x-request-id": "1" },
							data: { ok: true },
						}),
					},
				},
			},
		},
		middlewares: {
			MIDDLEWARE: {
				audit: (_ctx, next) => next(),
				// @ts-expect-error unknown middleware names are rejected
				extra: (_ctx: unknown, next: () => Promise<void>) => next(),
			},
		},
	});
});

describe("Standard Schema interoperability", () => {
	for (const [vendor, schema] of [
		["Zod", z.string().transform(async (value) => value.trim())],
		["Effect v4", Schema.toStandardSchemaV1(Schema.String)],
	] as const) {
		test(`${vendor} validates requests, responses and headers`, async () => {
			const api = defineApi({
				contracts: {
					CONTRACT: {
						post: {
							body: { type: "Text", schema },
							responses: {
								200: {
									type: "Text",
									schema,
									headers: {
										type: "JSON",
										schema,
									},
								},
							},
						},
					},
				},
			});
			const base = serve(
				createApiHandlers(api)({
					createContext: () => ({}),
					contracts: {
						HANDLER: {
							post: (data) => {
								const value: string = data.body;
								return { status: 200, type: "Text", data: value, headers: value };
							},
						},
					},
				}),
			);
			const client = createClient<typeof api>(base);
			const response = await client.fetch("/", "post", {
				body: { type: "Text", data: "hello" },
			});
			expect(response.status).toBe(200);
			expect(response.data).toBe("hello");
			expect(response.headers).toBe("hello");
		});
	}
	test("client accepts schema input and handlers receive transformed output", async () => {
		const api = defineApi({
			contracts: {
				CONTRACT: {
					post: {
						body: {
							type: "JSON",
							schema: z.string().transform(async (value) => value.length),
						},
						responses: {
							200: { type: "JSON", schema: Schema.toStandardSchemaV1(Schema.Number) },
						},
					},
				},
			},
		});
		const base = serve(
			createApiHandlers(api)({
				createContext: () => ({}),
				contracts: {
					HANDLER: {
						post: (data) => {
							const length: number = data.body;
							return { status: 200, type: "JSON", data: length };
						},
					},
				},
			}),
		);
		const client = createClient<typeof api>(base);
		const response = await client.fetch("/", "post", { body: { type: "JSON", data: "hello" } });
		expect(response.data).toBe(5);
		const invalid = await fetch(base, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "42",
		});
		expect(invalid.status).toBe(400);
	});
});
