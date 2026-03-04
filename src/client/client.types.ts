import type {
	Contract,
	ContractMethod,
	ContractResponses,
	ErrorMode,
	InternalErrorBody,
	NotFoundErrorBody,
	ValidationErrorBody,
} from "~/contract/contract.types.js";
import type { ContractInput, MergeContractResponses } from "~/contract/contract.util.js";
import type {
	PossiblePromise,
	Prettify,
	ResponseBodyForStatusInResponses,
	ResponseHeadersForStatusInResponses,
} from "~/internal/util.types.js";
import type { MiddlewareContractMap } from "~/middleware/middleware.types.js";

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
	k: infer I,
) => void
	? I
	: never;

type FlattenMiddlewareValues<M extends MiddlewareContractMap> = [keyof M] extends [never]
	? Record<never, never>
	: UnionToIntersection<M[keyof M]> extends infer R extends ContractResponses
		? R
		: Record<never, never>;

type ExtractLevelMiddleware<TNode> = TNode extends {
	MIDDLEWARE: infer M extends MiddlewareContractMap;
}
	? FlattenMiddlewareValues<M>
	: Record<never, never>;

type CollectFromSingleMiddleware<
	TNode,
	TPath extends ReadonlyArray<string>,
> = MergeContractResponses<
	ExtractLevelMiddleware<TNode>,
	TPath extends readonly [infer K extends string, ...infer Rest extends ReadonlyArray<string>]
		? TNode extends { ROUTER: infer R extends Record<string, unknown> }
			? K extends keyof R
				? CollectFromSingleMiddleware<R[K], Rest>
				: Record<never, never>
			: Record<never, never>
		: Record<never, never>
>;

type CollectAllMiddlewareResponses<
	TMiddlewares extends ReadonlyArray<unknown>,
	TPath extends ReadonlyArray<string>,
> = Prettify<
	TMiddlewares extends readonly [infer Head, ...infer Tail extends ReadonlyArray<unknown>]
		? MergeContractResponses<
				CollectFromSingleMiddleware<Head, TPath>,
				CollectAllMiddlewareResponses<Tail, TPath>
			>
		: Record<never, never>
>;

type MergedResponses<
	TContract extends Contract,
	TMiddlewareResponses extends ContractResponses,
> = MergeContractResponses<TContract["responses"], TMiddlewareResponses>;

type ClientOutputBase<
	TContract extends Contract,
	TMiddlewareResponses extends ContractResponses,
> = Prettify<
	{
		[S in Extract<keyof MergedResponses<TContract, TMiddlewareResponses>, number>]: {
			status: S;
			body: ResponseBodyForStatusInResponses<
				MergedResponses<TContract, TMiddlewareResponses>,
				S
			>;
			headers: ResponseHeadersForStatusInResponses<
				MergedResponses<TContract, TMiddlewareResponses>,
				S
			>;
			response: Response;
		};
	}[Extract<keyof MergedResponses<TContract, TMiddlewareResponses>, number>]
>;

type WithGlobalErrorResponses<
	TOutput,
	TErrorMode extends ErrorMode | undefined,
> = TErrorMode extends ErrorMode
	?
			| TOutput
			| (Extract<TOutput, { status: 400 }> extends never
					? ClientValidationErrorResponse<TErrorMode>
					: never)
			| (Extract<TOutput, { status: 404 }> extends never
					? ClientNotFoundErrorResponse
					: never)
			| (Extract<TOutput, { status: 500 }> extends never
					? ClientInternalErrorResponse
					: never)
	: TOutput;

/**
 * Client response for validation errors (400 status).
 * @template TMode - Error mode determining level of detail in the error body
 */
export type ClientValidationErrorResponse<TMode extends ErrorMode> = {
	status: 400;
	body: ValidationErrorBody<TMode>;
	headers: undefined;
	response: Response;
};

/** Client response for not found errors (404 status) */
export type ClientNotFoundErrorResponse = {
	status: 404;
	body: NotFoundErrorBody;
	headers: undefined;
	response: Response;
};

/** Client response for internal server errors (500 status) */
export type ClientInternalErrorResponse = {
	status: 500;
	body: InternalErrorBody;
	headers: undefined;
	response: Response;
};

/**
 * Output type for a contract on the client side, including global error responses.
 * Body uses z.output<responseSchema> (after transforms, what the client sees).
 * Headers uses z.output<headersSchema>.
 * @template TContract - The contract to extract output type from
 * @template TMiddlewareResponses - Responses from middleware that may be returned
 * @template TErrorMode - Error mode for validation error detail level
 */
export type ClientOutputForContract<
	TContract extends Contract,
	TMiddlewareResponses extends ContractResponses,
	TErrorMode extends ErrorMode | undefined,
