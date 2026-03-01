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

export function buildNotFoundErrorResponse(): Response {
	const body: NotFoundErrorBody = { type: "notFound" };
	return new Response(JSON.stringify(body), {
		status: 404,
		headers: { "content-type": "application/json" },
	});
}

export function buildInternalErrorResponse(): Response {
	const body: InternalErrorBody = { type: "internalError" };
	return new Response(JSON.stringify(body), {
		status: 500,
		headers: { "content-type": "application/json" },
	});
}

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
		statusDefinition.schema as unknown as z.ZodType,
	);

	let responseHeaders: HeadersInit | undefined;
	if (statusDefinition.headers) {
		const rawHeaders = "headers" in result ? result.headers : undefined;
		const parsedHeaders = await parseSchemaForChannel(
			statusDefinition.headers as unknown as z.ZodType,
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
