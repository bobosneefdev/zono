import { describe, expect, test } from "bun:test";
import superjson from "superjson";
import z from "zod";
import {
	appendQueryParams,
	collectShapePathNodes,
	createSerializedResponse,
	findExactShapePathNode,
	getRequestHeadersObject,
	getRequestQueryObject,
	HTTP_METHODS,
	interpolatePathTemplate,
	isHTTPMethod,
	METHODS_WITHOUT_FETCH_BODY,
	makeErrorRuntimeResponse,
	makeNotFoundRuntimeResponse,
	mediaTypeSatisfies,
	normalizeHeaderValues,
	parseBodyInput,
	parseHeadersInput,
	parseMediaType,
	parseQueryInput,
	parseSerializedResponse,
	RequestValidationError,
	resolveRequestContentType,
	resolveResponseContentType,
	toHonoPath,
	UnsupportedMediaTypeError,
	validateResponseAgainstStatusMap,
	ZONO_HEADER_DATA_HEADER,
	ZONO_HEADER_DATA_TYPE_HEADER,
	ZONO_QUERY_DATA_KEY,
	ZONO_RESPONSE_SOURCE_HEADER,
	ZONO_RESPONSE_TYPE_HEADER,
} from "./shared.js";

describe("shared public helpers", () => {
	test("interpolatePathTemplate encodes params and throws on missing params", () => {
		expect(interpolatePathTemplate("/users/$userId", { userId: "a/b" })).toBe("/users/a%2Fb");
		expect(() => interpolatePathTemplate("/users/$userId", {})).toThrow("Missing path param");
	});

	test("appendQueryParams and normalizeHeaderValues stringify non-strings", () => {
		const url = new URL("https://example.com");
		appendQueryParams(url, {
			plain: "x",
			number: 1,
			obj: { ok: true },
			skip: undefined,
		});

		expect(url.searchParams.get("plain")).toBe("x");
		expect(url.searchParams.get("number")).toBe("1");
		expect(url.searchParams.get("obj")).toBe('{"ok":true}');
		expect(url.searchParams.has("skip")).toBe(false);

		const headers = normalizeHeaderValues({
			"x-plain": "x",
			"x-number": 2,
			"x-obj": { ok: true },
			"x-skip": undefined,
		});

		expect(headers.get("x-plain")).toBe("x");
		expect(headers.get("x-number")).toBe("2");
		expect(headers.get("x-obj")).toBe('{"ok":true}');
		expect(headers.has("x-skip")).toBe(false);
	});
});

describe("shared internal path helpers", () => {
	test("toHonoPath converts dynamic segments", () => {
		expect(toHonoPath("/")).toBe("/");
		expect(toHonoPath("/users/$userId/posts/$postId")).toBe("/users/:userId/posts/:postId");
	});

	test("findExactShapePathNode resolves and reports missing nodes", () => {
		const root = {
			SHAPE: {
				users: {
					SHAPE: {
						$userId: {
							HANDLER: { get: () => undefined },
						},
					},
				},
			},
		};

		expect(
			findExactShapePathNode(
				root,
				"/users/$userId",
				(path) => `Missing node at ${path}`,
				(segment, path) => `Missing '${segment}' at ${path}`,
			),
		).toBe(root.SHAPE.users.SHAPE.$userId);

		expect(() =>
			findExactShapePathNode(
				root,
				"/users/$postId",
				(path) => `Missing node at ${path}`,
				(segment, path) => `Missing '${segment}' at ${path}`,
			),
		).toThrow("Missing '$postId' at /users/$postId");
	});

	test("collectShapePathNodes walks until the path stops matching", () => {
		const root = {
			name: "root",
			SHAPE: {
				users: {
					name: "users",
					SHAPE: {
						$userId: {
							name: "user",
						},
					},
				},
			},
		};

		expect(collectShapePathNodes(root, "/users/$userId")).toEqual([
			root,
			root.SHAPE.users,
			root.SHAPE.users.SHAPE.$userId,
		]);
		expect(collectShapePathNodes(root, "/users/$postId")).toEqual([root, root.SHAPE.users]);
	});
});

