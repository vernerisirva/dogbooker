export type Dog = {
  id: string;
  name: string;
  size: "small" | "medium" | "large";
  age_years: number;
  breed: string;
  social: boolean;
  requirements: string[];
  preferences: string[];
  care_notes: string;
};
export type MatchingDog = Pick<
  Dog,
  "id" | "size" | "social" | "requirements" | "preferences"
>;
export type Sitter = {
  id: string;
  name: string;
  area: string;
  latitude: number;
  longitude: number;
  radius_km: number;
  description: string;
  sizes: string[];
  experience_years: number;
  daily_price: number;
  capacity: number;
  resident_dogs: boolean;
  services: string[];
  preferences: string[];
  published: boolean;
};
export type Candidate = {
  profile: Sitter;
  available: boolean;
  capacity_ok: boolean;
};
export const defaultWeights = {
  distance: 0.35,
  price: 0.2,
  experience: 0.2,
  preferences: 0.25,
};
export const matchingVersion = "deterministic-v1";
export function distanceKm(a: number, b: number, c: number, d: number) {
  const rad = (x: number) => (x * Math.PI) / 180;
  return (
    6371 *
    2 *
    Math.asin(
      Math.sqrt(
        Math.min(
          1,
          Math.sin(rad(c - a) / 2) ** 2 +
            Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2,
        ),
      ),
    )
  );
}
export function rankSitters(
  candidates: Candidate[],
  dogs: MatchingDog[],
  location: { latitude: number; longitude: number },
  weights = defaultWeights,
) {
  if (
    !dogs.length ||
    !Number.isFinite(location.latitude) ||
    Math.abs(location.latitude) > 90 ||
    !Number.isFinite(location.longitude) ||
    Math.abs(location.longitude) > 180
  )
    throw new Error("Invalid matching input");
  if (
    Object.values(weights).some((v) => !Number.isFinite(v) || v < 0) ||
    Object.values(weights).reduce((a, b) => a + b, 0) <= 0
  )
    throw new Error("Invalid weights");
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  const evaluated = candidates.map(({ profile: s, available, capacity_ok }) => {
    const distance = distanceKm(
      location.latitude,
      location.longitude,
      Number(s.latitude),
      Number(s.longitude),
    );
    const reasons: string[] = [];
    if (!available) reasons.push("Hundvakten är inte tillgänglig alla dagar.");
    if (!capacity_ok || dogs.length > s.capacity)
      reasons.push("Det finns inte plats för hela sällskapet.");
    if (distance > s.radius_km)
      reasons.push("Platsen ligger utanför hundvaktens serviceområde.");
    if (dogs.some((d) => !s.sizes.includes(d.size)))
      reasons.push("Hundens storlek tas inte emot.");
    if (dogs.some((d) => !d.social) && s.resident_dogs)
      reasons.push("Hunden behöver ett hem utan andra hundar.");
    if (dogs.some((d) => d.requirements.some((r) => !s.services.includes(r))))
      reasons.push("Hundvakten erbjuder inte all omsorg som behövs.");
    if (!s.published) reasons.push("Profilen är inte publicerad.");
    const preferences = [...new Set(dogs.flatMap((d) => d.preferences))];
    const factors = {
      distance: Math.max(0, 1 - distance / s.radius_km),
      price: 1 / (1 + s.daily_price / 50000),
      experience: Math.min(1, s.experience_years / 10),
      preferences: preferences.length
        ? preferences.filter((p) => s.preferences.includes(p)).length /
          preferences.length
        : 0.5,
    };
    const score =
      Math.round(
        ((100 *
          Object.entries(factors).reduce(
            (v, [k, n]) => v + n * weights[k as keyof typeof weights],
            0,
          )) /
          sum) *
          100,
      ) / 100;
    return {
      sitter: s,
      distanceKm: Math.round(distance * 10) / 10,
      score,
      factors,
      reasons,
      explanations: [
        `${Math.round(distance)} km från din sökplats (ungefärligt).`,
        `${s.daily_price / 100} kr per hund och dag.`,
        `${s.experience_years} års uppgiven erfarenhet.`,
        preferences.length
          ? `${preferences.filter((p) => s.preferences.includes(p)).length} av ${preferences.length} önskemål matchar.`
          : "Inga särskilda önskemål angivna.",
        "Storlek och omsorgsbehov passar.",
        ...(dogs.some((d) => !d.social)
          ? ["Hela kapaciteten reserveras för era hundar."]
          : []),
      ],
    };
  });
  return {
    version: matchingVersion,
    matches: evaluated
      .filter((x) => !x.reasons.length)
      .sort(
        (a, b) => b.score - a.score || a.sitter.id.localeCompare(b.sitter.id),
      ),
    excluded: evaluated
      .filter((x) => x.reasons.length)
      .map((x) => ({
        sitterId: x.sitter.id,
        name: x.sitter.name,
        reasons: x.reasons,
      })),
  };
}
