import { useDatabase } from "./database";

export async function cleanup() {
  useDatabase().then((db) => db && db.destroy());
}
