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

export type ClientPathsAvailableGivenMethod<TRouter, TMethod extends ContractMethod> = {
	[TPath in RouterPath<TRouter>]: TMethod extends RouterMethodGivenPath<TRouter, TPath>
		? TPath
		: never;
}[RouterPath<TRouter>];

type SchemaOutput<TSchema> = TSchema extends z.ZodType ? z.output<TSchema> : never;

export type ClientRequestInput<TContract extends Contract> = ServerHandlerInput<TContract>;

export type ClientRequestInputGivenMethodAndPath<
	TRouter,
	TMethod extends ContractMethod,
	TPath extends ClientPathsAvailableGivenMethod<TRouter, TMethod>,
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

export type ClientOutput<TContract extends Contract> = {
	[TStatus in ContractResponseStatuses<TContract>]: {
		status: TStatus;
		body: ParsedBodyForStatus<TContract, TStatus>;
		headers: ParsedHeadersForStatus<TContract, TStatus>;
		response: Response;
	};
}[ContractResponseStatuses<TContract>];

export type ClientOutputGivenPath<TRouter, TPath extends RouterPath<TRouter>> = ClientOutput<
	RouterContractGivenPath<TRouter, TPath>
>;

export type ClientOutputGivenPathAndMethod<
	TRouter,
	TPath extends RouterPath<TRouter>,
	TMethod extends ContractMethod,
> = ClientOutput<RouterContractGivenPathAndMethod<TRouter, TPath, TMethod>>;

type ClientMethodRequestArgs<
	TRouter,
	TMethod extends ContractMethod,
	TPath extends ClientPathsAvailableGivenMethod<TRouter, TMethod>,
> = keyof ClientRequestInputGivenMethodAndPath<TRouter, TMethod, TPath> extends never
	? [request?: ClientRequestInputGivenMethodAndPath<TRouter, TMethod, TPath>]
	: [request: ClientRequestInputGivenMethodAndPath<TRouter, TMethod, TPath>];

export type ClientOptionsDefaultHeaderValue = string | (() => PossiblePromise<string>);

export type ClientOptions = {
	baseUrl: string;
	bypassOutgoingParse?: boolean;
	bypassIncomingParse?: boolean;
	defaultHeaders?: Record<string, ClientOptionsDefaultHeaderValue>;
};

export interface Client<TRouter> {
	get<TPath extends ClientPathsAvailableGivenMethod<TRouter, "get">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "get", TPath>
	): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "get">>;

	post<TPath extends ClientPathsAvailableGivenMethod<TRouter, "post">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "post", TPath>
	): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "post">>;

	put<TPath extends ClientPathsAvailableGivenMethod<TRouter, "put">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "put", TPath>
	): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "put">>;

	delete<TPath extends ClientPathsAvailableGivenMethod<TRouter, "delete">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "delete", TPath>
	): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "delete">>;

	patch<TPath extends ClientPathsAvailableGivenMethod<TRouter, "patch">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "patch", TPath>
	): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "patch">>;

	options<TPath extends ClientPathsAvailableGivenMethod<TRouter, "options">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "options", TPath>
	): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "options">>;

	head<TPath extends ClientPathsAvailableGivenMethod<TRouter, "head">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "head", TPath>
	): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "head">>;

	parseResponse<
		TMethod extends ContractMethod,
		TPath extends ClientPathsAvailableGivenMethod<TRouter, TMethod>,
	>(
		method: TMethod,
		route: TPath,
		response: Response,
	): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, TMethod>>;
}
