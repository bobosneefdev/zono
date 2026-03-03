import superjson from "superjson";
import type z from "zod";
import type {
	ContractResponse,
	ErrorMode,
	InternalErrorBody,
	NotFoundErrorBody,
	ValidationErrorBodyHidden,
	ValidationErrorBodyPublic,
} from "~/contract/contract.types.js";

type TypedResponseOutput = {
	type: string;
	status: number;
	data?: unknown;
	headers?: HeadersInit;
};

function mergeDefaultContentTypeHeaders(
	defaultContentType: string,
	headers: HeadersInit | undefined,
): HeadersInit {
	const merged: Record<string, string> = {
		"content-type": defaultContentType,
	};

	if (headers) {
		for (const [key, value] of new Headers(headers).entries()) {
			merged[key] = value;
		}
	}

	return merged;
}

/**
 * Builds an HTTP Response from a typed output object.
 */
export function buildTypedResponse(result: TypedResponseOutput): Response {
	switch (result.type as ContractResponse["type"]) {
		case "JSON":
			return new Response(JSON.stringify(result.data), {
				status: result.status,
				headers: mergeDefaultContentTypeHeaders("application/json", result.headers),
			});
		case "SuperJSON":
			return new Response(JSON.stringify(superjson.serialize(result.data)), {
				status: result.status,
				headers: mergeDefaultContentTypeHeaders("application/json", result.headers),
			});
		case "Text":
			return new Response(String(result.data), {
				status: result.status,
				headers: mergeDefaultContentTypeHeaders("text/plain", result.headers),
			});
		case "Blob":
			return new Response(result.data as Blob, {
				status: result.status,
				headers: result.headers,
			});
		case "ArrayBuffer":
			return new Response(result.data as ArrayBuffer, {
				status: result.status,
				headers: result.headers,
			});
		case "FormData":
			return new Response(result.data as FormData, {
				status: result.status,
				headers: result.headers,
			});
		case "ReadableStream":
			return new Response(result.data as ReadableStream, {
				status: result.status,
				headers: result.headers,
			});
		case "Void":
			return new Response(null, {
				status: result.status,
				headers: result.headers,
			});
		default:
			throw new Error(`Unknown response type: ${result.type}`);
	}
}

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
