import { describe, expect, test } from "bun:test";
import { appendQueryParams, interpolatePathTemplate, normalizeHeaderValues } from "./shared.js";

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

// @ts-expect-error internal-only export
void (0 as typeof import("./shared.js")["createSerializedResponse"]);

// @ts-expect-error internal-only export
void (0 as typeof import("./shared.js")["TypedFetch"]);

// @ts-expect-error interpolatePathTemplate path params values must be strings
interpolatePathTemplate("/users/$userId", { userId: 123 });
