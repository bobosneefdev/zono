import type z from "zod";
import type { ContractOutput } from "~/contract/contract.io.js";
import type { Contract } from "~/contract/contract.types.js";
import { isRecord } from "~/internal/util.js";

export type RawContractInput = {
	pathParams?: unknown;
	payload?: unknown;
	query?: unknown;
	headers?: unknown;
};

export type ParseContractResult<TContract extends Contract> =
	| { success: true; data: ContractOutput<TContract> }
	| { success: false; issues: Array<z.core.$ZodIssue> };

export function parseRawQuery(contract: Contract, rawQuery: unknown): unknown {
	if (!contract.query) {
		return rawQuery;
	}

	if (contract.query.type === "json") {
		if (!isRecord(rawQuery)) {
			return rawQuery;
		}

		const encoded = rawQuery.json;
		if (typeof encoded === "string") {
			return JSON.parse(encoded);
		}
		// Client passes the query object directly; server passes { json: "..." } from URL
		return "json" in rawQuery ? undefined : rawQuery;
	}

	return rawQuery;
}

export async function parseContractFields<TContract extends Contract>(
	contract: TContract,
	rawInput: RawContractInput,
	bypass: boolean,
): Promise<ParseContractResult<TContract>> {
	const parsed: Record<string, unknown> = {};

	if (bypass) {
		if (contract.pathParams) parsed.pathParams = rawInput.pathParams;
		if (contract.query) parsed.query = parseRawQuery(contract, rawInput.query);
		if (contract.headers) parsed.headers = rawInput.headers;
		if (contract.payload) parsed.payload = rawInput.payload;
		return { success: true, data: parsed as ContractOutput<TContract> };
	}

	const allIssues: Array<z.core.$ZodIssue> = [];

	if (contract.pathParams) {
		const result = await contract.pathParams.safeParseAsync(rawInput.pathParams);
		if (result.success) {
			parsed.pathParams = result.data;
		} else {
			allIssues.push(...result.error.issues);
		}
	}

	if (contract.query) {
		const rawQuery = parseRawQuery(contract, rawInput.query);
		const result = await contract.query.schema.safeParseAsync(rawQuery);
		if (result.success) {
			parsed.query = result.data;
		} else {
			allIssues.push(...result.error.issues);
		}
	}

	if (contract.headers) {
		const result = await contract.headers.safeParseAsync(rawInput.headers);
		if (result.success) {
			parsed.headers = result.data;
		} else {
			allIssues.push(...result.error.issues);
		}
	}

	if (contract.payload) {
		const result = await contract.payload.schema.safeParseAsync(rawInput.payload);
		if (result.success) {
			parsed.payload = result.data;
		} else {
			allIssues.push(...result.error.issues);
		}
	}

	if (allIssues.length > 0) {
		return { success: false, issues: allIssues };
	}

	return { success: true, data: parsed as ContractOutput<TContract> };
}
