import type z from "zod";
import type { Contract } from "~/contract/contract.types.js";
import { getHttpSafeBaseSchema, type SchemaChannel } from "~/internal/schema_channels.js";
import { isRecord } from "~/internal/util.js";

export type RawContractInput = {
	pathParams?: unknown;
	body?: unknown;
	query?: unknown;
	headers?: unknown;
};

export type ParseContractResult =
	| { success: true; data: Record<string, unknown> }
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
		return "json" in rawQuery ? undefined : rawQuery;
	}

	return rawQuery;
}

function toSchema(schema: z.ZodType, channel: SchemaChannel): z.ZodType {
	return channel === "http-safe" ? getHttpSafeBaseSchema(schema) : schema;
}

export async function parseContractFields(
	contract: Contract,
	rawInput: RawContractInput,
	channel: SchemaChannel,
): Promise<ParseContractResult> {
	const parsed: Record<string, unknown> = {};
	const allIssues: Array<z.core.$ZodIssue> = [];

	if (contract.pathParams) {
		const result = await toSchema(contract.pathParams, channel).safeParseAsync(
			rawInput.pathParams,
		);
		if (result.success) {
			parsed.pathParams = result.data;
		} else {
			allIssues.push(...result.error.issues);
		}
	}

	if (contract.query) {
		const rawQuery = parseRawQuery(contract, rawInput.query);
		const result = await toSchema(contract.query.schema, channel).safeParseAsync(rawQuery);
		if (result.success) {
			parsed.query = result.data;
		} else {
			allIssues.push(...result.error.issues);
		}
	}

	if (contract.headers) {
		const result = await toSchema(contract.headers, channel).safeParseAsync(rawInput.headers);
		if (result.success) {
			parsed.headers = result.data;
		} else {
			allIssues.push(...result.error.issues);
		}
	}

	if (contract.body) {
		const result = await toSchema(contract.body.schema, channel).safeParseAsync(rawInput.body);
		if (result.success) {
			parsed.body = result.data;
		} else {
			allIssues.push(...result.error.issues);
		}
	}

	if (allIssues.length > 0) {
		return { success: false, issues: allIssues };
	}

	return { success: true, data: parsed };
}
