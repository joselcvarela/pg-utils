import { select } from "@inquirer/prompts";
import cli from "./cli";
import { cleanup } from "./cleanup";

async function start() {
  try {
    const choices = [
      {
        name: "Change primary key of table",
        value: "change_primary_key",
      },
      {
        name: "Change database config",
        value: "change_database_config",
      },
    ];

    const answer =
      choices.find((c) => c.value === cli.commands[0])?.value ||
      (await select({
        message: "What do you want to do?",
        choices,
      }));

    await import(`./actions/${answer}.js`).then((m) => m.start());
  } catch (error) {
    console.error(error);
  } finally {
    cleanup();
  }
}

start();
