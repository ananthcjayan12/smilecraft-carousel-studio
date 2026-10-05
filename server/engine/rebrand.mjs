// Update saved copy as well as seeds. Keep IDs, asset paths and provider settings intact.
const copyColumns = {
  engine_brands: ["name", "profile_json", "brand_json"],
  engine_templates: ["name", "roles_json", "instructions", "visual"],
  engine_ideas: ["hook", "show", "angle", "notes"],
  engine_magnets: ["name", "description", "how"],
  engine_plans: ["title"],
  engine_content: ["topic", "brief_json", "frames_json", "caption", "extras_json", "validation_json"],
  engine_styles: ["name", "notes"],
};

export function rebrandStatements(account) {
  return Object.entries(copyColumns).map(([table, columns]) => {
    const replace = (column) => `replace(replace(replace(${column}, 'SmileCraft', 'FlossPost'), 'smilecraft', 'flosspost'), 'SMILECRAFT', 'FLOSSPOST')`;
    const assignments = columns.map((column) => `${column}=${replace(column)}`);
    if (table === "engine_brands" || table === "engine_content") assignments.push("revision=revision+1");
    return [
      `UPDATE ${table} SET ${assignments.join(",")} WHERE account_id=? AND (${columns.map((column) => `${column} LIKE '%smilecraft%'`).join(" OR ")})`,
      account,
    ];
  });
}
