/** Static club data for the franchise: park factors, markets, ballparks, rivals, names. */

export interface ClubInfo {
  /** Run and home-run park factors (1 = neutral). */
  run: number;
  hr: number;
  /** Metro population, millions (drives attendance, media, sponsorship). */
  pop: number;
  capacity: number;
  /** Local media rights, $M per season. */
  localMedia: number;
  /** Ballpark appeal 0.8–1.2 (newer / iconic parks draw better). */
  park: number;
}

export const CLUBS: Record<number, ClubInfo> = {
  108: { run: 1.0, hr: 1.05, pop: 6, capacity: 45517, localMedia: 80, park: 0.98 },
  109: { run: 1.03, hr: 0.95, pop: 4.9, capacity: 48405, localMedia: 45, park: 0.95 },
  110: { run: 1.0, hr: 1.02, pop: 2.8, capacity: 45971, localMedia: 45, park: 1.1 },
  111: { run: 1.06, hr: 0.95, pop: 4.9, capacity: 37755, localMedia: 100, park: 1.2 },
  112: { run: 1.0, hr: 1.0, pop: 9.5, capacity: 41649, localMedia: 100, park: 1.2 },
  113: { run: 1.06, hr: 1.22, pop: 2.3, capacity: 43500, localMedia: 40, park: 0.95 },
  114: { run: 0.97, hr: 0.95, pop: 2.1, capacity: 34830, localMedia: 40, park: 0.95 },
  115: { run: 1.14, hr: 1.12, pop: 3.0, capacity: 50144, localMedia: 45, park: 1.05 },
  116: { run: 0.98, hr: 0.93, pop: 4.3, capacity: 41083, localMedia: 50, park: 1.0 },
  117: { run: 0.99, hr: 1.05, pop: 7.1, capacity: 41168, localMedia: 75, park: 1.0 },
  118: { run: 1.03, hr: 0.88, pop: 2.2, capacity: 37903, localMedia: 35, park: 0.95 },
  119: { run: 1.01, hr: 1.12, pop: 13, capacity: 56000, localMedia: 200, park: 1.15 },
  120: { run: 1.0, hr: 1.02, pop: 6.3, capacity: 41339, localMedia: 55, park: 0.95 },
  121: { run: 0.96, hr: 0.98, pop: 20, capacity: 41922, localMedia: 110, park: 1.0 },
  133: { run: 1.03, hr: 1.05, pop: 2.4, capacity: 14014, localMedia: 25, park: 0.8 },
  134: { run: 0.98, hr: 0.88, pop: 2.4, capacity: 38747, localMedia: 40, park: 1.1 },
  135: { run: 0.95, hr: 0.98, pop: 3.3, capacity: 40209, localMedia: 55, park: 1.1 },
  136: { run: 0.92, hr: 0.95, pop: 4.0, capacity: 47929, localMedia: 65, park: 1.0 },
  137: { run: 0.94, hr: 0.85, pop: 4.7, capacity: 41915, localMedia: 80, park: 1.15 },
  138: { run: 0.97, hr: 0.9, pop: 2.8, capacity: 44383, localMedia: 65, park: 1.05 },
  139: { run: 0.97, hr: 0.95, pop: 3.2, capacity: 25000, localMedia: 30, park: 0.8 },
  140: { run: 0.99, hr: 1.0, pop: 7.6, capacity: 40300, localMedia: 75, park: 1.0 },
  141: { run: 1.0, hr: 1.03, pop: 6.7, capacity: 39150, localMedia: 80, park: 1.0 },
  142: { run: 1.0, hr: 1.0, pop: 3.7, capacity: 38544, localMedia: 45, park: 1.0 },
  143: { run: 1.03, hr: 1.12, pop: 6.2, capacity: 42901, localMedia: 90, park: 1.05 },
  144: { run: 1.0, hr: 1.03, pop: 6.1, capacity: 41084, localMedia: 75, park: 1.05 },
  145: { run: 1.0, hr: 1.08, pop: 5, capacity: 40615, localMedia: 50, park: 0.9 },
  146: { run: 0.96, hr: 0.9, pop: 6.1, capacity: 37446, localMedia: 30, park: 0.9 },
  147: { run: 1.02, hr: 1.15, pop: 20, capacity: 46537, localMedia: 160, park: 1.15 },
  158: { run: 0.99, hr: 1.05, pop: 1.6, capacity: 41700, localMedia: 40, park: 1.0 },
};

export const club = (id: number): ClubInfo => CLUBS[id] ?? { run: 1, hr: 1, pop: 4, capacity: 40000, localMedia: 50, park: 1 };

/** Reference ticket price for a market, $. */
export const refTicketPrice = (id: number): number => Math.round(26 + 7 * Math.log2(club(id).pop + 1));

