import z from "zod";
import type { JoinPath, PossibleZodOptional } from "~/lib/types.js";

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

export type ContractResponseJsonContentType = "application/json";
export type ContractResponseTextContentType = "text/plain";
export type ContractResponseBytesContentType = "application/octet-stream";

export type ContractResponseNonNullContentType =
	| ContractResponseJsonContentType
	| ContractResponseTextContentType
	| ContractResponseBytesContentType;

type ContractResponseWithBody = {
	contentType: ContractResponseNonNullContentType;
	body: z.ZodType;
	headers?: ContractHeaders;
};

type ContractResponseWithoutBody = {
	contentType: null;
	body?: undefined;
	headers?: ContractHeaders;
};

export type ContractResponse = ContractResponseWithBody | ContractResponseWithoutBody;

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
