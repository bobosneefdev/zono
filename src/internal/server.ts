import type z from "zod";
import type {
	ErrorMode,
	InternalErrorBody,
	NotFoundErrorBody,
	ValidationErrorBodyHidden,
	ValidationErrorBodyPublic,
} from "~/contract/contract.error.js";

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
