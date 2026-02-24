import type { Context, MiddlewareHandler } from "hono";
import type { ServerHandlerTree, ServerOptionsBase } from "~/lib/server.types.js";

export type InitHonoHandlers<
	TRouter,
	TParams extends Array<unknown> = [Context],
> = ServerHandlerTree<TRouter, TParams, { MIDDLEWARE?: Array<MiddlewareHandler> }>;

export type InitHonoOptions<TParams extends Array<unknown> = [Context]> = ServerOptionsBase<
	[Context],
	TParams
> & {
	globalMiddleware?: Array<MiddlewareHandler>;
};
