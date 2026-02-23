import z from "zod";
import type { Contract } from "~/contract/types.js";
import type { JoinPath, PossiblePromise } from "~/internal/types.js";

type EmptyObject = object;

type DotPathToRoutePath<TPath extends string> = TPath extends `${infer TSegment}.${infer TRest}`
	? `/${TSegment}${DotPathToRoutePath<TRest>}`
	: `/${TPath}`;

type StripLeadingSlash<TPath extends string> = TPath extends `/${infer TRest}` ? TRest : TPath;

type RoutePathToDotPath<TPath extends string> =
	StripLeadingSlash<TPath> extends `${infer TSegment}/${infer TRest}`
		? `${TSegment}.${RoutePathToDotPath<TRest>}`
		: StripLeadingSlash<TPath>;

type RoutePathsFromNode<TNode, TPrefix extends string = ""> = TNode extends {
	contract: Contract;
}
	?
			| DotPathToRoutePath<TPrefix>
			| (TNode extends { router: infer TRouter }
					? RoutePathsFromNode<TRouter, TPrefix>
					: never)
	: TNode extends Record<string, unknown>
		? {
				[K in keyof TNode & string]: RoutePathsFromNode<TNode[K], JoinPath<TPrefix, K>>;
			}[keyof TNode & string]
		: never;

type ValueAtDotPath<TValue, TPath extends string> = TPath extends `${infer TSegment}.${infer TRest}`
	? TSegment extends keyof TValue
		? ValueAtDotPath<TValue[TSegment], TRest>
		: never
	: TPath extends keyof TValue
		? TValue[TPath]
		: never;

type NextNodeForPath<TNode> = TNode extends { router: infer TRouter } ? TRouter : TNode;

type ContractAtDotPath<
	TNode,
	TPath extends string,
> = TPath extends `${infer TSegment}.${infer TRest}`
	? TSegment extends keyof TNode
		? ContractAtDotPath<NextNodeForPath<TNode[TSegment]>, TRest>
		: never
	: TPath extends keyof TNode
		? ContractFromNode<TNode[TPath]>
		: never;

type ContractFromNode<TNode> = TNode extends { contract: infer TContract extends Contract }
	? TContract
	: never;

export type ClientRoute<TRouter> = RoutePathsFromNode<TRouter>;

export type ContractForRoute<TRouter, TRoute extends ClientRoute<TRouter>> = ContractFromNode<
	ValueAtDotPath<TRouter, RoutePathToDotPath<TRoute>>
> extends never
	? ContractAtDotPath<TRouter, RoutePathToDotPath<TRoute>>
	: ContractFromNode<ValueAtDotPath<TRouter, RoutePathToDotPath<TRoute>>>;

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

export type ClientRequestInput<TContract extends Contract> = IncludePathParams<TContract> &
	IncludeBody<TContract> &
	IncludeQuery<TContract> &
	IncludeHeaders<TContract>;

export type ClientRequestForRoute<
	TRouter,
	TRoute extends ClientRoute<TRouter>,
> = ClientRequestInput<ContractForRoute<TRouter, TRoute>>;

type ContractResponseStatuses<TContract extends Contract> = Extract<
	keyof TContract["responses"],
	number
>;

type ParsedBodyForStatus<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus]["body"] extends z.ZodType
	? SchemaOutput<TContract["responses"][TStatus]["body"]>
	: undefined;

type ParsedHeadersForStatus<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus]["headers"] extends z.ZodType
	? SchemaOutput<TContract["responses"][TStatus]["headers"]>
	: undefined;

export type ParsedResponseForContract<TContract extends Contract> = {
	[TStatus in ContractResponseStatuses<TContract>]: {
		status: TStatus;
		body: ParsedBodyForStatus<TContract, TStatus>;
		headers: ParsedHeadersForStatus<TContract, TStatus>;
		response: Response;
	};
}[ContractResponseStatuses<TContract>];

export type ParsedResponseForRoute<
	TRouter,
	TRoute extends ClientRoute<TRouter>,
> = ParsedResponseForContract<ContractForRoute<TRouter, TRoute>>;

export type HeaderFactoryValue = string | (() => PossiblePromise<string>);

export type ClientOptions = {
	baseUrl: string;
	bypassOutgoingParse?: boolean;
	bypassIncomingParse?: boolean;
	defaultHeaders?: Record<string, HeaderFactoryValue>;
};

export interface Client<TRouter> {
	fetch<TRoute extends ClientRoute<TRouter>>(
		route: TRoute,
		...args: keyof ClientRequestForRoute<TRouter, TRoute> extends never
			? [request?: ClientRequestForRoute<TRouter, TRoute>]
			: [request: ClientRequestForRoute<TRouter, TRoute>]
	): Promise<ParsedResponseForRoute<TRouter, TRoute>>;

	fetchConfig<TRoute extends ClientRoute<TRouter>>(
		route: TRoute,
		...args: keyof ClientRequestForRoute<TRouter, TRoute> extends never
			? [request?: ClientRequestForRoute<TRouter, TRoute>]
			: [request: ClientRequestForRoute<TRouter, TRoute>]
	): Promise<[string, RequestInit]>;

	parseResponse<TRoute extends ClientRoute<TRouter>>(
		route: TRoute,
		response: Response,
	): Promise<ParsedResponseForRoute<TRouter, TRoute>>;
}
