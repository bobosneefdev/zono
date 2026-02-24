import z from "zod";
import type { Contract, ContractMethod } from "~/contract/types.js";
import type {
	ContractForRoutePath,
	ContractForRoutePathMethod,
	ContractMethodsForRoutePath,
	RouterRoutePath,
} from "~/lib/route_types.js";
import type { ServerHandlerInput } from "~/lib/server_types.js";
import type { PossiblePromise } from "~/lib/types.js";

export type ClientRoute<TRouter> = RouterRoutePath<TRouter>;

export type ContractForRoute<TRouter, TRoute extends ClientRoute<TRouter>> = ContractForRoutePath<
	TRouter,
	TRoute
>;

export type ContractForRouteMethod<
	TRouter,
	TRoute extends ClientRoute<TRouter>,
	TMethod extends ContractMethod,
> = ContractForRoutePathMethod<TRouter, TRoute, TMethod>;

export type ClientMethodRoute<TRouter, TMethod extends ContractMethod> = {
	[TRoute in ClientRoute<TRouter>]: TMethod extends ContractMethodsForRoutePath<TRouter, TRoute>
		? TRoute
		: never;
}[ClientRoute<TRouter>];

type SchemaOutput<TSchema> = TSchema extends z.ZodType ? z.output<TSchema> : never;

export type ClientRequestInput<TContract extends Contract> = ServerHandlerInput<TContract>;

export type ClientRequestForRoute<
	TRouter,
	TRoute extends ClientRoute<TRouter>,
> = ClientRequestInput<ContractForRoute<TRouter, TRoute>>;

export type ClientRequestForRouteMethod<
	TRouter,
	TMethod extends ContractMethod,
	TRoute extends ClientMethodRoute<TRouter, TMethod>,
> = ClientRequestInput<ContractForRouteMethod<TRouter, TRoute, TMethod>>;

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

export type ParsedResponseForRouteMethod<
	TRouter,
	TMethod extends ContractMethod,
	TRoute extends ClientMethodRoute<TRouter, TMethod>,
> = ParsedResponseForContract<ContractForRouteMethod<TRouter, TRoute, TMethod>>;

type ClientMethodRequestArgs<
	TRouter,
	TMethod extends ContractMethod,
	TRoute extends ClientMethodRoute<TRouter, TMethod>,
> = keyof ClientRequestForRouteMethod<TRouter, TMethod, TRoute> extends never
	? [request?: ClientRequestForRouteMethod<TRouter, TMethod, TRoute>]
	: [request: ClientRequestForRouteMethod<TRouter, TMethod, TRoute>];

export type HeaderFactoryValue = string | (() => PossiblePromise<string>);

export type ClientOptions = {
	baseUrl: string;
	bypassOutgoingParse?: boolean;
	bypassIncomingParse?: boolean;
	defaultHeaders?: Record<string, HeaderFactoryValue>;
};

export interface Client<TRouter> {
	get<TRoute extends ClientMethodRoute<TRouter, "get">>(
		route: TRoute,
		...args: ClientMethodRequestArgs<TRouter, "get", TRoute>
	): Promise<ParsedResponseForRouteMethod<TRouter, "get", TRoute>>;

	post<TRoute extends ClientMethodRoute<TRouter, "post">>(
		route: TRoute,
		...args: ClientMethodRequestArgs<TRouter, "post", TRoute>
	): Promise<ParsedResponseForRouteMethod<TRouter, "post", TRoute>>;

	put<TRoute extends ClientMethodRoute<TRouter, "put">>(
		route: TRoute,
		...args: ClientMethodRequestArgs<TRouter, "put", TRoute>
	): Promise<ParsedResponseForRouteMethod<TRouter, "put", TRoute>>;

	delete<TRoute extends ClientMethodRoute<TRouter, "delete">>(
		route: TRoute,
		...args: ClientMethodRequestArgs<TRouter, "delete", TRoute>
	): Promise<ParsedResponseForRouteMethod<TRouter, "delete", TRoute>>;

	patch<TRoute extends ClientMethodRoute<TRouter, "patch">>(
		route: TRoute,
		...args: ClientMethodRequestArgs<TRouter, "patch", TRoute>
	): Promise<ParsedResponseForRouteMethod<TRouter, "patch", TRoute>>;

	options<TRoute extends ClientMethodRoute<TRouter, "options">>(
		route: TRoute,
		...args: ClientMethodRequestArgs<TRouter, "options", TRoute>
	): Promise<ParsedResponseForRouteMethod<TRouter, "options", TRoute>>;

	head<TRoute extends ClientMethodRoute<TRouter, "head">>(
		route: TRoute,
		...args: ClientMethodRequestArgs<TRouter, "head", TRoute>
	): Promise<ParsedResponseForRouteMethod<TRouter, "head", TRoute>>;

	parseResponse<
		TMethod extends ContractMethod,
		TRoute extends ClientMethodRoute<TRouter, TMethod>,
	>(
		method: TMethod,
		route: TRoute,
		response: Response,
	): Promise<ParsedResponseForRouteMethod<TRouter, TMethod, TRoute>>;
}
