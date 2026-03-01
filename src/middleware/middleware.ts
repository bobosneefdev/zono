import type { MiddlewareDefinition } from "~/middleware/middleware.types.js";

/**
 * Creates a type-safe middleware definition matching a route definition.
 * Validates that middleware structure matches the route structure.
 * @param _routes - Route definition (used for type inference only)
 * @param definition - Middleware definition with response contracts
 * @returns The middleware definition with type validation
 */
export function createMiddleware<const TRoutes, const TDef extends MiddlewareDefinition<TRoutes>>(
	_routes: TRoutes,
	definition: TDef,
): TDef {
	return definition;
}
