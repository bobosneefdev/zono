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

export type AdditionalHandlerParamsFn<TContextParams extends HonoContextParams = []> = (
	ctx: Context,
) => PossiblePromise<TContextParams>;

export type InferAdditionalHandlerParams<T extends AdditionalHandlerParamsFn> = Awaited<
	ReturnType<T>
>;

export type HonoHandler<
	TContract extends Contract,
	TContextParams extends HonoContextParams = [],
> = (
	input: ContractOutput<TContract>,
	ctx: Context,
	...contextParams: TContextParams
) => PossiblePromise<ServerHandlerOutput<TContract>>;

export type HonoHandlerMethodMap<
	TContractMap extends ContractMethodMap,
	TContextParams extends HonoContextParams = [],
> = {
	[M in ContractMethod as TContractMap[M] extends Contract ? M : never]: HonoHandler<
		Extract<TContractMap[M], Contract>,
		TContextParams
	>;
};

type HonoRouteHandlerNode<TNode, TContextParams extends HonoContextParams = []> = (TNode extends {
	CONTRACT: infer C extends ContractMethodMap;
}
	? { HANDLER: HonoHandlerMethodMap<C, TContextParams> }
	: unknown) &
	(TNode extends { ROUTER: infer R extends Record<string, unknown> }
		? { ROUTER: { [K in keyof R]: HonoRouteHandlerNode<R[K], TContextParams> } }
		: unknown);

export type HonoRouteHandlerTree<
	TRoutes,
	TContextParams extends HonoContextParams = [],
> = TRoutes extends {
	ROUTER: infer R extends Record<string, unknown>;
}
	? { ROUTER: { [K in keyof R]: HonoRouteHandlerNode<R[K], TContextParams> } }
	: never;

export type HonoMiddlewareHandler<
	TResponses extends ContractResponses,
	TContextParams extends HonoContextParams = [],
> =
	| null
	| ((
			ctx: Context,
			next: () => Promise<void>,
			...contextParams: TContextParams
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
	TContextParams extends HonoContextParams = [],
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
};

export type HonoOptions<TContextParams extends HonoContextParams = []> = HonoOptionsBase & {
	additionalHandlerParams?: AdditionalHandlerParamsFn<TContextParams>;
};

/** Infers TContextParams from additionalHandlerParams when present, otherwise [] */
export type InferredHandlerParams<O> = O extends {
	additionalHandlerParams: AdditionalHandlerParamsFn<infer R>;
}
	? R
	: [];
