import superjson from "superjson";
import { isRecord } from "~/internal/util.js";

function parseSuperjsonString(value: string): unknown {
	try {
		return superjson.parse(value);
	} catch {
		return value;
	}
}

export function encodeSuperjsonFields(fields: Record<string, unknown>): Record<string, string> {
	const encoded: Record<string, string> = {};
	for (const [key, value] of Object.entries(fields)) {
		if (value !== undefined) {
			encoded[key] = superjson.stringify(value);
		}
	}
	return encoded;
}

export function decodeSuperjsonFields(value: unknown): unknown {
	if (!isRecord(value)) {
		return value;
	}

	const decoded: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === "string") {
			decoded[key] = parseSuperjsonString(entry);
			continue;
		}

		if (Array.isArray(entry)) {
			decoded[key] = entry.map((item) =>
				typeof item === "string" ? parseSuperjsonString(item) : item,
			);
			continue;
		}

		decoded[key] = entry;
	}

	return decoded;
}
