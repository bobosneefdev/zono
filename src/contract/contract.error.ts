import type z from "zod";

/** Controls how much validation error detail is exposed to clients */
export type ErrorMode = "public" | "hidden";

/** Full validation error details with Zod issues - used when errorMode is "public" */
export type ValidationErrorBodyPublic = {
	type: "invalidInput";
	issues: Array<z.core.$ZodIssue>;
};

/** Minimal validation error with only issue count - used when errorMode is "hidden" */
export type ValidationErrorBodyHidden = {
	type: "invalidInput";
	issues: number;
};

/** Error body for 404 Not Found responses */
export type NotFoundErrorBody = {
	type: "notFound";
};

/** Error body for 500 Internal Server Error responses */
export type InternalErrorBody = {
	type: "internalError";
};

/**
 * Validation error body type based on error mode.
 * @template TMode - The error mode, "public" includes full issues, "hidden" includes count only
 */
export type ValidationErrorBody<TMode extends ErrorMode> = TMode extends "public"
	? ValidationErrorBodyPublic
	: ValidationErrorBodyHidden;
