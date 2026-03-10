import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import superjson from "superjson";
import z from "zod";
import type { ContractTreeFor } from "../contract/contract.js";
import type { MiddlewareTreeFor } from "../middleware/middleware.js";
import type { ApiShape } from "../shared/shared.js";
import {
	parseSerializedResponse,
	ZONO_HEADER_DATA_HEADER,
	ZONO_QUERY_DATA_KEY,
} from "../shared/shared.js";
import type { ContractHandlerTree } from "./server.js";
import { createHonoContractHandlers, createHonoMiddlewareHandlers, initHono } from "./server.js";

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

describe("server runtime", () => {
	test("parses path params, standard query, and standard headers into handler data", async () => {
		const shape = {
			SHAPE: {
				users: {
					SHAPE: {
						$userId: { CONTRACT: true },
					},
				},
			},
		} as const satisfies ApiShape;

		const contracts = {
			SHAPE: {
				users: {
					SHAPE: {
						$userId: {
							CONTRACT: {
								get: {
									pathParams: z.object({ userId: z.string() }),
									query: {
										type: "Standard",
										schema: z.object({ foo: z.string(), count: z.string() }),
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
		} as const satisfies ContractTreeFor<typeof shape>;

		const app = new Hono();
		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers(contracts, {
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
			}),
			errorMode: "public",
			createContext: () => ({}),
		});

		const response = await fetch(`${startServer(app)}/users/u1?foo=bar&count=2`, {
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
		const shape = {
			SHAPE: {
				querySuper: { CONTRACT: true },
				headersSuper: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const contracts = {
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
		} as const satisfies ContractTreeFor<typeof shape>;

		let queryValue: { createdAt: Date } | undefined;
		let headerValue: { createdAt: Date } | undefined;

		const app = new Hono();
		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers(contracts, {
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
			}),
			errorMode: "public",
			createContext: () => ({}),
		});

		const base = startServer(app);
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
		const shape = {
			SHAPE: {
				queryOptional: { CONTRACT: true },
				headersOptional: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const contracts = {
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
		} as const satisfies ContractTreeFor<typeof shape>;

		let optionalQueryValue: { count: number } | undefined;
		let optionalHeaderValue: { trace: string } | undefined;

		const app = new Hono();
		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers(contracts, {
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
			}),
			errorMode: "public",
			createContext: () => ({}),
		});

		const base = startServer(app);
		const queryResponse = await fetch(`${base}/queryOptional`);
		const headerResponse = await fetch(`${base}/headersOptional`);

		expect(queryResponse.status).toBe(200);
		expect(headerResponse.status).toBe(200);
		expect(optionalQueryValue).toBeUndefined();
		expect(optionalHeaderValue).toBeUndefined();
	});

	test("returns 400 public errors for invalid query and header payloads", async () => {
		const shape = {
			SHAPE: {
				query: { CONTRACT: true },
				headers: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const contracts = {
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
		} as const satisfies ContractTreeFor<typeof shape>;

		const handlers: ContractHandlerTree<typeof contracts, unknown> = {
			SHAPE: {
				query: {
					HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
				},
				headers: {
					HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
				},
			},
		};

		const app = new Hono();
		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers(contracts, handlers),
			errorMode: "public",
			createContext: () => ({}),
		});

		const base = startServer(app);

		const badQuery = await fetch(`${base}/query?${ZONO_QUERY_DATA_KEY}=oops`);
		expect(badQuery.status).toBe(400);
		const badQueryParsed = await parseSerializedResponse(badQuery);
		expect(badQueryParsed.source).toBe("error");
		expect((badQueryParsed.data as { message: string }).message).toBe(
			"Query validation failed",
		);

		const badHeaders = await fetch(`${base}/headers`, {
			headers: {},
		});
		expect(badHeaders.status).toBe(400);
		const badHeadersParsed = await parseSerializedResponse(badHeaders);
		expect((badHeadersParsed.data as { message: string }).message).toBe(
			"Headers validation failed",
		);
	});

	test("returns 400 when path params fail schema validation", async () => {
		const shape = {
			SHAPE: {
				users: {
					SHAPE: {
						$userId: { CONTRACT: true },
					},
				},
			},
		} as const satisfies ApiShape;

		const contracts = {
			SHAPE: {
				users: {
					SHAPE: {
						$userId: {
							CONTRACT: {
								get: {
									pathParams: z.object({ userId: z.uuid() }),
									responses: {
										200: { type: "JSON", schema: z.object({ id: z.string() }) },
									},
								},
							},
						},
					},
				},
			},
		} as const satisfies ContractTreeFor<typeof shape>;

		const app = new Hono();
		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers(contracts, {
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
			}),
			errorMode: "public",
			createContext: () => ({}),
		});

		const response = await fetch(`${startServer(app)}/users/not-a-uuid`);
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(400);
		expect(parsed.data).toEqual({
			message: "Path params validation failed",
			issues: expect.any(Array),
		});
	});

	test("returns 400 when JSON or SuperJSON bodies cannot be parsed", async () => {
		const shape = {
			SHAPE: {
				jsonBody: { CONTRACT: true },
				superBody: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const contracts = {
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
							body: { type: "SuperJSON", schema: z.object({ createdAt: z.date() }) },
							responses: {
								200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
							},
						},
					},
				},
			},
		} as const satisfies ContractTreeFor<typeof shape>;

		const handlers: ContractHandlerTree<typeof contracts, unknown> = {
			SHAPE: {
				jsonBody: {
					HANDLER: { post: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
				},
				superBody: {
					HANDLER: { post: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
				},
			},
		};

		const app = new Hono();
		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers(contracts, handlers),
			errorMode: "public",
			createContext: () => ({}),
		});

		const base = startServer(app);
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

		expect(badJson.status).toBe(400);
		expect((await parseSerializedResponse(badJson)).data).toEqual({
			message: "Body validation failed",
			issues: [{ message: expect.any(String) }],
		});

		expect(badSuper.status).toBe(400);
		expect((await parseSerializedResponse(badSuper)).data).toEqual({
			message: "Body validation failed",
			issues: [{ message: expect.any(String) }],
		});
	});

	test("returns 400 when body schema validation fails", async () => {
		const shape = {
			SHAPE: {
				jsonBody: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const contracts = {
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
			},
		} as const satisfies ContractTreeFor<typeof shape>;

		const app = new Hono();
		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers(contracts, {
				SHAPE: {
					jsonBody: {
						HANDLER: {
							post: () => ({ status: 200, type: "JSON", data: { ok: true } }),
						},
					},
				},
			}),
			errorMode: "public",
			createContext: () => ({}),
		});

		const response = await fetch(`${startServer(app)}/jsonBody`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: 123 }),
		});
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(400);
		expect(parsed.data).toEqual({
			message: "Body validation failed",
			issues: expect.any(Array),
		});
	});

	test("preserves headers on serialized contract responses", async () => {
		const shape = {
			SHAPE: {
				json: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const contracts = {
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
			},
		} as const satisfies ContractTreeFor<typeof shape>;

		const app = new Hono();
		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers(contracts, {
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
				},
			}),
			errorMode: "public",
			createContext: () => ({}),
		});

		const response = await fetch(`${startServer(app)}/json`);
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(200);
		expect(response.headers.get("x-handler")).toBe("1");
		expect(parsed.data).toEqual({ ok: true });
	});

	test("returns 500 when handlers violate the declared response contract", async () => {
		const shape = {
			SHAPE: {
				invalidStatus: { CONTRACT: true },
				invalidType: { CONTRACT: true },
				invalidData: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

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
			},
		} as const satisfies ContractTreeFor<typeof shape>;

		const app = new Hono();
		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers(contracts, {
				SHAPE: {
					invalidStatus: {
						HANDLER: { get: () => ({ status: 201, type: "JSON", data: { ok: true } }) },
					},
					invalidType: {
						HANDLER: { get: () => ({ status: 200, type: "Text", data: "nope" }) },
					},
					invalidData: {
						HANDLER: {
							get: () => ({ status: 200, type: "JSON", data: { ok: "nope" } }),
						},
					},
				},
			} as unknown as ContractHandlerTree<typeof contracts, unknown>),
			errorMode: "public",
			createContext: () => ({}),
		});

		const base = startServer(app);
		const invalidStatus = await parseSerializedResponse(await fetch(`${base}/invalidStatus`));
		const invalidType = await parseSerializedResponse(await fetch(`${base}/invalidType`));
		const invalidData = await parseSerializedResponse(await fetch(`${base}/invalidData`));

		expect(invalidStatus.data).toEqual({
			message: "Handler returned undeclared status: 201",
		});
		expect(invalidType.data).toEqual({
			message: "Handler returned mismatched response type. Expected JSON, received Text",
		});
		expect(invalidData.data).toEqual({
			message: "Handler response data validation failed",
		});
	});

	test("returns 400 private validation payload with issueCount", async () => {
		const shape = {
			SHAPE: {
				query: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const contracts = {
			SHAPE: {
				query: {
					CONTRACT: {
						get: {
							query: {
								type: "JSON",
								schema: z.object({ count: z.number() }),
							},
							responses: {
								200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
							},
						},
					},
				},
			},
		} as const satisfies ContractTreeFor<typeof shape>;

		const app = new Hono();
		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers(contracts, {
				SHAPE: {
					query: {
						HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
					},
				},
			}),
			errorMode: "private",
			createContext: () => ({}),
		});

		const badQuery = await fetch(`${startServer(app)}/query?${ZONO_QUERY_DATA_KEY}=oops`);
		const parsed = await parseSerializedResponse(badQuery);

		expect(badQuery.status).toBe(400);
		expect(parsed.data).toEqual({
			message: "Query validation failed",
			issueCount: expect.any(Number),
		});
	});

	test("returns JSON 404 for unmatched routes", async () => {
		const shape = {
			SHAPE: {
				json: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const contracts = {
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
		} as const satisfies ContractTreeFor<typeof shape>;

		const app = new Hono();
		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers(contracts, {
				SHAPE: {
					json: {
						HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
					},
				},
			}),
			errorMode: "public",
			createContext: () => ({}),
		});

		const notFound = await fetch(`${startServer(app)}/not-a-route`);
		const parsed = await parseSerializedResponse(notFound);

		expect(notFound.status).toBe(404);
		expect(parsed.source).toBe("error");
		expect(parsed.data).toEqual({ message: "Not Found" });
	});

	test("middleware raw Response pass-through bypasses serialization", async () => {
		const shape = {
			SHAPE: {
				middleware: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const contracts = {
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
		} as const satisfies ContractTreeFor<typeof shape>;

		const middlewares = {
			MIDDLEWARE: {
				gate: {
					401: { type: "JSON", schema: z.object({ message: z.string() }) },
				},
			},
		} as const satisfies MiddlewareTreeFor<typeof shape>;

		let handlerCalled = false;
		const app = new Hono();
		initHono<typeof shape, unknown, typeof middlewares>(app, {
			contracts: createHonoContractHandlers(contracts, {
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
			}),
			middlewares: createHonoMiddlewareHandlers(middlewares, {
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
			}),
			errorMode: "public",
			createContext: () => ({}),
		});

		const response = await fetch(`${startServer(app)}/middleware`);

		expect(response.status).toBe(401);
		expect(response.headers.get("x-raw")).toBe("1");
		expect(await response.text()).toBe("blocked");
		expect(handlerCalled).toBe(false);
	});

	test("middleware short-circuits and public/private errors differ", async () => {
		const shape = {
			SHAPE: {
				middleware: { CONTRACT: true },
				boom: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const contracts = {
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
		} as const satisfies ContractTreeFor<typeof shape>;

		const middlewares = {
			MIDDLEWARE: {
				gate: {
					429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
				},
			},
		} as const satisfies MiddlewareTreeFor<typeof shape>;

		const handlers: ContractHandlerTree<typeof contracts, unknown> = {
			SHAPE: {
				middleware: {
					HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
				},
				boom: {
					HANDLER: {
						get: () => {
							throw new Error("boom");
						},
					},
				},
			},
		};

		const publicApp = new Hono();
		initHono<typeof shape, unknown, typeof middlewares>(publicApp, {
			contracts: createHonoContractHandlers(contracts, handlers),
			middlewares: createHonoMiddlewareHandlers(middlewares, {
				MIDDLEWARE: {
					gate: (ctx, next) => {
						if (new URL(ctx.req.url).searchParams.get("deny") === "1") {
							return { status: 429, type: "JSON", data: { retryAfter: 5 } };
						}
						return next();
					},
				},
			}),
			errorMode: "public",
			createContext: () => ({}),
		});

		const publicBase = startServer(publicApp);
		const denied = await fetch(`${publicBase}/middleware?deny=1`);
		expect(denied.status).toBe(429);
		expect((await parseSerializedResponse(denied)).source).toBe("middleware");

		const publicBoom = await fetch(`${publicBase}/boom`);
		const publicBoomParsed = await parseSerializedResponse(publicBoom);
		expect(publicBoom.status).toBe(500);
		expect(publicBoomParsed.data).toEqual({ message: "boom" });

		const privateApp = new Hono();
		initHono<typeof shape, unknown>(privateApp, {
			contracts: createHonoContractHandlers(contracts, handlers),
			errorMode: "private",
			createContext: () => ({}),
		});

		const privateBoom = await fetch(`${startServer(privateApp)}/boom`);
		const privateBoomParsed = await parseSerializedResponse(privateBoom);
		expect(privateBoom.status).toBe(500);
		expect((privateBoomParsed.data as { message: string }).message).toBe("boom");
		expect(privateBoomParsed.data).toHaveProperty("stack");
	});
});

describe("server scoped middleware runtime", () => {
	test("runs root-to-leaf middleware only on matching routes and threads context", async () => {
		const scopedShape = {
			SHAPE: {
				users: {
					CONTRACT: true,
					SHAPE: {
						$userId: { CONTRACT: true },
					},
				},
				plain: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const scopedContracts = {
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
										200: { type: "JSON", schema: z.object({ id: z.string() }) },
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
		} as const satisfies ContractTreeFor<typeof scopedShape>;

		const scopedMiddlewares = {
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
		} as const satisfies MiddlewareTreeFor<typeof scopedShape>;

		const steps: Array<string> = [];
		const app = new Hono();
		initHono<typeof scopedShape, { requestId: string }, typeof scopedMiddlewares>(app, {
			contracts: createHonoContractHandlers(scopedContracts, {
				SHAPE: {
					users: {
						HANDLER: {
							get: (_data, _ctx, ourContext) => {
								steps.push(`handler:users:${ourContext.requestId}`);
								return { status: 200, type: "JSON", data: { ok: true } };
							},
						},
						SHAPE: {
							$userId: {
								HANDLER: {
									get: (data, _ctx, ourContext) => {
										steps.push(`handler:user:${ourContext.requestId}`);
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
							get: (_data, _ctx, ourContext) => {
								steps.push(`handler:plain:${ourContext.requestId}`);
								return { status: 200, type: "JSON", data: { ok: true } };
							},
						},
					},
				},
			}),
			middlewares: createHonoMiddlewareHandlers(scopedMiddlewares, {
				MIDDLEWARE: {
					audit: async (_ctx, next, ourContext) => {
						steps.push(`audit:before:${ourContext.requestId}`);
						await next();
						steps.push("audit:after");
					},
				},
				SHAPE: {
					users: {
						MIDDLEWARE: {
							auth: async (_ctx, next, ourContext) => {
								steps.push(`auth:before:${ourContext.requestId}`);
								await next();
								steps.push("auth:after");
							},
						},
						SHAPE: {
							$userId: {
								MIDDLEWARE: {
									rateLimit: async (_ctx, next, ourContext) => {
										steps.push(`rate:before:${ourContext.requestId}`);
										await next();
										steps.push("rate:after");
									},
								},
							},
						},
					},
				},
			}),
			errorMode: "public",
			createContext: () => ({ requestId: "ctx-1" }),
		});

		const base = startServer(app);

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
		const scopedShape = {
			SHAPE: {
				users: { CONTRACT: true },
			},
		} as const satisfies ApiShape;

		const scopedContracts = {
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
		} as const satisfies ContractTreeFor<typeof scopedShape>;

		const scopedMiddlewares = {
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
		} as const satisfies MiddlewareTreeFor<typeof scopedShape>;

		const steps: Array<string> = [];
		const app = new Hono();
		initHono<typeof scopedShape, unknown, typeof scopedMiddlewares>(app, {
			contracts: createHonoContractHandlers(scopedContracts, {
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
			}),
			middlewares: createHonoMiddlewareHandlers(scopedMiddlewares, {
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
			}),
			errorMode: "public",
			createContext: () => ({}),
		});

		const response = await fetch(`${startServer(app)}/users`);
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(403);
		expect(parsed.source).toBe("middleware");
		expect(parsed.data).toEqual({ message: "scoped" });
		expect(steps).toEqual(["root", "scoped"]);
	});

	test("nested short-circuit stops deeper middleware and handler execution", async () => {
		const scopedShape = {
			SHAPE: {
				users: {
					CONTRACT: true,
					SHAPE: {
						$userId: { CONTRACT: true },
					},
				},
			},
		} as const satisfies ApiShape;

		const scopedContracts = {
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
										200: { type: "JSON", schema: z.object({ id: z.string() }) },
									},
								},
							},
						},
					},
				},
			},
		} as const satisfies ContractTreeFor<typeof scopedShape>;

		const scopedMiddlewares = {
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
		} as const satisfies MiddlewareTreeFor<typeof scopedShape>;

		const steps: Array<string> = [];
		const app = new Hono();
		initHono<typeof scopedShape, { requestId: string }, typeof scopedMiddlewares>(app, {
			contracts: createHonoContractHandlers(scopedContracts, {
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
										return { status: 200, type: "JSON", data: { id: "u1" } };
									},
								},
							},
						},
					},
				},
			}),
			middlewares: createHonoMiddlewareHandlers(scopedMiddlewares, {
				MIDDLEWARE: {
					audit: async (_ctx, next, ourContext) => {
						steps.push(`audit:${ourContext.requestId}`);
						await next();
					},
				},
				SHAPE: {
					users: {
						MIDDLEWARE: {
							auth: (_ctx, _next, ourContext) => {
								steps.push(`auth:block:${ourContext.requestId}`);
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
			}),
			errorMode: "public",
			createContext: () => ({ requestId: "ctx-2" }),
		});

		const response = await fetch(`${startServer(app)}/users/u1`);
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(403);
		expect(parsed.source).toBe("middleware");
		expect(parsed.data).toEqual({ message: "blocked" });
		expect(steps).toEqual(["audit:ctx-2", "auth:block:ctx-2"]);
	});
});

