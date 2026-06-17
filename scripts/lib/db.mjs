import { createRequire } from "node:module";
import { join } from "node:path";

const GAME_COLUMNS = [
  "game_pk",
  "game_date",
  "season",
  "game_type",
  "status",
  "status_detail",
  "away_team_id",
  "away_team_name",
  "away_team_abbrev",
  "home_team_id",
  "home_team_name",
  "home_team_abbrev",
  "away_score",
  "home_score",
  "venue_id",
  "venue_name",
  "official_date",
  "updated_at",
];

/** @param {string} webPackageJson */
function loadPg(webPackageJson) {
  const require = createRequire(webPackageJson);
  return require("pg").Pool;
}

/**
 * @param {string} root Repo root
 * @returns {{ mode: "rest", supabaseUrl: string, serviceRoleKey: string } | { mode: "postgres", databaseUrl: string }}
 */
export function resolveDbCredentials(root) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = process.env.DATABASE_URL;

  if (supabaseUrl && serviceRoleKey) {
    return { mode: "rest", supabaseUrl, serviceRoleKey };
  }

  if (databaseUrl) {
    return { mode: "postgres", databaseUrl };
  }

  const missing = [];
  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey && !databaseUrl) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY or DATABASE_URL");
  }

  throw new Error(
    `Missing database credentials (${missing.join(", ")}).\n` +
      "Option A: add SUPABASE_SERVICE_ROLE_KEY to web/.env.local\n" +
      "Option B: use DATABASE_URL in ingestor/.env (same as the ingestor)",
  );
}

/** @param {string} supabaseUrl @param {string} serviceRoleKey @param {object[]} rows @param {number} batchSize */
export async function upsertGamesViaRest(supabaseUrl, serviceRoleKey, rows, batchSize) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const response = await fetch(`${supabaseUrl}/rest/v1/games?on_conflict=game_pk`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase upsert failed (${response.status}): ${body}`);
    }

    console.log(`  upserted ${Math.min(i + batchSize, rows.length)} / ${rows.length}`);
  }
}

/** @param {string} databaseUrl @param {string} webPackageJson @param {object[]} rows @param {number} batchSize */
export async function upsertGamesViaPostgres(databaseUrl, webPackageJson, rows, batchSize) {
  const Pool = loadPg(webPackageJson);
  const pool = new Pool({ connectionString: databaseUrl });

  const updateClause = GAME_COLUMNS.filter((col) => col !== "game_pk")
    .map((col) => `${col} = EXCLUDED.${col}`)
    .join(", ");

  try {
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const values = [];
      const placeholders = batch.map((row, rowIndex) => {
        const base = rowIndex * GAME_COLUMNS.length;
        for (const column of GAME_COLUMNS) {
          values.push(row[column]);
        }
        const slot = GAME_COLUMNS.map((_, colIndex) => `$${base + colIndex + 1}`).join(", ");
        return `(${slot})`;
      });

      await pool.query(
        `INSERT INTO games (${GAME_COLUMNS.join(", ")})
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (game_pk) DO UPDATE SET ${updateClause}`,
        values,
      );

      console.log(`  upserted ${Math.min(i + batchSize, rows.length)} / ${rows.length}`);
    }
  } finally {
    await pool.end();
  }
}

/** @param {{ mode: "rest", supabaseUrl: string, serviceRoleKey: string } | { mode: "postgres", databaseUrl: string }} creds @param {string} root @param {object[]} rows @param {number} batchSize */
export async function upsertGames(creds, root, rows, batchSize) {
  if (creds.mode === "rest") {
    await upsertGamesViaRest(creds.supabaseUrl, creds.serviceRoleKey, rows, batchSize);
    return;
  }

  await upsertGamesViaPostgres(
    creds.databaseUrl,
    join(root, "web/package.json"),
    rows,
    batchSize,
  );
}

/** @param {{ mode: "postgres", databaseUrl: string }} creds @param {string} webPackageJson @param {number | null} onlyGamePk @param {boolean} force */
export async function listGamesForFeedSync(creds, webPackageJson, onlyGamePk, force = false) {
  if (creds.mode !== "postgres") return null;

  const Pool = loadPg(webPackageJson);
  const pool = new Pool({ connectionString: creds.databaseUrl });

  try {
    const params = [];
    let sql =
      "SELECT game_pk, status, feed_synced_at FROM games";
    const conditions = [];

    if (onlyGamePk != null) {
      params.push(onlyGamePk);
      conditions.push(`game_pk = $${params.length}`);
    } else if (!force) {
      conditions.push("(feed_synced_at IS NULL OR status IN ('Live', 'In Progress'))");
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }
    sql += " ORDER BY game_date ASC";

    const result = await pool.query(sql, params);
    return result.rows;
  } finally {
    await pool.end();
  }
}

/** @param {{ mode: "postgres", databaseUrl: string }} creds @param {string} webPackageJson @param {number} gamePk @param {object} state @param {object | null} boxScore */
export async function updateGameFeedViaPostgres(creds, webPackageJson, gamePk, state, boxScore) {
  const Pool = loadPg(webPackageJson);
  const pool = new Pool({ connectionString: creds.databaseUrl });

  try {
    await pool.query(
      `UPDATE games SET
         game_state = $2::jsonb,
         box_score = $3::jsonb,
         feed_synced_at = $4,
         away_score = $5,
         home_score = $6,
         status = $7,
         venue_id = $8,
         venue_name = $9,
         updated_at = $4
       WHERE game_pk = $1`,
      [
        gamePk,
        JSON.stringify(state),
        boxScore ? JSON.stringify(boxScore) : null,
        new Date().toISOString(),
        state.awayRuns,
        state.homeRuns,
        state.gameStatus,
        state.venueId,
        state.venueName,
      ],
    );
  } finally {
    await pool.end();
  }
}
