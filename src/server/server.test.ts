import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import z from "zod";
import type { Contracts } from "../contract/contract.types.js";
import type { Middlewares } from "../middleware/middleware.types.js";
import { parseSerializedResponse } from "../shared/shared.js";
import type { Shape } from "../shared/shared.types.js";
import { createHonoContractHandlers, createHonoMiddlewareHandlers, initHono } from "./server.js";
import type { ContractHandlersFromContracts } from "./server.types.js";

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
		text: { CONTRACT: true },
		blob: { CONTRACT: true },
		form: { CONTRACT: true },
		urlencoded: { CONTRACT: true },
		middleware: { CONTRACT: true },
		boom: { CONTRACT: true },
	},
} as const satisfies Shape;

const contracts = {
	SHAPE: {
		json: {
			CONTRACT: {
				post: {
					body: { type: "JSON", body: z.object({ name: z.string() }) },
					responses: { 200: { type: "JSON", body: z.object({ ok: z.boolean() }) } },
				},
			},
		},
		query: {
			CONTRACT: {
				get: {
					query: {
						type: "JSON",
						query: z.object({
							count: z.number().refine(async (count) => count > 0),
						}),
					},
					responses: { 200: { type: "JSON", body: z.object({ ok: z.boolean() }) } },
				},
			},
		},
		headers: {
			CONTRACT: {
				get: {
					headers: {
						type: "Standard",
						headers: z.object({ "x-trace": z.string() }),
					},
					responses: { 200: { type: "JSON", body: z.object({ ok: z.boolean() }) } },
				},
			},
		},
		text: {
			CONTRACT: {
				post: {
					body: { type: "Text", body: z.string() },
					responses: { 200: { type: "Text", body: z.string() } },
				},
			},
		},
		blob: {
			CONTRACT: {
				post: {
					body: { type: "Blob", body: z.instanceof(Blob) },
					responses: { 200: { type: "Bytes", body: z.instanceof(Uint8Array) } },
				},
			},
		},
		form: {
			CONTRACT: {
				post: {
					body: { type: "FormData", body: z.instanceof(FormData) },
					responses: { 200: { type: "JSON", body: z.object({ ok: z.boolean() }) } },
				},
			},
		},
		urlencoded: {
			CONTRACT: {
				post: {
					body: { type: "URLSearchParams", body: z.instanceof(URLSearchParams) },
					responses: { 200: { type: "JSON", body: z.object({ ok: z.boolean() }) } },
				},
			},
		},
		middleware: {
			CONTRACT: {
				get: {
					responses: { 200: { type: "JSON", body: z.object({ ok: z.boolean() }) } },
				},
			},
		},
		boom: {
			CONTRACT: {
				get: {
					responses: { 200: { type: "JSON", body: z.object({ ok: z.boolean() }) } },
				},
			},
		},
	},
} as const satisfies Contracts<typeof shape>;

const handlers: ContractHandlersFromContracts<typeof contracts, unknown> = {
	SHAPE: {
		json: { HANDLER: { post: () => ({ status: 200, type: "JSON", data: { ok: true } }) } },
		query: { HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) } },
		headers: { HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) } },
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
		initHono(app, {
			contracts: createHonoContractHandlers<typeof shape, unknown>(contracts, handlers),
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

		const query = await fetch(`${base}/query?count=2`);
		expect(query.status).toBe(200);

		const headers = await fetch(`${base}/headers`, {
			headers: { "x-trace": "t1" },
		});
		expect(headers.status).toBe(200);

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
		initHono(app, {
			contracts: createHonoContractHandlers<typeof shape, unknown>(contracts, handlers),
			errorMode: "public",
			createContext: () => ({}),
		});

		const base = startServer(app);

		const badQuery = await fetch(`${base}/query?count=oops`);
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
		initHono(app, {
			contracts: createHonoContractHandlers<typeof shape, unknown>(contracts, handlers),
			errorMode: "private",
			createContext: () => ({}),
		});

		const badQuery = await fetch(`${startServer(app)}/query?count=oops`);
		expect(badQuery.status).toBe(400);
		const parsed = await parseSerializedResponse(badQuery);
		expect((parsed.data as { message: string }).message).toBe("Query validation failed");
		expect((parsed.data as { issueCount: number }).issueCount).toBeGreaterThan(0);
		expect(parsed.data).not.toHaveProperty("issues");
	});

	test("returns JSON 404 for unmatched routes", async () => {
		const app = new Hono();
		initHono(app, {
			contracts: createHonoContractHandlers<typeof shape, unknown>(contracts, handlers),
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

	test("middleware short-circuits and error mode public/private differ", async () => {
		const middlewares = {
			MIDDLEWARE: {
				gate: {
					429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
				},
			},
		} as const satisfies Middlewares<typeof shape>;

		const publicApp = new Hono();
		initHono(publicApp, {
			contracts: createHonoContractHandlers<typeof shape, unknown>(contracts, handlers),
			middlewares: createHonoMiddlewareHandlers<typeof shape, unknown>(middlewares, {
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
		initHono(privateApp, {
			contracts: createHonoContractHandlers<typeof shape, unknown>(contracts, handlers),
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

const typed = createHonoContractHandlers<typeof shape, { requestId: string }>(contracts, {
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
	void createHonoContractHandlers<typeof shape, { requestId: string }>(contracts, {
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
