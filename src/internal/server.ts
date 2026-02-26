import type z from "zod";
import type { Contract } from "~/contract/contract.types.js";
import type {
	ErrorMode,
	ServerHandlerInput,
	ServerHandlerOutput,
	ValidationErrorBodyHidden,
	ValidationErrorBodyPublic,
} from "~/internal/server.types.js";
import {
	BYTES_CONTENT_TYPES,
	isRecord,
	JSON_CONTENT_TYPES,
	TEXT_CONTENT_TYPES,
} from "~/internal/util.js";

export type RawContractInput = {
	pathParams?: unknown;
	payload?: unknown;
	query?: unknown;
	headers?: unknown;
};

function parseRawQuery(contract: Contract, rawQuery: unknown): unknown {
	if (!contract.query) {
		return rawQuery;
	}

	if (contract.query.type === "json") {
		if (!isRecord(rawQuery)) {
			return rawQuery;
		}

		const encoded = rawQuery.json;
		if (typeof encoded !== "string") {
			return undefined;
		}

		return JSON.parse(encoded);
	}

	return rawQuery;
}

export type ParseContractResult<TContract extends Contract> =
	| { success: true; data: ServerHandlerInput<TContract> }
	| { success: false; issues: Array<z.core.$ZodIssue> };

export async function parseContractInput<TContract extends Contract>(
	contract: TContract,
	rawInput: RawContractInput,
	bypassIncomingParse: boolean,
): Promise<ParseContractResult<TContract>> {
	const parsed: Record<string, unknown> = {};

	if (bypassIncomingParse) {
		if (contract.pathParams) parsed.pathParams = rawInput.pathParams;
		if (contract.query) parsed.query = parseRawQuery(contract, rawInput.query);
		if (contract.headers) parsed.headers = rawInput.headers;
		if (contract.payload) parsed.payload = rawInput.payload;
		return { success: true, data: parsed as ServerHandlerInput<TContract> };
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

	return { success: true, data: parsed as ServerHandlerInput<TContract> };
}

export function buildValidationErrorResponse(
	issues: Array<z.core.$ZodIssue>,
	errorMode: ErrorMode,
): Response {
	const body: ValidationErrorBodyPublic | ValidationErrorBodyHidden =
		errorMode === "public" ? { issues } : { issues: issues.length };
	return new Response(JSON.stringify(body), {
		status: 400,
		headers: { "content-type": "application/json" },
	});
}

export async function buildContractResponse<TContract extends Contract>(
	contract: TContract,
	result: ServerHandlerOutput<TContract>,
	defaultBypassOutgoingParse: boolean,
): Promise<Response> {
	const statusDefinition = contract.responses[result.status];
	if (!statusDefinition) {
		throw new Error(`Unexpected response status: ${result.status}`);
	}

	const bypassOutgoingParse = result.opts?.bypassOutgoingParse ?? defaultBypassOutgoingParse;

	const rawData = "data" in result ? result.data : undefined;

	let encodedBody: BodyInit | null = null;
	if (statusDefinition.contentType === null) {
		// Do nothing
	} else if (JSON_CONTENT_TYPES.has(statusDefinition.contentType)) {
		const parsedBody = bypassOutgoingParse
			? rawData
			: await statusDefinition.schema.parseAsync(rawData);
		encodedBody = JSON.stringify(parsedBody);
	} else if (TEXT_CONTENT_TYPES.has(statusDefinition.contentType)) {
		const parsedBody = bypassOutgoingParse
			? rawData
			: await statusDefinition.schema.parseAsync(rawData);
		encodedBody = String(parsedBody);
	} else if (BYTES_CONTENT_TYPES.has(statusDefinition.contentType)) {
		const parsedBody = bypassOutgoingParse
			? rawData
			: await statusDefinition.schema.parseAsync(rawData);
		encodedBody = parsedBody as BodyInit;
	}

	let responseHeaders: HeadersInit | undefined;
	if (statusDefinition.headers) {
		const rawHeaders = "headers" in result ? result.headers : undefined;
		const parsedHeaders = bypassOutgoingParse
			? rawHeaders
			: await statusDefinition.headers.parseAsync(rawHeaders);
		responseHeaders = isRecord(parsedHeaders)
			? (Object.entries(parsedHeaders).filter(
					(entry): entry is [string, string] => typeof entry[1] === "string",
				) as HeadersInit)
			: undefined;
	}

	const finalHeaders = new Headers(responseHeaders);
	if (statusDefinition.contentType !== null && !finalHeaders.has("content-type")) {
		finalHeaders.set("content-type", statusDefinition.contentType);
	}

	return new Response(encodedBody, {
		status: result.status,
		headers: finalHeaders,
	});
}
