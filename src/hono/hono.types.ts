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

/** Type for additional parameters passed to Hono handlers (e.g., from context) */
export type HonoContextParams = ReadonlyArray<unknown>;

type MutableContextParams<TContextParams extends HonoContextParams> = [...TContextParams];

/**
 * Function that extracts additional handler parameters from a Hono context.
 * @template TContextParams - The type of additional parameters to extract
 */
export type AdditionalHandlerParamsFn<TContextParams extends HonoContextParams = []> = (
	ctx: Context,
) => PossiblePromise<TContextParams>;

/**
 * Infers the additional handler parameter type from an AdditionalHandlerParamsFn.
 * @template T - The AdditionalHandlerParamsFn type to infer from
 */
export type InferAdditionalHandlerParams<T extends AdditionalHandlerParamsFn<HonoContextParams>> =
	Awaited<ReturnType<T>>;

/**
 * Hono TypedResponse type for contract responses.
 * Ensures type safety between the contract and Hono's response type.
 * @template TContract - The contract defining valid responses
 */
export type HonoContractTypedResponse<TContract extends Contract> = {
	[TStatus in ContractResponseStatuses<TContract>]: TypedResponse<
		ResponseBodyForStatus<TContract, TStatus>,
		TStatus & StatusCode
	>;
}[ContractResponseStatuses<TContract>];

/**
 * Hono TypedResponse type for middleware responses.
 * @template TResponses - Contract responses that middleware can return
 */
export type HonoMiddlewareTypedResponse<TResponses extends ContractResponses> = {
	[S in Extract<keyof TResponses, number>]: TypedResponse<
		TResponses[S] extends { schema: infer TSchema extends z.ZodType }
			? SchemaHttpSafeInput<TSchema>
			: undefined,
		S & StatusCode
	>;
}[Extract<keyof TResponses, number>];

/**
 * Handler type for Hono route handlers with contract type-safety.
 * @template TContract - The contract defining request/response types
 * @template TContextParams - Additional parameters extracted from context
 */
export type HonoHandler<
	TContract extends Contract,
	TContextParams extends HonoContextParams = [],
> = (
	input: ContractOutput<TContract>,
	ctx: Context,
	...contextParams: MutableContextParams<TContextParams>
) => PossiblePromise<HonoContractTypedResponse<TContract>>;

/**
 * Maps HTTP methods to their Hono handler types for a contract map.
 * @template TContractMap - The contract method map
 * @template TContextParams - Additional parameters extracted from context
 */
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

/**
 * Tree structure for Hono route handlers matching a route definition.
 * Provides type-safe handler structure for routes.
 * @template TRoutes - The route definition type
 * @template TContextParams - Additional parameters extracted from context
 */
export type HonoRouteHandlerTree<
	TRoutes,
	TContextParams extends HonoContextParams = [],
> = TRoutes extends {
	ROUTER: infer R extends Record<string, unknown>;
}
	? { ROUTER: { [K in keyof R]: HonoRouteHandlerNode<R[K], TContextParams> } }
	: never;

/**
 * Handler type for Hono middleware with contract type-safety.
 * Returns void to continue, or a response to short-circuit the request.
 * @template TResponses - Contract responses that middleware can return
 * @template TContextParams - Additional parameters extracted from context
 */
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

/**
 * Tree structure for Hono middleware handlers matching a middleware definition.
 * @template TMiddleware - The middleware definition type
 * @template TContextParams - Additional parameters extracted from context
 */
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

/**
 * Configuration options for creating a Hono server.
 * @template TContextParams - Additional parameters extracted from context
 */
export type HonoOptions<TContextParams extends HonoContextParams = []> = HonoOptionsBase & {
	additionalHandlerParams?: AdditionalHandlerParamsFn<TContextParams>;
};

/**
 * Hono options with required additional handler params function.
 * @template TAdditionalHandlerParams - The AdditionalHandlerParamsFn type
 */
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
