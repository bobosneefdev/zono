import type { ExactObjectDeep } from "~/internal/util.types.js";
import type { MiddlewaresDefinition } from "~/middleware/middleware.types.js";

/**
 * Creates a type-safe middlewares definition matching a contract definition.
 * @param _contracts - Contract definition (used for type inference only)
 * @param definition - Middlewares definition with response contracts
 * @returns The middlewares definition with type validation
 */
export function createMiddlewares<
	const TContracts,
	const TDef extends MiddlewaresDefinition<TContracts>,
>(
	_contracts: TContracts,
	definition: TDef & ExactObjectDeep<TDef, MiddlewaresDefinition<TContracts>>,
): TDef {
	return definition;
}
