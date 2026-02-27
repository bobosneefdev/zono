import { describe, expect, it } from "bun:test";
import z from "zod";
import type { ContractResponses } from "~/contract/contract.types.js";
import { mergeContractResponses } from "~/contract/index.js";

function expectType<T>(_value: T): void {}

describe("mergeContractResponses", () => {
	it("merges multiple response maps and keeps last collision at runtime", () => {
		const first = {
			200: {
				contentType: "application/json",
				schema: z.object({ ok: z.literal(true) }),
			},
			204: {
				contentType: null,
			},
		} satisfies ContractResponses;

		const second = {
			200: {
				contentType: "application/json",
				schema: z.string(),
			},
			418: {
				contentType: "application/json",
				schema: z.object({ reason: z.string() }),
			},
		} satisfies ContractResponses;

		const merged = mergeContractResponses(first, second);

		expect(Object.keys(merged).sort()).toEqual(["200", "204", "418"]);
		expect(merged[200]).toBe(second[200]);
		expect(merged[204]).toBe(first[204]);
		expect(merged[418]).toBe(second[418]);
		expect(merged[200].schema.parse("pong")).toBe("pong");
	});

	it("preserves type-safe union on collided statuses", () => {
		const first = {
			200: {
				contentType: "application/json",
				schema: z.object({ ok: z.literal(true) }),
			},
		} as const satisfies ContractResponses;

		const second = {
			200: {
				contentType: "application/json",
				schema: z.number(),
			},
			418: {
				contentType: "application/json",
				schema: z.object({ reason: z.string() }),
			},
		} as const satisfies ContractResponses;

		const third = {
			200: {
				contentType: "text/plain",
				schema: z.string(),
			},
		} as const satisfies ContractResponses;

		const merged = mergeContractResponses(first, second, third);

		expectType<(typeof first)[200] | (typeof second)[200] | (typeof third)[200]>(merged[200]);
		expectType<(typeof second)[418]>(merged[418]);
	});
});
