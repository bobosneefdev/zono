import type {
	Contract,
	ContractMethod,
	ContractResponseStatuses,
} from "~/contract/contract.types.js";
import type {
	ErrorMode,
	ServerHandlerInput,
	ValidationErrorBody,
} from "~/internal/server.types.js";
import type {
	PossiblePromise,
	ResponseBodyForStatus,
	ResponseHeadersForStatus,
} from "~/internal/util.types.js";
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

export type ClientRequestInput<TContract extends Contract> = ServerHandlerInput<TContract>;

export type ClientRequestInputGivenMethodAndPath<
	TRouter,
	TMethod extends ContractMethod,
	TPath extends ClientPathsAvailableGivenMethod<TRouter, TMethod>,
> = ClientRequestInput<RouterContractGivenPathAndMethod<TRouter, TPath, TMethod>>;

export type ClientOutput<TContract extends Contract> = {
	[TStatus in ContractResponseStatuses<TContract>]: {
		status: TStatus;
		body: ResponseBodyForStatus<TContract, TStatus>;
		headers: ResponseHeadersForStatus<TContract, TStatus>;
		response: Response;
	};
}[ContractResponseStatuses<TContract>];

export type ClientValidationErrorResponse<TMode extends ErrorMode> = {
	status: 400;
	body: ValidationErrorBody<TMode>;
	headers: undefined;
	response: Response;
};

type WithValidationError<
	TOutput,
	TErrorMode extends ErrorMode | undefined,
> = TErrorMode extends ErrorMode ? TOutput | ClientValidationErrorResponse<TErrorMode> : TOutput;

export type ClientOutputGivenPath<TRouter, TPath extends RouterPath<TRouter>> = ClientOutput<
	RouterContractGivenPath<TRouter, TPath>
>;

export type ClientOutputGivenPathAndMethod<
	TRouter,
	TPath extends RouterPath<TRouter>,
	TMethod extends ContractMethod,
	TErrorMode extends ErrorMode | undefined = undefined,
> = WithValidationError<
	ClientOutput<RouterContractGivenPathAndMethod<TRouter, TPath, TMethod>>,
	TErrorMode
>;

type ClientMethodRequestArgs<
	TRouter,
	TMethod extends ContractMethod,
	TPath extends ClientPathsAvailableGivenMethod<TRouter, TMethod>,
> = keyof ClientRequestInputGivenMethodAndPath<TRouter, TMethod, TPath> extends never
	? [request?: ClientRequestInputGivenMethodAndPath<TRouter, TMethod, TPath>]
	: [request: ClientRequestInputGivenMethodAndPath<TRouter, TMethod, TPath>];

export type ClientOptionsDefaultHeaderValue = string | (() => PossiblePromise<string>);

export type ClientOptions<TErrorMode extends ErrorMode | undefined = undefined> = {
	baseUrl: string;
	bypassOutgoingParse?: boolean;
	bypassIncomingParse?: boolean;
	defaultHeaders?: Record<string, ClientOptionsDefaultHeaderValue>;
	serverErrorMode?: TErrorMode;
};

export interface Client<TRouter, TErrorMode extends ErrorMode | undefined = undefined> {
	get<TPath extends ClientPathsAvailableGivenMethod<TRouter, "get">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "get", TPath>
	): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "get", TErrorMode>>;

	post<TPath extends ClientPathsAvailableGivenMethod<TRouter, "post">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "post", TPath>
	): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "post", TErrorMode>>;

	put<TPath extends ClientPathsAvailableGivenMethod<TRouter, "put">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "put", TPath>
	): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "put", TErrorMode>>;

	delete<TPath extends ClientPathsAvailableGivenMethod<TRouter, "delete">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "delete", TPath>
	): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "delete", TErrorMode>>;

	patch<TPath extends ClientPathsAvailableGivenMethod<TRouter, "patch">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "patch", TPath>
	): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "patch", TErrorMode>>;

	options<TPath extends ClientPathsAvailableGivenMethod<TRouter, "options">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "options", TPath>
	): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "options", TErrorMode>>;

	head<TPath extends ClientPathsAvailableGivenMethod<TRouter, "head">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "head", TPath>
	): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "head", TErrorMode>>;

	parseResponse<
		TMethod extends ContractMethod,
		TPath extends ClientPathsAvailableGivenMethod<TRouter, TMethod>,
	>(
		method: TMethod,
		route: TPath,
		response: Response,
	): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, TMethod, TErrorMode>>;
}
