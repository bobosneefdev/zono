import z from "zod";
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
	ResponseHeadersForStatus,
	SchemaInput,
} from "~/internal/util.types.js";
import type { MiddlewareContractMap } from "~/router/router.types.js";

/** Return type for typed middleware - always { status, data } */
export type MiddlewareReturn<TResponses extends ContractResponses> = {
	[S in Extract<keyof TResponses, number>]: {
		status: S;
	} & (TResponses[S] extends { schema: infer TSchema extends z.ZodType }
		? { data: SchemaInput<TSchema> }
		: { data?: undefined });
}[Extract<keyof TResponses, number>];

/** Typed middleware handler - returns void to continue, or { status, data } to short-circuit */
export type TypedMiddlewareHandler<TResponses extends ContractResponses, TContext> =
	| null
	| ((
			ctx: TContext,
			next: () => Promise<void>,
	  ) => PossiblePromise<void | MiddlewareReturn<TResponses>>);

/** Maps middleware names to typed handlers (or null for external middleware) */
export type TypedMiddlewareHandlers<TMiddlewareMap extends MiddlewareContractMap, TContext> = {
	[K in keyof TMiddlewareMap]?: TypedMiddlewareHandler<TMiddlewareMap[K], TContext> | null;
};

type ResponseContentTypeForStatus<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus]["contentType"];

type IncludeOutputData<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = ResponseContentTypeForStatus<TContract, TStatus> extends null
	? { data?: undefined }
	: { data: ResponseBodyForStatus<TContract, TStatus> };

type IncludeOutputHeaders<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = ResponseHeadersForStatus<TContract, TStatus> extends undefined
	? { headers?: undefined }
	: { headers: ResponseHeadersForStatus<TContract, TStatus> };

export type ServerHandlerOutputOptions = {
	bypassOutgoingParse?: boolean;
};

export type ServerHandlerOutput<TContract extends Contract> = {
	[TStatus in ContractResponseStatuses<TContract>]: {
		status: TStatus;
		opts?: ServerHandlerOutputOptions;
	} & IncludeOutputData<TContract, TStatus> &
		IncludeOutputHeaders<TContract, TStatus>;
}[ContractResponseStatuses<TContract>];

export type ServerHandler<TContract extends Contract, TParams extends Array<unknown> = []> = (
	data: ContractOutput<TContract>,
	...args: TParams
) => PossiblePromise<ServerHandlerOutput<TContract>>;

export type ServerHandlerGivenMethod<
	TContract extends ContractMethodMap,
	TParams extends Array<unknown>,
	TMethod extends keyof TContract,
> = ServerHandler<Extract<TContract[TMethod], Contract>, TParams>;

export type ServerHandlerMethodMap<
	TContractMap extends ContractMethodMap,
	TParams extends Array<unknown>,
> = {
	[TMethod in ContractMethod as TContractMap[TMethod] extends Contract
		? TMethod
		: never]: ServerHandlerGivenMethod<TContractMap, TParams, TMethod>;
};

export type ServerHandlerTree<TRouter, TParams extends Array<unknown> = []> = {
	[K in keyof TRouter]?: K extends "MIDDLEWARE"
		? NonNullable<TRouter[K]> extends MiddlewareContractMap
			? TypedMiddlewareHandlers<NonNullable<TRouter[K]>, FirstParam<TParams>>
			: never
		: HandlerNode<TRouter[K], TParams>;
};

type FirstParam<TParams extends Array<unknown>> = TParams extends [infer C, ...Array<unknown>]
	? C
	: unknown;

type MiddlewareAndForNode<TNode, TParams extends Array<unknown>> = TNode extends {
	MIDDLEWARE?: infer M;
}
	? NonNullable<M> extends MiddlewareContractMap
		? { MIDDLEWARE?: TypedMiddlewareHandlers<NonNullable<M>, FirstParam<TParams>> }
		: Record<string, never>
	: Record<string, never>;

type HandlerNode<TNode, TParams extends Array<unknown>> = TNode extends {
	CONTRACT: infer TContractMap extends ContractMethodMap;
}
	? { HANDLER: ServerHandlerMethodMap<TContractMap, TParams> } & MiddlewareAndForNode<
			TNode,
			TParams
		> &
			(TNode extends { ROUTER: infer TRouter }
				? { ROUTER: ServerHandlerTree<TRouter, TParams> }
				: { ROUTER?: undefined })
	: TNode extends { ROUTER: infer TRouter }
		? { ROUTER: ServerHandlerTree<TRouter, TParams> } & MiddlewareAndForNode<TNode, TParams>
		: TNode extends Record<string, unknown>
			? ServerHandlerTree<TNode, TParams>
			: never;

export type ServerOptionsBase<
	TInParams extends Array<unknown>,
	TOutParams extends Array<unknown>,
> = {
	bypassIncomingParse?: boolean;
	bypassOutgoingParse?: boolean;
	errorMode?: ErrorMode;
	transformParams?: (...args: TInParams) => TOutParams;
};