describe("shared internal serialized response", () => {
	test("roundtrips all supported response types", async () => {
		const json = createSerializedResponse({
			status: 200,
			type: "JSON",
			data: { ok: true },
			source: "contract",
		});
		expect(await parseSerializedResponse(json)).toEqual({
			type: "JSON",
			source: "contract",
			data: { ok: true },
			headers: undefined,
		});

		const createdAt = new Date("2024-02-02T00:00:00.000Z");
		const structured = createSerializedResponse({
			status: 200,
			type: "SuperJSON",
			data: { createdAt },
			source: "contract",
		});
		expect(await parseSerializedResponse(structured)).toEqual({
			type: "SuperJSON",
			source: "contract",
			data: { createdAt },
			headers: undefined,
		});

		const text = createSerializedResponse({
			status: 200,
			type: "Text",
			data: "hello",
			source: "contract",
		});
		expect(await parseSerializedResponse(text)).toEqual({
			type: "Text",
			source: "contract",
			data: "hello",
			headers: undefined,
		});

		const bytes = createSerializedResponse({
			status: 200,
			type: "Bytes",
			data: new Uint8Array([1, 2, 3]),
			source: "contract",
		});
		const parsedBytes = await parseSerializedResponse(bytes);
		expect(parsedBytes.type).toBe("Bytes");
		expect(Array.from(parsedBytes.data as Uint8Array)).toEqual([1, 2, 3]);
		expect(parsedBytes.headers).toBeUndefined();

		const blobValue = new Blob(["hello blob"], { type: "text/plain" });
		const blob = createSerializedResponse({
			status: 200,
			type: "Blob",
			data: blobValue,
			source: "contract",
		});
		const parsedBlob = await parseSerializedResponse(blob);
		expect(parsedBlob.type).toBe("Blob");
		expect(await (parsedBlob.data as Blob).text()).toBe("hello blob");
		expect(parsedBlob.headers).toBeUndefined();

		const formDataValue = new FormData();
		formDataValue.set("fileName", "avatar.png");
		const form = createSerializedResponse({
			status: 200,
			type: "FormData",
			data: formDataValue,
			source: "contract",
		});
		const parsedForm = await parseSerializedResponse(form);
		expect(parsedForm.type).toBe("FormData");
		expect((parsedForm.data as FormData).get("fileName")).toBe("avatar.png");
		expect(parsedForm.headers).toBeUndefined();

		const contentless = createSerializedResponse({
			status: 204,
			type: "Contentless",
			data: undefined,
			source: "contract",
		});
		expect(await parseSerializedResponse(contentless)).toEqual({
			type: "Contentless",
			source: "contract",
			data: undefined,
			headers: undefined,
		});
	});

	test("infers source and handles empty json payloads", async () => {
		const plainText = new Response("hello", {
			headers: { "content-type": "text/plain" },
		});
		expect(await parseSerializedResponse(plainText)).toEqual({
			type: "Text",
			source: "contract",
			data: "hello",
			headers: undefined,
		});

		const failedJson = new Response(JSON.stringify({ message: "nope" }), {
			status: 500,
			headers: { "content-type": "application/json" },
		});
		expect((await parseSerializedResponse(failedJson)).source).toBe("error");

		const emptyJson = new Response("", {
			headers: { "content-type": "application/json" },
		});
		expect(await parseSerializedResponse(emptyJson)).toEqual({
			type: "JSON",
			source: "contract",
			data: undefined,
			headers: undefined,
		});
	});

	test("parses response header metadata", async () => {
		const response = new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: {
				"content-type": "application/json",
				[ZONO_RESPONSE_TYPE_HEADER]: "JSON",
				[ZONO_RESPONSE_SOURCE_HEADER]: "contract",
				[ZONO_HEADER_DATA_TYPE_HEADER]: "SuperJSON",
				[ZONO_HEADER_DATA_HEADER]: superjson.stringify({
					traceId: "trace-1",
					createdAt: new Date("2024-02-02T00:00:00.000Z"),
				}),
			},
		});

		expect(await parseSerializedResponse(response)).toEqual({
			type: "JSON",
			source: "contract",
			data: { ok: true },
			headers: {
				traceId: "trace-1",
				createdAt: new Date("2024-02-02T00:00:00.000Z"),
			},
		});
	});

	test("validates strict payload types when serializing", () => {
		expect(() =>
			createSerializedResponse({
				status: 200,
				type: "FormData",
				data: "x",
				source: "contract",
			}),
		).toThrow("FormData response type requires FormData instance");
		expect(() =>
			createSerializedResponse({
				status: 200,
				type: "Blob",
				data: "x",
				source: "contract",
			}),
		).toThrow("Blob response type requires Blob instance");
		expect(() =>
			createSerializedResponse({
				status: 200,
				type: "Bytes",
				data: "x",
				source: "contract",
			}),
		).toThrow("Bytes response type requires Uint8Array instance");
	});
});

