import type z from "zod";
import type { Contract } from "~/contract/contract.types.js";
import type { SchemaChannel } from "~/internal/schema_channels.js";
import { getHttpSafeBaseSchema } from "~/internal/schema_channels.js";
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

export async function parseContractFields(
	contract: Contract,
	rawInput: RawContractInput,
	channel: SchemaChannel,
): Promise<ParseContractResult> {
	const parsed: Record<string, unknown> = {};

	const allIssues: Array<z.core.$ZodIssue> = [];
	const parseSchema = (schema: z.ZodType): z.ZodType =>
		channel === "http-safe" ? getHttpSafeBaseSchema(schema) : schema;

	if (contract.pathParams) {
		const pathParamsSchema = parseSchema(contract.pathParams as unknown as z.ZodType);
		const result = await pathParamsSchema.safeParseAsync(rawInput.pathParams);
		if (result.success) {
			parsed.pathParams = result.data;
		} else {
			allIssues.push(...result.error.issues);
		}
	}

	if (contract.query) {
		const rawQuery = parseRawQuery(contract, rawInput.query);
		const querySchema = parseSchema(contract.query.schema as unknown as z.ZodType);
		const result = await querySchema.safeParseAsync(rawQuery);
		if (result.success) {
			parsed.query = result.data;
		} else {
			allIssues.push(...result.error.issues);
		}
	}

	if (contract.headers) {
		const headersSchema = parseSchema(contract.headers);
		const result = await headersSchema.safeParseAsync(rawInput.headers);
		if (result.success) {
			parsed.headers = result.data;
		} else {
			allIssues.push(...result.error.issues);
		}
	}

	if (contract.body) {
		const bodySchema = parseSchema(contract.body.schema as unknown as z.ZodType);
		const result = await bodySchema.safeParseAsync(rawInput.body);
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
