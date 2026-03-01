import type {
	Contract,
	ContractMethodMap,
	ContractResponse,
	RouterShape,
	ShapeNode,
} from "~/contract/contract.types.js";
import { validateRouteContractSchema } from "~/internal/schema_channels.js";
import { getContractMethods, isContractNode, isRecord, isRouterNode } from "~/internal/util.js";
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

/**
 * Type-safe route definition matching a router shape.
 * Provides autocomplete for paths and methods based on the shape structure.
 * @template TShape - The router shape to define routes for
 */
export type RouteDefinition<TShape extends RouterShape> = {
	ROUTER: {
		[K in keyof TShape["ROUTER"] & string]: RouteDefinitionNode<TShape["ROUTER"][K], K>;
	};
};

function validateRouteContractsNode(node: unknown): void {
	if (!isRecord(node)) {
		return;
	}

	if (isContractNode(node)) {
		const contractMap = node.CONTRACT as ContractMethodMap;
		for (const method of getContractMethods(contractMap)) {
			const contract = contractMap[method] as Contract | undefined;
			if (!contract) continue;

			if (contract.pathParams) validateRouteContractSchema(contract.pathParams);
			if (contract.query) validateRouteContractSchema(contract.query.schema);
			if (contract.headers) validateRouteContractSchema(contract.headers);
			if (contract.body) validateRouteContractSchema(contract.body.schema);

			for (const response of Object.values(contract.responses) as Array<ContractResponse>) {
				if (response.schema) validateRouteContractSchema(response.schema);
				if (response.headers) validateRouteContractSchema(response.headers);
			}
		}
	}

	if (isRouterNode(node)) {
		for (const child of Object.values(node.ROUTER)) {
			validateRouteContractsNode(child);
		}
	}
}

/**
 * Creates a type-safe route definition matching the given router shape.
 * Validates that all schemas in the definition are properly configured.
 * @param _shape - The router shape (used for type inference only)
 * @param definition - The route definition with contracts
 * @returns The validated route definition
 */
export function createRoutes<
	const TShape extends RouterShape,
	const TDef extends RouteDefinition<TShape>,
>(_shape: TShape, definition: TDef): TDef {
	validateRouteContractsNode(definition);
	return definition;
}
