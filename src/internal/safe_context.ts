/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Context } from "hono";
import type { Contract } from "~/contract/contract.types.js";
import { parseSchemaForChannel } from "~/internal/schema_channels.js";

/**
 * Custom error for validation failures to distinguish from other errors
 */
export class ResponseValidationError extends Error {
	issues: Array<unknown>;

	constructor(message: string, issues: Array<unknown>) {
		super(message);
		this.name = "ResponseValidationError";
		this.issues = issues;
	}
}

/**
 * Gets the response schema for a given status code from the contract
 */
function getResponseSchema(contract: Contract, status: number) {
	const responseDef = contract.responses[status];
	if (!responseDef) {
		throw new Error(`No contract for response status: ${status}`);
	}
	return responseDef;
}

/**
 * Validates response data against the contract schema for a given status
 */
async function validateResponseData<T>(contract: Contract, status: number, data: T): Promise<T> {
	const responseDef = getResponseSchema(contract, status);

	// If no schema (e.g., 204 No Content), skip validation
	if (!responseDef.schema) {
		return data;
	}

	// Validate the response body against the schema using "transformed" channel
	// This applies any transforms defined in the schema
	try {
		await parseSchemaForChannel(responseDef.schema, data, "transformed");
	} catch (error) {
		const issues = error instanceof Error ? [error.message] : ["Validation failed"];
		throw new ResponseValidationError(
			`Response validation failed for status ${status}: ${issues.join(", ")}`,
			issues,
		);
	}

	return data;
}

/**
 * Creates a safe version of Hono's context methods that validate responses against the contract.
 * This keeps the same API but adds runtime validation.
 * @param ctx - The original Hono Context
 * @param contract - The contract defining valid response schemas
 * @returns A wrapped Context with validated response methods
 */
export function createSafeContext(ctx: Context, contract: Contract): Context {
	// Create wrappers for the response methods that validate before calling the original
	const safeJson = async (data: unknown, status = 200) => {
		const validated = await validateResponseData(contract, status, data);
		return (ctx.json as any)(validated, status);
	};

	const safeText = async (data: unknown, status = 200) => {
		const validated = await validateResponseData(contract, status, data);
		return (ctx.text as any)(validated as string, status);
	};

	const safeBody = async (data: unknown, status = 200, contentType?: string) => {
		const validated = await validateResponseData(contract, status, data);
		return (ctx.body as any)(validated, status, contentType);
	};

	// Create a proxy that overrides only json, text, and body
	return new Proxy(ctx, {
		get(target, prop) {
			// Override these specific methods with safe versions
			if (prop === "json") {
				return safeJson;
			}
			if (prop === "text") {
				return safeText;
			}
			if (prop === "body") {
				return safeBody;
			}

			// Pass through all other properties/methods unchanged
			const value = target[prop as keyof Context];
			if (typeof value === "function") {
				return value.bind(target);
			}
			return value;
		},
	}) as Context;
}
