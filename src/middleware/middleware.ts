import type { MiddlewareDefinition } from "~/middleware/middleware.types.js";

export function createMiddleware<const TRoutes, const TDef extends MiddlewareDefinition<TRoutes>>(
	_routes: TRoutes,
	definition: TDef,
): TDef {
	return definition;
}
