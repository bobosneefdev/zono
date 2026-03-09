import { describe, expect, test } from "bun:test";
import {
	createSerializedResponse,
	getRequestHeadersObject,
	getRequestQueryObject,
	parseSerializedResponse,
	toHonoPath,
	ZONO_RESPONSE_SOURCE_HEADER,
	ZONO_RESPONSE_TYPE_HEADER,
} from "./shared.internal.js";

describe("shared internal path helpers", () => {
	test("toHonoPath converts dynamic segments", () => {
		expect(toHonoPath("/")).toBe("/");
		expect(toHonoPath("/users/$userId/posts/$postId")).toBe("/users/:userId/posts/:postId");
	});
});

describe("shared internal serialized response", () => {
	test("roundtrips common response types", async () => {
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
	});

	test("infers source and validates strict payload types", async () => {
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

		expect(() =>
			createSerializedResponse({
				status: 200,
				type: "FormData",
				data: "x",
				source: "contract",
			}),
		).toThrow("FormData response type requires FormData instance");
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
});
