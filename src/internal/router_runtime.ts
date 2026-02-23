import type { Contract } from "~/contract/types.js";
import type { ContractForRoutePath, RouterRoutePath } from "~/internal/route_types.js";

function routePathToDotPath(routePath: string): string {
	const withoutLeadingSlash = routePath.startsWith("/") ? routePath.slice(1) : routePath;
	return withoutLeadingSlash.split("/").filter(Boolean).join(".");
}

export function dotPathToParamPath(dotPath: string): string {
	if (!dotPath) {
		return "/";
	}

	const segments = dotPath.split(".").filter(Boolean);
	const mapped = segments.map((segment) =>
		segment.startsWith("$") ? `:${segment.slice(1)}` : segment,
	);

	return `/${mapped.join("/")}`;
}

export function getContractForRoutePath<TRouter, TRoute extends RouterRoutePath<TRouter>>(
	router: TRouter,
	routePath: TRoute,
): ContractForRoutePath<TRouter, TRoute> & Contract {
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

	return current.contract as ContractForRoutePath<TRouter, TRoute> & Contract;
}
