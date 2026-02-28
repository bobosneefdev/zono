import z from "zod";
import { isRecord } from "~/internal/util.js";

export type SchemaChannel = "http-safe" | "transformed";

const HTTP_SAFE_BASE_SCHEMA_CACHE = new WeakMap<z.ZodType, z.ZodType>();

function isTopLevelTransformPipe(
	schema: z.ZodType,
): schema is z.ZodPipe<z.ZodType, z.ZodTransform> {
	return schema instanceof z.ZodPipe && schema.out instanceof z.ZodTransform;
}

function collectChildSchemas(value: unknown, out: Set<z.ZodType>): void {
	if (value instanceof z.ZodType) {
		out.add(value);
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			collectChildSchemas(item, out);
		}
		return;
	}

	if (typeof value === "function") {
		const result = value();
		collectChildSchemas(result, out);
		return;
	}

	if (!isRecord(value)) {
		return;
	}

	for (const nestedValue of Object.values(value)) {
		collectChildSchemas(nestedValue, out);
	}
}

function getChildSchemas(schema: z.ZodType): Array<z.ZodType> {
	const def = schema._def as unknown as Record<string, unknown>;
	const out = new Set<z.ZodType>();

	for (const [key, value] of Object.entries(def)) {
		if (key === "type") continue;
		collectChildSchemas(value, out);
	}

	return [...out];
}

function assertNoNestedTransforms(schema: z.ZodType): void {
	const stack: Array<z.ZodType> = getChildSchemas(schema);
	const visited = new Set<z.ZodType>();

	while (stack.length > 0) {
		const current = stack.pop();
		if (!current || visited.has(current)) continue;
		visited.add(current);

		if (current instanceof z.ZodTransform || isTopLevelTransformPipe(current)) {
			throw new Error(
				"Nested .transform(...) is not supported in route contract schemas; transforms must be top-level chains only",
			);
		}

		stack.push(...getChildSchemas(current));
	}
}

function extractAndValidateHttpSafeBaseSchema(schema: z.ZodType): z.ZodType {
	let current: z.ZodType = schema;

	while (current instanceof z.ZodPipe) {
		if (!isTopLevelTransformPipe(current)) {
			throw new Error(
				"Only top-level .transform(...) chains are supported in route contract schemas",
			);
		}
		current = current.in;
	}

	if (current instanceof z.ZodTransform) {
		throw new Error(
			"Route contract schemas require an HTTP-safe base schema before top-level transforms",
		);
	}

	assertNoNestedTransforms(current);
	return current;
}

export function getHttpSafeBaseSchema(schema: z.ZodType): z.ZodType {
	const cached = HTTP_SAFE_BASE_SCHEMA_CACHE.get(schema);
	if (cached) {
		return cached;
	}

	const baseSchema = extractAndValidateHttpSafeBaseSchema(schema);
	HTTP_SAFE_BASE_SCHEMA_CACHE.set(schema, baseSchema);
	return baseSchema;
}

export function validateRouteContractSchema(schema: z.ZodType): void {
	void getHttpSafeBaseSchema(schema);
}

export function resolveSchemaForChannel<TSchema extends z.ZodType>(
	schema: TSchema,
	channel: SchemaChannel,
): z.ZodType {
	return channel === "http-safe" ? getHttpSafeBaseSchema(schema) : schema;
}

export async function parseSchemaForChannel(
	schema: z.ZodType,
	value: unknown,
	channel: SchemaChannel,
): Promise<unknown> {
	const parser = resolveSchemaForChannel(schema, channel);
	return await parser.parseAsync(value);
}
