import { input, password, number } from "@inquirer/prompts";
import fsp from "node:fs/promises";

export async function start() {
  await fsp.unlink("./.database").catch(() => null);

  const host = await input({ message: "What is database host?" });
  const port = await number({ message: "What is database port?" });
  const database = await input({ message: "What is database name?" });
  const user = await input({ message: "What is database user?" });
  const pass = await password({ message: "What is database password?" });

  const connection = { host, port, database, password: pass, user };

  await fsp.writeFile("./.database", JSON.stringify(connection));
}