> = WithGlobalErrorResponses<ClientOutputBase<TContract, TMiddlewareResponses>, TErrorMode>;

type ClientRequestConfigTuple = [url: string, init: RequestInit];

type ClientMethodFn<
	TMethod extends ContractMethod,
	TContract extends Contract,
	TMiddlewareResponses extends ContractResponses,
	TErrorMode extends ErrorMode | undefined,
> = keyof ContractInput<TContract> extends never
	? (
			method: TMethod,
		) => Promise<ClientOutputForContract<TContract, TMiddlewareResponses, TErrorMode>>
	: (
			method: TMethod,
			input: ContractInput<TContract>,
		) => Promise<ClientOutputForContract<TContract, TMiddlewareResponses, TErrorMode>>;

type ClientConfigMethodFn<
	TMethod extends ContractMethod,
	TContract extends Contract,
> = keyof ContractInput<TContract> extends never
	? (method: `config_${TMethod}`) => Promise<ClientRequestConfigTuple>
	: (
			method: `config_${TMethod}`,
			input: ContractInput<TContract>,
		) => Promise<ClientRequestConfigTuple>;

type ClientValidateMethodFn<
	TMethod extends ContractMethod,
	TContract extends Contract,
	TMiddlewareResponses extends ContractResponses,
	TErrorMode extends ErrorMode | undefined,
> = (
	method: `validate_${TMethod}`,
	response: Response,
) => Promise<ClientOutputForContract<TContract, TMiddlewareResponses, TErrorMode>>;

type ClientMethodVariants<
	TMethod extends ContractMethod,
	TContract extends Contract,
	TMiddlewareResponses extends ContractResponses,
	TErrorMode extends ErrorMode | undefined,
> =
	| ClientMethodFn<TMethod, TContract, TMiddlewareResponses, TErrorMode>
	| ClientConfigMethodFn<TMethod, TContract>
	| ClientValidateMethodFn<TMethod, TContract, TMiddlewareResponses, TErrorMode>;

type ClientMethodKeys<TContractMap> = Extract<keyof TContractMap, ContractMethod>;

type ClientMethodInvoker<
	TContractMap,
	TMiddlewareResponses extends ContractResponses,
	TErrorMode extends ErrorMode | undefined,
> = [ClientMethodKeys<TContractMap>] extends [never]
	? unknown
	: UnionToIntersection<
			{
				[M in ClientMethodKeys<TContractMap>]: TContractMap[M] extends infer TContract extends
					Contract
					? ClientMethodVariants<M, TContract, TMiddlewareResponses, TErrorMode>
					: never;
			}[ClientMethodKeys<TContractMap>]
		>;

type ClientNode<
	TNode,
	TMiddlewares extends ReadonlyArray<unknown>,
	TPath extends ReadonlyArray<string>,
	TErrorMode extends ErrorMode | undefined,
> = (TNode extends { CONTRACT: infer C extends Record<string, unknown> }
	? ClientMethodInvoker<C, CollectAllMiddlewareResponses<TMiddlewares, TPath>, TErrorMode>
	: unknown) &
	(TNode extends { ROUTER: infer R extends Record<string, unknown> }
		? { [K in keyof R & string]: ClientNode<R[K], TMiddlewares, [...TPath, K], TErrorMode> }
		: unknown);

/**
 * Type-safe client proxy that provides autocomplete for routes and methods.
 * @template TContracts - Contract definition type
 * @template TMiddlewares - Array of middleware definitions
 * @template TErrorMode - Error mode for validation error detail level
 */
export type ClientProxy<
	TContracts,
	TMiddlewares extends ReadonlyArray<unknown>,
	TErrorMode extends ErrorMode | undefined,
> = TContracts extends { ROUTER: infer R extends Record<string, unknown> }
	? {
			[K in keyof R & string]: ClientNode<R[K], TMiddlewares, [K], TErrorMode>;
		}
	: never;

/** Value for a default header - either a string or a function returning a string */
export type ClientOptionsDefaultHeaderValue = string | (() => PossiblePromise<string>);

/**
 * Configuration options for creating a type-safe HTTP client.
 * @template TMiddlewares - Array of middleware definitions for type inference
 * @template TErrorMode - Error mode for validation error detail level
 */
export type ClientOptions<
	TMiddlewares extends ReadonlyArray<unknown> = [],
	TErrorMode extends ErrorMode | undefined = undefined,
> = {
	baseUrl: string;
	middleware?: TMiddlewares;
	defaultHeaders?: Record<string, ClientOptionsDefaultHeaderValue>;
	serverErrorMode?: TErrorMode;
};
