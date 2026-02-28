import type z from "zod";

export type ErrorMode = "public" | "hidden";

export type ValidationErrorBodyPublic = {
	type: "invalidInput";
	issues: Array<z.core.$ZodIssue>;
};

export type ValidationErrorBodyHidden = {
	type: "invalidInput";
	issues: number;
};

export type NotFoundErrorBody = {
	type: "notFound";
};

export type InternalErrorBody = {
	type: "internalError";
};

export type ValidationErrorBody<TMode extends ErrorMode> = TMode extends "public"
	? ValidationErrorBodyPublic
	: ValidationErrorBodyHidden;
