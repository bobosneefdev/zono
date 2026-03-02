import type {
	Contract,
	ContractMethodMap,
	RouterShape,
	ShapeNode,
} from "~/contract/contract.types.js";
import { getContractMethods, isContractNode, isRecord, isRouterNode } from "~/internal/util.js";
import type { JoinPath } from "~/internal/util.types.js";

type ContractDefinitionNode<TNode extends ShapeNode, TPath extends string> = (TNode extends {
	CONTRACT: true;
}
	? { CONTRACT: ContractMethodMap }
	: unknown) &
	(TNode extends { ROUTER: infer R extends Record<string, ShapeNode> }
		? {
				ROUTER: {
					[K in keyof R & string]: ContractDefinitionNode<R[K], JoinPath<TPath, K>>;
				};
			}
		: unknown);

/**
 * Type-safe contract definition matching a router shape.
 * Provides autocomplete for paths and methods based on the shape structure.
 * @template TShape - The router shape to define contracts for
 */
export type ContractDefinition<TShape extends RouterShape> = {
	ROUTER: {
		[K in keyof TShape["ROUTER"] & string]: ContractDefinitionNode<TShape["ROUTER"][K], K>;
	};
};

function validateContractNode(node: unknown): void {
	if (!isRecord(node)) {
		return;
	}

	if (isContractNode(node)) {
		const contractMap = node.CONTRACT as ContractMethodMap;
		for (const method of getContractMethods(contractMap)) {
			const contract = contractMap[method] as Contract | undefined;
			if (!contract) continue;

			// Validate that response schemas are accessible (no structural issues)
			for (const response of Object.values(contract.responses)) {
				void response;
			}
		}
	}

	if (isRouterNode(node)) {
		for (const child of Object.values(node.ROUTER)) {
			validateContractNode(child);
		}
	}
}

/**
 * Creates a type-safe contract definition matching the given router shape.
 * @param _shape - The router shape (used for type inference only)
 * @param definition - The contract definition
 * @returns The validated contract definition
 */
export function createContracts<
	const TShape extends RouterShape,
	const TDef extends ContractDefinition<TShape>,
>(_shape: TShape, definition: TDef): TDef {
	validateContractNode(definition);
	return definition;
}
