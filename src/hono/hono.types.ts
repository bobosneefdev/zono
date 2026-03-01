import type { Context, TypedResponse } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import type z from "zod";
import type { ErrorMode } from "~/contract/contract.error.js";
import type { ContractOutput } from "~/contract/contract.io.js";
import type {
	Contract,
	ContractMethod,
	ContractMethodMap,
	ContractResponseStatuses,
	ContractResponses,
} from "~/contract/contract.types.js";
import type {
	PossiblePromise,
	ResponseBodyForStatus,
	SchemaHttpSafeInput,
} from "~/internal/util.types.js";
import type { MiddlewareContractMap } from "~/middleware/middleware.types.js";

export type HonoContextParams = ReadonlyArray<unknown>;

type MutableContextParams<TContextParams extends HonoContextParams> = [...TContextParams];

export type AdditionalHandlerParamsFn<TContextParams extends HonoContextParams = []> = (
	ctx: Context,
) => PossiblePromise<TContextParams>;

export type InferAdditionalHandlerParams<T extends AdditionalHandlerParamsFn<HonoContextParams>> =
	Awaited<ReturnType<T>>;

export type HonoContractTypedResponse<TContract extends Contract> = {
	[TStatus in ContractResponseStatuses<TContract>]: TypedResponse<
		ResponseBodyForStatus<TContract, TStatus>,
		TStatus & StatusCode
	>;
}[ContractResponseStatuses<TContract>];

export type HonoMiddlewareTypedResponse<TResponses extends ContractResponses> = {
	[S in Extract<keyof TResponses, number>]: TypedResponse<
		TResponses[S] extends { schema: infer TSchema extends z.ZodType }
			? SchemaHttpSafeInput<TSchema>
			: undefined,
		S & StatusCode
	>;
}[Extract<keyof TResponses, number>];

export type HonoHandler<
	TContract extends Contract,
	TContextParams extends HonoContextParams = [],
> = (
	input: ContractOutput<TContract>,
	ctx: Context,
	...contextParams: MutableContextParams<TContextParams>
) => PossiblePromise<HonoContractTypedResponse<TContract>>;

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
			...contextParams: MutableContextParams<TContextParams>
	  ) => PossiblePromise<void | HonoMiddlewareTypedResponse<TResponses>>);

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

export type HonoOptionsWithAdditionalHandlerParams<
	TAdditionalHandlerParams extends AdditionalHandlerParamsFn<HonoContextParams>,
> = HonoOptions<InferAdditionalHandlerParams<TAdditionalHandlerParams>> & {
	additionalHandlerParams: TAdditionalHandlerParams;
};

/** Infers TContextParams from additionalHandlerParams when present, otherwise [] */
export type InferredHandlerParams<O> = O extends {
	additionalHandlerParams: AdditionalHandlerParamsFn<infer R>;
}
	? R
	: [];
