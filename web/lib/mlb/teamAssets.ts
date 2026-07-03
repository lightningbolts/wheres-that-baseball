export type TeamLogoTheme = "light" | "dark";

/** MLB Static CDN team logo — pick on-light vs on-dark for contrast with the page background. */
export function mlbTeamLogoUrl(teamId: number, theme: TeamLogoTheme): string {
  const surface = theme === "dark" ? "on-dark" : "on-light";
  return `https://www.mlbstatic.com/team-logos/team-cap-${surface}/${teamId}.svg`;
}

/** Raster logo for OG/share cards (Satori does not render SVG). */
export function mlbTeamShareLogoUrl(teamId: number): string {
  return `https://www.mlbstatic.com/team-logos/share/${teamId}.jpg`;
}
