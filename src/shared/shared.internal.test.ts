import { describe, expect, test } from "bun:test";
import superjson from "superjson";
import z from "zod";
import {
	collectShapePathNodes,
	createSerializedResponse,
	findExactShapePathNode,
	getRequestHeadersObject,
	getRequestQueryObject,
	parseBodyInput,
	parseHeadersInput,
	parseQueryInput,
	parseSerializedResponse,
	toHonoPath,
	validateResponseAgainstStatusMap,
	ZONO_HEADER_DATA_HEADER,
	ZONO_QUERY_DATA_KEY,
	ZONO_RESPONSE_SOURCE_HEADER,
	ZONO_RESPONSE_TYPE_HEADER,
} from "./shared.internal.js";

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
				{ status: 200, type: "JSON", data: { ok: true }, headers: { "x-test": "1" } },
				"Handler",
			),
		).not.toThrow();
	});

	test("rejects undeclared statuses, mismatched types, and invalid data", () => {
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
	});
});
