import { input, select } from "@inquirer/prompts";
import { useDatabase } from "../database";
import cli from "../cli";
import { Knex } from "knex";

type PrimaryKey = {
  constraint_name: string;
  column_name: string;
};

type ForeignKey = {
  constraint_name: string;
  foreign_column: string;
  foreign_table: string;
  referenced_column: string;
  referenced_table: string;
};

type Field = {
  id: number;
  collection: string;
  field: string;
  sort: string;
};
type Relation = {
  id: number;
  many_collection: string;
  many_field: string;
  junction_field: string;
};

export async function start() {
  const database = await useDatabase();
  const trx = await database.transaction();

  const table_name =
    cli.params?.table_name ||
    (await input({ message: "What is the table name?" }));

  const new_column_name =
    cli.params?.new_column_name ||
    (await input({
      message: "What is the new column name?",
    }));

  const new_column_type = (cli.params?.new_column_type ||
    (await select({
      message: "What is the new column type?",
      choices: [
        {
          name: "Int",
          value: "int",
        },
        {
          name: "UUID",
          value: "uuid",
        },
      ],
    }))) as "int" | "uuid";

  try {
    /**
     * Get current primary key
     */
    const pk = await trx
      .raw(
        `
      SELECT
    con.conname AS constraint_name,
    a.attname AS column_name
FROM
    pg_constraint con
JOIN
    pg_class rel ON rel.oid = con.conrelid
JOIN
    pg_attribute a ON a.attnum = ANY(con.conkey)
                  AND a.attrelid = rel.oid
WHERE
    con.contype = 'p'
    AND rel.relname = '${table_name}';
`
      )
      .then((r) => r.rows[0] as PrimaryKey);

    /**
     * Get foreign keys to main table
     */
    const foreign_keys = await trx
      .raw(
        `
    SELECT
        conname AS constraint_name,
        conrelid::regclass AS foreign_table,
        a.attname AS foreign_column,
        confrelid::regclass AS referenced_table,
        af.attname AS referenced_column
    FROM
        pg_constraint c
    JOIN
        pg_attribute a
        ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
    JOIN
        pg_attribute af
        ON af.attnum = ANY(c.confkey) AND af.attrelid = c.confrelid
    WHERE
        c.confrelid = '${table_name}'::regclass
        AND c.contype = 'f';
    `
      )
      .then((r) => r.rows as ForeignKey[]);

    /**
     * Go to foreign tables and override name.
     * For example, "blog_slug" will become "blog_id"
     */
    for (const fk of foreign_keys) {
      await trx.schema.alterTable(fk.foreign_table, (table) => {
        table.dropForeign(fk.foreign_column, fk.constraint_name);
        table.renameColumn(fk.foreign_column, get_old_foreign_name(fk));
        table.index(get_old_foreign_name(fk));
      });
    }

    /**
     * Remove primary key constraint from main table
     */
    await trx.schema.alterTable(table_name, (table) => {
      table.dropPrimary(pk.constraint_name);
    });

    /**
     * Create new column on main table
     */
    await trx.schema.alterTable(table_name, (table) => {
      if (new_column_type === "uuid") {
        table.uuid(new_column_name).defaultTo(database.fn.uuid()).primary();
      } else if (new_column_type === "int") {
        table.increments(new_column_name).primary();
      }
    });

    /**
     * Rename columns in foreign tables
     */
    for (const fk of foreign_keys) {
      const new_foreign_column_name = get_new_foreign_name(fk, pk);

      await trx.schema.alterTable(fk.foreign_table, (table) => {
        if (new_column_type === "uuid") {
          table.uuid(new_foreign_column_name);
        } else if (new_column_type === "int") {
          table.integer(new_foreign_column_name).unsigned();
        }

        table
          .foreign(new_foreign_column_name)
          .references(new_column_name)
          .inTable(table_name);
      });
    }

    /**
     * Update foreign columns to have the new value
     */
    for (const fk of foreign_keys) {
      const new_foreign_column_name = get_new_foreign_name(fk, pk);

      await trx(fk.foreign_table)
        .update({
          [new_foreign_column_name]: database.raw("??", [
            `${table_name}.${new_column_name}`,
          ]),
        })
        .updateFrom(table_name)
        .where(
          pk.column_name,
          database.raw("??", [
            `${fk.foreign_table}.${get_old_foreign_name(fk)}`,
          ])
        );
    }

    /**
     * Drop old column from foreign tables
     */
    for (const fk of foreign_keys) {
      await trx.schema.alterTable(fk.foreign_table, (table) => {
        table.dropColumn(get_old_foreign_name(fk));
      });
    }

    await directus({
      foreign_keys,
      pk,
      trx,
    });

    await trx.commit();
  } catch (error) {
    await trx.rollback();
    throw error;
  }

  function get_new_foreign_name(fk: ForeignKey, pk: PrimaryKey) {
    return fk.foreign_column === `${table_name}_${pk.column_name}`
      ? `${fk.foreign_table}_${new_column_name}`
      : fk.foreign_column;
  }

  function get_old_foreign_name(fk: ForeignKey) {
    return `old_${fk.foreign_column}`;
  }

  async function directus({
    trx,
    foreign_keys,
    pk,
  }: {
    trx: Knex.Transaction;
    foreign_keys: ForeignKey[];
    pk: PrimaryKey;
  }) {
    /**
     * Update foreign columns name in fields and relations
     */
    for (const fk of foreign_keys) {
      const new_foreign_column_name = get_new_foreign_name(fk, pk);
      const field = await trx<Field>("directus_fields")
        .where({
          collection: fk.foreign_table,
          field: fk.foreign_column,
        })
        .first();

      if (field) {
        // Re-insert field without any options like interface
        await trx("directus_fields").delete().where({ id: field.id });
        await trx("directus_fields").insert({
          id: field.id,
          collection: fk.foreign_table,
          field: new_foreign_column_name,
          sort: field.sort,
        });
      }

      const relations = await trx<Relation>("directus_relations").where({
        many_collection: fk.foreign_table,
      });

      for (const relation of relations) {
        if (relation.junction_field === fk.foreign_column) {
          await trx("directus_relations")
            .update({ junction_field: new_foreign_column_name })
            .where({ id: relation.id });
        } else if (relation.many_field === fk.foreign_column) {
          await trx("directus_relations")
            .update({ many_field: new_foreign_column_name })
            .where({ id: relation.id });
        }
      }
    }

    /**
     * Create primary column in fields
     */
    {
      const result = await trx<Field>("directus_fields")
        .max("sort")
        .where("collection", table_name)
        .first();

      if (result?.max) {
        await trx("directus_fields").insert({
          collection: table_name,
          field: new_column_name,
          sort: result.max + 1,
        });
      }
    }
  }
}
