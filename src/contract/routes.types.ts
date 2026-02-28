import type { ContractMethodMap } from "~/contract/contract.types.js";
import type { RouterShape, ShapeNode } from "~/contract/shape.types.js";
import type { JoinPath } from "~/internal/util.types.js";

type RouteDefinitionNode<TNode extends ShapeNode, TPath extends string> = (TNode extends {
	CONTRACT: true;
}
	? { CONTRACT: ContractMethodMap }
	: unknown) &
	(TNode extends { ROUTER: infer R extends Record<string, ShapeNode> }
		? {
				ROUTER: {
					[K in keyof R & string]: RouteDefinitionNode<R[K], JoinPath<TPath, K>>;
				};
			}
		: unknown);

export type RouteDefinition<TShape extends RouterShape> = {
	ROUTER: {
		[K in keyof TShape["ROUTER"] & string]: RouteDefinitionNode<TShape["ROUTER"][K], K>;
	};
};
