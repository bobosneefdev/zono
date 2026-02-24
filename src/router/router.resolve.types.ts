import type { ContractMethod, ContractMethodMap } from "~/contract/contract.types.js";
import type { JoinPath } from "~/lib/util.types.js";

type DotPathToRoutePath<TPath extends string> = TPath extends `${infer TSegment}.${infer TRest}`
	? `/${TSegment}${DotPathToRoutePath<TRest>}`
	: `/${TPath}`;

type StripLeadingSlash<TPath extends string> = TPath extends `/${infer TRest}` ? TRest : TPath;

type RoutePathToDotPath<TPath extends string> =
	StripLeadingSlash<TPath> extends `${infer TSegment}/${infer TRest}`
		? `${TSegment}.${RoutePathToDotPath<TRest>}`
		: StripLeadingSlash<TPath>;

type RoutePathsFromNode<TNode, TPrefix extends string = ""> = TNode extends {
	CONTRACT: ContractMethodMap;
}
	?
			| DotPathToRoutePath<TPrefix>
			| (TNode extends { ROUTER: infer TRouter }
					? RoutePathsFromNode<TRouter, TPrefix>
					: never)
	: TNode extends Record<string, unknown>
		? {
				[K in keyof TNode & string]: RoutePathsFromNode<TNode[K], JoinPath<TPrefix, K>>;
			}[keyof TNode & string]
		: never;

type ValueAtDotPath<TValue, TPath extends string> = TPath extends `${infer TSegment}.${infer TRest}`
	? TSegment extends keyof TValue
		? ValueAtDotPath<TValue[TSegment], TRest>
		: never
	: TPath extends keyof TValue
		? TValue[TPath]
		: never;

type NextNodeForPath<TNode> = TNode extends { ROUTER: infer TRouter } ? TRouter : TNode;

type ContractAtDotPath<
	TNode,
	TPath extends string,
> = TPath extends `${infer TSegment}.${infer TRest}`
	? TSegment extends keyof TNode
		? ContractAtDotPath<NextNodeForPath<TNode[TSegment]>, TRest>
		: never
	: TPath extends keyof TNode
		? ContractMapFromNode<TNode[TPath]>
		: never;

type ContractMapFromNode<TNode> = TNode extends {
	CONTRACT: infer TContractMap extends ContractMethodMap;
}
	? TContractMap
	: never;

type ContractsFromMap<TContractMap extends ContractMethodMap> = Exclude<
	TContractMap[keyof TContractMap],
	undefined
>;

type ContractForMethod<
	TContractMap extends ContractMethodMap,
	TMethod extends ContractMethod,
> = Exclude<TContractMap[TMethod], undefined>;

export type RouterPathContractMap<
	TRouter,
	TRoute extends RouterPath<TRouter>,
> = ContractMapFromNode<ValueAtDotPath<TRouter, RoutePathToDotPath<TRoute>>> extends never
	? ContractAtDotPath<TRouter, RoutePathToDotPath<TRoute>>
	: ContractMapFromNode<ValueAtDotPath<TRouter, RoutePathToDotPath<TRoute>>>;

export type RouterPath<TRouter> = RoutePathsFromNode<TRouter>;

export type RouterMethodGivenPath<
	TRouter,
	TRoute extends RouterPath<TRouter>,
> = keyof RouterPathContractMap<TRouter, TRoute> & ContractMethod;

export type RouterContractGivenPath<
	TRouter,
	TRoute extends RouterPath<TRouter>,
> = RouterPathContractMap<TRouter, TRoute> extends infer TContractMap extends ContractMethodMap
	? ContractsFromMap<TContractMap>
	: never;

export type RouterContractGivenPathAndMethod<
	TRouter,
	TRoute extends RouterPath<TRouter>,
	TMethod extends ContractMethod,
> = RouterPathContractMap<TRouter, TRoute> extends infer TContractMap extends ContractMethodMap
	? ContractForMethod<TContractMap, TMethod>
	: never;
