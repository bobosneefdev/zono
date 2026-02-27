import type z from "zod";

export type ErrorMode = "public" | "hidden";

export type ValidationErrorBodyPublic = { issues: Array<z.core.$ZodIssue> };

export type ValidationErrorBodyHidden = { issues: number };

export type ValidationErrorBody<TMode extends ErrorMode> = TMode extends "public"
	? ValidationErrorBodyPublic
	: ValidationErrorBodyHidden;