describe("shared internal request helpers", () => {
	test("request object helpers convert iterable values", () => {
		const query = getRequestQueryObject(new URL("https://example.com?a=1&b=two"));
		expect(query).toEqual({ a: "1", b: "two" });

		const headers = new Headers({
			[ZONO_RESPONSE_TYPE_HEADER]: "JSON",
			[ZONO_RESPONSE_SOURCE_HEADER]: "contract",
		});
		const parsedHeaders = getRequestHeadersObject(headers);
		expect(parsedHeaders[ZONO_RESPONSE_TYPE_HEADER]).toBe("JSON");
		expect(parsedHeaders[ZONO_RESPONSE_SOURCE_HEADER]).toBe("contract");
	});

	test("parses standard and structured query/header inputs", () => {
		const queryUrl = new URL("https://example.com?foo=bar&count=2");
		expect(parseQueryInput({ type: "Standard" }, queryUrl)).toEqual({
			foo: "bar",
			count: "2",
		});

		const jsonQueryUrl = new URL("https://example.com");
		jsonQueryUrl.searchParams.set(ZONO_QUERY_DATA_KEY, JSON.stringify({ active: true }));
		expect(parseQueryInput({ type: "JSON" }, jsonQueryUrl)).toEqual({ active: true });

		const superQueryUrl = new URL("https://example.com");
		superQueryUrl.searchParams.set(
			ZONO_QUERY_DATA_KEY,
			superjson.stringify({ createdAt: new Date("2024-01-01T00:00:00.000Z") }),
		);
		expect(parseQueryInput({ type: "SuperJSON" }, superQueryUrl)).toEqual({
			createdAt: new Date("2024-01-01T00:00:00.000Z"),
		});

		const standardHeaders = new Headers({ "x-trace": "trace-1" });
		expect(parseHeadersInput({ type: "Standard" }, standardHeaders)).toEqual({
			"x-trace": "trace-1",
		});

		const jsonHeaders = new Headers({
			[ZONO_HEADER_DATA_HEADER]: JSON.stringify({ trace: "trace-2" }),
		});
		expect(parseHeadersInput({ type: "JSON" }, jsonHeaders)).toEqual({ trace: "trace-2" });

		const superHeaders = new Headers({
			[ZONO_HEADER_DATA_HEADER]: superjson.stringify({
				createdAt: new Date("2024-02-02T00:00:00.000Z"),
			}),
		});
		expect(parseHeadersInput({ type: "SuperJSON" }, superHeaders)).toEqual({
			createdAt: new Date("2024-02-02T00:00:00.000Z"),
		});
	});

	test("parses request bodies for each supported body type", async () => {
		expect(
			await parseBodyInput(
				{ type: "JSON" },
				new Request("https://example.com", {
					method: "POST",
					body: JSON.stringify({ name: "alice" }),
					headers: { "content-type": "application/json" },
				}),
			),
		).toEqual({ name: "alice" });

		expect(
			await parseBodyInput(
				{ type: "SuperJSON" },
				new Request("https://example.com", {
					method: "POST",
					body: superjson.stringify({ createdAt: new Date("2024-03-03T00:00:00.000Z") }),
					headers: { "content-type": "application/json" },
				}),
			),
		).toEqual({ createdAt: new Date("2024-03-03T00:00:00.000Z") });

		expect(
			await parseBodyInput(
				{ type: "Text" },
				new Request("https://example.com", { method: "POST", body: "hello" }),
			),
		).toBe("hello");

		expect(
			await parseBodyInput(
				{ type: "URLSearchParams" },
				new Request("https://example.com", {
					method: "POST",
					body: "q=zono",
					headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
				}),
			),
		).toEqual(new URLSearchParams("q=zono"));

		const blob = (await parseBodyInput(
			{ type: "Blob" },
			new Request("https://example.com", {
				method: "POST",
				body: new Blob(["blob-value"], { type: "text/plain" }),
			}),
		)) as Blob;
		expect(await blob.text()).toBe("blob-value");

		const formData = new FormData();
		formData.set("fileName", "avatar.png");
		const parsedForm = (await parseBodyInput(
			{ type: "FormData" },
			new Request("https://example.com", { method: "POST", body: formData }),
		)) as FormData;
		expect(parsedForm.get("fileName")).toBe("avatar.png");
	});
});

