import z from "zod";
import type { Contract, ContractMethodMap, ContractResponses } from "~/contract/contract.types.js";
import type { JoinPath } from "~/internal/util.types.js";

/** Each middleware has a name and its possible response schemas */
export type MiddlewareContractMap = Record<string, ContractResponses>;

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
	[key: string]: RouterGroupNode | RouterContractNode;
}

export type RouterGroupNode = {
	TYPE: "router";
	ROUTER: RouterShape;
};

export type RouterContractNode = {
	TYPE: "contract";
	ROUTER?: RouterShape;
};

/** Input type for createRouter second argument - uses explicit ROUTER wrapping at group nodes */
export type RouterDefinition<TShape extends RouterShape, TPath extends string = ""> = {
	MIDDLEWARE?: MiddlewareContractMap;
	ROUTER: {
		[K in keyof TShape & string]: TShape[K] extends RouterGroupNode
			? RouterDefinition<TShape[K]["ROUTER"], JoinPath<TPath, K>>
			: RouterDefinitionContractNode<
					Extract<TShape[K], RouterContractNode>,
					JoinPath<TPath, K>
				>;
	};
};

type RouterDefinitionChild<TChild, TPath extends string> = TChild extends RouterGroupNode
	? RouterDefinition<TChild["ROUTER"], TPath>
	: TChild extends RouterContractNode
		? RouterDefinitionContractNode<TChild, TPath>
		: never;

type RouterDefinitionContractNode<TNode extends RouterContractNode, TPath extends string> = {
	MIDDLEWARE?: MiddlewareContractMap;
	CONTRACT: ContractMethodMap<ContractForPath<TPath>>;
} & (TNode["ROUTER"] extends infer R extends RouterShape
	? {
			ROUTER: {
				[K in keyof R & string]: RouterDefinitionChild<R[K], JoinPath<TPath, K>>;
			};
		}
	: { ROUTER?: undefined });

type MiddlewareFromDef<TDef> = TDef extends { MIDDLEWARE?: infer M extends MiddlewareContractMap }
	? M
	: never;

/**
 * Resolves the output shape of a contract node's ROUTER children (a flat children map,
 * not wrapped in RouterDefinition's outer ROUTER key). Preserves specific contract types.
 */
type ContractChildrenFromDefinition<
	TShape extends RouterShape,
	TChildDef extends Record<string, unknown>,
	TPath extends string,
> = {
	[K in keyof TShape & string]: TShape[K] extends RouterGroupNode
		? K extends keyof TChildDef
			? TChildDef[K] extends RouterDefinition<TShape[K]["ROUTER"]>
				? RouterFromDefinition<TShape[K]["ROUTER"], TChildDef[K], JoinPath<TPath, K>>
				: never
			: never
		: K extends keyof TChildDef
			? TChildDef[K] extends infer D
				? {
						MIDDLEWARE?: MiddlewareFromDef<D>;
						CONTRACT: D extends { CONTRACT: infer C }
							? C
							: ContractMethodMap<ContractForPath<JoinPath<TPath, K>>>;
					} & (TShape[K]["ROUTER"] extends infer GrandchildShape extends RouterShape
						? D extends { ROUTER: infer R extends Record<string, unknown> }
							? {
									ROUTER: ContractChildrenFromDefinition<
										GrandchildShape,
										R,
										JoinPath<TPath, K>
									>;
								}
							: { ROUTER?: undefined }
						: { ROUTER?: undefined })
				: never
			: never;
};

export type RouterFromDefinition<
	TShape extends RouterShape,
	TDef extends RouterDefinition<TShape>,
	TPath extends string = "",
> = TDef extends { ROUTER: infer TDefRouter extends Record<string, unknown> }
	? {
			MIDDLEWARE?: MiddlewareFromDef<TDef>;
		} & {
			[K in keyof TShape & string]: TShape[K] extends RouterGroupNode
				? K extends keyof TDefRouter
					? TDefRouter[K] extends RouterDefinition<TShape[K]["ROUTER"]>
						? RouterFromDefinition<
								TShape[K]["ROUTER"],
								TDefRouter[K],
								JoinPath<TPath, K>
							>
						: never
					: never
				: K extends keyof TDefRouter
					? TDefRouter[K] extends infer DefNode
						? {
								MIDDLEWARE?: MiddlewareFromDef<DefNode>;
								CONTRACT: DefNode extends { CONTRACT: infer C }
									? C
									: ContractMethodMap<ContractForPath<JoinPath<TPath, K>>>;
							} & (TShape[K]["ROUTER"] extends infer ChildShape extends RouterShape
								? DefNode extends {
										ROUTER: infer R extends Record<string, unknown>;
									}
									? {
											ROUTER: ContractChildrenFromDefinition<
												ChildShape,
												R,
												JoinPath<TPath, K>
											>;
										}
									: { ROUTER?: undefined }
								: { ROUTER?: undefined })
						: never
					: never;
		}
	: { MIDDLEWARE?: MiddlewareFromDef<TDef> };

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
		: TShape[K] extends RouterGroupNode
			? PathsFromShape<TShape[K]["ROUTER"], JoinPath<TPrefix, K>>
			: never;
}[keyof TShape & string];

export type RouterShapePath<T extends RouterShape> = PathsFromShape<T>;

type ContractFromPath<
	TShape extends RouterShape,
	TPath extends RouterShapePath<TShape>,
> = TPath extends `${infer TPrefix}.${infer TSuffix}`
	? TShape[TPrefix] extends RouterGroupNode
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
