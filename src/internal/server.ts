import type z from "zod";
import type {
	ErrorMode,
	ValidationErrorBodyHidden,
	ValidationErrorBodyPublic,
} from "~/contract/contract.error.js";
import type { Contract } from "~/contract/contract.types.js";
import type { ServerHandlerOutput } from "~/internal/handler.types.js";
import {
	BYTES_CONTENT_TYPES,
	isRecord,
	JSON_CONTENT_TYPES,
	TEXT_CONTENT_TYPES,
} from "~/internal/util.js";

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

	const rawBody = "body" in result ? result.body : undefined;

	let encodedBody: BodyInit | null = null;
	if (statusDefinition.contentType === null) {
		// No body for contentless responses
	} else if (JSON_CONTENT_TYPES.has(statusDefinition.contentType)) {
		const parsedBody = bypassOutgoingParse
			? rawBody
			: await statusDefinition.schema.parseAsync(rawBody);
		encodedBody = JSON.stringify(parsedBody);
	} else if (TEXT_CONTENT_TYPES.has(statusDefinition.contentType)) {
		const parsedBody = bypassOutgoingParse
			? rawBody
			: await statusDefinition.schema.parseAsync(rawBody);
		encodedBody = String(parsedBody);
	} else if (BYTES_CONTENT_TYPES.has(statusDefinition.contentType)) {
		const parsedBody = bypassOutgoingParse
			? rawBody
			: await statusDefinition.schema.parseAsync(rawBody);
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
