import {
	BytesContentType,
	type ContractMethod,
	type ContractMethodMap,
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

export function isContractNode(value: unknown): value is { CONTRACT: Record<string, unknown> } {
	return isRecord(value) && "CONTRACT" in value && isRecord(value.CONTRACT);
}

export function isRouterNode(value: unknown): value is { ROUTER: Record<string, unknown> } {
	return isRecord(value) && "ROUTER" in value && isRecord(value.ROUTER);
}

export function isMiddlewareNode(value: unknown): value is { MIDDLEWARE: Record<string, unknown> } {
	return isRecord(value) && "MIDDLEWARE" in value && isRecord(value.MIDDLEWARE);
}

export function getContractMethods(contractMap: ContractMethodMap): Array<ContractMethod> {
	const methods: Array<ContractMethod> = [];
	for (const method of CONTRACT_METHOD_ORDER) {
		if (contractMap[method]) {
			methods.push(method);
		}
	}
	return methods;
}

export function dotPathToParamPath(dotPath: string): string {
	if (!dotPath) return "/";
	const segments = dotPath.split(".").filter(Boolean);
	const mapped = segments.map((s) => (s.startsWith("$") ? `:${s.slice(1)}` : s));
	return `/${mapped.join("/")}`;
}

export function dotPathToSlashPath(dotPath: string): string {
	if (!dotPath) return "/";
	return `/${dotPath.split(".").filter(Boolean).join("/")}`;
}

export function routeToSegments(route: string): Array<string> {
	const withoutLeadingSlash = route.startsWith("/") ? route.slice(1) : route;
	return withoutLeadingSlash.split("/").filter(Boolean);
}

export const JSON_CONTENT_TYPES: Set<string> = new Set(Object.values(JsonContentType));

export const TEXT_CONTENT_TYPES: Set<string> = new Set(Object.values(TextContentType));

export const BYTES_CONTENT_TYPES: Set<string> = new Set(Object.values(BytesContentType));
