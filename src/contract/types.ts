import { JSONValue } from "hono/utils/types";
import z from "zod";
import type { EnumValues, JoinPath, PossibleZodOptional } from "~/lib/types.js";

export type Contract = {
	responses: ContractResponses;
	pathParams?: z.ZodType<Record<string, string>>;
	body?: z.ZodType;
	query?: ContractQuery;
	headers?: ContractHeaders;
};

type PathParamNamesFromSegment<TSegment extends string> = TSegment extends `$${infer TParamName}`
	? TParamName
	: never;

type PathParamNamesFromPath<TPath extends string> = TPath extends `${infer TSegment}.${infer TRest}`
	? PathParamNamesFromSegment<TSegment> | PathParamNamesFromPath<TRest>
	: PathParamNamesFromSegment<TPath>;

type PathParamsShape<TPath extends string> = {
	[K in PathParamNamesFromPath<TPath>]: z.ZodType<string, string>;
};

export type ContractMethod = "get" | "post" | "put" | "delete" | "patch" | "options" | "head";

export type ContractMethodMap<TContract extends Contract = Contract> = Partial<
	Record<ContractMethod, TContract>
>;

export type ContractHeaders = z.ZodObject<
	Record<string, PossibleZodOptional<z.ZodType<string, string>>>
>;

export enum ContractResponseJsonContentType {
	JSON = "application/json",
}

export enum ContractResponseTextContentType {
	PLAIN = "text/plain",
	HTML = "text/html",
	CSV = "text/csv",
	XML = "text/xml",
	JS = "text/javascript",
	CSS = "text/css",
}

export enum ContractResponseBytesContentType {
	STREAM = "application/octet-stream",
	MSGPACK = "application/x-msgpack",
}

export type ContractResponseJson = {
	contentType:
		| ContractResponseJsonContentType
		| EnumValues<typeof ContractResponseJsonContentType>;
	body: z.ZodType<JSONValue, JSONValue>;
	headers?: ContractHeaders;
};

export type ContractResponseText = {
	contentType:
		| ContractResponseTextContentType
		| EnumValues<typeof ContractResponseTextContentType>;
	body: z.ZodType<string, string>;
	headers?: ContractHeaders;
};

export type ContractResponseBytes = {
	contentType:
		| ContractResponseBytesContentType
		| EnumValues<typeof ContractResponseBytesContentType>;
	body: z.ZodType<Uint8Array, Uint8Array>;
	headers?: ContractHeaders;
};

export type ContractResponseContentless = {
	contentType: null;
	body?: undefined;
	headers?: ContractHeaders;
};

export type ContractResponse =
	| ContractResponseJson
	| ContractResponseText
	| ContractResponseBytes
	| ContractResponseContentless;

export type ContractResponses = Record<number, ContractResponse>;

export type ContractQuery = z.ZodObject<
	Record<string, PossibleZodOptional<z.ZodType<string, string>>>
>;

export interface RouterShape {
	[key: string]: RouterRouterNode | ContractRouterNode;
}

export type RouterRouterNode = {
	type: "router";
	router: RouterShape;
};

export type ContractRouterNode = {
	type: "contract";
	router?: RouterShape;
};

export type Router<TShape extends RouterShape, TPath extends string = ""> = {
	[K in keyof TShape]: TShape[K] extends RouterRouterNode
		? Router<TShape[K]["router"], JoinPath<TPath, Extract<K, string>>>
		: {
				contract: ContractMethodMap<ContractForPath<JoinPath<TPath, Extract<K, string>>>>;
			} & (TShape[K]["router"] extends RouterShape
				? { router: Router<TShape[K]["router"], JoinPath<TPath, Extract<K, string>>> }
				: { router?: undefined });
};

type ContractForPath<TPath extends string> = Contract &
	([PathParamNamesFromPath<TPath>] extends [never]
		? { pathParams?: undefined }
		: { pathParams: z.ZodObject<PathParamsShape<TPath>> });
