import type { Contract } from "~/contract/types.js";
import type { JoinPath } from "~/internal/types.js";

type DotPathToRoutePath<TPath extends string> = TPath extends `${infer TSegment}.${infer TRest}`
	? `/${TSegment}${DotPathToRoutePath<TRest>}`
	: `/${TPath}`;

type StripLeadingSlash<TPath extends string> = TPath extends `/${infer TRest}` ? TRest : TPath;

type RoutePathToDotPath<TPath extends string> =
	StripLeadingSlash<TPath> extends `${infer TSegment}/${infer TRest}`
		? `${TSegment}.${RoutePathToDotPath<TRest>}`
		: StripLeadingSlash<TPath>;

type RoutePathsFromNode<TNode, TPrefix extends string = ""> = TNode extends {
	contract: Contract;
}
	?
			| DotPathToRoutePath<TPrefix>
			| (TNode extends { router: infer TRouter }
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

type NextNodeForPath<TNode> = TNode extends { router: infer TRouter } ? TRouter : TNode;

type ContractAtDotPath<
	TNode,
	TPath extends string,
> = TPath extends `${infer TSegment}.${infer TRest}`
	? TSegment extends keyof TNode
		? ContractAtDotPath<NextNodeForPath<TNode[TSegment]>, TRest>
		: never
	: TPath extends keyof TNode
		? ContractFromNode<TNode[TPath]>
		: never;

type ContractFromNode<TNode> = TNode extends { contract: infer TContract extends Contract }
	? TContract
	: never;

export type RouterRoutePath<TRouter> = RoutePathsFromNode<TRouter>;

export type ContractForRoutePath<
	TRouter,
	TRoute extends RouterRoutePath<TRouter>,
> = ContractFromNode<ValueAtDotPath<TRouter, RoutePathToDotPath<TRoute>>> extends never
	? ContractAtDotPath<TRouter, RoutePathToDotPath<TRoute>>
	: ContractFromNode<ValueAtDotPath<TRouter, RoutePathToDotPath<TRoute>>>;
