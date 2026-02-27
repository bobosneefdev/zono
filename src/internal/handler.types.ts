import type { ErrorMode } from "~/contract/contract.error.js";
import type { ContractOutput } from "~/contract/contract.io.js";
import type {
	Contract,
	ContractMethod,
	ContractMethodMap,
	ContractResponseStatuses,
} from "~/contract/contract.types.js";
import type {
	PossiblePromise,
	ResponseBodyForStatus,
	ResponseHeadersForStatus,
} from "~/internal/util.types.js";

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
	errorMode?: ErrorMode;
	transformParams?: (...args: TInParams) => TOutParams;
};
