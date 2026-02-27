import z from "zod";
import type { ErrorMode, ValidationErrorBody } from "~/contract/contract.error.js";
import type { ContractInput } from "~/contract/contract.io.js";
import type { MergeContractResponses } from "~/contract/contract.responses.js";
import type { Contract, ContractMethod, ContractResponses } from "~/contract/contract.types.js";
import type { PossiblePromise, SchemaOutput } from "~/internal/util.types.js";
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

export type ClientRequestInputGivenMethodAndPath<
	TRouter,
	TMethod extends ContractMethod,
	TPath extends ClientPathsAvailableGivenMethod<TRouter, TMethod>,
> = ContractInput<RouterContractGivenPathAndMethod<TRouter, TPath, TMethod>>;

type ResponseBodyForStatusFromResponses<
	TResponses,
	TStatus extends Extract<keyof TResponses, number>,
> = TResponses[TStatus] extends { schema: infer TSchema extends z.ZodType }
	? SchemaOutput<TSchema>
	: undefined;

type ResponseHeadersForStatusFromResponses<
	TResponses,
	TStatus extends Extract<keyof TResponses, number>,
> = TResponses[TStatus] extends { headers: infer THeaders extends z.ZodType }
	? SchemaOutput<THeaders>
	: undefined;

export type ClientOutput<
	TContract extends Contract,
	TAdditionalResponses extends ContractResponses = Record<never, never>,
> = TContract extends { responses: infer TResponses extends ContractResponses }
	? {
			[TStatus in Extract<
				keyof MergeContractResponses<TResponses, TAdditionalResponses>,
				number
			>]: {
				status: TStatus;
				body: ResponseBodyForStatusFromResponses<
					MergeContractResponses<TResponses, TAdditionalResponses>,
					TStatus
				>;
				headers: ResponseHeadersForStatusFromResponses<
					MergeContractResponses<TResponses, TAdditionalResponses>,
					TStatus
				>;
				response: Response;
			};
		}[Extract<keyof MergeContractResponses<TResponses, TAdditionalResponses>, number>]
	: never;

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
	TAdditionalResponses extends ContractResponses = Record<never, never>,
> = WithValidationError<
	ClientOutput<RouterContractGivenPathAndMethod<TRouter, TPath, TMethod>, TAdditionalResponses>,
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

export type ClientOptions<
	TErrorMode extends ErrorMode | undefined = undefined,
	TAdditionalResponses extends ContractResponses = Record<never, never>,
> = {
	baseUrl: string;
	bypassOutgoingParse?: boolean;
	bypassIncomingParse?: boolean;
	defaultHeaders?: Record<string, ClientOptionsDefaultHeaderValue>;
	serverErrorMode?: TErrorMode;
	additionalResponses?: TAdditionalResponses;
};

export interface Client<
	TRouter,
	TErrorMode extends ErrorMode | undefined = undefined,
	TAdditionalResponses extends ContractResponses = Record<never, never>,
> {
	get<TPath extends ClientPathsAvailableGivenMethod<TRouter, "get">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "get", TPath>
	): Promise<
		ClientOutputGivenPathAndMethod<TRouter, TPath, "get", TErrorMode, TAdditionalResponses>
	>;

	post<TPath extends ClientPathsAvailableGivenMethod<TRouter, "post">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "post", TPath>
	): Promise<
		ClientOutputGivenPathAndMethod<TRouter, TPath, "post", TErrorMode, TAdditionalResponses>
	>;

	put<TPath extends ClientPathsAvailableGivenMethod<TRouter, "put">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "put", TPath>
	): Promise<
		ClientOutputGivenPathAndMethod<TRouter, TPath, "put", TErrorMode, TAdditionalResponses>
	>;

	delete<TPath extends ClientPathsAvailableGivenMethod<TRouter, "delete">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "delete", TPath>
	): Promise<
		ClientOutputGivenPathAndMethod<TRouter, TPath, "delete", TErrorMode, TAdditionalResponses>
	>;

	patch<TPath extends ClientPathsAvailableGivenMethod<TRouter, "patch">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "patch", TPath>
	): Promise<
		ClientOutputGivenPathAndMethod<TRouter, TPath, "patch", TErrorMode, TAdditionalResponses>
	>;

	options<TPath extends ClientPathsAvailableGivenMethod<TRouter, "options">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "options", TPath>
	): Promise<
		ClientOutputGivenPathAndMethod<TRouter, TPath, "options", TErrorMode, TAdditionalResponses>
	>;

	head<TPath extends ClientPathsAvailableGivenMethod<TRouter, "head">>(
		route: TPath,
		...args: ClientMethodRequestArgs<TRouter, "head", TPath>
	): Promise<
		ClientOutputGivenPathAndMethod<TRouter, TPath, "head", TErrorMode, TAdditionalResponses>
	>;

	parseResponse<
		TMethod extends ContractMethod,
		TPath extends ClientPathsAvailableGivenMethod<TRouter, TMethod>,
	>(
		method: TMethod,
		route: TPath,
		response: Response,
	): Promise<
		ClientOutputGivenPathAndMethod<TRouter, TPath, TMethod, TErrorMode, TAdditionalResponses>
	>;
}
