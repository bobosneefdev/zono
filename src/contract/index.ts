import { Router, RouterShape } from "./types.js";

export function createRouter<
	TShape extends RouterShape,
	TRouter extends Router<TShape> = Router<TShape>,
>(_shape: TShape, router: TRouter): TRouter {
	return router;
}

export * from "./types.js";
