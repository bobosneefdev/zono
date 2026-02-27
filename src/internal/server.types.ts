import type z from "zod";
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
	SchemaInput,
	SchemaOutput,
} from "~/internal/util.types.js";

export type ErrorMode = "public" | "hidden";

export type ValidationErrorBodyPublic = { issues: Array<z.core.$ZodIssue> };

export type ValidationErrorBodyHidden = { issues: number };

export type ValidationErrorBody<TMode extends ErrorMode> = TMode extends "public"
	? ValidationErrorBodyPublic
	: ValidationErrorBodyHidden;

type SchemaDir = "input" | "output";

type SchemaForDir<TSchema, TDir extends SchemaDir> = TDir extends "input"
	? SchemaInput<TSchema>
	: SchemaOutput<TSchema>;

type IncludePathParams<
	TContract extends Contract,
	TDir extends SchemaDir,
> = TContract["pathParams"] extends z.ZodType
	? { pathParams: SchemaForDir<TContract["pathParams"], TDir> }
	: object;

type IncludePayload<
	TContract extends Contract,
	TDir extends SchemaDir,
> = TContract["payload"] extends { schema: infer TSchema extends z.ZodType }
	? { payload: SchemaForDir<TSchema, TDir> }
	: object;

type IncludeQuery<TContract extends Contract, TDir extends SchemaDir> = TContract["query"] extends {
	schema: infer TSchema extends z.ZodType;
}
	? { query: SchemaForDir<TSchema, TDir> }
	: object;

type IncludeHeaders<
	TContract extends Contract,
	TDir extends SchemaDir,
> = TContract["headers"] extends z.ZodType
	? { headers: SchemaForDir<TContract["headers"], TDir> }
	: object;

export type ContractInput<TContract extends Contract> = IncludePathParams<TContract, "input"> &
	IncludePayload<TContract, "input"> &
	IncludeQuery<TContract, "input"> &
	IncludeHeaders<TContract, "input">;

export type ContractOutput<TContract extends Contract> = IncludePathParams<TContract, "output"> &
	IncludePayload<TContract, "output"> &
	IncludeQuery<TContract, "output"> &
	IncludeHeaders<TContract, "output">;

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
