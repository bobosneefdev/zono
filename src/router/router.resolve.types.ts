import type { MergeContractResponses } from "~/contract/contract.responses.js";
import type {
	ContractMethod,
	ContractMethodMap,
	ContractResponses,
} from "~/contract/contract.types.js";
import type { JoinPath } from "~/internal/util.types.js";
import type { MiddlewareContractMap } from "~/router/router.types.js";

type DotPathToRoutePath<TPath extends string> = TPath extends `${infer TSegment}.${infer TRest}`
	? `/${TSegment}${DotPathToRoutePath<TRest>}`
	: `/${TPath}`;

type StripLeadingSlash<TPath extends string> = TPath extends `/${infer TRest}` ? TRest : TPath;

type RoutePathToDotPath<TPath extends string> =
	StripLeadingSlash<TPath> extends `${infer TSegment}/${infer TRest}`
		? `${TSegment}.${RoutePathToDotPath<TRest>}`
		: StripLeadingSlash<TPath>;

type RouteKeys<TNode> =
	TNode extends Record<string, unknown> ? Exclude<keyof TNode & string, "MIDDLEWARE"> : never;

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
				[K in RouteKeys<TNode>]: RoutePathsFromNode<TNode[K], JoinPath<TPrefix, K>>;
			}[RouteKeys<TNode>]
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

/** Flatten middleware map values into merged ContractResponses */
type FlattenMiddlewareMap<M> = M extends MiddlewareContractMap
	? M[keyof M] extends infer R extends ContractResponses
		? R
		: Record<never, never>
	: Record<never, never>;

/** Recursively collect middleware responses from root to the path's node */
type CollectMiddlewareAlongPath<
	TNode,
	TPath extends string,
> = TPath extends `${infer K}.${infer Rest}`
	? K extends keyof TNode
		? TNode[K] extends infer Child
			? FlattenMiddlewareMap<
					TNode extends { MIDDLEWARE?: infer M } ? M : never
				> extends infer RootMw extends ContractResponses
				? Child extends { MIDDLEWARE?: infer CM }
					? MergeContractResponses<
							RootMw,
							MergeContractResponses<
								FlattenMiddlewareMap<CM>,
								CollectMiddlewareAlongPath<
									Child extends { ROUTER?: infer R } ? R : Child,
									Rest
								>
							>
						>
					: MergeContractResponses<
							RootMw,
							CollectMiddlewareAlongPath<
								Child extends { ROUTER?: infer R } ? R : Child,
								Rest
							>
						>
				: never
			: never
		: Record<never, never>
	: TNode extends { MIDDLEWARE?: infer M }
		? FlattenMiddlewareMap<M>
		: Record<never, never>;

/** Merged middleware response schemas for all middleware along the path from root to target */
export type CollectMiddlewareResponses<
	TRouter,
	TPath extends RouterPath<TRouter>,
> = CollectMiddlewareAlongPath<TRouter, RoutePathToDotPath<TPath>> extends infer R
	? R extends ContractResponses
		? R
		: Record<never, never>
	: Record<never, never>;
