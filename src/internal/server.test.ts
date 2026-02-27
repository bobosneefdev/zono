import { describe, expect, it } from "bun:test";
import z from "zod";
import { parseContractFields } from "~/contract/contract.parse.js";
import { buildContractResponse, buildValidationErrorResponse } from "~/internal/server.js";

const jsonQueryContract = {
	query: {
		type: "json" as const,
		schema: z.object({ foo: z.string(), count: z.number() }),
	},
	responses: {
		200: {
			contentType: "application/json" as const,
			schema: z.object({ ok: z.boolean() }),
		},
	},
} as const;

const basicContract = {
	responses: {
		200: {
			contentType: "application/json" as const,
			schema: z.object({ value: z.string() }),
		},
	} as const,
} as const;

describe("parseContractFields", () => {
	it("parses query with type json via parseRawQuery", async () => {
		const rawInput = {
			query: { json: JSON.stringify({ foo: "bar", count: 42 }) },
		};
		const result = await parseContractFields(jsonQueryContract as never, rawInput, false);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.query).toEqual({ foo: "bar", count: 42 });
		}
	});

	it("passes through raw query when bypassIncomingParse and query type json", async () => {
		const parsed = { foo: "x", count: 1 };
		const rawInput = {
			query: { json: JSON.stringify(parsed) },
		};
		const result = await parseContractFields(jsonQueryContract as never, rawInput, true);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.query).toEqual(parsed);
		}
	});

	it("handles rawQuery not a record for json query", async () => {
		const rawInput = { query: "not-a-record" };
		const result = await parseContractFields(jsonQueryContract as never, rawInput, false);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.length).toBeGreaterThan(0);
		}
	});

	it("handles rawQuery.json not a string for json query", async () => {
		const rawInput = { query: { json: 123 } };
		const result = await parseContractFields(jsonQueryContract as never, rawInput, false);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.length).toBeGreaterThan(0);
		}
	});
});

describe("buildValidationErrorResponse", () => {
	it("returns public issues when errorMode is public", async () => {
		const issues = [{ code: "invalid_type", path: ["x"] }] as never;
		const res = buildValidationErrorResponse(issues, "public");
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body).toHaveProperty("issues");
		expect(Array.isArray(body.issues)).toBe(true);
		expect(body.issues).toEqual(issues);
	});

	it("returns issue count when errorMode is hidden", async () => {
		const issues = [{ code: "invalid_type" }, { code: "custom" }] as never;
		const res = buildValidationErrorResponse(issues, "hidden");
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body).toEqual({ issues: 2 });
	});
});

describe("buildContractResponse", () => {
	it("throws when status is not in contract responses", async () => {
		await expect(
			buildContractResponse(basicContract as never, { status: 999 }, false),
		).rejects.toThrow("Unexpected response status: 999");
	});
});
