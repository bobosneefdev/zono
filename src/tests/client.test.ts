import { afterEach, expect, mock, test } from "bun:test";
import z from "zod";
import { createZonoClient } from "~/client.js";
import { ZonoContractMethod } from "~/contract/enums.js";
import { createZonoContract, createZonoRouter } from "~/contract/factory.js";

const originalFetch = global.fetch;

afterEach(() => {
	global.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchMock(body: unknown, status = 200, contentType = "application/json") {
	return mock(async () => {
		return new Response(
			contentType === "application/json" ? JSON.stringify(body) : String(body),
			{
				status,
				headers: { "Content-Type": contentType },
			},
		);
	});
}

// ---------------------------------------------------------------------------
// Existing tests
// ---------------------------------------------------------------------------

test("createZonoClient serializes GET requests correctly", async () => {
	const fetchMock = makeFetchMock({ id: "123", name: "Mock User" });
	global.fetch = fetchMock as any;

	const router = createZonoRouter({
		users: {
			get: createZonoContract("/:id", {
				method: ZonoContractMethod.GET,
				responses: {
					200: {
						body: z.object({
							id: z.string(),
							name: z.string(),
						}),
					},
				},
				pathParams: z.object({
					id: z.string(),
				}),
				query: z.object({
					includeAdmin: z.string().optional(),
				}),
			}),
		},
	});

	const client = createZonoClient(router, {
		baseUrl: "http://localhost:3000",
	});

	const response = await client.users.get({
		pathParams: { id: "123" },
		query: { includeAdmin: "true" },
	});

	expect(response.status).toBe(200);
	expect(response.data).toEqual({ id: "123", name: "Mock User" });

	expect(fetchMock).toHaveBeenCalled();
	const [url, options] = fetchMock.mock.calls[0] as any;

	expect(url.toString()).toBe("http://localhost:3000/users/get/123?includeAdmin=true");
	expect(options?.method).toBe("GET");
});

test("createZonoClient serializes POST requests and JSON bodies correctly", async () => {
	const fetchMock = makeFetchMock({ success: true }, 201);
	global.fetch = fetchMock as any;

	const router = createZonoRouter({
		users: {
			create: createZonoContract("/new", {
				method: ZonoContractMethod.POST,
				responses: {
					201: {
						body: z.object({
							success: z.boolean(),
						}),
					},
				},
				body: z.object({
					name: z.string(),
					age: z.number(),
				}),
			}),
		},
	});

	const client = createZonoClient(router, {
		baseUrl: "http://localhost:3000",
	});

	const response = await client.users.create({
		body: { name: "Alice", age: 30 },
	});

	expect(response.status).toBe(201);
	expect(response.data).toEqual({ success: true });

	expect(fetchMock).toHaveBeenCalled();
	const [url, options] = fetchMock.mock.calls[0] as any;

	expect(url.toString()).toBe("http://localhost:3000/users/create/new");
	expect(options?.method).toBe("POST");

	const headers = options?.headers as Headers;
	expect(headers.get("Content-Type")).toBe("application/json");
	expect(options?.body).toBe(JSON.stringify({ name: "Alice", age: 30 }));
});

// ---------------------------------------------------------------------------
// HTTP method variants
// ---------------------------------------------------------------------------

test("createZonoClient sends PUT with the correct method", async () => {
	const fetchMock = makeFetchMock({ updated: true });
	global.fetch = fetchMock as any;

	const router = createZonoRouter({
		item: createZonoContract("/:id", {
			method: ZonoContractMethod.PUT,
			responses: { 200: { body: z.object({ updated: z.boolean() }) } },
			pathParams: z.object({ id: z.string() }),
			body: z.object({ value: z.string() }),
		}),
	});

	const client = createZonoClient(router, { baseUrl: "http://localhost:3000" });
	await client.item({ pathParams: { id: "1" }, body: { value: "x" } });

	const [, options] = fetchMock.mock.calls[0] as any;
	expect(options?.method).toBe("PUT");
});

test("createZonoClient sends DELETE with the correct method", async () => {
	const fetchMock = makeFetchMock(null, 204, "text/plain");
	global.fetch = fetchMock as any;

	const router = createZonoRouter({
		item: createZonoContract("/:id", {
			method: ZonoContractMethod.DELETE,
			responses: { 204: {} },
			pathParams: z.object({ id: z.string() }),
		}),
	});

	const client = createZonoClient(router, { baseUrl: "http://localhost:3000" });
	await client.item({ pathParams: { id: "42" } });

	const [, options] = fetchMock.mock.calls[0] as any;
	expect(options?.method).toBe("DELETE");
});

test("createZonoClient sends PATCH with the correct method", async () => {
	const fetchMock = makeFetchMock({ patched: true });
	global.fetch = fetchMock as any;

	const router = createZonoRouter({
		item: createZonoContract("/:id", {
			method: ZonoContractMethod.PATCH,
			responses: { 200: { body: z.object({ patched: z.boolean() }) } },
			pathParams: z.object({ id: z.string() }),
			body: z.object({ field: z.string() }),
		}),
	});

	const client = createZonoClient(router, { baseUrl: "http://localhost:3000" });
	await client.item({ pathParams: { id: "7" }, body: { field: "val" } });

	const [, options] = fetchMock.mock.calls[0] as any;
	expect(options?.method).toBe("PATCH");
});

// ---------------------------------------------------------------------------
// Array query params
// ---------------------------------------------------------------------------

test("createZonoClient appends array query params as multiple entries", async () => {
	const fetchMock = makeFetchMock([]);
	global.fetch = fetchMock as any;

	const router = createZonoRouter({
		search: createZonoContract("/search", {
			method: ZonoContractMethod.GET,
			responses: { 200: { body: z.array(z.string()) } },
			query: z.object({
				tags: z.array(z.string()),
			}),
		}),
	});

	const client = createZonoClient(router, { baseUrl: "http://localhost:3000" });
	await client.search({ query: { tags: ["a", "b", "c"] } });

	const [url] = fetchMock.mock.calls[0] as any;
	const parsed = new URL(url.toString());
	expect(parsed.searchParams.getAll("tags")).toEqual(["a", "b", "c"]);
});

// ---------------------------------------------------------------------------
// Validation bypass flags
// ---------------------------------------------------------------------------

test("ignoreInputValidation allows invalid input without throwing", async () => {
	const fetchMock = makeFetchMock({ ok: true });
	global.fetch = fetchMock as any;

	const router = createZonoRouter({
		resource: createZonoContract("/resource", {
			method: ZonoContractMethod.POST,
			responses: { 200: { body: z.object({ ok: z.boolean() }) } },
			body: z.object({ name: z.string() }),
		}),
	});

	// Pass a number where a string is expected — should NOT throw because ignoreInputValidation is set
	const client = createZonoClient(router, {
		baseUrl: "http://localhost:3000",
		ignoreInputValidation: true,
	});

	await expect(client.resource({ body: { name: 999 as any } })).resolves.toBeDefined();
});

test("ignoreOutputValidation allows invalid server response without throwing", async () => {
	// Server returns wrong shape: { wrong: true } instead of { ok: boolean }
	const fetchMock = makeFetchMock({ wrong: true });
	global.fetch = fetchMock as any;

	const router = createZonoRouter({
		resource: createZonoContract("/resource", {
			method: ZonoContractMethod.GET,
			responses: { 200: { body: z.object({ ok: z.boolean() }) } },
		}),
	});

	const client = createZonoClient(router, {
		baseUrl: "http://localhost:3000",
		ignoreOutputValidation: true,
	});

	const response = await client.resource();
	// data is the raw (invalid) server JSON — no ZodError thrown
	expect((response.data as any).wrong).toBe(true);
});

// ---------------------------------------------------------------------------
// Unexpected status code
// ---------------------------------------------------------------------------

test("createZonoClient throws on an unexpected status code", async () => {
	// Server returns 503 but contract only declares 200
	const fetchMock = mock(async () => new Response(null, { status: 503 }));
	global.fetch = fetchMock as any;

	const router = createZonoRouter({
		resource: createZonoContract("/resource", {
			method: ZonoContractMethod.GET,
			responses: { 200: {} },
		}),
	});

	const client = createZonoClient(router, { baseUrl: "http://localhost:3000" });

	await expect(client.resource()).rejects.toThrow("Unexpected status code: 503");
});

// ---------------------------------------------------------------------------
// defaultHeaders
// ---------------------------------------------------------------------------

test("createZonoClient sends defaultHeaders on every request", async () => {
	const fetchMock = makeFetchMock({ ok: true });
	global.fetch = fetchMock as any;

	const router = createZonoRouter({
		resource: createZonoContract("/resource", {
			method: ZonoContractMethod.GET,
			responses: { 200: { body: z.object({ ok: z.boolean() }) } },
		}),
	});

	const client = createZonoClient(router, {
		baseUrl: "http://localhost:3000",
		defaultHeaders: { "X-Api-Key": "secret-key" },
	});

	await client.resource();

	const [, options] = fetchMock.mock.calls[0] as any;
	expect((options?.headers as Headers).get("X-Api-Key")).toBe("secret-key");
});

test("per-call headers are merged with defaultHeaders", async () => {
	const fetchMock = makeFetchMock({ ok: true });
	global.fetch = fetchMock as any;

	const router = createZonoRouter({
		resource: createZonoContract("/resource", {
			method: ZonoContractMethod.GET,
			responses: { 200: { body: z.object({ ok: z.boolean() }) } },
			headers: z.object({ "x-request-id": z.string() }),
		}),
	});

	const client = createZonoClient(router, {
		baseUrl: "http://localhost:3000",
		defaultHeaders: { "X-Api-Key": "secret-key" },
	});

	await client.resource({ headers: { "x-request-id": "req-abc" } });

	const [, options] = fetchMock.mock.calls[0] as any;
	const sentHeaders = options?.headers as Headers;
	expect(sentHeaders.get("X-Api-Key")).toBe("secret-key");
	expect(sentHeaders.get("x-request-id")).toBe("req-abc");
});

// ---------------------------------------------------------------------------
// FormData body
// ---------------------------------------------------------------------------

test("createZonoClient sends FormData as-is without JSON.stringify or Content-Type override", async () => {
	const fetchMock = makeFetchMock({ uploaded: true });
	global.fetch = fetchMock as any;

	const router = createZonoRouter({
		upload: createZonoContract("/upload", {
			method: ZonoContractMethod.POST,
			responses: { 200: { body: z.object({ uploaded: z.boolean() }) } },
			body: z.any(), // FormData bypasses JSON serialization at runtime
		}),
	});

	const client = createZonoClient(router, { baseUrl: "http://localhost:3000" });

	const fd = new FormData();
	fd.append("file", "data");

	await client.upload({ body: fd as any });

	const [, options] = fetchMock.mock.calls[0] as any;
	// Body should be the FormData instance itself
	expect(options?.body).toBe(fd);
	// Content-Type must NOT be forced to application/json for FormData
	expect((options?.headers as Headers).get("Content-Type")).not.toBe("application/json");
});

// ---------------------------------------------------------------------------
// Input validation throws by default
// ---------------------------------------------------------------------------

test("createZonoClient throws on invalid input body when ignoreInputValidation is not set", async () => {
	const fetchMock = makeFetchMock({ ok: true });
	global.fetch = fetchMock as any;

	const router = createZonoRouter({
		resource: createZonoContract("/resource", {
			method: ZonoContractMethod.POST,
			responses: { 200: { body: z.object({ ok: z.boolean() }) } },
			body: z.object({ name: z.string() }),
		}),
	});

	const client = createZonoClient(router, { baseUrl: "http://localhost:3000" });

	// Pass a number where a string is required — should throw a ZodError
	await expect(client.resource({ body: { name: 123 as any } })).rejects.toThrow();
});

// ---------------------------------------------------------------------------
// Output validation throws by default
// ---------------------------------------------------------------------------

test("createZonoClient throws on invalid response body when ignoreOutputValidation is not set", async () => {
	// Server returns wrong shape
	const fetchMock = makeFetchMock({ wrong: true });
	global.fetch = fetchMock as any;

	const router = createZonoRouter({
		resource: createZonoContract("/resource", {
			method: ZonoContractMethod.GET,
			responses: { 200: { body: z.object({ ok: z.boolean() }) } },
		}),
	});

	const client = createZonoClient(router, { baseUrl: "http://localhost:3000" });

	await expect(client.resource()).rejects.toThrow();
});

// ---------------------------------------------------------------------------
// Path param URL encoding
// ---------------------------------------------------------------------------

test("createZonoClient URL-encodes special characters in path params", async () => {
	const fetchMock = makeFetchMock({ ok: true });
	global.fetch = fetchMock as any;

	const router = createZonoRouter({
		resource: createZonoContract("/:id", {
			method: ZonoContractMethod.GET,
			responses: { 200: { body: z.object({ ok: z.boolean() }) } },
			pathParams: z.object({ id: z.string() }),
		}),
	});

	const client = createZonoClient(router, { baseUrl: "http://localhost:3000" });
	await client.resource({ pathParams: { id: "hello world/slash" } });

	const [url] = fetchMock.mock.calls[0] as any;
	// Both the space and the slash should be percent-encoded
	expect(url.toString()).toContain(encodeURIComponent("hello world/slash"));
});

// ---------------------------------------------------------------------------
// Optional query param omitted → not appended to URL
// ---------------------------------------------------------------------------

test("createZonoClient does not append undefined optional query params to the URL", async () => {
	const fetchMock = makeFetchMock({ ok: true });
	global.fetch = fetchMock as any;

	const router = createZonoRouter({
		search: createZonoContract("/search", {
			method: ZonoContractMethod.GET,
			responses: { 200: { body: z.object({ ok: z.boolean() }) } },
			query: z.object({
				required: z.string(),
				optional: z.string().optional(),
			}),
		}),
	});

	const client = createZonoClient(router, { baseUrl: "http://localhost:3000" });
	await client.search({ query: { required: "yes", optional: undefined } });

	const [url] = fetchMock.mock.calls[0] as any;
	const parsed = new URL(url.toString());
	expect(parsed.searchParams.has("required")).toBe(true);
	expect(parsed.searchParams.has("optional")).toBe(false);
});