describe("shared internal response validation", () => {
	test("accepts responses that match the declared status map", () => {
		expect(() =>
			validateResponseAgainstStatusMap(
				{
					200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
				},
				{ status: 200, type: "JSON", data: { ok: true } },
				"Handler",
			),
		).not.toThrow();
	});

	test("validates declared response headers", () => {
		expect(() =>
			validateResponseAgainstStatusMap(
				{
					200: {
						type: "JSON",
						schema: z.object({ ok: z.boolean() }),
						headers: {
							type: "Standard",
							schema: z.object({ "x-trace": z.string() }),
						},
					},
				},
				{
					status: 200,
					type: "JSON",
					data: { ok: true },
					headers: { "x-trace": "trace-1" },
				},
				"Handler",
			),
		).not.toThrow();
	});

	test("rejects undeclared statuses, mismatched types, invalid data, and invalid headers", () => {
		expect(() =>
			validateResponseAgainstStatusMap(
				{
					200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
				},
				{ status: 201, type: "JSON", data: { ok: true } },
				"Handler",
			),
		).toThrow("Handler returned undeclared status: 201");

		expect(() =>
			validateResponseAgainstStatusMap(
				{
					200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
				},
				{ status: 200, type: "Text", data: "nope" },
				"Handler",
			),
		).toThrow("Handler returned mismatched response type. Expected JSON, received Text");

		expect(() =>
			validateResponseAgainstStatusMap(
				{
					200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
				},
				{ status: 200, type: "JSON", data: { ok: "nope" } },
				"Handler",
			),
		).toThrow("Handler response data validation failed");

		expect(() =>
			validateResponseAgainstStatusMap(
				{
					200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
				},
				{ status: 200, type: "JSON", data: { ok: true }, headers: { "x-test": "1" } },
				"Handler",
			),
		).toThrow("Handler returned undeclared response headers");

		expect(() =>
			validateResponseAgainstStatusMap(
				{
					200: {
						type: "JSON",
						schema: z.object({ ok: z.boolean() }),
						headers: {
							type: "Standard",
							schema: z.object({ "x-trace": z.string() }),
						},
					},
				},
				{ status: 200, type: "JSON", data: { ok: true }, headers: { "x-trace": 1 } },
				"Handler",
			),
		).toThrow("Handler response headers validation failed");
	});
});

