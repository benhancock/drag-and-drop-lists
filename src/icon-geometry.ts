export interface RectangleGeometry {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface IconOverlayGeometry {
	left: number;
	top: number;
	width: number;
	height: number;
}

export function calculateIconOverlayGeometry(
	checkbox: RectangleGeometry,
	container: RectangleGeometry,
	containerBorderLeft: number,
	containerBorderTop: number,
): IconOverlayGeometry | null {
	if (checkbox.width <= 0 || checkbox.height <= 0) return null;
	return {
		left: checkbox.left - container.left - containerBorderLeft,
		top: checkbox.top - container.top - containerBorderTop,
		width: checkbox.width,
		height: checkbox.height,
	};
}
