import z from "zod";
import type { Contract, ContractMethod } from "~/contract/contract.types.js";
import type { ServerHandlerInput } from "~/lib/server.types.js";
import type { PossiblePromise } from "~/lib/util.types.js";
import type {
	RouterContractGivenPath,
	RouterContractGivenPathAndMethod,
	RouterMethodGivenPath,
	RouterPath,
} from "~/router/router.resolve.types.js";

export type ClientMethodRoute<TRouter, TMethod extends ContractMethod> = {
	[TPath in RouterPath<TRouter>]: TMethod extends RouterMethodGivenPath<TRouter, TPath>
		? TPath
		: never;
}[RouterPath<TRouter>];

type SchemaOutput<TSchema> = TSchema extends z.ZodType ? z.output<TSchema> : never;

export type ClientRequestInput<TContract extends Contract> = ServerHandlerInput<TContract>;

export type ClientRequestInputGivenPath<
	TRouter,
	TPath extends RouterPath<TRouter>,
> = ClientRequestInput<RouterContractGivenPath<TRouter, TPath>>;

export type ClientRequestGivenMethodAndPath<
	TRouter,
	TMethod extends ContractMethod,
	TPath extends ClientMethodRoute<TRouter, TMethod>,
> = ClientRequestInput<RouterContractGivenPathAndMethod<TRouter, TPath, TMethod>>;

type ContractResponseStatuses<TContract extends Contract> = Extract<
	keyof TContract["responses"],
	number
>;

type ParsedBodyForStatus<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus] extends { body: infer TBody extends z.ZodType }
	? SchemaOutput<TBody>
	: undefined;

type ParsedHeadersForStatus<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus]["headers"] extends z.ZodType
	? SchemaOutput<TContract["responses"][TStatus]["headers"]>
	: undefined;

export type ParsedResponseGivenContract<TContract extends Contract> = {
	[TStatus in ContractResponseStatuses<TContract>]: {
		status: TStatus;
		body: ParsedBodyForStatus<TContract, TStatus>;
		headers: ParsedHeadersForStatus<TContract, TStatus>;
		response: Response;
	};
}[ContractResponseStatuses<TContract>];

export type ParsedResponseGivenPath<
	TRouter,
	TPath extends RouterPath<TRouter>,
> = ParsedResponseGivenContract<RouterContractGivenPath<TRouter, TPath>>;

export type ParsedResponseGivenMethodAndPath<
	TRouter,
	TMethod extends ContractMethod,
	TPath extends RouterPath<TRouter>,
> = ParsedResponseGivenContract<RouterContractGivenPathAndMethod<TRouter, TPath, TMethod>>;

type ClientMethodRequestArgs<
	TRouter,
	TMethod extends ContractMethod,
	TRoute extends ClientMethodRoute<TRouter, TMethod>,
> = keyof ClientRequestGivenMethodAndPath<TRouter, TMethod, TRoute> extends never
	? [request?: ClientRequestGivenMethodAndPath<TRouter, TMethod, TRoute>]
	: [request: ClientRequestGivenMethodAndPath<TRouter, TMethod, TRoute>];

export type ClientOptionsDefaultHeaderValue = string | (() => PossiblePromise<string>);

export type ClientOptions = {
	baseUrl: string;
	bypassOutgoingParse?: boolean;
	bypassIncomingParse?: boolean;
	defaultHeaders?: Record<string, ClientOptionsDefaultHeaderValue>;
};

export interface Client<TRouter> {
	get<TRoute extends ClientMethodRoute<TRouter, "get">>(
		route: TRoute,
		...args: ClientMethodRequestArgs<TRouter, "get", TRoute>
	): Promise<ParsedResponseGivenMethodAndPath<TRouter, "get", TRoute>>;

	post<TRoute extends ClientMethodRoute<TRouter, "post">>(
		route: TRoute,
		...args: ClientMethodRequestArgs<TRouter, "post", TRoute>
	): Promise<ParsedResponseGivenMethodAndPath<TRouter, "post", TRoute>>;

	put<TRoute extends ClientMethodRoute<TRouter, "put">>(
		route: TRoute,
		...args: ClientMethodRequestArgs<TRouter, "put", TRoute>
	): Promise<ParsedResponseGivenMethodAndPath<TRouter, "put", TRoute>>;

	delete<TRoute extends ClientMethodRoute<TRouter, "delete">>(
		route: TRoute,
		...args: ClientMethodRequestArgs<TRouter, "delete", TRoute>
	): Promise<ParsedResponseGivenMethodAndPath<TRouter, "delete", TRoute>>;

	patch<TRoute extends ClientMethodRoute<TRouter, "patch">>(
		route: TRoute,
		...args: ClientMethodRequestArgs<TRouter, "patch", TRoute>
	): Promise<ParsedResponseGivenMethodAndPath<TRouter, "patch", TRoute>>;

	options<TRoute extends ClientMethodRoute<TRouter, "options">>(
		route: TRoute,
		...args: ClientMethodRequestArgs<TRouter, "options", TRoute>
	): Promise<ParsedResponseGivenMethodAndPath<TRouter, "options", TRoute>>;

	head<TRoute extends ClientMethodRoute<TRouter, "head">>(
		route: TRoute,
		...args: ClientMethodRequestArgs<TRouter, "head", TRoute>
	): Promise<ParsedResponseGivenMethodAndPath<TRouter, "head", TRoute>>;

	parseResponse<
		TMethod extends ContractMethod,
		TRoute extends ClientMethodRoute<TRouter, TMethod>,
	>(
		method: TMethod,
		route: TRoute,
		response: Response,
	): Promise<ParsedResponseGivenMethodAndPath<TRouter, TMethod, TRoute>>;
}
