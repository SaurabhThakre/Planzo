export const landscapes = ["coast", "mountains", "city", "desert", "countryside"] as const;
export const palettes = ["dawn", "daylight", "dusk"] as const;
export type CoverScene = { landscape: typeof landscapes[number]; palette: typeof palettes[number] };

export function parseCoverScene(value: unknown): CoverScene | null {
    if (typeof value !== "object" || value === null) return null;
    const { landscape, palette } = value as CoverScene;
    if (!landscapes.includes(landscape) || !palettes.includes(palette)) return null;
    return { landscape, palette };
}
