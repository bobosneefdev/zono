import {
	BytesContentType,
	type ContractMethod,
	JsonContentType,
	TextContentType,
} from "~/contract/contract.types.js";

export const CONTRACT_METHOD_ORDER: Array<ContractMethod> = [
	"get",
	"post",
	"put",
	"delete",
	"patch",
	"options",
	"head",
];

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function routeToSegments(route: string): Array<string> {
	const withoutLeadingSlash = route.startsWith("/") ? route.slice(1) : route;
	return withoutLeadingSlash.split("/").filter(Boolean);
}

export const JSON_CONTENT_TYPES: Set<string> = new Set(Object.values(JsonContentType));

export const TEXT_CONTENT_TYPES: Set<string> = new Set(Object.values(TextContentType));

export const BYTES_CONTENT_TYPES: Set<string> = new Set(Object.values(BytesContentType));
