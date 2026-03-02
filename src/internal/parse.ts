import superjson from "superjson";
import z from "zod";
import type { Contract } from "~/contract/contract.types.js";
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
 * For SuperJSON queries the value arrives as a single `superjson` URL parameter.
 */
function parseRawQuery(contract: Contract, rawQuery: unknown): unknown {
	if (!contract.query) {
		return rawQuery;
	}

	if (contract.query.type === "SuperJSON") {
		if (!isRecord(rawQuery)) {
			return rawQuery;
		}
		const encoded = rawQuery.superjson;
		if (typeof encoded === "string") {
			return superjson.parse(encoded);
		}
		return "superjson" in rawQuery ? undefined : rawQuery;
	}

	return rawQuery;
}

/**
 * Extracts the raw headers value appropriate for the contract headers type.
 * For SuperJSON headers the full object arrives in x-zono-superjson-headers.
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

		const encoded = isRecord(rawHeaders)
			? (rawHeaders["x-zono-superjson-headers"] as string | undefined)
			: undefined;
		if (typeof encoded === "string") {
			return superjson.parse(encoded);
		}
		return undefined;
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
		const rawQuery = parseRawQuery(contract, rawInput.query);
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
