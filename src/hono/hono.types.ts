import type { Context } from "hono";
import type {
	Contract,
	ContractMethod,
	ContractMethodMap,
	ContractResponses,
	ErrorMode,
} from "~/contract/contract.types.js";
import type { ContractOutput } from "~/contract/contract.util.js";
import type { MiddlewareReturn, ServerHandlerOutput } from "~/internal/handler.types.js";
import type { PossiblePromise } from "~/internal/util.types.js";
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
 * Handler type for Hono route handlers with contract type-safety.
 * Returns a plain ServerHandlerOutput object rather than a Hono TypedResponse.
 * @template TContract - The contract defining request/response types
 * @template TContextParams - Additional parameters extracted from context
 */
export type HonoContractHandler<
	TContract extends Contract,
	TContextParams extends HonoContextParams = [],
> = (
	input: ContractOutput<TContract>,
	ctx: Context,
	...contextParams: MutableContextParams<TContextParams>
) => PossiblePromise<ServerHandlerOutput<TContract>>;

/**
 * Maps HTTP methods to their Hono handler types for a contract map.
 * @template TContractMap - The contract method map
 * @template TContextParams - Additional parameters extracted from context
 */
export type HonoContractHandlerMethodMap<
	TContractMap extends ContractMethodMap,
	TContextParams extends HonoContextParams = [],
> = {
	[M in ContractMethod as TContractMap[M] extends Contract ? M : never]: HonoContractHandler<
		Extract<TContractMap[M], Contract>,
		TContextParams
	>;
};

type HonoContractHandlerNode<
	TNode,
	TContextParams extends HonoContextParams = [],
> = (TNode extends {
	CONTRACT: infer C extends ContractMethodMap;
}
	? { HANDLER: HonoContractHandlerMethodMap<C, TContextParams> }
	: unknown) &
	(TNode extends { ROUTER: infer R extends Record<string, unknown> }
		? { ROUTER: { [K in keyof R]: HonoContractHandlerNode<R[K], TContextParams> } }
		: unknown);

/**
 * Tree structure for Hono route handlers matching a contract definition.
 * @template TContracts - The contract definition type
 * @template TContextParams - Additional parameters extracted from context
 */
export type HonoContractHandlerTree<
	TContracts,
	TContextParams extends HonoContextParams = [],
> = TContracts extends {
	ROUTER: infer R extends Record<string, unknown>;
}
	? { ROUTER: { [K in keyof R]: HonoContractHandlerNode<R[K], TContextParams> } }
	: never;

/**
 * Handler type for Hono middleware with contract type-safety.
 * Returns void to continue, a Response to passthrough, or MiddlewareReturn to short-circuit.
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
	  ) => PossiblePromise<void | Response | MiddlewareReturn<TResponses>>);

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
 * Tree structure for Hono middleware handlers matching a middlewares definition.
 * @template TMiddleware - The middlewares definition type
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
