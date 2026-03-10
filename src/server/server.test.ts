import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import superjson from "superjson";
import z from "zod";
import type { ContractTreeFor } from "../contract/contract.js";
import type { MiddlewareTreeFor } from "../middleware/middleware.js";
import {
	parseSerializedResponse,
	ZONO_HEADER_DATA_HEADER,
	ZONO_QUERY_DATA_KEY,
} from "../shared/shared.internal.js";
import type { ApiShape } from "../shared/shared.js";
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

const shape = {
	SHAPE: {
		json: { CONTRACT: true },
		query: { CONTRACT: true },
		headers: { CONTRACT: true },
		queryOptional: { CONTRACT: true },
		headersOptional: { CONTRACT: true },
		querySuper: { CONTRACT: true },
		headersSuper: { CONTRACT: true },
		text: { CONTRACT: true },
		blob: { CONTRACT: true },
		form: { CONTRACT: true },
		urlencoded: { CONTRACT: true },
		middleware: { CONTRACT: true },
		boom: { CONTRACT: true },
	},
} as const satisfies ApiShape;

const contracts = {
	SHAPE: {
		json: {
			CONTRACT: {
				post: {
					body: { type: "JSON", schema: z.object({ name: z.string() }) },
					responses: { 200: { type: "JSON", schema: z.object({ ok: z.boolean() }) } },
				},
			},
		},
		query: {
			CONTRACT: {
				get: {
					query: {
						type: "JSON",
						schema: z.object({
							count: z.number().refine(async (count) => count > 0),
						}),
					},
					responses: { 200: { type: "JSON", schema: z.object({ ok: z.boolean() }) } },
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
					responses: { 200: { type: "JSON", schema: z.object({ ok: z.boolean() }) } },
				},
			},
		},
		queryOptional: {
			CONTRACT: {
				get: {
					query: {
						type: "JSON",
						schema: z.object({ count: z.number() }).optional(),
					},
					responses: { 200: { type: "JSON", schema: z.object({ ok: z.boolean() }) } },
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
					responses: { 200: { type: "JSON", schema: z.object({ ok: z.boolean() }) } },
				},
			},
		},
		querySuper: {
			CONTRACT: {
				get: {
					query: {
						type: "SuperJSON",
						schema: z.object({ createdAt: z.date() }),
					},
					responses: { 200: { type: "JSON", schema: z.object({ ok: z.boolean() }) } },
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
					responses: { 200: { type: "JSON", schema: z.object({ ok: z.boolean() }) } },
				},
			},
		},
		text: {
			CONTRACT: {
				post: {
					body: { type: "Text", schema: z.string() },
					responses: { 200: { type: "Text", schema: z.string() } },
				},
			},
		},
		blob: {
			CONTRACT: {
				post: {
					body: { type: "Blob", schema: z.instanceof(Blob) },
					responses: { 200: { type: "Bytes", schema: z.instanceof(Uint8Array) } },
				},
			},
		},
		form: {
			CONTRACT: {
				post: {
					body: { type: "FormData", schema: z.instanceof(FormData) },
					responses: { 200: { type: "JSON", schema: z.object({ ok: z.boolean() }) } },
				},
			},
		},
		urlencoded: {
			CONTRACT: {
				post: {
					body: { type: "URLSearchParams", schema: z.instanceof(URLSearchParams) },
					responses: { 200: { type: "JSON", schema: z.object({ ok: z.boolean() }) } },
				},
			},
		},
		middleware: {
			CONTRACT: {
				get: {
					responses: { 200: { type: "JSON", schema: z.object({ ok: z.boolean() }) } },
				},
			},
		},
		boom: {
			CONTRACT: {
				get: {
					responses: { 200: { type: "JSON", schema: z.object({ ok: z.boolean() }) } },
				},
			},
		},
	},
} as const satisfies ContractTreeFor<typeof shape>;

const handlers: ContractHandlerTree<typeof contracts, unknown> = {
	SHAPE: {
		json: { HANDLER: { post: () => ({ status: 200, type: "JSON", data: { ok: true } }) } },
		query: { HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) } },
		headers: { HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) } },
		queryOptional: {
			HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
		},
		headersOptional: {
			HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
		},
		querySuper: {
			HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
		},
		headersSuper: {
			HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
		},
		text: { HANDLER: { post: () => ({ status: 200, type: "Text", data: "ok" }) } },
		blob: {
			HANDLER: {
				post: () => ({ status: 200, type: "Bytes", data: new Uint8Array([1, 2, 3]) }),
			},
		},
		form: { HANDLER: { post: () => ({ status: 200, type: "JSON", data: { ok: true } }) } },
		urlencoded: {
			HANDLER: { post: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
		},
		middleware: { HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) } },
		boom: {
			HANDLER: {
				get: () => {
					throw new Error("boom");
				},
			},
		},
	},
};

