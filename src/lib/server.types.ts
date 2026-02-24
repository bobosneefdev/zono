import type z from "zod";
import type { Contract, ContractMethod, ContractMethodMap } from "~/contract/contract.types.js";
import type { PossiblePromise } from "~/lib/util.types.js";

type EmptyObject = object;

type SchemaInput<TSchema> = TSchema extends z.ZodType ? z.input<TSchema> : never;

type SchemaOutput<TSchema> = TSchema extends z.ZodType ? z.output<TSchema> : never;

type IncludePathParams<TContract extends Contract> = TContract["pathParams"] extends z.ZodType
	? { pathParams: SchemaInput<TContract["pathParams"]> }
	: EmptyObject;

type IncludeBody<TContract extends Contract> = TContract["body"] extends z.ZodType
	? { body: SchemaInput<TContract["body"]> }
	: EmptyObject;

type IncludeQuery<TContract extends Contract> = TContract["query"] extends z.ZodType
	? { query: SchemaInput<TContract["query"]> }
	: EmptyObject;

type IncludeHeaders<TContract extends Contract> = TContract["headers"] extends z.ZodType
	? { headers: SchemaInput<TContract["headers"]> }
	: EmptyObject;

export type ServerHandlerInput<TContract extends Contract> = IncludePathParams<TContract> &
	IncludeBody<TContract> &
	IncludeQuery<TContract> &
	IncludeHeaders<TContract>;

type ContractResponseStatuses<TContract extends Contract> = Extract<
	keyof TContract["responses"],
	number
>;

type ResponseBodyForStatus<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus] extends { body: infer TBody extends z.ZodType }
	? SchemaOutput<TBody>
	: undefined;

type ResponseContentTypeForStatus<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus]["contentType"];

type ResponseHeadersForStatus<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus]["headers"] extends z.ZodType
	? SchemaOutput<TContract["responses"][TStatus]["headers"]>
	: undefined;

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
	data: ServerHandlerInput<TContract>,
	...args: TParams
) => PossiblePromise<ServerHandlerOutput<TContract>>;

export type ServerHandlerGivenMethod<
	TContract extends ContractMethodMap,
	TParams extends Array<unknown>,
	TMethod extends keyof TContract,
> = ServerHandler<Extract<TContract[TMethod], Contract>, TParams>;

type ServerHandlerMethodMap<
	TContractMap extends ContractMethodMap,
	TParams extends Array<unknown>,
> = {
	[TMethod in ContractMethod as TContractMap[TMethod] extends Contract
		? TMethod
		: never]: ServerHandlerGivenMethod<TContractMap, TParams, TMethod>;
};

export type ServerHandlerTree<
	TRouter,
	TParams extends Array<unknown> = [],
	TNodeAnd extends Record<string, unknown> = Record<string, unknown>,
> = {
	[K in keyof TRouter]?: HandlerNode<TRouter[K], TParams, TNodeAnd>;
};

type HandlerNode<
	TNode,
	TParams extends Array<unknown>,
	TNodeAnd extends Record<string, unknown>,
> = TNode extends { CONTRACT: infer TContractMap extends ContractMethodMap }
	? { HANDLER: ServerHandlerMethodMap<TContractMap, TParams> } & TNodeAnd &
			(TNode extends { ROUTER: infer TRouter }
				? { ROUTER: ServerHandlerTree<TRouter, TParams, TNodeAnd> }
				: { ROUTER?: undefined })
	: TNode extends { ROUTER: infer TRouter }
		? { ROUTER: ServerHandlerTree<TRouter, TParams, TNodeAnd> } & TNodeAnd
		: TNode extends Record<string, unknown>
			? ServerHandlerTree<TNode, TParams, TNodeAnd>
			: never;

export type ServerOptionsBase<
	TInParams extends Array<unknown>,
	TOutParams extends Array<unknown>,
> = {
	bypassIncomingParse?: boolean;
	bypassOutgoingParse?: boolean;
	transformParams?: (...args: TInParams) => TOutParams;
};
