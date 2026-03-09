import { describe, expect, test } from "bun:test";
import {
	appendQueryParams,
	createSerializedResponse,
	getRequestHeadersObject,
	getRequestQueryObject,
	interpolatePathTemplate,
	normalizeHeaderValues,
	parseSerializedResponse,
	toHonoPath,
	ZONO_RESPONSE_SOURCE_HEADER,
	ZONO_RESPONSE_TYPE_HEADER,
} from "./shared.js";

describe("shared path/query/header helpers", () => {
	test("toHonoPath converts dynamic segments", () => {
		expect(toHonoPath("/")).toBe("/");
		expect(toHonoPath("/users/$userId/posts/$postId")).toBe("/users/:userId/posts/:postId");
	});

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

describe("shared serialized response", () => {
	test("JSON response roundtrip", async () => {
		const response = createSerializedResponse({
			status: 200,
			type: "JSON",
			data: { ok: true },
			source: "contract",
		});
		const parsed = await parseSerializedResponse(response);

		expect(parsed.type).toBe("JSON");
		expect(parsed.source).toBe("contract");
		expect(parsed.data).toEqual({ ok: true });
	});

	test("SuperJSON response roundtrip keeps Date", async () => {
		const now = new Date("2024-01-01T00:00:00.000Z");
		const response = createSerializedResponse({
			status: 200,
			type: "SuperJSON",
			data: { now },
			source: "contract",
		});
		const parsed = await parseSerializedResponse(response);
		const data = parsed.data as { now: Date };

		expect(parsed.type).toBe("SuperJSON");
		expect(data.now).toEqual(now);
		expect(data.now instanceof Date).toBe(true);
	});

	test("Text and Contentless response roundtrip", async () => {
		const text = createSerializedResponse({
			status: 200,
			type: "Text",
			data: "hello",
			source: "contract",
		});
		const parsedText = await parseSerializedResponse(text);
		expect(parsedText.type).toBe("Text");
		expect(parsedText.data).toBe("hello");

		const contentless = createSerializedResponse({
			status: 204,
			type: "Contentless",
			data: undefined,
			source: "contract",
		});
		const parsedContentless = await parseSerializedResponse(contentless);
		expect(parsedContentless.type).toBe("Contentless");
		expect(parsedContentless.data).toBeUndefined();
	});

	test("Blob, Bytes, and FormData response roundtrip", async () => {
		const blob = createSerializedResponse({
			status: 200,
			type: "Blob",
			data: new Blob(["abc"]),
			source: "contract",
		});
		const parsedBlob = await parseSerializedResponse(blob);
		expect(parsedBlob.type).toBe("Blob");
		expect(await (parsedBlob.data as Blob).text()).toBe("abc");

		const bytes = createSerializedResponse({
			status: 200,
			type: "Bytes",
			data: new Uint8Array([1, 2, 3]),
			source: "contract",
		});
		const parsedBytes = await parseSerializedResponse(bytes);
		expect(parsedBytes.type).toBe("Bytes");
		expect(Array.from(parsedBytes.data as Uint8Array)).toEqual([1, 2, 3]);

		const formData = new FormData();
		formData.set("name", "zono");
		const formDataResponse = createSerializedResponse({
			status: 200,
			type: "FormData",
			data: formData,
			source: "contract",
		});
		const parsedFormData = await parseSerializedResponse(formDataResponse);
		expect(parsedFormData.type).toBe("FormData");
		expect((parsedFormData.data as FormData).get("name")).toBe("zono");
	});

	test("Bytes response roundtrip preserves subarray boundaries", async () => {
		const fullBytes = new Uint8Array([0, 1, 2, 3]);
		const response = createSerializedResponse({
			status: 200,
			type: "Bytes",
			data: fullBytes.subarray(1, 3),
			source: "contract",
		});
		const parsed = await parseSerializedResponse(response);

		expect(parsed.type).toBe("Bytes");
		expect(Array.from(parsed.data as Uint8Array)).toEqual([1, 2]);
	});

	test("parseSerializedResponse infers source/type fallbacks", async () => {
		const plainText = new Response("hello", {
			headers: { "content-type": "text/plain" },
		});
		const parsedPlainText = await parseSerializedResponse(plainText);
		expect(parsedPlainText.type).toBe("Text");
		expect(parsedPlainText.source).toBe("contract");

		const failedJson = new Response(JSON.stringify({ message: "nope" }), {
			status: 500,
			headers: { "content-type": "application/json" },
		});
		const parsedFailedJson = await parseSerializedResponse(failedJson);
		expect(parsedFailedJson.type).toBe("JSON");
		expect(parsedFailedJson.source).toBe("error");

		const emptyJson = new Response("", { headers: { "content-type": "application/json" } });
		const parsedEmptyJson = await parseSerializedResponse(emptyJson);
		expect(parsedEmptyJson.data).toBeUndefined();
	});

	test("createSerializedResponse validates payload shape for strict response types", () => {
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
});

type SharedHelperReturn = ReturnType<typeof toHonoPath>;
const sharedHelperReturnIsString: SharedHelperReturn = "ok";
void sharedHelperReturnIsString;

// @ts-expect-error interpolatePathTemplate path params values must be strings
interpolatePathTemplate("/users/$userId", { userId: 123 });
