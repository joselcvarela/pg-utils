import Knex from "knex";
import fsp from "node:fs/promises";

let knex: Knex.Knex | null = null;

export async function useDatabase() {
  if (!knex) {
    let config_json = await fsp.readFile("./.database").catch(() => null);

    if (!config_json) {
      await import("./actions/change_database_config").then((m) => m.start());
      config_json = await fsp.readFile("./.database");
    }

    const connection = JSON.parse(config_json.toString("utf-8"));

    knex = Knex({ client: "pg", connection });

    try {
      await knex.raw("select 1");
    } catch (err) {
      throw err;
    }
  }

  return knex;
}