/** AL team → NL natural rival (home-and-home 2+2 each season). */
export const RIVALS: Array<[number, number]> = [
  [147, 121], // NYY–NYM
  [145, 112], // CWS–CHC
  [108, 119], // LAA–LAD
  [133, 137], // ATH–SF
  [110, 120], // BAL–WSH
  [111, 144], // BOS–ATL
  [139, 146], // TB–MIA
  [141, 143], // TOR–PHI
  [114, 113], // CLE–CIN
  [116, 134], // DET–PIT
  [118, 138], // KC–STL
  [142, 158], // MIN–MIL
  [117, 115], // HOU–COL
  [136, 135], // SEA–SD
  [140, 109], // TEX–ARI
];

export const FIRST_NAMES = [
  "Aaron", "Adrian", "Alex", "Andres", "Andrew", "Angel", "Anthony", "Austin", "Ben", "Blake", "Brandon", "Brayan", "Brett", "Bryce", "Caleb", "Cameron",
  "Carlos", "Carson", "Chase", "Chris", "Cole", "Colton", "Connor", "Cristian", "Dalton", "Daniel", "David", "Diego", "Dylan", "Eduardo", "Eli", "Elian",
  "Emmanuel", "Enrique", "Eric", "Ethan", "Felix", "Francisco", "Gabriel", "Garrett", "Gavin", "Grant", "Gunnar", "Hayden", "Hector", "Hunter", "Ian",
  "Isaac", "Jace", "Jackson", "Jacob", "Jake", "James", "Jared", "Javier", "Jesus", "Joel", "Johan", "Jonah", "Jordan", "Jose", "Josh", "Juan", "Julio",
  "Justin", "Kaleb", "Keegan", "Kevin", "Kyle", "Landon", "Liam", "Logan", "Luis", "Marco", "Mason", "Matt", "Max", "Miguel", "Nathan", "Nick", "Noah",
  "Oliver", "Omar", "Owen", "Pablo", "Parker", "Pedro", "Rafael", "Ramon", "Reid", "Ricky", "Riley", "Roman", "Ryan", "Samuel", "Sean", "Spencer",
  "Tanner", "Travis", "Trey", "Tyler", "Victor", "Wesley", "Wilmer", "Wyatt", "Yainer", "Yohel", "Zach",
];

export const LAST_NAMES = [
  "Acosta", "Adams", "Aguilar", "Allen", "Alvarez", "Baker", "Barnes", "Bell", "Bennett", "Brooks", "Brown", "Bryant", "Burke", "Butler", "Campbell",
  "Carter", "Castillo", "Castro", "Chavez", "Clark", "Coleman", "Collins", "Cook", "Cooper", "Cruz", "Daniels", "Davis", "Diaz", "Dixon", "Duran",
  "Edwards", "Ellis", "Espinal", "Evans", "Fisher", "Flores", "Ford", "Foster", "Garcia", "Gibson", "Gomez", "Gonzalez", "Graham", "Grant", "Gray",
  "Green", "Griffin", "Gutierrez", "Hall", "Hamilton", "Harris", "Hayes", "Henderson", "Hernandez", "Hill", "Holmes", "Howard", "Hughes", "Jackson",
  "James", "Jenkins", "Jimenez", "Johnson", "Jordan", "Kelly", "Kennedy", "King", "Lee", "Lewis", "Long", "Lopez", "Marshall", "Martinez", "Mason",
  "Medina", "Mejia", "Mendoza", "Miller", "Mitchell", "Montero", "Moore", "Morales", "Moreno", "Morgan", "Murphy", "Myers", "Nelson", "Nunez", "Ortiz",
  "Owens", "Palmer", "Parker", "Patterson", "Pena", "Perez", "Perry", "Peterson", "Phillips", "Pierce", "Powell", "Price", "Ramirez", "Ramos", "Reed",
  "Reyes", "Reynolds", "Rivera", "Roberts", "Robinson", "Rodriguez", "Rogers", "Romero", "Rosario", "Ross", "Ruiz", "Russell", "Sanchez", "Sanders",
  "Santana", "Scott", "Simmons", "Soto", "Stewart", "Sullivan", "Taylor", "Thomas", "Thompson", "Torres", "Tucker", "Turner", "Valdez", "Vargas",
  "Vasquez", "Walker", "Wallace", "Ward", "Warren", "Washington", "Watson", "Webb", "Wells", "West", "White", "Williams", "Wilson", "Wood", "Wright", "Young",
];

/** League constants for the PA sim (2025-ish environment). */
export const LG = {
  k: 0.222,
  bb: 0.084,
  hbp: 0.011,
  hr: 0.03,
  babip: 0.291,
  xbh: 0.243,
  woba: 0.312,
  wobaScale: 1.25,
  runsPerPa: 0.118,
};

/** $ per WAR on the open market (2027), $M. */
export const DOLLARS_PER_WAR = 9.5;
export const MIN_SALARY = 0.8;
/** Competitive balance tax base threshold for a season, $M. */
export const cbtThreshold = (season: number): number => 244 + Math.max(0, season - 2026) * 4;
export const NATIONAL_MEDIA = 68;
