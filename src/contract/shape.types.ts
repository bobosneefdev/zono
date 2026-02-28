export type ShapeNode = {
	CONTRACT?: true;
	ROUTER?: Record<string, ShapeNode>;
};

export type RouterShape = {
	ROUTER: Record<string, ShapeNode>;
};