const typedShape = {
	SHAPE: {
		json: { CONTRACT: true },
	},
} as const satisfies ApiShape;

const typedContracts = {
	SHAPE: {
		json: {
			CONTRACT: {
				post: {
					body: { type: "JSON", schema: z.object({ name: z.string() }) },
					responses: { 200: { type: "JSON", schema: z.object({ ok: z.boolean() }) } },
				},
			},
		},
	},
} as const satisfies ContractTreeFor<typeof typedShape>;

const typed = createHonoContractHandlers<typeof typedContracts, { requestId: string }>(
	typedContracts,
	{
		SHAPE: {
			json: {
				HANDLER: {
					post: (_data, _ctx, ourContext) => {
						const id: string = ourContext.requestId;
						void id;
						return { status: 200, type: "JSON", data: { ok: true } };
					},
				},
			},
		},
	},
);
void typed;

const typeOnly = (_cb: () => void): void => {};

typeOnly(() => {
	void createHonoContractHandlers<typeof typedContracts, { requestId: string }>(typedContracts, {
		SHAPE: {
			json: {
				HANDLER: {
					post: (_data, _ctx, ourContext) => {
						// @ts-expect-error requestId is string
						const bad: number = ourContext.requestId;
						void bad;
						return { status: 200, type: "JSON", data: { ok: true } };
					},
				},
			},
		},
	});
});
