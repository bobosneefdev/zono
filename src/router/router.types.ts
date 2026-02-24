import z from "zod";
import type { Contract, ContractMethodMap } from "~/contract/contract.types.js";
import type { JoinPath } from "~/lib/util.types.js";

type PathParamNamesFromSegment<TSegment extends string> = TSegment extends `$${infer TParamName}`
	? TParamName
	: never;

type PathParamNamesFromPath<TPath extends string> = TPath extends `${infer TSegment}.${infer TRest}`
	? PathParamNamesFromSegment<TSegment> | PathParamNamesFromPath<TRest>
	: PathParamNamesFromSegment<TPath>;

type PathParamsShape<TPath extends string> = {
	[K in PathParamNamesFromPath<TPath>]: z.ZodType<string, string>;
};

export interface RouterShape {
	[key: string]: RouterRouterNode | RouterContractNode;
}

export type RouterRouterNode = {
	TYPE: "router";
	ROUTER: RouterShape;
};

export type RouterContractNode = {
	TYPE: "contract";
	ROUTER?: RouterShape;
};

export type Router<TShape extends RouterShape, TPath extends string = ""> = {
	[K in keyof TShape]: TShape[K] extends RouterRouterNode
		? Router<TShape[K]["ROUTER"], JoinPath<TPath, Extract<K, string>>>
		: {
				CONTRACT: ContractMethodMap<ContractForPath<JoinPath<TPath, Extract<K, string>>>>;
			} & (TShape[K]["ROUTER"] extends RouterShape
				? { ROUTER: Router<TShape[K]["ROUTER"], JoinPath<TPath, Extract<K, string>>> }
				: { ROUTER?: undefined });
};

type ContractForPath<TPath extends string> = Contract &
	([PathParamNamesFromPath<TPath>] extends [never]
		? { pathParams?: undefined }
		: { pathParams: z.ZodObject<PathParamsShape<TPath>> });