describe("shared media type helpers", () => {
	test("parses media types with normalized type/subtype and parameters", () => {
		expect(parseMediaType("Application/JSON")).toEqual({
			type: "application",
			subtype: "json",
			parameters: {},
		});
		expect(parseMediaType("text/plain; Charset=UTF-8")).toEqual({
			type: "text",
			subtype: "plain",
			parameters: { charset: "UTF-8" },
		});
		expect(parseMediaType('multipart/form-data; boundary="abc"')).toEqual({
			type: "multipart",
			subtype: "form-data",
			parameters: { boundary: "abc" },
		});
		expect(parseMediaType("not-a-media-type")).toBeUndefined();
		expect(parseMediaType("")).toBeUndefined();
	});

	test("mediaTypeSatisfies compares case-insensitively and requires declared parameters", () => {
		expect(mediaTypeSatisfies("application/json", "Application/JSON")).toBe(true);
		expect(mediaTypeSatisfies("text/plain; charset=utf-8", "text/plain;charset=UTF-8")).toBe(
			true,
		);
		// Parameter ordering and whitespace are insignificant.
		expect(
			mediaTypeSatisfies(
				"text/plain; charset=utf-8; format=flowed",
				"text/plain;  format=flowed ;charset=utf-8",
			),
		).toBe(true);
		// Incoming values may carry extra parameters.
		expect(mediaTypeSatisfies("application/json", "application/json; charset=utf-8")).toBe(
			true,
		);
		// Declared parameters must be present and match.
		expect(mediaTypeSatisfies("text/plain; charset=utf-8", "text/plain")).toBe(false);
		expect(mediaTypeSatisfies("text/plain; charset=utf-8", "text/plain; charset=ascii")).toBe(
			false,
		);
		expect(mediaTypeSatisfies("application/json", "text/plain")).toBe(false);
	});

	test("resolveRequestContentType applies defaults and overrides", () => {
		expect(resolveRequestContentType("JSON", undefined, {})).toBe("application/json");
		expect(resolveRequestContentType("SuperJSON", undefined, {})).toBe("application/json");
		expect(resolveRequestContentType("Text", undefined, "x")).toBe("text/plain; charset=utf-8");
		expect(resolveRequestContentType("URLSearchParams", undefined, new URLSearchParams())).toBe(
			"application/x-www-form-urlencoded;charset=UTF-8",
		);
		expect(
			resolveRequestContentType("Blob", undefined, new Blob(["x"], { type: "image/png" })),
		).toBe("image/png");
		expect(resolveRequestContentType("Blob", undefined, new Blob(["x"]))).toBe(
			"application/octet-stream",
		);
		expect(resolveRequestContentType("JSON", "application/query+json", {})).toBe(
			"application/query+json",
		);
		expect(resolveRequestContentType("FormData", undefined, new FormData())).toBeUndefined();
		expect(() =>
			resolveRequestContentType("FormData", "multipart/form-data", new FormData()),
		).toThrow("FormData bodies do not support a custom content type");
	});

	test("resolveResponseContentType applies defaults and validates compatibility", () => {
		expect(resolveResponseContentType("JSON", undefined, {})).toBe("application/json");
		expect(resolveResponseContentType("Bytes", undefined, new Uint8Array())).toBe(
			"application/octet-stream",
		);
		expect(resolveResponseContentType("Contentless", undefined, undefined)).toBeUndefined();
		expect(resolveResponseContentType("FormData", undefined, new FormData())).toBeUndefined();
		expect(
			resolveResponseContentType("Blob", undefined, new Blob(["x"], { type: "image/png" })),
		).toBe("image/png");

		// JSON and SuperJSON require application/json or a +json subtype.
		expect(resolveResponseContentType("JSON", "application/problem+json", {})).toBe(
			"application/problem+json",
		);
		expect(resolveResponseContentType("SuperJSON", "application/vnd.api+json", {})).toBe(
			"application/vnd.api+json",
		);
		expect(() => resolveResponseContentType("JSON", "text/plain", {})).toThrow(
			"not compatible with JSON responses",
		);
		// Text allows any text/*.
		expect(resolveResponseContentType("Text", "text/csv", "x")).toBe("text/csv");
		expect(() => resolveResponseContentType("Text", "application/json", "x")).toThrow(
			"not compatible with Text responses",
		);
		// Blob and Bytes allow arbitrary valid media types.
		expect(resolveResponseContentType("Bytes", "image/png", new Uint8Array())).toBe(
			"image/png",
		);
		expect(() => resolveResponseContentType("Bytes", "garbage", new Uint8Array())).toThrow(
			"not compatible with Bytes responses",
		);
	});

	test("createSerializedResponse applies custom and default content types", async () => {
		const custom = createSerializedResponse({
			status: 200,
			type: "JSON",
			data: { ok: true },
			source: "contract",
			contentType: "application/problem+json",
		});
		expect(custom.headers.get("content-type")).toBe("application/problem+json");
		expect(await parseSerializedResponse(custom)).toMatchObject({ data: { ok: true } });

		const blob = createSerializedResponse({
			status: 200,
			type: "Blob",
			data: new Blob(["x"], { type: "image/png" }),
			source: "contract",
		});
		expect(blob.headers.get("content-type")).toBe("image/png");

		const text = createSerializedResponse({
			status: 200,
			type: "Text",
			data: "hi",
			source: "contract",
		});
		expect(text.headers.get("content-type")).toBe("text/plain; charset=utf-8");

		const form = createSerializedResponse({
			status: 200,
			type: "FormData",
			data: new FormData(),
			source: "contract",
		});
		// The runtime generates the multipart boundary itself.
		expect(form.headers.get("content-type") ?? "").toContain("boundary");

		expect(() =>
			createSerializedResponse({
				status: 200,
				type: "JSON",
				data: { ok: true },
				source: "contract",
				contentType: "text/plain",
			}),
		).toThrow("not compatible with JSON responses");
	});
});

