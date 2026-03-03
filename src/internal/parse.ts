import z from "zod";
import type { Contract } from "~/contract/contract.types.js";
import { decodeSuperjsonFields } from "~/internal/superjson.util.js";
import { isRecord } from "~/internal/util.js";

type RawContractInput = {
	pathParams?: unknown;
	body?: unknown;
	query?: unknown;
	headers?: unknown;
};

type ParseContractResult =
	| { success: true; data: Record<string, unknown> }
	| { success: false; issues: Array<z.core.$ZodIssue> };

/**
 * Extracts the raw query value appropriate for the contract query type.
 * For SuperJSON queries each declared key carries its own SuperJSON string value.
 */
function parseRawQuery(contract: Contract, rawQuery: unknown, mode: "server" | "client"): unknown {
	if (!contract.query) {
		return rawQuery;
	}

	if (contract.query.type === "SuperJSON") {
		if (mode === "client") {
			return rawQuery;
		}

		if (!isRecord(rawQuery)) {
			return rawQuery;
		}
		return decodeSuperjsonFields(rawQuery);
	}

	return rawQuery;
}

/**
 * Extracts the raw headers value appropriate for the contract headers type.
 * For SuperJSON headers each declared key carries its own SuperJSON string value.
 */
function parseRawHeaders(
	contract: Contract,
	rawHeaders: unknown,
	mode: "server" | "client",
): unknown {
	if (!contract.headers) {
		return rawHeaders;
	}

	if (contract.headers.type === "SuperJSON") {
		if (mode === "client") {
			return rawHeaders;
		}

		if (isRecord(rawHeaders)) {
			return decodeSuperjsonFields(rawHeaders);
		}
		return rawHeaders;
	}

	return rawHeaders;
}

/**
 * Parses and validates all contract fields from a raw input.
 *
 * - "server" mode: returns z.output (transforms applied) — used by the Hono server
 * - "client" mode: validates but returns the original input values (no transforms applied
 *   on the client side, since the wire value must be z.input<schema>)
 */
export async function parseContractFields(
	contract: Contract,
	rawInput: RawContractInput,
	mode: "server" | "client",
): Promise<ParseContractResult> {
	const parsed: Record<string, unknown> = {};
	const allIssues: Array<z.core.$ZodIssue> = [];

	if (contract.pathParams) {
		const result = await contract.pathParams.safeParseAsync(rawInput.pathParams);
		if (result.success) {
			parsed.pathParams = mode === "server" ? result.data : rawInput.pathParams;
		} else {
			allIssues.push(...result.error.issues);
		}
	}

	if (contract.query) {
		const rawQuery = parseRawQuery(contract, rawInput.query, mode);
		const result = await contract.query.schema.safeParseAsync(rawQuery);
		if (result.success) {
			parsed.query = mode === "server" ? result.data : rawQuery;
		} else {
			allIssues.push(...result.error.issues);
		}
	}

	if (contract.headers) {
		const rawHeaders = parseRawHeaders(contract, rawInput.headers, mode);
		const result = await contract.headers.schema.safeParseAsync(rawHeaders);
		if (result.success) {
			parsed.headers = mode === "server" ? result.data : rawHeaders;
		} else {
			allIssues.push(...result.error.issues);
		}
	}

	if (contract.body) {
		const result = await contract.body.schema.safeParseAsync(rawInput.body);
		if (result.success) {
			parsed.body = mode === "server" ? result.data : rawInput.body;
		} else {
			allIssues.push(...result.error.issues);
		}
	}

	if (allIssues.length > 0) {
		return { success: false, issues: allIssues };
	}

	return { success: true, data: parsed };
}
