import type { Contract, ContractMethod, ContractMethodMap } from "~/contract/contract.types.js";
import { CONTRACT_METHOD_ORDER } from "~/lib/util.js";
import type {
	RouterContractGivenPath,
	RouterContractGivenPathAndMethod,
	RouterPath,
	RouterPathContractMap,
} from "~/router/router.resolve.types.js";

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

export function resolveRouteContractMap<TRouter, TRoute extends RouterPath<TRouter>>(
	router: TRouter,
	routePath: TRoute,
): RouterPathContractMap<TRouter, TRoute> & ContractMethodMap {
	const dotPath = routePathToDotPath(routePath);
	const keys = dotPath.length === 0 ? [] : dotPath.split(".");

	let current: unknown = router;
	for (const key of keys) {
		if (typeof current !== "object" || current === null) {
			throw new Error(`Unknown route: ${routePath}`);
		}

		const currentRecord = current as Record<string, unknown>;
		if (key in currentRecord) {
			current = currentRecord[key];
			continue;
		}

		if (
			"router" in currentRecord &&
			typeof currentRecord.router === "object" &&
			currentRecord.router !== null &&
			key in (currentRecord.router as Record<string, unknown>)
		) {
			current = (currentRecord.router as Record<string, unknown>)[key];
			continue;
		}

		throw new Error(`Unknown route: ${routePath}`);
	}

	if (
		typeof current !== "object" ||
		current === null ||
		!("contract" in current) ||
		typeof current.contract !== "object" ||
		current.contract === null
	) {
		throw new Error(`Route does not resolve to a contract: ${routePath}`);
	}

	return current.contract as RouterPathContractMap<TRouter, TRoute> & ContractMethodMap;
}

export function resolveRouteContract<TRouter, TRoute extends RouterPath<TRouter>>(
	router: TRouter,
	routePath: TRoute,
): RouterContractGivenPath<TRouter, TRoute> & Contract {
	const contractMap = resolveRouteContractMap(router, routePath);

	for (const method of CONTRACT_METHOD_ORDER) {
		const contract = contractMap[method];
		if (contract) {
			return contract as RouterContractGivenPath<TRouter, TRoute> & Contract;
		}
	}

	throw new Error(`Route does not contain any contracts: ${routePath}`);
}

export function resolveRouteMethodContract<
	TRouter,
	TRoute extends RouterPath<TRouter>,
	TMethod extends ContractMethod,
>(
	router: TRouter,
	routePath: TRoute,
	method: TMethod,
): RouterContractGivenPathAndMethod<TRouter, TRoute, TMethod> & Contract {
	const contractMap = resolveRouteContractMap(router, routePath);
	const contract = contractMap[method];

	if (!contract) {
		throw new Error(`Route does not contain contract for method ${method}: ${routePath}`);
	}

	return contract as RouterContractGivenPathAndMethod<TRouter, TRoute, TMethod> & Contract;
}
