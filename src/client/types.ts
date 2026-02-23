import z from "zod";
import type { Contract } from "~/contract/types.js";
import type { ContractForRoutePath, RouterRoutePath } from "~/internal/route_types.js";
import type { ServerHandlerInput } from "~/internal/server_types.js";
import type { PossiblePromise } from "~/internal/types.js";

export type ClientRoute<TRouter> = RouterRoutePath<TRouter>;

export type ContractForRoute<TRouter, TRoute extends ClientRoute<TRouter>> = ContractForRoutePath<
	TRouter,
	TRoute
>;

type SchemaOutput<TSchema> = TSchema extends z.ZodType ? z.output<TSchema> : never;

export type ClientRequestInput<TContract extends Contract> = ServerHandlerInput<TContract>;

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