describe("shared method recognition", () => {
	test("recognizes all HTTP methods including QUERY", () => {
		for (const method of HTTP_METHODS) {
			expect(isHTTPMethod(method)).toBe(true);
		}
		expect(isHTTPMethod("QUERY")).toBe(false);
		expect(isHTTPMethod("trace")).toBe(false);
		expect(METHODS_WITHOUT_FETCH_BODY.has("get")).toBe(true);
		expect(METHODS_WITHOUT_FETCH_BODY.has("head")).toBe(true);
		expect(METHODS_WITHOUT_FETCH_BODY.has("query")).toBe(false);
	});
});

describe("shared error responses", () => {
	test("opaque errors never expose messages, issues, or stacks", () => {
		const validation = makeErrorRuntimeResponse(
			new RequestValidationError("Body validation failed", [{ path: ["secret"] }]),
			"opaque",
		);
		expect(validation).toEqual({
			status: 400,
			type: "JSON",
			data: { message: "Invalid request" },
		});

		const media = makeErrorRuntimeResponse(
			new UnsupportedMediaTypeError("Content type 'x' does not satisfy declared 'y'"),
			"opaque",
		);
		expect(media).toEqual({
			status: 415,
			type: "JSON",
			data: { message: "Unsupported media type" },
		});

		const internal = makeErrorRuntimeResponse(new Error("secret detail"), "opaque");
		expect(internal).toEqual({
			status: 500,
			type: "JSON",
			data: { message: "Internal server error" },
		});
	});

	test("detailed errors include diagnostics", () => {
		const issues = [{ path: ["filter"] }];
		const validation = makeErrorRuntimeResponse(
			new RequestValidationError("Body validation failed", issues),
			"detailed",
		);
		expect(validation.status).toBe(400);
		expect(validation.data).toMatchObject({
			message: "Body validation failed",
			issues,
		});

		const internal = makeErrorRuntimeResponse(new Error("boom"), "detailed");
		expect(internal.status).toBe(500);
		expect(internal.data).toMatchObject({ message: "boom" });
		expect((internal.data as { stack?: string }).stack).toBeDefined();

		const nonError = makeErrorRuntimeResponse("weird", "detailed");
		expect(nonError.status).toBe(500);
		expect(nonError.data).toEqual({
			message: "Internal server error",
			issues: ["weird"],
		});
	});

	test("not found responses are stable", () => {
		expect(makeNotFoundRuntimeResponse()).toEqual({
			status: 404,
			type: "JSON",
			data: { message: "Not Found" },
		});
	});
});

// @ts-expect-error interpolatePathTemplate path params values must be strings
interpolatePathTemplate("/users/$userId", { userId: 123 });
