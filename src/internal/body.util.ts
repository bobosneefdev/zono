import type z from "zod";
import { parseSchemaForChannel } from "~/internal/schema_channels.js";
import { BYTES_CONTENT_TYPES, JSON_CONTENT_TYPES, TEXT_CONTENT_TYPES } from "~/internal/util.js";

export async function resolveRequestBody(
	contentType: string,
	jsonParser: () => Promise<unknown>,
	textParser: () => Promise<unknown>,
	bytesParser: () => Promise<unknown>,
	formDataParser: () => Promise<unknown>,
): Promise<unknown> {
	const normalized = contentType.toLowerCase();
	for (const ct of JSON_CONTENT_TYPES) {
		if (normalized.includes(ct)) return jsonParser();
	}
	for (const ct of TEXT_CONTENT_TYPES) {
		if (normalized.includes(ct)) return textParser();
	}
	for (const ct of BYTES_CONTENT_TYPES) {
		if (normalized.includes(ct)) return bytesParser();
	}
	return formDataParser();
}

export async function encodeResponseBody(
	contentType: string | null,
	body: unknown,
	schema?: z.ZodType,
): Promise<BodyInit | null> {
	if (contentType === null) return null;
	if (!schema) return null;
	const parsedBody = await parseSchemaForChannel(schema, body, "http-safe");
	if (JSON_CONTENT_TYPES.has(contentType)) {
		return JSON.stringify(parsedBody);
	}
	if (TEXT_CONTENT_TYPES.has(contentType)) {
		return String(parsedBody);
	}
	if (BYTES_CONTENT_TYPES.has(contentType)) {
		return parsedBody as BodyInit;
	}
	return null;
}

export async function parseResponseBody(
	contentType: string | null,
	response: Response,
	schema?: z.ZodType,
): Promise<unknown> {
	if (contentType === null) return undefined;
	if (!schema) return undefined;
	let rawBody: unknown;
	if (JSON_CONTENT_TYPES.has(contentType)) {
		rawBody = await response.clone().json();
	} else if (TEXT_CONTENT_TYPES.has(contentType)) {
		rawBody = await response.clone().text();
	} else if (BYTES_CONTENT_TYPES.has(contentType)) {
		rawBody = await response.clone().bytes();
	} else {
		return undefined;
	}
	return parseSchemaForChannel(schema, rawBody, "transformed");
}
