import z from "zod";
import type {
	Contract,
	ContractMethod,
	ContractMethodMap,
	ContractResponseStatuses,
	ContractResponses,
} from "~/contract/contract.types.js";
import type { ContractOutput } from "~/contract/contract.util.js";
import type { PossiblePromise, ResponseHeadersForStatus } from "~/internal/util.types.js";
import type { MiddlewareContractMap } from "~/middleware/middleware.types.js";

/**
 * Return type for a typed middleware handler — either a short-circuit response object or void.
 * Middleware may also return a plain Response to bypass type checking (for 3rd-party middleware).
 * @template TResponses - Contract responses that this middleware can return
 */
export type MiddlewareReturn<TResponses extends ContractResponses> = {
	[S in Extract<keyof TResponses, number>]: {
		status: S;
		type: TResponses[S]["type"];
	} & (TResponses[S] extends { schema: infer TSchema extends z.ZodType }
		? { data: z.input<TSchema> }
		: { data?: undefined });
}[Extract<keyof TResponses, number>];

/**
 * Typed middleware handler. Returns:
 * - void to continue to next middleware / route handler
 * - Response to short-circuit with a raw Response (no schema validation)
 * - MiddlewareReturn to short-circuit with a type-safe response object
 * @template TResponses - Contract responses that this middleware can return
 * @template TContext - Context type passed to the handler
 */
export type TypedMiddlewareHandler<TResponses extends ContractResponses, TContext> =
	| null
	| ((
			ctx: TContext,
			next: () => Promise<void>,
	  ) => PossiblePromise<void | Response | MiddlewareReturn<TResponses>>);

/**
 * Maps middleware names to typed handlers (or null for external middleware).
 * @template TMiddlewareMap - Map of middleware names to their response contracts
 * @template TContext - Context type passed to handlers
 */
export type TypedMiddlewareHandlers<TMiddlewareMap extends MiddlewareContractMap, TContext> = {
	[K in keyof TMiddlewareMap]: TypedMiddlewareHandler<TMiddlewareMap[K], TContext> | null;
};

/**
 * Output type for a server handler — the shape of the plain object returned by handlers.
 * Uses z.input<responseSchema> for data (wire-safe value the server sends).
 * @template TContract - The contract defining valid responses
 */
export type ServerHandlerOutput<TContract extends Contract> = {
	[TStatus in ContractResponseStatuses<TContract>]: {
		status: TStatus;
		type: TContract["responses"][TStatus]["type"];
	} & (TContract["responses"][TStatus] extends { schema: infer TSchema extends z.ZodType }
		? { data: z.input<TSchema> }
		: { data?: undefined }) &
		(ResponseHeadersForStatus<TContract, TStatus> extends undefined
			? { headers?: undefined }
			: { headers: ResponseHeadersForStatus<TContract, TStatus> });
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
 */
export type ServerHandlerGivenMethod<
	TContract extends ContractMethodMap,
	TParams extends Array<unknown>,
	TMethod extends keyof TContract,
> = ServerHandler<Extract<TContract[TMethod], Contract>, TParams>;

/**
 * Maps HTTP methods to their handler types for a contract map.
 */
export type ServerHandlerMethodMap<
	TContractMap extends ContractMethodMap,
	TParams extends Array<unknown>,
> = {
	[TMethod in ContractMethod as TContractMap[TMethod] extends Contract
		? TMethod
		: never]: ServerHandlerGivenMethod<TContractMap, TParams, TMethod>;
};
