import type { Context } from "hono";
import type { ServerHandlerTree, ServerOptionsBase } from "~/internal/handler.types.js";

export type HonoHandlers<TRouter, TParams extends Array<unknown> = [Context]> = ServerHandlerTree<
	TRouter,
	TParams
>;

export type HonoOptions<TParams extends Array<unknown> = [Context]> = ServerOptionsBase<
	[Context],
	TParams
> & {
	basePath?: string;
};
