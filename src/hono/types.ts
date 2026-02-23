import type { Context } from "hono";
import type { Contract } from "~/contract/types.js";
import type {
	ServerHandler,
	ServerHandlerInput,
	ServerHandlerOutput,
	ServerHandlerOutputOptions,
	ServerHandlerTree,
} from "~/internal/server_types.js";

export type {
	ServerHandler,
	ServerHandlerInput,
	ServerHandlerOutput,
	ServerHandlerOutputOptions,
	ServerHandlerTree,
};

export type HonoServerHandler<
	TContract extends Contract,
	TParams extends Array<unknown> = [Context],
> = ServerHandler<TContract, TParams>;

export type HonoServerHandlerTree<
	TRouter,
	TParams extends Array<unknown> = [Context],
> = ServerHandlerTree<TRouter, TParams>;

export type InitHonoOptions<TParams extends Array<unknown> = [Context]> = {
	bypassIncomingParse?: boolean;
	bypassOutgoingParse?: boolean;
	getHandlerParams?: (context: Context) => TParams;
};
