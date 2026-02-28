import { mergeContractResponses } from "~/contract/contract.responses.js";
import type {
	Contract,
	ContractMethod,
	ContractMethodMap,
	ContractResponses,
} from "~/contract/contract.types.js";
import { CONTRACT_METHOD_ORDER, isContractNode, isRecord, isRouterNode } from "~/internal/util.js";
import type {
	RouterContractGivenPath,
	RouterContractGivenPathAndMethod,
	RouterPath,
	RouterPathContractMap,
} from "~/router/router.resolve.types.js";

export function routeToSegments(route: string): Array<string> {
	const withoutLeadingSlash = route.startsWith("/") ? route.slice(1) : route;
	return withoutLeadingSlash.split("/").filter(Boolean);
}

function routePathToDotPath(routePath: string): string {
	const withoutLeadingSlash = routePath.startsWith("/") ? routePath.slice(1) : routePath;
	return withoutLeadingSlash.split("/").filter(Boolean).join(".");
}

export function routerDotPathToParamPath(dotPath: string): string {
	if (!dotPath) {
		return "/";
	}

	const segments = dotPath.split(".").filter(Boolean);
	const mapped = segments.map((segment) =>
		segment.startsWith("$") ? `:${segment.slice(1)}` : segment,
	);

	return `/${mapped.join("/")}`;
}

function flattenNodeMiddleware(node: unknown): ContractResponses {
	if (!isRecord(node) || !("MIDDLEWARE" in node)) {
		return {};
	}
	const mw = node.MIDDLEWARE;
	if (!isRecord(mw)) {
		return {};
	}
	const entries = Object.values(mw).filter(
		(v): v is ContractResponses => isRecord(v) && typeof v === "object",
	);
	return entries.length === 0 ? {} : mergeContractResponses(...entries);
}

export function resolveRouteMiddlewareResponses(
	router: unknown,
	routePath: string,
): ContractResponses {
	const dotPath = routePathToDotPath(routePath);
	const keys = dotPath.length === 0 ? [] : dotPath.split(".");

	const accumulated: Array<ContractResponses> = [];
	let current: unknown = router;

	accumulated.push(flattenNodeMiddleware(current));

	for (const key of keys) {
		if (!isRecord(current)) {
			throw new Error(`Unknown path ${routePath}`);
		}

		if (key in current) {
			current = current[key];
		} else if (isRouterNode(current) && key in current.ROUTER) {
			current = current.ROUTER[key];
		} else {
			throw new Error(`Unknown path ${routePath}`);
		}

		accumulated.push(flattenNodeMiddleware(current));
	}

	return accumulated.length === 1 ? accumulated[0] : mergeContractResponses(...accumulated);
}

export function resolveRouteContractMap<TRouter, TPath extends RouterPath<TRouter>>(
	router: TRouter,
	routePath: TPath,
): RouterPathContractMap<TRouter, TPath> & ContractMethodMap {
	const dotPath = routePathToDotPath(routePath);
	const keys = dotPath.length === 0 ? [] : dotPath.split(".");

	let current: unknown = router;
	for (const key of keys) {
		if (!isRecord(current)) {
			throw new Error(`Unknown path ${routePath}`);
		}

		if (key in current) {
			current = current[key];
			continue;
		}

		if (isRouterNode(current) && key in current.ROUTER) {
			current = current.ROUTER[key];
			continue;
		}

		throw new Error(`Unknown path ${routePath}`);
	}

	if (!isContractNode(current)) {
		throw new Error(`Route does not resolve to a contract: ${routePath}`);
	}

	return current.CONTRACT as RouterPathContractMap<TRouter, TPath> & ContractMethodMap;
}

export function resolveRouteContract<TRouter, TPath extends RouterPath<TRouter>>(
	router: TRouter,
	routePath: TPath,
): RouterContractGivenPath<TRouter, TPath> & Contract {
	const contractMap = resolveRouteContractMap(router, routePath);

	for (const method of CONTRACT_METHOD_ORDER) {
		const contract = contractMap[method];
		if (contract) {
			return contract as RouterContractGivenPath<TRouter, TPath> & Contract;
		}
	}

	throw new Error(`Route does not contain any contracts: ${routePath}`);
}

export function resolveRouteMethodContract<
	TRouter,
	TPath extends RouterPath<TRouter>,
	TMethod extends ContractMethod,
>(
	router: TRouter,
	routePath: TPath,
	method: TMethod,
): RouterContractGivenPathAndMethod<TRouter, TPath, TMethod> & Contract {
	const contractMap = resolveRouteContractMap(router, routePath);
	const contract = contractMap[method];

	if (!contract) {
		throw new Error(`Route does not contain contract for method ${method}: ${routePath}`);
	}

	return contract as RouterContractGivenPathAndMethod<TRouter, TPath, TMethod> & Contract;
}
