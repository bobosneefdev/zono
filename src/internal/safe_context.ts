import type { Context } from "hono";
import z from "zod";
import type { Contract } from "~/contract/contract.types.js";

/**
 * Custom error for response validation failures to distinguish from other errors.
 */
export class ResponseValidationError extends Error {
	issues: Array<z.core.$ZodIssue>;

	constructor(message: string, issues: Array<z.core.$ZodIssue>) {
		super(message);
		this.name = "ResponseValidationError";
		this.issues = issues;
	}
}

/**
 * Validates response data against the contract schema for a given status.
 * Returns the data unchanged; throws ResponseValidationError on failure.
 */
async function validateResponseData<T>(contract: Contract, status: number, data: T): Promise<T> {
	const responseDef = contract.responses[status];
	if (!responseDef) {
		throw new Error(`No contract for response status: ${status}`);
	}

	// If no schema (e.g., 204 No Content), skip validation
	if (!responseDef.schema) {
		return data;
	}

	const result = await responseDef.schema.safeParseAsync(data);
	if (!result.success) {
		throw new ResponseValidationError(
			`Response validation failed for status ${status}`,
			result.error.issues,
		);
	}

	return data;
}

/**
 * Creates a safe version of Hono's context methods that validate responses against the contract.
 * The json/text/body delegation calls require `as` casts because Hono's overloads cannot be
 * expressed generically when proxying unknown data; this is the narrowest possible cast surface.
 * @param ctx - The original Hono Context
 * @param contract - The contract defining valid response schemas
 * @returns A wrapped Context with validated response methods
 */
export function createSafeContext(ctx: Context, contract: Contract): Context {
	return new Proxy(ctx, {
		get(target, prop) {
			if (prop === "json") {
				return async (data: unknown, status = 200) => {
					const validated = await validateResponseData(contract, status, data);
					return (target.json as (d: unknown, s: number) => unknown)(validated, status);
				};
			}
			if (prop === "text") {
				return async (data: unknown, status = 200) => {
					const validated = await validateResponseData(contract, status, data);
					return (target.text as (d: string, s: number) => unknown)(
						validated as string,
						status,
					);
				};
			}
			if (prop === "body") {
				return async (data: unknown, status = 200, contentType?: string) => {
					const validated = await validateResponseData(contract, status, data);
					return (target.body as (d: unknown, s: number, ct?: string) => unknown)(
						validated,
						status,
						contentType,
					);
				};
			}
			const value = target[prop as keyof Context];
			if (typeof value === "function") return value.bind(target);
			return value;
		},
	}) as Context;
}
