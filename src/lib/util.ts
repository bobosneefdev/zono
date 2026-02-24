import type { ContractMethod } from "~/contract/types.js";

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
