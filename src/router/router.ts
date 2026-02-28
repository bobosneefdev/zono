import { isRecord } from "~/internal/util.js";
import type { RouterDefinition, RouterFromDefinition, RouterShape } from "~/router/router.types.js";

function flattenDefinition(
	shape: Record<string, unknown>,
	definition: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	if (definition.MIDDLEWARE !== undefined) {
		result.MIDDLEWARE = definition.MIDDLEWARE;
	}

	const defRouter = definition.ROUTER;
	if (!isRecord(defRouter)) {
		return result;
	}

	for (const key of Object.keys(shape)) {
		const shapeChild = shape[key];
		const defChild = defRouter[key];

		if (!isRecord(shapeChild) || !isRecord(defChild)) {
			continue;
		}

		const shapeType = (shapeChild as { TYPE?: string }).TYPE;
		if (shapeType === "router") {
			const innerShape = (shapeChild as { ROUTER?: unknown }).ROUTER;
			const innerDef = defChild;
			if (isRecord(innerShape) && isRecord(innerDef)) {
				result[key] = flattenDefinition(
					innerShape as Record<string, unknown>,
					innerDef as Record<string, unknown>,
				);
			}
		} else {
			result[key] = {
				...(defChild.MIDDLEWARE !== undefined && { MIDDLEWARE: defChild.MIDDLEWARE }),
				CONTRACT: defChild.CONTRACT,
				...(defChild.ROUTER !== undefined && {
					ROUTER: flattenContractChildren(
						shapeChild.ROUTER as Record<string, unknown> | undefined,
						defChild.ROUTER as Record<string, unknown>,
					),
				}),
			};
		}
	}

	return result;
}

function flattenContractChildren(
	shapeRouter: Record<string, unknown> | undefined,
	defRouter: Record<string, unknown>,
): Record<string, unknown> {
	if (!isRecord(shapeRouter)) {
		return {};
	}

	const result: Record<string, unknown> = {};
	for (const key of Object.keys(shapeRouter)) {
		const shapeChild = shapeRouter[key];
		const defChild = defRouter[key];

		if (!isRecord(shapeChild) || !isRecord(defChild)) {
			continue;
		}

		if (shapeChild.TYPE === "router") {
			const innerShape = shapeChild.ROUTER;
			const innerDef = defChild.ROUTER;
			if (isRecord(innerShape) && isRecord(innerDef)) {
				const flattened = flattenDefinition(innerShape, innerDef);
				for (const [k, v] of Object.entries(flattened)) {
					result[k] = v;
				}
			}
		} else {
			result[key] = {
				...(defChild.MIDDLEWARE !== undefined && { MIDDLEWARE: defChild.MIDDLEWARE }),
				CONTRACT: defChild.CONTRACT,
				...(defChild.ROUTER !== undefined && {
					ROUTER: flattenContractChildren(
						shapeChild.ROUTER as Record<string, unknown> | undefined,
						defChild.ROUTER as Record<string, unknown>,
					),
				}),
			};
		}
	}
	return result;
}

export function createRouter<TShape extends RouterShape, TDef extends RouterDefinition<TShape>>(
	shape: TShape,
	definition: TDef,
): RouterFromDefinition<TShape, TDef> {
	return flattenDefinition(
		shape as Record<string, unknown>,
		definition as Record<string, unknown>,
	) as RouterFromDefinition<TShape, TDef>;
}
