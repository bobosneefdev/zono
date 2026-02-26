import type { Contract } from "~/contract/contract.types.js";
import type { ServerHandlerInput, ServerHandlerOutput } from "~/internal/server.types.js";
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

export async function parseContractInput<TContract extends Contract>(
	contract: TContract,
	rawInput: RawContractInput,
	bypassIncomingParse: boolean,
): Promise<ServerHandlerInput<TContract>> {
	const parsed: Record<string, unknown> = {};

	if (contract.pathParams) {
		parsed.pathParams = bypassIncomingParse
			? rawInput.pathParams
			: await contract.pathParams.parseAsync(rawInput.pathParams);
	}

	if (contract.query) {
		const rawQuery = parseRawQuery(contract, rawInput.query);
		parsed.query = bypassIncomingParse
			? rawQuery
			: await contract.query.schema.parseAsync(rawQuery);
	}

	if (contract.headers) {
		parsed.headers = bypassIncomingParse
			? rawInput.headers
			: await contract.headers.parseAsync(rawInput.headers);
	}

	if (contract.payload) {
		parsed.payload = bypassIncomingParse
			? rawInput.payload
			: await contract.payload.schema.parseAsync(rawInput.payload);
	}

	return parsed as ServerHandlerInput<TContract>;
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