describe("server runtime", () => {
	test("accepts valid input parsers and returns serialized output", async () => {
		const app = new Hono();
		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers<typeof contracts, unknown>(contracts, handlers),
			errorMode: "public",
			createContext: () => ({}),
		});

		const base = startServer(app);

		const json = await fetch(`${base}/json`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "alice" }),
		});
		expect(json.status).toBe(200);

		const query = await fetch(
			`${base}/query?${ZONO_QUERY_DATA_KEY}=${encodeURIComponent(JSON.stringify({ count: 2 }))}`,
		);
		expect(query.status).toBe(200);

		const headers = await fetch(`${base}/headers`, {
			headers: { [ZONO_HEADER_DATA_HEADER]: JSON.stringify({ trace: "t1" }) },
		});
		expect(headers.status).toBe(200);

		const optionalQuery = await fetch(`${base}/queryOptional`);
		expect(optionalQuery.status).toBe(200);

		const optionalHeaders = await fetch(`${base}/headersOptional`);
		expect(optionalHeaders.status).toBe(200);

		const text = await fetch(`${base}/text`, { method: "POST", body: "hello" });
		const parsedText = await parseSerializedResponse(text);
		expect(parsedText.type).toBe("Text");

		const blob = await fetch(`${base}/blob`, {
			method: "POST",
			body: new Blob([new Uint8Array([1, 2, 3])]),
		});
		const parsedBlob = await parseSerializedResponse(blob);
		expect(parsedBlob.type).toBe("Bytes");

		const formData = new FormData();
		formData.set("name", "x");
		const form = await fetch(`${base}/form`, { method: "POST", body: formData });
		expect(form.status).toBe(200);

		const urlencoded = await fetch(`${base}/urlencoded`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
			body: "q=zono",
		});
		expect(urlencoded.status).toBe(200);
	});

	test("rejects invalid query and headers as 400 public errors", async () => {
		const app = new Hono();
		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers<typeof contracts, unknown>(contracts, handlers),
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
		expect((badQueryParsed.data as { issues: Array<unknown> }).issues.length).toBeGreaterThan(
			0,
		);

		const badHeaders = await fetch(`${base}/headers`, {
			headers: {},
		});
		expect(badHeaders.status).toBe(400);
		const badHeadersParsed = await parseSerializedResponse(badHeaders);
		expect((badHeadersParsed.data as { message: string }).message).toBe(
			"Headers validation failed",
		);
		expect((badHeadersParsed.data as { issues: Array<unknown> }).issues.length).toBeGreaterThan(
			0,
		);
	});

	test("returns 400 private validation payload with issueCount", async () => {
		const app = new Hono();
		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers<typeof contracts, unknown>(contracts, handlers),
			errorMode: "private",
			createContext: () => ({}),
		});

		const badQuery = await fetch(`${startServer(app)}/query?${ZONO_QUERY_DATA_KEY}=oops`);
		expect(badQuery.status).toBe(400);
		const parsed = await parseSerializedResponse(badQuery);
		expect((parsed.data as { message: string }).message).toBe("Query validation failed");
		expect((parsed.data as { issueCount: number }).issueCount).toBeGreaterThan(0);
		expect(parsed.data).not.toHaveProperty("issues");
	});

	test("returns JSON 404 for unmatched routes", async () => {
		const app = new Hono();
		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers<typeof contracts, unknown>(contracts, handlers),
			errorMode: "public",
			createContext: () => ({}),
		});

		const notFound = await fetch(`${startServer(app)}/not-a-route`);
		expect(notFound.status).toBe(404);
		const parsed = await parseSerializedResponse(notFound);
		expect(parsed.source).toBe("error");
		expect(parsed.type).toBe("JSON");
		expect(parsed.data).toEqual({ message: "Not Found" });
	});

	test("parses SuperJSON query and headers from reserved transport slots", async () => {
		let queryValue: { createdAt: Date } | undefined;
		let headerValue: { createdAt: Date } | undefined;

		const superHandlers: ContractHandlerTree<typeof contracts, unknown> = {
			...handlers,
			SHAPE: {
				...handlers.SHAPE,
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
		};

		const app = new Hono();
		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers<typeof contracts, unknown>(
				contracts,
				superHandlers,
			),
			errorMode: "public",
			createContext: () => ({}),
		});

		const queryCreatedAt = new Date("2024-02-02T00:00:00.000Z");
		const headerCreatedAt = new Date("2024-03-03T00:00:00.000Z");
		const base = startServer(app);

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
		let optionalQueryValue: { count: number } | undefined;
		let optionalHeaderValue: { trace: string } | undefined;

		const optionalHandlers: ContractHandlerTree<typeof contracts, unknown> = {
			...handlers,
			SHAPE: {
				...handlers.SHAPE,
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
		};

		const app = new Hono();
		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers<typeof contracts, unknown>(
				contracts,
				optionalHandlers,
			),
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

	test("middleware short-circuits and error mode public/private differ", async () => {
		const middlewares = {
			MIDDLEWARE: {
				gate: {
					429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
				},
			},
		} as const satisfies MiddlewareTreeFor<typeof shape>;

		const publicApp = new Hono();
		initHono<typeof shape, unknown, typeof middlewares>(publicApp, {
			contracts: createHonoContractHandlers<typeof contracts, unknown>(contracts, handlers),
			middlewares: createHonoMiddlewareHandlers<typeof middlewares, unknown>(middlewares, {
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
			contracts: createHonoContractHandlers<typeof contracts, unknown>(contracts, handlers),
			errorMode: "private",
			createContext: () => ({}),
		});

		const privateBoom = await fetch(`${startServer(privateApp)}/boom`);
		const privateBoomParsed = await parseSerializedResponse(privateBoom);
		expect(privateBoom.status).toBe(500);
		expect((privateBoomParsed.data as { message: string }).message).toBe("boom");
		expect(privateBoomParsed.data).toHaveProperty("stack");
	});

	test("prepared routes still read the current handler from the resolved handler node", async () => {
		const app = new Hono();
		const mutableHandlers: ContractHandlerTree<typeof contracts, unknown> = {
			SHAPE: {
				json: {
					HANDLER: {
						post: () => ({ status: 200, type: "JSON", data: { ok: true } }),
					},
				},
				query: {
					HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
				},
				headers: {
					HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
				},
				queryOptional: {
					HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
				},
				headersOptional: {
					HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
				},
				querySuper: {
					HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
				},
				headersSuper: {
					HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
				},
				text: { HANDLER: { post: () => ({ status: 200, type: "Text", data: "ok" }) } },
				blob: {
					HANDLER: {
						post: () => ({
							status: 200,
							type: "Bytes",
							data: new Uint8Array([1, 2, 3]),
						}),
					},
				},
				form: {
					HANDLER: { post: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
				},
				urlencoded: {
					HANDLER: { post: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
				},
				middleware: {
					HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
				},
				boom: {
					HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
				},
			},
		};

		initHono<typeof shape, unknown>(app, {
			contracts: createHonoContractHandlers<typeof contracts, unknown>(
				contracts,
				mutableHandlers,
			),
			errorMode: "public",
			createContext: () => ({}),
		});

		mutableHandlers.SHAPE.json.HANDLER.post = () => ({
			status: 200,
			type: "JSON",
			data: { ok: false },
		});

		const response = await fetch(`${startServer(app)}/json`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "alice" }),
		});
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(200);
		expect(parsed.data).toEqual({ ok: false });
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

	test("deeper middleware overrides ancestor middleware with the same name", async () => {
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

		const app = new Hono();
		initHono<typeof scopedShape, unknown, typeof scopedMiddlewares>(app, {
			contracts: createHonoContractHandlers(scopedContracts, {
				SHAPE: {
					users: {
						HANDLER: {
							get: () => ({ status: 200, type: "JSON", data: { ok: true } }),
						},
					},
				},
			}),
			middlewares: createHonoMiddlewareHandlers(scopedMiddlewares, {
				MIDDLEWARE: {
					auth: () => ({
						status: 401,
						type: "JSON",
						data: { message: "root" },
					}),
				},
				SHAPE: {
					users: {
						MIDDLEWARE: {
							auth: () => ({
								status: 403,
								type: "JSON",
								data: { message: "scoped" },
							}),
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

const typed = createHonoContractHandlers<typeof contracts, { requestId: string }>(contracts, {
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
		query: { HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) } },
		headers: { HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) } },
		queryOptional: {
			HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
		},
		headersOptional: {
			HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
		},
		querySuper: { HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) } },
		headersSuper: {
			HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
		},
		text: { HANDLER: { post: () => ({ status: 200, type: "Text", data: "ok" }) } },
		blob: {
			HANDLER: { post: () => ({ status: 200, type: "Bytes", data: new Uint8Array([1]) }) },
		},
		form: { HANDLER: { post: () => ({ status: 200, type: "JSON", data: { ok: true } }) } },
		urlencoded: {
			HANDLER: { post: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
		},
		middleware: { HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) } },
		boom: { HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) } },
	},
});
void typed;

const typeOnly = (_cb: () => void): void => {};

typeOnly(() => {
	void createHonoContractHandlers<typeof contracts, { requestId: string }>(contracts, {
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
			query: { HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) } },
			headers: {
				HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
			},
			queryOptional: {
				HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
			},
			headersOptional: {
				HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
			},
			querySuper: {
				HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
			},
			headersSuper: {
				HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
			},
			text: { HANDLER: { post: () => ({ status: 200, type: "Text", data: "ok" }) } },
			blob: {
				HANDLER: {
					post: () => ({ status: 200, type: "Bytes", data: new Uint8Array([1]) }),
				},
			},
			form: { HANDLER: { post: () => ({ status: 200, type: "JSON", data: { ok: true } }) } },
			urlencoded: {
				HANDLER: { post: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
			},
			middleware: {
				HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
			},
			boom: { HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) } },
		},
	});
});
