import type { Context } from "hono";
import type z from "zod";
import type { Contract } from "~/contract/types.js";
import type { PossiblePromise } from "~/internal/types.js";

type EmptyObject = object;

type SchemaInput<TSchema> = TSchema extends z.ZodType ? z.input<TSchema> : never;

type SchemaOutput<TSchema> = TSchema extends z.ZodType ? z.output<TSchema> : never;

type IncludePathParams<TContract extends Contract> =
	NonNullable<TContract["pathParams"]> extends z.ZodType
		? { pathParams: SchemaInput<NonNullable<TContract["pathParams"]>> }
		: EmptyObject;

type IncludeBody<TContract extends Contract> =
	NonNullable<TContract["body"]> extends z.ZodType
		? { body: SchemaInput<NonNullable<TContract["body"]>> }
		: EmptyObject;

type IncludeQuery<TContract extends Contract> =
	NonNullable<TContract["query"]> extends z.ZodType
		? { query: SchemaInput<NonNullable<TContract["query"]>> }
		: EmptyObject;

type IncludeHeaders<TContract extends Contract> =
	NonNullable<TContract["headers"]> extends z.ZodType
		? { headers: SchemaInput<NonNullable<TContract["headers"]>> }
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
> = TContract["responses"][TStatus]["body"] extends z.ZodType
	? SchemaOutput<TContract["responses"][TStatus]["body"]>
	: undefined;

type ResponseHeadersForStatus<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus]["headers"] extends z.ZodType
	? SchemaOutput<TContract["responses"][TStatus]["headers"]>
	: undefined;

type IncludeOutputData<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = ResponseBodyForStatus<TContract, TStatus> extends undefined
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

export type ServerHandler<
	TContract extends Contract,
	TParams extends Array<unknown> = [Context],
> = (
	data: ServerHandlerInput<TContract>,
	...args: TParams
) => PossiblePromise<ServerHandlerOutput<TContract>>;

type HandlerNode<TNode, TParams extends Array<unknown>> = TNode extends {
	contract: infer TContract extends Contract;
}
	? {
			handler: ServerHandler<TContract, TParams>;
		} & (TNode extends { router: infer TRouter }
			? { router: ServerHandlerTree<TRouter, TParams> }
			: { router?: undefined })
	: TNode extends Record<string, unknown>
		? ServerHandlerTree<TNode, TParams>
		: never;

export type ServerHandlerTree<TRouter, TParams extends Array<unknown> = [Context]> = {
	[K in keyof TRouter]: HandlerNode<TRouter[K], TParams>;
};

export type InitHonoOptions<TParams extends Array<unknown> = [Context]> = {
	bypassIncomingParse?: boolean;
	getHandlerParams?: (context: Context) => TParams;
};
