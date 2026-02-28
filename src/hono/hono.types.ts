import type { Context } from "hono";
import type { ErrorMode } from "~/contract/contract.error.js";
import type { ContractOutput } from "~/contract/contract.io.js";
import type {
	Contract,
	ContractMethod,
	ContractMethodMap,
	ContractResponses,
} from "~/contract/contract.types.js";
import type { ServerHandlerOutput } from "~/internal/handler.types.js";
import type { PossiblePromise } from "~/internal/util.types.js";
import type { MiddlewareContractMap } from "~/middleware/middleware.types.js";

export type HonoContextParams = ReadonlyArray<unknown>;

export type HonoHandler<
	TContract extends Contract,
	TContextParams extends HonoContextParams = [Context],
> = (
	input: ContractOutput<TContract>,
	...contextParams: TContextParams
) => PossiblePromise<ServerHandlerOutput<TContract>>;

export type HonoHandlerMethodMap<
	TContractMap extends ContractMethodMap,
	TContextParams extends HonoContextParams = [Context],
> = {
	[M in ContractMethod as TContractMap[M] extends Contract ? M : never]: HonoHandler<
		Extract<TContractMap[M], Contract>,
		TContextParams
	>;
};

type HonoRouteHandlerNode<
	TNode,
	TContextParams extends HonoContextParams = [Context],
> = (TNode extends {
	CONTRACT: infer C extends ContractMethodMap;
}
	? { HANDLER: HonoHandlerMethodMap<C, TContextParams> }
	: unknown) &
	(TNode extends { ROUTER: infer R extends Record<string, unknown> }
		? { ROUTER: { [K in keyof R]: HonoRouteHandlerNode<R[K], TContextParams> } }
		: unknown);

export type HonoRouteHandlerTree<
	TRoutes,
	TContextParams extends HonoContextParams = [Context],
> = TRoutes extends {
	ROUTER: infer R extends Record<string, unknown>;
}
	? { ROUTER: { [K in keyof R]: HonoRouteHandlerNode<R[K], TContextParams> } }
	: never;

export type HonoMiddlewareHandler<
	TResponses extends ContractResponses,
	TContextParams extends HonoContextParams = [Context],
> =
	| null
	| ((
			...contextParamsAndNext: [...contextParams: TContextParams, next: () => Promise<void>]
	  ) => PossiblePromise<void | HonoMiddlewareReturn<TResponses>>);

export type HonoMiddlewareReturn<TResponses extends ContractResponses> = {
	[S in Extract<keyof TResponses, number>]: {
		status: S;
	} & (TResponses[S] extends { contentType: infer CT; schema: infer _TSchema }
		? { contentType: CT; body: unknown }
		: { contentType?: undefined; body?: undefined });
}[Extract<keyof TResponses, number>];

type HonoMiddlewareHandlersMap<
	TMap extends MiddlewareContractMap,
	TContextParams extends HonoContextParams,
> = {
	[K in keyof TMap]: HonoMiddlewareHandler<TMap[K], TContextParams>;
};

type HonoMiddlewareHandlerNode<TNode, TContextParams extends HonoContextParams> = (TNode extends {
	MIDDLEWARE: infer M extends MiddlewareContractMap;
}
	? { MIDDLEWARE: HonoMiddlewareHandlersMap<M, TContextParams> }
	: unknown) &
	(TNode extends { ROUTER: infer R extends Record<string, unknown> }
		? { ROUTER?: { [K in keyof R]?: HonoMiddlewareHandlerNode<R[K], TContextParams> } }
		: unknown);

export type HonoMiddlewareHandlerTree<
	TMiddleware,
	TContextParams extends HonoContextParams = [Context],
> = (TMiddleware extends {
	MIDDLEWARE: infer M extends MiddlewareContractMap;
}
	? { MIDDLEWARE: HonoMiddlewareHandlersMap<M, TContextParams> }
	: unknown) &
	(TMiddleware extends { ROUTER: infer R extends Record<string, unknown> }
		? { ROUTER?: { [K in keyof R]?: HonoMiddlewareHandlerNode<R[K], TContextParams> } }
		: unknown);

type HonoOptionsBase = {
	errorMode?: ErrorMode;
	basePath?: string;
	bypassIncomingParse?: boolean;
	bypassOutgoingParse?: boolean;
};

export type HonoOptionsWithTransform<TContextParams extends HonoContextParams = [Context]> =
	HonoOptionsBase & {
		transformContextParams: (params: [Context]) => PossiblePromise<TContextParams>;
	};

export type HonoOptionsWithoutTransform = HonoOptionsBase & {
	transformContextParams?: undefined;
};

export type HonoOptions<TContextParams extends HonoContextParams = [Context]> = HonoOptionsBase & {
	transformContextParams?: (params: [Context]) => PossiblePromise<TContextParams>;
};

/** Infers TContextParams from transformContextParams when present, otherwise [Context] */
export type InferredHandlerParams<O> = O extends {
	transformContextParams: (params: [Context]) => infer R;
}
	? Awaited<R>
	: [Context];
