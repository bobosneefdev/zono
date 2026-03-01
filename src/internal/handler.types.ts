import z from "zod";
import type { ErrorMode } from "~/contract/contract.error.js";
import type { ContractOutput } from "~/contract/contract.io.js";
import type {
	Contract,
	ContractMethod,
	ContractMethodMap,
	ContractResponseStatuses,
	ContractResponses,
} from "~/contract/contract.types.js";
import type {
	PossiblePromise,
	ResponseBodyForStatus,
	ResponseHeadersForStatus,
	SchemaInput,
} from "~/internal/util.types.js";
import type { MiddlewareContractMap } from "~/middleware/middleware.types.js";

/**
 * Return type for typed middleware - always { status, contentType, body }.
 * Represents a middleware response that short-circuits the request.
 * @template TResponses - Contract responses that this middleware can return
 */
export type MiddlewareReturn<TResponses extends ContractResponses> = {
	[S in Extract<keyof TResponses, number>]: {
		status: S;
	} & (TResponses[S] extends { contentType: infer CT }
		? TResponses[S] extends { schema: infer TSchema extends z.ZodType }
			? { contentType: CT; body: SchemaInput<TSchema> }
			: { contentType: CT; body?: undefined }
		: { contentType?: undefined; body?: undefined });
}[Extract<keyof TResponses, number>];

/**
 * Typed middleware handler - returns void to continue, or response to short-circuit.
 * @template TResponses - Contract responses that this middleware can return
 * @template TContext - Context type passed to the handler
 */
export type TypedMiddlewareHandler<TResponses extends ContractResponses, TContext> =
	| null
	| ((
			ctx: TContext,
			next: () => Promise<void>,
	  ) => PossiblePromise<void | MiddlewareReturn<TResponses>>);

/**
 * Maps middleware names to typed handlers (or null for external middleware).
 * @template TMiddlewareMap - Map of middleware names to their response contracts
 * @template TContext - Context type passed to handlers
 */
export type TypedMiddlewareHandlers<TMiddlewareMap extends MiddlewareContractMap, TContext> = {
	[K in keyof TMiddlewareMap]: TypedMiddlewareHandler<TMiddlewareMap[K], TContext> | null;
};

type ResponseContentTypeForStatus<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus]["contentType"];

type IncludeOutputBody<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = ResponseContentTypeForStatus<TContract, TStatus> extends null
	? { body?: undefined }
	: { body: ResponseBodyForStatus<TContract, TStatus> };

type IncludeOutputContentType<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = { contentType: ResponseContentTypeForStatus<TContract, TStatus> };

type IncludeOutputHeaders<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = ResponseHeadersForStatus<TContract, TStatus> extends undefined
	? { headers?: undefined }
	: { headers: ResponseHeadersForStatus<TContract, TStatus> };

/**
 * Output type for a server handler - the shape of data returned by handlers.
 * @template TContract - The contract defining valid responses
 */
export type ServerHandlerOutput<TContract extends Contract> = {
	[TStatus in ContractResponseStatuses<TContract>]: {
		status: TStatus;
	} & IncludeOutputContentType<TContract, TStatus> &
		IncludeOutputBody<TContract, TStatus> &
		IncludeOutputHeaders<TContract, TStatus>;
}[ContractResponseStatuses<TContract>];

/**
 * Type for a server-side request handler.
 * @template TContract - The contract defining request/response types
 * @template TParams - Additional parameters passed to the handler
 */
export type ServerHandler<TContract extends Contract, TParams extends Array<unknown> = []> = (
	data: ContractOutput<TContract>,
	...args: TParams
) => PossiblePromise<ServerHandlerOutput<TContract>>;

/**
 * Handler type for a specific HTTP method in a contract map.
 * @template TContract - The contract method map
 * @template TParams - Additional parameters passed to the handler
 * @template TMethod - The specific HTTP method
 */
export type ServerHandlerGivenMethod<
	TContract extends ContractMethodMap,
	TParams extends Array<unknown>,
	TMethod extends keyof TContract,
> = ServerHandler<Extract<TContract[TMethod], Contract>, TParams>;

/**
 * Maps HTTP methods to their handler types for a contract map.
 * @template TContractMap - The contract method map
 * @template TParams - Additional parameters passed to handlers
 */
export type ServerHandlerMethodMap<
	TContractMap extends ContractMethodMap,
	TParams extends Array<unknown>,
> = {
	[TMethod in ContractMethod as TContractMap[TMethod] extends Contract
		? TMethod
		: never]: ServerHandlerGivenMethod<TContractMap, TParams, TMethod>;
};

/** Base options for server configuration */
export type ServerOptionsBase = {
	errorMode?: ErrorMode;
};
