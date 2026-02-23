import z from "zod";
import type { JoinPath, PossibleZodOptional } from "~/internal/types.js";

export type Contract = {
	method: ContractMethod;
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

export type ContractHeaders = z.ZodObject<
	Record<string, PossibleZodOptional<z.ZodType<string, string>>>
>;

export type ContractResponses = Record<
	number,
	{
		body?: z.ZodType;
		headers?: ContractHeaders;
	}
>;

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
				contract: ContractForPath<JoinPath<TPath, Extract<K, string>>>;
			} & (TShape[K]["router"] extends RouterShape
				? { router: Router<TShape[K]["router"], JoinPath<TPath, Extract<K, string>>> }
				: { router?: undefined });
};

type ContractForPath<TPath extends string> = Contract &
	([PathParamNamesFromPath<TPath>] extends [never]
		? { pathParams?: undefined }
		: { pathParams: z.ZodObject<PathParamsShape<TPath>> });
