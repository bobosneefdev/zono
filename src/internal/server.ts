import type z from "zod";
import type {
	ErrorMode,
	InternalErrorBody,
	NotFoundErrorBody,
	ValidationErrorBodyHidden,
	ValidationErrorBodyPublic,
} from "~/contract/contract.error.js";
import type { Contract } from "~/contract/contract.types.js";
import { encodeResponseBody } from "~/internal/body.util.js";
import type { ServerHandlerOutput } from "~/internal/handler.types.js";
import { parseSchemaForChannel } from "~/internal/schema_channels.js";
import { isRecord } from "~/internal/util.js";

/**
 * Builds a 400 Bad Request response for validation errors.
 * @param issues - Array of Zod validation issues
 * @param errorMode - Whether to include full issues or just the count
 * @returns Response with validation error body
 */
export function buildValidationErrorResponse(
	issues: Array<z.core.$ZodIssue>,
	errorMode: ErrorMode,
): Response {
	const body: ValidationErrorBodyPublic | ValidationErrorBodyHidden =
		errorMode === "public"
			? { type: "invalidInput", issues }
			: { type: "invalidInput", issues: issues.length };
	return new Response(JSON.stringify(body), {
		status: 400,
		headers: { "content-type": "application/json" },
	});
}

/** Builds a 404 Not Found response */
export function buildNotFoundErrorResponse(): Response {
	const body: NotFoundErrorBody = { type: "notFound" };
	return new Response(JSON.stringify(body), {
		status: 404,
		headers: { "content-type": "application/json" },
	});
}

/** Builds a 500 Internal Server Error response */
export function buildInternalErrorResponse(): Response {
	const body: InternalErrorBody = { type: "internalError" };
	return new Response(JSON.stringify(body), {
		status: 500,
		headers: { "content-type": "application/json" },
	});
}

/**
 * Builds a Response from a contract and handler result.
 * Encodes the body according to the response's content type.
 * @param contract - The contract defining the response format
 * @param result - The handler output to build the response from
 * @returns Promise resolving to the encoded Response
 */
export async function buildContractResponse<TContract extends Contract>(
	contract: TContract,
	result: ServerHandlerOutput<TContract>,
): Promise<Response> {
	const statusDefinition = contract.responses[result.status];
	if (!statusDefinition) {
		throw new Error(`Unexpected response status: ${result.status}`);
	}

	const rawBody = "body" in result ? result.body : undefined;
	const encodedBody = await encodeResponseBody(
		statusDefinition.contentType,
		rawBody,
		statusDefinition.schema,
	);

	let responseHeaders: HeadersInit | undefined;
	if (statusDefinition.headers) {
		const rawHeaders = "headers" in result ? result.headers : undefined;
		const parsedHeaders = await parseSchemaForChannel(
			statusDefinition.headers,
			rawHeaders,
			"http-safe",
		);
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
