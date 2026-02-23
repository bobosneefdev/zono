import type { Contract } from "~/contract/types.js";
import type { ServerHandlerInput, ServerHandlerOutput } from "~/internal/server_types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export type RawContractInput = {
	pathParams?: unknown;
	body?: unknown;
	query?: unknown;
	headers?: unknown;
};

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
		parsed.query = bypassIncomingParse
			? rawInput.query
			: await contract.query.parseAsync(rawInput.query);
	}

	if (contract.headers) {
		parsed.headers = bypassIncomingParse
			? rawInput.headers
			: await contract.headers.parseAsync(rawInput.headers);
	}

	if (contract.body) {
		parsed.body = bypassIncomingParse
			? rawInput.body
			: await contract.body.parseAsync(rawInput.body);
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

	let responseBody: unknown;
	if (statusDefinition.body) {
		const rawData = "data" in result ? result.data : undefined;
		responseBody = bypassOutgoingParse
			? rawData
			: await statusDefinition.body.parseAsync(rawData);
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

	if (responseBody === undefined) {
		return new Response(null, {
			status: result.status,
			headers: responseHeaders,
		});
	}

	return Response.json(responseBody, {
		status: result.status,
		headers: responseHeaders,
	});
}
