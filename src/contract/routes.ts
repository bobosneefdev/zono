import type { RouteDefinition } from "~/contract/routes.types.js";
import type { RouterShape } from "~/contract/shape.types.js";

export function createRoutes<
	const TShape extends RouterShape,
	const TDef extends RouteDefinition<TShape>,
>(_shape: TShape, definition: TDef): TDef {
	return definition;
}
