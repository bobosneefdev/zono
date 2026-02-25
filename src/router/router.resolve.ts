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

export function resolveRouteContractMap<TRouter, TPath extends RouterPath<TRouter>>(
	router: TRouter,
	routePath: TPath,
): RouterPathContractMap<TRouter, TPath> & ContractMethodMap {
	const dotPath = routePathToDotPath(routePath);
	const keys = dotPath.length === 0 ? [] : dotPath.split(".");

	let current: unknown = router;
	for (const key of keys) {
		if (typeof current !== "object" || current === null) {
			throw new Error(`Unknown path ${routePath}`);
		}

		const currentRecord = current as Record<string, unknown>;
		if (key in currentRecord) {
			current = currentRecord[key];
			continue;
		}

		if (
			"ROUTER" in currentRecord &&
			typeof currentRecord.ROUTER === "object" &&
			currentRecord.ROUTER !== null &&
			key in (currentRecord.ROUTER as Record<string, unknown>)
		) {
			current = (currentRecord.ROUTER as Record<string, unknown>)[key];
			continue;
		}

		throw new Error(`Unknown path ${routePath}`);
	}

	if (
		typeof current !== "object" ||
		current === null ||
		!("CONTRACT" in current) ||
		typeof current.CONTRACT !== "object" ||
		current.CONTRACT === null
	) {
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
