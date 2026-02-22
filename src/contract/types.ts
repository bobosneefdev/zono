import { StatusCode } from "hono/utils/http-status";
import z from "zod";
import { ConditionalKeyInObject, PossibleZodOptional } from "~/shared/types.js";
import { ZonoContractMethod } from "./enums.js";

export type ZonoContractPath = `/:${string}` | "";

type ExtractPathParams<TPath extends string> =
	TPath extends `${infer _Start}:${infer Param}/${infer Rest}`
		? Param | ExtractPathParams<`/${Rest}`>
		: TPath extends `${infer _Start}:${infer Param}`
			? Param
			: never;

export type ZonoContractOptions<TPath extends ZonoContractPath> = {
	method: ZonoContractMethod;
	responses: ZonoContractResponses;
	body?: z.ZodType;
	query?: ZonoContractQuery;
	headers?: ZonoContractHeaders;
} & ConditionalKeyInObject<
	"pathParams",
	[ExtractPathParams<TPath>] extends [never] ? never : ZonoContractPathParams<TPath>
>;

export type ZonoContractResponse = { body?: z.ZodType; headers?: ZonoContractHeaders };

export type ZonoContractResponses = Partial<Record<StatusCode, ZonoContractResponse>>;

export type ZonoContract<
	TPath extends ZonoContractPath,
	TOptions extends ZonoContractOptions<TPath>,
> = { path: TPath } & TOptions;

/**
 * A loosely-typed contract, used for router definitions where the
 * path is not statically known. Avoids the `pathParams` required issue
 * that arises with `ZonoContract<any>`.
 */
export type ZonoContractAny = {
	path: ZonoContractPath;
	method: ZonoContractMethod;
	responses: ZonoContractResponses;
	body?: z.ZodType;
	query?: ZonoContractQuery;
	headers?: ZonoContractHeaders;
	pathParams?: z.ZodObject<Record<string, ZonoContractPathParamValue>>;
};

export type ZonoContractQueryValue =
	| PossibleZodOptional<z.ZodType<string, string>>
	| z.ZodArray<z.ZodType<string, string>>
	| z.ZodTuple<[z.ZodType<string, string>, ...Array<z.ZodType<string, string>>]>;

export type ZonoContractQuery = z.ZodObject<Record<string, ZonoContractQueryValue>>;

export type ZonoContractHeaderValue = PossibleZodOptional<z.ZodType<string, string>>;

export type ZonoContractHeaders = z.ZodObject<Record<string, ZonoContractHeaderValue>>;

export type ZonoContractPathParamValue = z.ZodType<string, string>;

export type ZonoContractPathParams<TPath extends ZonoContractPath> = z.ZodObject<
	Record<ExtractPathParams<TPath>, ZonoContractPathParamValue>
>;

export interface ZonoRouter {
	[key: string]: ZonoContractAny | ZonoRouter;
}
