import {
	type ContractMethod,
	ContractResponseBytesContentType,
	ContractResponseJsonContentType,
	ContractResponseTextContentType,
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

export const JSON_CONTENT_TYPES: Set<string> = new Set(
	Object.values(ContractResponseJsonContentType),
);

export const TEXT_CONTENT_TYPES: Set<string> = new Set(
	Object.values(ContractResponseTextContentType),
);

export const BYTES_CONTENT_TYPES: Set<string> = new Set(
	Object.values(ContractResponseBytesContentType),
);
