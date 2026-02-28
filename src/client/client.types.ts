import { Prettify } from "ts-essentials";
import z from "zod";
import type { ErrorMode, ValidationErrorBody } from "~/contract/contract.error.js";
import type { ContractInput } from "~/contract/contract.io.js";
import type { MergeContractResponses } from "~/contract/contract.responses.js";
import type { Contract, ContractMethod, ContractResponses } from "~/contract/contract.types.js";
import type { PossiblePromise, SchemaOutput } from "~/internal/util.types.js";
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

type ResponseBodyForStatus<TResponses, TStatus extends number> = TStatus extends keyof TResponses
	? TResponses[TStatus] extends { schema: infer TSchema extends z.ZodType }
		? SchemaOutput<TSchema>
		: undefined
	: undefined;

type ResponseHeadersForStatus<TResponses, TStatus extends number> = TStatus extends keyof TResponses
	? TResponses[TStatus] extends { headers: infer THeaders extends z.ZodType }
		? SchemaOutput<THeaders>
		: undefined
	: undefined;

type MergedResponses<
	TContract extends Contract,
	TMiddlewareResponses extends ContractResponses,
> = MergeContractResponses<TContract["responses"], TMiddlewareResponses>;

type ClientOutputBase<
	TContract extends Contract,
	TMiddlewareResponses extends ContractResponses,
> = {
	[S in Extract<keyof MergedResponses<TContract, TMiddlewareResponses>, number>]: {
		status: S;
		body: ResponseBodyForStatus<MergedResponses<TContract, TMiddlewareResponses>, S>;
		headers: ResponseHeadersForStatus<MergedResponses<TContract, TMiddlewareResponses>, S>;
		response: Response;
	};
}[Extract<keyof MergedResponses<TContract, TMiddlewareResponses>, number>];

type WithValidationError<
	TOutput,
	TErrorMode extends ErrorMode | undefined,
> = TErrorMode extends ErrorMode ? TOutput | ClientValidationErrorResponse<TErrorMode> : TOutput;

export type ClientValidationErrorResponse<TMode extends ErrorMode> = {
	status: 400;
	body: ValidationErrorBody<TMode>;
	headers: undefined;
	response: Response;
};

export type ClientOutputForContract<
	TContract extends Contract,
	TMiddlewareResponses extends ContractResponses,
	TErrorMode extends ErrorMode | undefined,
> = WithValidationError<ClientOutputBase<TContract, TMiddlewareResponses>, TErrorMode>;

type ClientMethodFn<
	TContract extends Contract,
	TMiddlewareResponses extends ContractResponses,
	TErrorMode extends ErrorMode | undefined,
> = keyof ContractInput<TContract> extends never
	? (
			input?: ContractInput<TContract>,
		) => Promise<ClientOutputForContract<TContract, TMiddlewareResponses, TErrorMode>>
	: (
			input: ContractInput<TContract>,
		) => Promise<ClientOutputForContract<TContract, TMiddlewareResponses, TErrorMode>>;

type ClientMethods<
	TContractMap,
	TMiddlewareResponses extends ContractResponses,
	TErrorMode extends ErrorMode | undefined,
> = {
	[M in ContractMethod as M extends keyof TContractMap ? M : never]: M extends keyof TContractMap
		? TContractMap[M] extends infer TContract extends Contract
			? ClientMethodFn<TContract, TMiddlewareResponses, TErrorMode>
			: never
		: never;
};

type ClientNode<
	TNode,
	TMiddlewares extends ReadonlyArray<unknown>,
	TPath extends ReadonlyArray<string>,
	TErrorMode extends ErrorMode | undefined,
> = (TNode extends { CONTRACT: infer C extends Record<string, unknown> }
	? ClientMethods<C, CollectAllMiddlewareResponses<TMiddlewares, TPath>, TErrorMode>
	: unknown) &
	(TNode extends { ROUTER: infer R extends Record<string, unknown> }
		? { [K in keyof R & string]: ClientNode<R[K], TMiddlewares, [...TPath, K], TErrorMode> }
		: unknown);

export type ClientProxy<
	TRoutes,
	TMiddlewares extends ReadonlyArray<unknown>,
	TErrorMode extends ErrorMode | undefined,
> = TRoutes extends { ROUTER: infer R extends Record<string, unknown> }
	? {
			[K in keyof R & string]: ClientNode<R[K], TMiddlewares, [K], TErrorMode>;
		}
	: never;

export type ClientOptionsDefaultHeaderValue = string | (() => PossiblePromise<string>);

export type ClientOptions<
	TMiddlewares extends ReadonlyArray<unknown> = [],
	TErrorMode extends ErrorMode | undefined = undefined,
> = {
	baseUrl: string;
	middleware?: TMiddlewares;
	bypassOutgoingParse?: boolean;
	bypassIncomingParse?: boolean;
	defaultHeaders?: Record<string, ClientOptionsDefaultHeaderValue>;
	serverErrorMode?: TErrorMode;
};
