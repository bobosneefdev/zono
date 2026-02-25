import z from "zod";
import type { Contract, ContractMethodMap } from "~/contract/contract.types.js";
import type { JoinPath } from "~/lib/util.types.js";

type PathParamNamesFromSegment<TSegment extends string> =
	TSegment extends `${string}$${infer TParamName}`
		? TParamName
		: TSegment extends `$${infer TParamName}`
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

type PathsFromShape<TShape extends RouterShape, TPrefix extends string = ""> = {
	[K in keyof TShape & string]: TShape[K] extends RouterContractNode
		?
				| (TPrefix extends "" ? K : JoinPath<TPrefix, K>)
				| (TShape[K]["ROUTER"] extends RouterShape
						? PathsFromShape<
								TShape[K]["ROUTER"],
								TPrefix extends "" ? K : JoinPath<TPrefix, K>
							>
						: never)
		: TShape[K] extends RouterRouterNode
			? PathsFromShape<TShape[K]["ROUTER"], JoinPath<TPrefix, K>>
			: never;
}[keyof TShape & string];

export type RouterShapePath<T extends RouterShape> = PathsFromShape<T>;

type ContractFromPath<
	TShape extends RouterShape,
	TPath extends RouterShapePath<TShape>,
> = TPath extends `${infer TPrefix}.${infer TSuffix}`
	? TShape[TPrefix] extends RouterRouterNode
		? ContractFromPath<
				TShape[TPrefix]["ROUTER"],
				TSuffix & RouterShapePath<TShape[TPrefix]["ROUTER"]>
			>
		: TShape[TPrefix] extends RouterContractNode
			? TShape[TPrefix]["ROUTER"] extends RouterShape
				? ContractFromPath<
						TShape[TPrefix]["ROUTER"],
						TSuffix & RouterShapePath<TShape[TPrefix]["ROUTER"]>
					>
				: never
			: never
	: TShape[TPath] extends RouterContractNode
		? ContractMethodMap<ContractForPath<TPath>>
		: never;

export type RouterShapeContractGivenPath<
	T extends RouterShape,
	U extends RouterShapePath<T>,
> = ContractFromPath<T, U> extends never ? never : ContractMethodMap<ContractForPath<U>>;
